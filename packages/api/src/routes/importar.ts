/**
 * IMPORTACION DESDE EL SISTEMA POS — /api/importar
 *
 * Dos endpoints y una asimetria deliberada entre ellos:
 *
 *   POST /preview    lee el archivo y devuelve QUE CAMBIARIA. No escribe una sola fila.
 *   POST /ejecutar   vuelve a leer el archivo desde cero y escribe, en transaccion.
 *
 * POR QUE `ejecutar` NO CONFIA EN LO QUE MANDA EL NAVEGADOR. Seria mas simple que la
 * pantalla devolviera el plan que ya reviso el usuario y el servidor lo aplicara. Pero
 * entonces la verdad de que se escribe vive en el cliente, y cualquier cosa que llegue por
 * la red se aplica tal cual. Ademas el plan es grande —hasta 297 filas por colegio— y
 * viajaria dos veces.
 *
 * Asi que `ejecutar` re-parsea y re-resuelve. Y para probar que el archivo es el MISMO que
 * se reviso, el preview devuelve una HUELLA del contenido resuelto y la ejecucion exige
 * que coincida. Si no coincide, se niega. Sin eso se podria revisar una planilla y
 * confirmar otra: distinta version, distinto colegio, distintos precios.
 *
 * LO QUE ESTA IMPORTACION NO HACE, y conviene decirlo antes de que se descubra:
 *
 *   NO GUARDA EL PRECIO ANTERIOR. `historico_precio` exige `cambiado_por` referenciando a
 *   `usuario`, y esta importacion no tiene un usuario autenticado del que colgar el
 *   registro. El camino de vuelta es la INSTANTANEA, que por eso es obligatoria.
 *
 *   NO CALCULA COSTOS. Escribe precio de venta, codigo del POS e inventario. El costo de
 *   una prenda sale del peso de tela y la mano de obra, que el POS no tiene.
 *
 * MEDIDO SOBRE EL ARCHIVO REAL antes de escribir una linea de este archivo: de las 463
 * filas que hoy tienen colegio destino, 429 cambian el precio, 19 quedan igual y 15 son
 * nuevas. 126 cambian 40% o mas. O sea que importar reescribe casi todos los precios del
 * colegio, y por eso el preview muestra actual -> nuevo con el delta y no solo el nuevo.
 */

import { Hono } from 'hono';
import { and, eq, isNull, or, desc } from 'drizzle-orm';
import XLSX from 'xlsx';
import {
  colegios,
  productos,
  tallas,
  colegioTallas,
  preciosVenta,
  inventario,
  costoSnapshots,
} from '../database/schema';
import { getRawDb, getDbFilePath } from '../database/sqljs';
import {
  parsearFilasPos,
  resolverFilas,
  discrepanciasDeSufijo,
  categoriaDeColegio,
  CONFIANZA_MINIMA,
  type FilaResuelta,
} from '../services/importarPos.service';
import {
  planificarCambios,
  huellaDePlan,
  UMBRAL_SALTO_PRECIO,
  type EstadoActual,
  type PlanImportacion,
} from '../services/planImportacion.service';
import { crearPrendaConTallas } from '../services/crearPrenda.service';

const api = new Hono();

/**
 * Cuantos minutos vale una instantanea para autorizar una importacion.
 *
 * La instantanea es el UNICO camino de vuelta —esta importacion no escribe historico— asi
 * que tiene que ser reciente. Dos horas es holgado para revisar 50 decisiones sin prisa, y
 * corto como para que no autorice una importacion de la semana pasada, cuando la base
 * tenia otros precios y restaurarla desharia trabajo que no tiene nada que ver.
 */
export const MINUTOS_INSTANTANEA_VALIDA = 120;

/** Cuantas filas del archivo se aceptan. Guarda contra un archivo equivocado, no un limite real. */
const MAX_FILAS = 20000;

type Correccion = string | 'crear' | 'omitir';

// ---------------------------------------------------------------------------
// Lectura del archivo y armado del plan. Lo comparten los dos endpoints.
// ---------------------------------------------------------------------------

async function leerArchivo(c: any): Promise<
  | { ok: false; estado: number; error: string }
  | { ok: true; matriz: any[][]; hoja: string; nombreArchivo: string; colegioId: string; correcciones: Record<string, Correccion>; opciones: any }
> {
  let cuerpo: any;
  try {
    cuerpo = await c.req.parseBody();
  } catch (e) {
    return { ok: false, estado: 400, error: 'No se pudo leer el formulario: ' + String(e) };
  }

  const archivo = cuerpo?.archivo;
  if (!archivo || typeof archivo === 'string' || typeof archivo.arrayBuffer !== 'function') {
    return {
      ok: false,
      estado: 400,
      error: 'Falta el archivo. Mandar un multipart con el campo "archivo" y el .xlsx del POS.',
    };
  }

  const colegioId = String(cuerpo.colegioId ?? '').trim();
  if (!colegioId) {
    return {
      ok: false,
      estado: 400,
      error:
        'Falta colegioId. Se importa UN colegio por corrida a proposito: las filas de otra ' +
        'categoria se marcan y no se tocan, para que el precio de un colegio no pueda ' +
        'terminar en la prenda de otro.',
    };
  }

  // Las correcciones manuales del usuario, por nombre de producto del POS. El valor es un
  // productoId, o "crear" para dar de alta la prenda, o "omitir" para saltear el grupo.
  let correcciones: Record<string, Correccion> = {};
  if (cuerpo.correcciones) {
    try {
      correcciones = JSON.parse(String(cuerpo.correcciones));
    } catch (e) {
      return { ok: false, estado: 400, error: 'El campo "correcciones" no es JSON valido.' };
    }
  }

  let opciones: any = {};
  if (cuerpo.opciones) {
    try {
      opciones = JSON.parse(String(cuerpo.opciones));
    } catch (e) {
      return { ok: false, estado: 400, error: 'El campo "opciones" no es JSON valido.' };
    }
  }

  let matriz: any[][];
  let hoja: string;
  try {
    const buf = new Uint8Array(await archivo.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array' });
    hoja = wb.SheetNames[0];
    if (!hoja) return { ok: false, estado: 400, error: 'El archivo no tiene ninguna hoja.' };
    matriz = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[hoja], { header: 1, raw: false, defval: '' });
  } catch (e) {
    return {
      ok: false,
      estado: 400,
      error: 'No se pudo leer el .xlsx: ' + String(e) + '. Tiene que ser el export del POS sin modificar.',
    };
  }

  if (matriz.length > MAX_FILAS) {
    return {
      ok: false,
      estado: 400,
      error: `El archivo tiene ${matriz.length} filas y el limite es ${MAX_FILAS}. Probablemente no sea el export del POS.`,
    };
  }

  return {
    ok: true,
    matriz,
    hoja,
    nombreArchivo: String(archivo.name ?? 'archivo.xlsx'),
    colegioId,
    correcciones,
    opciones,
  };
}

/**
 * Aplica las correcciones manuales del usuario sobre las filas ya resueltas.
 *
 * Se hacen DESPUES de resolver y no en vez de resolver: asi la huella cubre tanto lo que
 * decidio el emparejamiento automatico como lo que corrigio el usuario, y un cambio en
 * cualquiera de los dos invalida un plan ya revisado.
 */
function aplicarCorrecciones(
  resueltas: FilaResuelta[],
  correcciones: Record<string, Correccion>,
  productosDelColegio: { id: string; descripcion: string }[]
): { resueltas: FilaResuelta[]; avisos: string[] } {
  const avisos: string[] = [];
  if (!Object.keys(correcciones).length) return { resueltas, avisos };

  const porId = new Map(productosDelColegio.map((p) => [String(p.id), p]));
  const nombresVistos = new Set(resueltas.map((r) => r.origen.nombreProducto));

  for (const nombre of Object.keys(correcciones)) {
    if (!nombresVistos.has(nombre)) {
      avisos.push(
        `Se mando una correccion para "${nombre}", que no aparece en este archivo. Se ignora: ` +
        `probablemente la correccion venga de otro export.`
      );
    }
  }

  const salida = resueltas.map((r) => {
    if (r.estado === 'otro-colegio') return r;
    const dec = correcciones[r.origen.nombreProducto];
    if (dec === undefined) return r;

    if (dec === 'omitir') {
      return { ...r, estado: 'sin-producto' as const, motivo: 'Salteado por decision del usuario.', productoId: undefined, productoDescripcion: undefined };
    }
    if (dec === 'crear') {
      // Se marca para alta. El emparejamiento automatico se descarta a proposito: el
      // usuario dijo que esta prenda no existe todavia.
      return { ...r, estado: 'sin-producto' as const, motivo: 'El usuario pidio crear la prenda.', productoId: undefined, productoDescripcion: undefined, confianza: 0 };
    }

    const p = porId.get(String(dec));
    if (!p) {
      avisos.push(
        `La correccion de "${r.origen.nombreProducto}" apunta a la prenda ${dec}, que no ` +
        `pertenece a este colegio. Se ignora: aceptarla pondria el precio de un colegio en ` +
        `la prenda de otro.`
      );
      return r;
    }
    // Confianza 1 porque la decidio una persona, no la similitud de texto.
    return { ...r, estado: r.tallaId ? ('ok' as const) : r.estado, productoId: p.id, productoDescripcion: p.descripcion, confianza: 1, motivo: 'Emparejado a mano.' };
  });

  return { resueltas: salida, avisos };
}

/** Carga catalogos, resuelve y arma el plan. No escribe. Lo usan los dos endpoints. */
async function armarPlan(
  db: any,
  datos: { matriz: any[][]; colegioId: string; correcciones: Record<string, Correccion> }
): Promise<{ ok: false; estado: number; error: string } | { ok: true; plan: PlanImportacion; resueltas: FilaResuelta[] }> {
  const [colegio] = await db.select().from(colegios).where(eq(colegios.id, datos.colegioId)).limit(1);
  if (!colegio) {
    return { ok: false, estado: 404, error: `No existe el colegio "${datos.colegioId}".` };
  }

  const parseo = parsearFilasPos(datos.matriz);
  const avisos: string[] = [...parseo.avisos];

  if (parseo.filas.length === 0) {
    return {
      ok: false,
      estado: 400,
      error:
        'El archivo no tiene ninguna fila util. Se descartan las categorias "General" y ' +
        '"Empresas" a proposito; si todas las filas son de esas dos, no hay nada que importar.',
    };
  }

  const disc = discrepanciasDeSufijo(parseo.filas);
  if (disc.length) {
    avisos.push(
      `${disc.length} fila(s) tienen un codigo cuyo sufijo no corresponde a su categoria ` +
      `(por ejemplo ${disc[0].categoria} con el codigo ${disc[0].codigo}, que esperaba ` +
      `${disc[0].sufijoEsperado}). Se reporta y no se resuelve solo: elegir entre la categoria ` +
      `y el sufijo en silencio mezclaria colegios.`
    );
  }

  // La ABREVIATURA viaja con el catalogo: es lo que resuelve el colegio contra el sufijo del
  // codigo del POS, y es exacta. El nombre queda como respaldo para una base que no las cargo.
  const todosLosColegios = await db
    .select({ id: colegios.id, nombre: colegios.nombre, abreviatura: colegios.abreviatura })
    .from(colegios);

  // Tallas ACTIVAS de este colegio: el flag global y la configuracion por colegio, con la
  // regla de que sin fila la talla esta activa.
  const filasTalla = await db
    .select({ id: tallas.id, codigo: tallas.codigo, orden: tallas.orden, activo: tallas.activo, ctActivo: colegioTallas.activo })
    .from(tallas)
    .leftJoin(colegioTallas, and(eq(colegioTallas.tallaId, tallas.id), eq(colegioTallas.colegioId, datos.colegioId)))
    .where(or(eq(tallas.colegioId, datos.colegioId), isNull(tallas.colegioId)))
    .orderBy(tallas.orden);

  const tallasActivas = filasTalla
    .filter((t: any) => t.activo && (t.ctActivo === null || t.ctActivo === undefined || t.ctActivo === true))
    .map((t: any) => ({ id: String(t.id), codigo: String(t.codigo) }));

  const productosDelColegio = (
    await db
      .select({ id: productos.id, descripcion: productos.descripcion, colegioId: productos.colegioId })
      .from(productos)
      .where(eq(productos.colegioId, datos.colegioId))
  ).map((p: any) => ({ id: String(p.id), descripcion: String(p.descripcion), colegioId: String(p.colegioId) }));

  const r = resolverFilas({
    filas: parseo.filas,
    colegioId: datos.colegioId,
    colegios: todosLosColegios.map((x: any) => ({
      id: String(x.id),
      nombre: String(x.nombre),
      abreviatura: x.abreviatura ?? null,
    })),
    tallasActivas,
    productos: productosDelColegio,
  });
  avisos.push(...r.avisos);

  const corr = aplicarCorrecciones(r.resueltas, datos.correcciones, productosDelColegio);
  avisos.push(...corr.avisos);

  // ---- estado actual de la base, solo para las combinaciones que toca este archivo
  const idsProducto = new Set(corr.resueltas.map((x) => x.productoId).filter(Boolean) as string[]);
  const actual: EstadoActual = { precios: new Map(), codigos: new Map(), inventario: new Map() };

  if (idsProducto.size) {
    const pv = await db
      .select({
        productoId: preciosVenta.productoId,
        tallaId: preciosVenta.tallaId,
        precioBs: preciosVenta.precioBs,
        codigoExterno: preciosVenta.codigoExterno,
      })
      .from(preciosVenta)
      .where(isNull(preciosVenta.vigenteHasta));
    for (const f of pv) {
      if (!idsProducto.has(String(f.productoId))) continue;
      const k = `${f.productoId}|${f.tallaId}`;
      actual.precios.set(k, Number(f.precioBs));
      actual.codigos.set(k, f.codigoExterno ?? null);
    }

    const inv = await db
      .select({ productoId: inventario.productoId, tallaId: inventario.tallaId, cantidad: inventario.cantidad })
      .from(inventario);
    for (const f of inv) {
      if (!idsProducto.has(String(f.productoId))) continue;
      actual.inventario.set(`${f.productoId}|${f.tallaId}`, Number(f.cantidad));
    }
  }

  // ---- categorias del archivo sin colegio en el sistema
  const filasPorCategoria = new Map<string, number>();
  for (const f of parseo.filas) filasPorCategoria.set(f.categoria, (filasPorCategoria.get(f.categoria) ?? 0) + 1);

  const categoriasConColegio = new Set<string>();
  for (const col of todosLosColegios) {
    const cat = categoriaDeColegio(String(col.id), todosLosColegios.map((x: any) => ({ id: String(x.id), nombre: String(x.nombre) })));
    if (cat) categoriasConColegio.add(cat);
  }

  const plan = planificarCambios({
    colegioId: datos.colegioId,
    colegioNombre: String(colegio.nombre),
    categoriaEsperada: r.categoriaEsperada,
    resueltas: corr.resueltas,
    actual,
    filasPorCategoria,
    categoriasConColegio,
    avisos,
  });

  return { ok: true, plan, resueltas: corr.resueltas };
}

// ---------------------------------------------------------------------------
// POST /api/importar/preview — NO ESCRIBE NADA
// ---------------------------------------------------------------------------

api.post('/preview', async (c) => {
  const db = (c as any).db;

  // SE DECLARA QUE ESTA RUTA NO ESCRIBE, para que el middleware de server.ts no vuelque la
  // base al terminar. Es un POST —recibe el archivo por multipart— y el middleware volcaba
  // por metodo, no por lo que hizo el handler: el contenido logico no cambiaba pero el
  // archivo si, porque sql.js re-serializa. La verificacion de punta a punta lo atrapo
  // comparando bytes.
  (c as any).__noEscribio = true;

  const leido = await leerArchivo(c);
  if (!leido.ok) return c.json({ success: false, error: leido.error }, leido.estado as any);

  const armado = await armarPlan(db, leido);
  if (!armado.ok) return c.json({ success: false, error: armado.error }, armado.estado as any);

  // Estado de la instantanea, para que la pantalla pueda pedirla antes de habilitar el
  // boton de confirmar en vez de dejar que la ejecucion falle al final.
  const instantanea = await instantaneaVigente(db);

  return c.json({
    success: true,
    escribio: false,
    archivo: { nombre: leido.nombreArchivo, hoja: leido.hoja, filas: leido.matriz.length - 1 },
    plan: armado.plan,
    umbralSalto: UMBRAL_SALTO_PRECIO,
    confianzaMinima: CONFIANZA_MINIMA,
    instantanea,
  });
});

/** La instantanea mas reciente y si alcanza para autorizar una importacion. */
async function instantaneaVigente(db: any) {
  const [ultima] = await db
    .select({ id: costoSnapshots.id, nombre: costoSnapshots.nombre, creadoEn: costoSnapshots.creadoEn })
    .from(costoSnapshots)
    .orderBy(desc(costoSnapshots.creadoEn))
    .limit(1);

  if (!ultima) {
    return {
      hay: false,
      vigente: false,
      minutosValida: MINUTOS_INSTANTANEA_VALIDA,
      mensaje:
        'No hay ninguna instantanea. Es obligatoria antes de importar: esta importacion ' +
        'reemplaza precios sin guardar el anterior, y la instantanea es el unico camino de vuelta.',
    };
  }

  // Las fechas se guardan con CURRENT_TIMESTAMP de SQLite, que es UTC sin zona. Sin la
  // "Z" el navegador y node la leerian como hora local y una instantanea recien creada
  // pareceria tener cuatro horas.
  const txt = String(ultima.creadoEn).trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(txt) ? txt : txt.replace(' ', 'T') + 'Z';
  const edadMin = (Date.now() - new Date(iso).getTime()) / 60000;
  const vigente = Number.isFinite(edadMin) && edadMin >= 0 && edadMin <= MINUTOS_INSTANTANEA_VALIDA;

  return {
    hay: true,
    vigente,
    id: String(ultima.id),
    nombre: String(ultima.nombre),
    creadoEn: String(ultima.creadoEn),
    edadMinutos: Math.round(edadMin),
    minutosValida: MINUTOS_INSTANTANEA_VALIDA,
    mensaje: vigente
      ? `Instantanea "${ultima.nombre}" de hace ${Math.round(edadMin)} minuto(s). Alcanza para importar.`
      : `La instantanea mas reciente es de hace ${Math.round(edadMin)} minuto(s) y el limite es ` +
        `${MINUTOS_INSTANTANEA_VALIDA}. Crear una nueva antes de importar: restaurar una vieja ` +
        `desharia todo lo que se hizo desde entonces.`,
  };
}

// ---------------------------------------------------------------------------
// POST /api/importar/ejecutar — ESCRIBE, en transaccion
// ---------------------------------------------------------------------------

api.post('/ejecutar', async (c) => {
  const db = (c as any).db;

  const leido = await leerArchivo(c);
  if (!leido.ok) return c.json({ success: false, error: leido.error }, leido.estado as any);

  const huellaCliente = String((leido.opciones as any).huella ?? '').trim();
  if (!huellaCliente) {
    return c.json({
      success: false,
      error:
        'Falta la huella del plan revisado. Se obtiene de /api/importar/preview y se manda en ' +
        'opciones.huella. Sirve para probar que lo que se ejecuta es lo que se reviso.',
    }, 400);
  }

  // ---------------------------------------------------- 1. la instantanea es obligatoria
  const inst = await instantaneaVigente(db);
  if (!inst.vigente) {
    return c.json({ success: false, error: inst.mensaje, instantanea: inst }, 409);
  }

  // ---------------------------------------------------- 2. re-resolver desde el archivo
  const armado = await armarPlan(db, leido);
  if (!armado.ok) return c.json({ success: false, error: armado.error }, armado.estado as any);

  const plan = armado.plan;

  // ---------------------------------------------------- 3. la huella tiene que coincidir
  if (plan.huella !== huellaCliente) {
    return c.json({
      success: false,
      error:
        `El plan cambio desde que se reviso. La huella revisada era ${huellaCliente} y el ` +
        `archivo de ahora da ${plan.huella}. No se escribe nada: volve a generar la vista ` +
        `previa y revisala de nuevo. Esto pasa si se subio otro archivo, otro colegio, o si ` +
        `alguien cambio prendas o tallas mientras revisabas.`,
      huellaEsperada: plan.huella,
      huellaRecibida: huellaCliente,
    }, 409);
  }

  const escribirInventario = (leido.opciones as any).inventario === true;
  const crearFaltantes = (leido.opciones as any).crearPrendas === true;

  // ---------------------------------------------------- 4. respaldo del archivo
  //
  // Antes de tocar nada, y si no se puede, no se importa. Es la misma disciplina que la
  // restauracion de instantaneas: el rollback cubre un error a mitad de camino, pero no
  // cubre haber importado el archivo equivocado con exito.
  let respaldo: string | null = null;
  try {
    const fs = await import('fs');
    // La ruta sale de getDbFilePath() y NO se calcula a mano. Calcularla ignora
    // SISTEMA_DB_PATH, que existe justamente para apuntar a una copia: el respaldo iria a
    // la base real mientras la escritura va a la copia, y entonces respalda el archivo
    // equivocado. Un respaldo que apunta a otro archivo es peor que no tenerlo.
    const rutaDb = getDbFilePath();
    if (fs.existsSync(rutaDb)) {
      const sello = new Date().toISOString().replace(/[:.]/g, '-');
      respaldo = rutaDb.replace(/\.db$/, '') + `.antes-de-importar-${sello}.db`;
      fs.copyFileSync(rutaDb, respaldo);
    }
  } catch (e) {
    return c.json({
      success: false,
      error: 'No se pudo crear el respaldo previo. No se importa sin red: ' + String(e),
    }, 500);
  }

  // ---------------------------------------------------- 5. escribir, en transaccion
  const reporte = {
    preciosCreados: 0,
    preciosActualizados: 0,
    preciosSinCambio: 0,
    codigosEscritos: 0,
    inventarioActualizado: 0,
    prendasCreadas: [] as { nombrePos: string; productoId: string; descripcion: string; itemNumero: number }[],
    gruposSalteados: [] as { nombrePos: string; motivo: string; filas: number }[],
  };
  const avisos: string[] = [...plan.avisos];

  let raw: any;
  try {
    raw = getRawDb();
  } catch (e) {
    return c.json({ success: false, error: 'La base no esta disponible: ' + String(e) }, 500);
  }

  raw.run('BEGIN');
  try {
    for (const grupo of plan.grupos) {
      // ---- grupos que no se escriben
      // Se pregunta por `puedeCrearPrenda` y NO por el estado: un grupo cuyo mejor parecido
      // es del 10% esta marcado como `revisar`, pero no hay nada que revisar —la prenda no
      // existe— y antes caia en la rama de abajo, que lo salteaba sin ofrecer crearla.
      if (grupo.puedeCrearPrenda && !crearFaltantes) {
        reporte.gruposSalteados.push({
          nombrePos: grupo.nombrePos,
          motivo:
            grupo.confianza > 0
              ? `La prenda no existe en el sistema —el parecido mas alto es del ${(grupo.confianza * 100).toFixed(0)}%— y no se pidio crearla.`
              : 'La prenda no existe en el sistema y no se pidio crearla.',
          filas: grupo.resumen.filas,
        });
        continue;
      }
      if (!grupo.puedeCrearPrenda &&
          (grupo.estado === 'revisar' || grupo.estado === 'sin-talla' || grupo.estado === 'sin-precio')) {
        reporte.gruposSalteados.push({
          nombrePos: grupo.nombrePos,
          motivo:
            grupo.estado === 'revisar'
              ? `Confianza ${(grupo.confianza * 100).toFixed(0)}%, por debajo del ${(CONFIANZA_MINIMA * 100).toFixed(0)}% exigido. Corregir a mano en la vista previa.`
              : grupo.estado === 'sin-talla'
                ? 'Alguna talla del grupo no existe o no esta activa en este colegio.'
                : 'Alguna fila del grupo no trae precio en el POS.',
          filas: grupo.resumen.filas,
        });
        continue;
      }

      // ---- alta de la prenda que falta
      let productoId = grupo.productoId;
      if (grupo.puedeCrearPrenda && crearFaltantes) {
        // El nombre del POS ya viene sin sufijo de colegio en la descripcion normalizada,
        // pero para la prenda se usa el nombre legible: lo que va antes de la coma.
        const coma = grupo.nombrePos.lastIndexOf(',');
        const descripcion = (coma > 0 ? grupo.nombrePos.slice(0, coma) : grupo.nombrePos).trim();

        const alta = await crearPrendaConTallas(db, { colegioId: plan.colegioId, descripcion });
        if (!alta.ok) {
          reporte.gruposSalteados.push({ nombrePos: grupo.nombrePos, motivo: 'No se pudo crear la prenda: ' + alta.error, filas: grupo.resumen.filas });
          continue;
        }
        productoId = String(alta.prenda.id);
        reporte.prendasCreadas.push({
          nombrePos: grupo.nombrePos,
          productoId,
          descripcion,
          itemNumero: Number(alta.prenda.itemNumero),
        });
        // Se dice UNA VEZ por prenda creada y no se esconde en el resumen: una prenda
        // recien creada tiene peso y mano de obra en CERO, asi que su costo es casi cero y
        // la pantalla no lo distingue de una prenda barata. El precio de venta que acaba
        // de importarse va a mostrar un margen enorme y falso.
        avisos.push(
          `Se creo la prenda "${descripcion}" (item ${alta.prenda.itemNumero}) con precio del POS ` +
          `pero SIN COSTO: nace con peso de tela y mano de obra en cero. Su margen va a verse ` +
          `enorme y no es real hasta que se carguen los costos o se copien de una prenda parecida.`
        );
      }

      if (!productoId) {
        reporte.gruposSalteados.push({ nombrePos: grupo.nombrePos, motivo: 'Sin prenda destino.', filas: grupo.resumen.filas });
        continue;
      }

      // ---- las filas del grupo
      for (const f of grupo.filas) {
        if (!f.tallaId) continue;

        // El codigo del POS y el precio viajan JUNTOS, en la misma fila. Por eso el parseo
        // exige precio en todas: un codigo sin precio no tendria donde vivir.
        if (f.accionPrecio === 'sin-cambio' && !f.codigoCambia) {
          reporte.preciosSinCambio++;
        } else {
          await db
            .delete(preciosVenta)
            .where(and(eq(preciosVenta.productoId, productoId), eq(preciosVenta.tallaId, f.tallaId)));
          await db.insert(preciosVenta).values({
            productoId,
            tallaId: f.tallaId,
            precioBs: f.precioPos,
            codigoExterno: f.codigoPos,
          });
          if (f.accionPrecio === 'crear') reporte.preciosCreados++;
          else if (f.accionPrecio === 'actualizar') reporte.preciosActualizados++;
          else reporte.preciosSinCambio++;
          if (f.codigoCambia) reporte.codigosEscritos++;
        }

        // El inventario es OPCIONAL y por defecto no se toca. Importar cantidades del POS
        // sobre un inventario que se lleva aparte destruiria el conteo real, y a diferencia
        // del precio no hay forma de notarlo mirando la pantalla.
        if (escribirInventario && f.cantidadCambia) {
          const existentes = await db
            .select({ id: inventario.id })
            .from(inventario)
            .where(and(eq(inventario.productoId, productoId), eq(inventario.tallaId, f.tallaId)));
          if (existentes.length) {
            await db
              .update(inventario)
              .set({ cantidad: f.cantidadPos })
              .where(and(eq(inventario.productoId, productoId), eq(inventario.tallaId, f.tallaId)));
          } else {
            await db.insert(inventario).values({
              productoId,
              tallaId: f.tallaId,
              cantidad: f.cantidadPos,
              costoUnitario: 0,
              costoTotal: 0,
            });
          }
          reporte.inventarioActualizado++;
        }
      }
    }

    raw.run('COMMIT');
  } catch (e: any) {
    // ROLLBACK y no un commit parcial. Verificado sobre esta base: un ROLLBACK sobre la
    // instancia cruda revierte tambien las escrituras hechas por Drizzle, porque las dos
    // van a la misma conexion de sql.js.
    try { raw.run('ROLLBACK'); } catch (e2) {}
    return c.json({
      success: false,
      error: 'Fallo la importacion y se revirtio TODO. No quedo nada a medias: ' + (e?.message || String(e)),
      respaldo,
    }, 500);
  }

  // EL VOLCADO A DISCO LO HACE EL MIDDLEWARE de server.ts, no esta ruta.
  //
  // La llamada explicita que vivia aca escribia el archivo de un MB una segunda vez: el log
  // del servidor mostraba "Base de datos guardada en disco" dos veces por importacion. Y era
  // una desviacion de la decision que este proyecto ya tomo —el middleware es el dueño del
  // volcado, para que ningun handler pueda olvidarse—; tener las dos cosas no agrega una
  // garantia, agrega una duda sobre quien manda.
  //
  // Que la escritura llega al ARCHIVO y no solo a la memoria lo comprueba
  // verificarImportacion.ts, que abre la copia con sql.js despues de importar y cuenta los
  // codigos ahi. Sin ese chequeo no habria sacado esta linea.

  if (!escribirInventario) {
    avisos.push(
      'No se toco el inventario. Se importaron precios y codigos del POS solamente. Para traer ' +
      'tambien las cantidades hay que pedirlo explicitamente.'
    );
  }
  avisos.push(
    'El precio anterior NO quedo guardado: esta importacion no escribe historico. El camino de ' +
    `vuelta es restaurar la instantanea "${inst.nombre}".`
  );

  return c.json({
    success: true,
    colegio: plan.colegioNombre,
    archivo: leido.nombreArchivo,
    huella: plan.huella,
    instantanea: { id: inst.id, nombre: inst.nombre },
    respaldo,
    reporte,
    avisos,
  });
});

export default api;
