import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import { calcularCostoTotal } from '../services/calculo/costoTotal.service';
import { costearLote, costearPrendaTodasLasTallas } from '../services/calculo/costeoInputs.service';
import { productos, tallas, preciosVenta, inventario, colegios } from '../database/schema';
// El criterio de orden y la paginacion viven en UNA sola casa. Ver el comentario de
// ordenPrendas.ts: estaban repartidos en diez consultas con tres criterios distintos.
import {
  posicionesDeColegios, ordenarPrendas, paginar, leerPaginacion, esCriterioValido,
} from '../services/ordenPrendas';
// Que le falta a una prenda para que su costo sea real. NO consulta nada: el motor ya reporta
// origenPeso, telaVinculada y tieneManoObra en el meta de cada fila.
import { diagnosticarPorPrenda, resumirDiagnosticos } from '../services/diagnosticoCosto';
// La referencia `CC-01` de cada prenda, para la columna `Prod`.
import { referenciasDesdeBase } from '../services/referenciaPrendaDb';
// Emparejar tallas sin depender de si la base guarda `2` o `02`.
import { buscarTallaPorCodigo, obtenerTallasActivasPorColegio, obtenerMapTallasActivasPorColegio } from '../services/tallas';
import XLSX from 'xlsx';
import { codigosPosDesdeBase, claveCodigoPos } from '../services/codigoPos';
import { resolverPrendaPorItem } from '../services/resolucion.service';
import {
  construirContextoFiscal,
  resolverPrecios,
  etiquetaModalidad,
} from '../services/modalidadFiscal';

/** Redondeo de presentacion. El motor ya redondea; esto es para los pesos crudos. */
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const api = new Hono();

/**
 * Simulador instantaneo: expone la superficie REAL del motor.
 *
 * El schema anterior descartaba la mitad del motor. Como zValidator borra las
 * claves que no estan declaradas, los campos faltantes no daban error: se
 * perdian en silencio y el motor calculaba con undefined.
 *
 * Lo que faltaba y ahora esta:
 *   precioBsG               el camino preferido de costo de tela, el que quedo
 *                           verificado contra el Excel. Sin el, la unica via era
 *                           precioTelaUnitario + rendimiento.
 *   pesoConMermaGramos      peso que ya trae la merma, que es lo que guarda la base
 *   pesoExactoGramos        peso limpio, al que el motor le aplica la merma
 *   precioAdquisicion       prendas semiterminadas o de reventa
 *   costoIndirectoUnitario  indirecto ya prorrateado, para poder usar un
 *                           denominador anual en vez de la produccion del mes
 *   tasaIva                 configurable, antes siempre caia en IVA_RATE
 *
 * Ademas:
 * - `pesoGramos`, `precioTelaUnitario` y `rendimientoTela` pasan a opcionales.
 *   Eran obligatorios y positivos, asi que era IMPOSIBLE simular una prenda
 *   adquirida (no lleva peso) o usar el camino de precioBsG.
 * - `factorComplejidad` deja de ser `.int()`. La columna del schema paso a real
 *   en la Fase 4, asi que 1,5 ya se persiste. SQLite tiene tipado dinamico y la
 *   afinidad INTEGER ya guardaba 1.5 como REAL, asi que no hizo falta migrar datos.
 * - Se saca el `.default(8)` de la merma. Era el tercer lugar con el 8
 *   hardcodeado, justo el que el motor elimino a proposito para que el default
 *   viva solo en el schema de la base y en configuracion_sistema. Si no viene, el
 *   motor avisa en su diagnostico.
 */
const calcularSchema = z.object({
  productoId: z.string().optional().default('demo-prod'),
  tallaId: z.string().optional().default('demo-talla'),
  colegioId: z.string().optional().default('demo-colegio'),

  // Peso. Tres formas, con la precedencia que documenta el motor.
  pesoConMermaGramos: z.number().nonnegative().optional(),
  pesoExactoGramos: z.number().nonnegative().optional(),
  pesoGramos: z.number().nonnegative().optional(),
  mermaPorcentaje: z.number().min(0).max(100).optional(),

  // Precio de la tela. Dos caminos.
  precioBsG: z.number().positive().optional(),
  precioTelaUnitario: z.number().positive().optional(),
  rendimientoTela: z.number().positive().optional(),

  // Prendas adquiridas: reemplaza al costo de tela.
  precioAdquisicion: z.number().positive().optional(),

  costoAccesorios: z.number().default(0),
  costoManoObra: z.number().default(0),
  factorComplejidad: z.number().positive().default(1),
  costoFijo: z.number().default(0),

  costoIndirectoUnitario: z.number().nonnegative().optional(),
  costoIndirectoMensual: z.number().default(0),
  produccionTotalMes: z.number().int().positive().default(1),

  precioVenta: z.number().optional().nullable(),

  // FRACCION, no porcentaje. El tope de 1 lo hace cumplir en el borde: si alguien
  // manda 13 pensando en el 13%, el motor calcularia 1300% de IVA sin lanzar
  // nada. Es la trampa de unidades de todo el refactor, y aca se ataja con un
  // mensaje que dice exactamente que hacer.
  tasaIva: z
    .number()
    .min(0)
    .max(1, {
      message:
        'tasaIva se expresa como fraccion, no como porcentaje: 0.13 para el 13%. ' +
        'Enviar 13 daria 1300% de IVA.',
    })
    .optional(),
});

// POST /api/calculo/calcular - Simulador instantáneo
api.post('/calcular', zValidator('json', calcularSchema), async (c) => {
  const body = c.req.valid('json');
  const resultado = calcularCostoTotal(body as any);
  return c.json({ success: true, data: resultado });
});


// GET /api/calculo/matriz-consolidada - Grilla completa de prendas x tallas
//
// UNIFICADO (Fase 2). Antes esta ruta casi no calculaba: leia los totales ya
// hechos del Excel (`costoBruto`, `costoAntesImp`, `costoTotal`) y solo caia en un
// calculo propio cuando el Excel callaba. Ademas despejaba el costo de tela por
// resta y derivaba el costo fijo como `excelCa - cb`, o sea heredaba de la
// planilla un fijo por prenda que no tiene por que coincidir con el que sale del
// pool de indirectos.
//
// Consecuencia: la base de datos no era autoritativa. Editar un peso o un precio
// de tela no movia la grilla mientras el Excel tuviera un valor para esa celda.
//
// El usuario fallo el 29-jul-2026 que gana el numero nuevo (causa 2 del arnes).
// Ahora delega en el motor y el Excel deja de participar del costeo.
//
// El shape se conserva campo por campo: el dashboard lee
// `json.data[].tallas[codigo].{costoBruto,precioVenta,costoUnitarioNeto,
// ingresoNetoConFactura,ingresoNetoSinFactura,utilidadConFactura,utilidadSinFactura,
// margenConFactura,margenSinFactura,inventarioUnidades,costoInventario,
// precioInventario}` y `json.tallas[].codigo`.
//
// FASE 3: desaparecieron costoAntesImp, costoTotal, utilidadNeta y margenPorcentaje.
// El costo ya no lleva IVA y el margen se parte por canal de venta.
api.get('/matriz-consolidada', async (c) => {
  try {
    const db = (c as any).db;
    const colegioIdRaw = c.req.query('colegioId');
    const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;
    const snapshotId = c.req.query('snapshotId');
    const { ctx, filas } = await costearLote(db, { colegioId, snapshotId });

    const avisosFiscales: string[] = [];
    const fiscal = construirContextoFiscal(c, ctx, avisosFiscales);

    // El inventario no es un concepto de costeo, se consulta aparte.
    let invList: any[] = [];
    try {
      invList = await db.select().from(inventario);
    } catch (e) {}
    const invMap = new Map<string, number>();
    invList.forEach((i: any) => invMap.set(`${i.productoId}_${i.tallaId}`, i.cantidad));

    // LA CABECERA RESPETA LAS TALLAS ACTIVAS DE CADA COLEGIO.
    //
    // Antes esta lista se traia global, con una nota que decia que filtrarla
    // "cambiaria la forma de la tabla" y quedaba para mas adelante. Ese mas adelante
    // es ahora: con la configuracion por colegio, una columna de una talla apagada no
    // es solo ruido visual — es una columna que la pantalla ofrece para editar precio
    // y stock de una combinacion que ese colegio decidio no ofrecer.
    //
    // Con el ambito en un colegio, se usa su juego. Con el ambito en la empresa, la
    // UNION de los juegos de los colegios presentes: una talla que algun colegio
    // ofrece tiene que poder verse en la vista consolidada.
    //
    // Si el motor no devolvio ningun juego —base sin prendas— se cae a la lista
    // global, que es el comportamiento anterior y evita una grilla sin columnas.
    // LA UNION SE TOMA SOLO DE LOS COLEGIOS DEL AMBITO, no de todo el mapa.
    //
    // `ctx.tallasPorColegio` tiene una entrada por cada colegio que tenga prendas O
    // configuracion de tallas, para que se pueda consultar el juego de un colegio sin
    // prendas todavia. Unir sobre TODAS sus entradas filtraba mal: con el ambito en
    // Internacional SM, la cabecera igual mostraba la talla 03 porque Cambridge la
    // tiene activa. Medido: los tres ambitos devolvian 17 tallas cuando Internacional
    // SM ofrece 16.
    const colegiosEnAmbito = new Set(
      ctx.productos.map((p: any) => String(p.colegioId)).filter((x: string) => x && x !== 'null')
    );
    const idsActivos = new Set<string>();
    for (const cid of colegiosEnAmbito) {
      for (const t of (ctx.tallasPorColegio.get(cid) || [])) idsActivos.add(String(t.id));
    }
    const mapTallasActivas = await obtenerMapTallasActivasPorColegio(db);
    const tallasGlobales = await obtenerTallasActivasPorColegio(db, colegioId);
    const allTallas = idsActivos.size > 0
      ? tallasGlobales.filter((t: any) => idsActivos.has(String(t.id)))
      : tallasGlobales;

    const porProducto = new Map<string, any[]>();
    for (const f of filas) {
      const arr = porProducto.get(f.meta.productoId) || [];
      arr.push(f);
      porProducto.set(f.meta.productoId, arr);
    }

    // DIAGNOSTICO DE COSTO, por prenda. Se calcula de las MISMAS filas que ya se costearon:
    // el motor reporta si hay peso, tela y mano de obra, asi que no hace falta ninguna
    // consulta extra. Ver services/diagnosticoCosto.ts para por que dice QUE falta en vez de
    // un "incompleta" generico.
    const diagnosticos = diagnosticarPorPrenda(
      filas,
      (f: any) => String(f.meta.productoId),
      (f: any) => f.meta
    );

    // Celda de una combinacion que no se ofrece. Se devuelve en cero, con el
    // inventario si lo hubiera, para conservar el mismo juego de claves que
    // antes: el dashboard recorre todas las tallas de la cabecera.
    const celdaVacia = () => ({
      costoBruto: 0,
      precioVenta: 0,
      precioLista: 0,
      ingresoNetoEfectivo: 0,
      costoUnitarioNeto: 0,
      ingresoNetoConFactura: 0,
      ingresoNetoSinFactura: 0,
      utilidadConFactura: 0,
      utilidadSinFactura: 0,
      margenConFactura: 0,
      margenSinFactura: 0,
      inventarioUnidades: 0,
      costoInventario: 0,
      precioInventario: 0,
      // El codigo va en TODAS las celdas, tambien en las que no se ofrecen, para que el juego
      // de claves sea el mismo en toda la grilla. Una celda a la que le falta una clave que
      // las demas tienen obliga a la pantalla a preguntar antes de leer.
      codigoExterno: null,
      seOfrece: false,
    });

    const gridData = ctx.productos.map((prod: any) => {
      const rowObj: any = {
        productoId: prod.id,
        itemNumero: prod.itemNumero,
        descripcion: prod.descripcion,
        // El COLEGIO viaja en la fila. Sin el, la pantalla no puede agrupar ni poner la fila
        // separadora, y el orden tampoco podia saber que existen los colegios: es la causa
        // exacta del 1, 28, 2, 3 que reporto el usuario.
        colegioId: prod.colegioId ?? null,
        orden: prod.orden ?? null,
        // Que le falta para que su costo sea real. `completa: true` es el caso normal y la
        // pantalla no dibuja nada; cuando no, trae la etiqueta corta y el motivo largo.
        diagnostico: diagnosticos.get(String(prod.id)) ?? { completa: true, faltan: [], etiqueta: '', motivo: '' },
        tallas: {},
      };

      const porTalla = new Map<string, any>();
      for (const f of porProducto.get(prod.id) || []) porTalla.set(f.meta.tallaId, f);

      for (const talla of allTallas) {
        const cid = String(prod.colegioId);
        const activasSet = mapTallasActivas.get(cid);
        if (activasSet && !activasSet.has(String(talla.id))) {
          rowObj.tallas[talla.codigo] = celdaVacia();
          continue;
        }

        const inv = invMap.get(`${prod.id}_${talla.id}`) ?? 0;
        const f = porTalla.get(talla.id);

        // Regla decidida: sin precio de venta vigente la prenda no se ofrece en
        // esa talla, asi que no se le prorratea costo fijo a algo que no existe.
        if (!f || !f.meta.seOfrece) {
          rowObj.tallas[talla.codigo] = { ...celdaVacia(), inventarioUnidades: inv };
          continue;
        }

        const r = f.resultado;
        // `precioVenta` pasa a ser el precio EFECTIVO del modo elegido: el de lista
        // con factura, y el de lista menos el descuento sin factura. Antes era
        // siempre el de lista, asi que el interruptor fiscal no movia esta grilla.
        // `precioLista` se conserva aparte para no perder el dato de origen.
        const { precioLista, precioVenta: pv, ingresoNeto } = resolverPrecios(f.meta.precioVentaBs, fiscal);
        rowObj.tallas[talla.codigo] = {
          costoBruto: r.costoBruto,
          precioVenta: r2(pv),
          precioLista: r2(precioLista),
          ingresoNetoEfectivo: r2(ingresoNeto),
          costoUnitarioNeto: r.costoUnitarioNeto,
          ingresoNetoConFactura: r.ingresoNetoConFactura ?? 0,
          ingresoNetoSinFactura: r.ingresoNetoSinFactura ?? 0,
          utilidadConFactura: r.utilidadConFactura ?? 0,
          utilidadSinFactura: r.utilidadSinFactura ?? 0,
          margenConFactura: r.margenConFactura ?? 0,
          margenSinFactura: r.margenSinFactura ?? 0,
          inventarioUnidades: inv,
          // El inventario se valua al costo NETO. Antes se valuaba al costo con
          // IVA, asi que el valor del stock estaba inflado ~13%.
          costoInventario: r2(inv * r.costoUnitarioNeto),
          precioInventario: r2(inv * (pv > 0 ? pv : r.costoUnitarioNeto)),
          // EL CODIGO DEL POS, en la celda. Es su granularidad exacta: una celda de esta
          // matriz ES una prenda en una talla, que es lo que el codigo identifica. La columna
          // ITEM no puede tenerlo porque su fila abarca de 9 a 16 codigos distintos.
          codigoExterno: f.meta.codigoExterno ?? null,
          seOfrece: true,
        };
      }

      return rowObj;
    });

    // -----------------------------------------------------------------------
    // ORDEN Y PAGINACION. Los dos aca, en este orden, y por una sola via.
    //
    // EL ORDEN NO SE ESCRIBE EN ESTA RUTA: lo define services/ordenPrendas.ts, que es la
    // unica casa del criterio. Antes esta pantalla ordenaba por `orden, item_numero` sin
    // mencionar el colegio, y como `orden` se numera POR COLEGIO los dos unos empataban:
    // el item 28 de Internacional SM salia entre el 1 y el 2 de Cambridge.
    //
    // Y PAGINAR VA DESPUES DE ORDENAR, no antes. Al reves cada pagina traeria un conjunto
    // distinto de filas segun el criterio elegido, que es la clase de error que no se ve
    // hasta que alguien compara dos paginas.
    // -----------------------------------------------------------------------
    const colegiosParaOrden = await db
      .select({ id: colegios.id, nombre: colegios.nombre, orden: colegios.orden, creadoEn: colegios.creadoEn })
      .from(colegios);
    const posiciones = posicionesDeColegios(colegiosParaOrden as any);
    const nombrePorColegio = new Map<string, string>(
      colegiosParaOrden.map((c: any) => [String(c.id), String(c.nombre)])
    );

    const q = c.req.query();
    const criterio = esCriterioValido(q.orden) ? q.orden : 'defecto';
    const agruparPorColegio = String(q.compararEntreColegios ?? '') !== 'true';

    // PRECIO REPRESENTATIVO de la prenda para el orden por precio: el MAYOR de sus tallas
    // ofrecidas. La prenda no tiene un precio unico —tiene uno por talla— asi que hay que
    // elegir. El mayor es el de la talla mas grande, es estable, y no se mueve porque una
    // talla chica no tenga precio cargado. Tomar la primera talla seria arbitrario, y el
    // promedio movería el orden al agregar una talla.
    // Las referencias se piden con TODAS las prendas, no con las de esta pagina: `CC-03` significa
    // "la tercera prenda de Cambridge", y si se contara sobre las filas devueltas, en la pagina 2
    // la primera volveria a ser `CC-01` y la columna dejaria de identificar.
    const referencias = await referenciasDesdeBase(db);
    for (const fila of gridData) {
      let mayor: number | null = null;
      for (const celda of Object.values(fila.tallas as Record<string, any>)) {
        if (celda?.seOfrece && Number(celda.precioVenta) > 0) {
          mayor = mayor === null ? Number(celda.precioVenta) : Math.max(mayor, Number(celda.precioVenta));
        }
      }
      fila.precio = mayor;
      fila.colegioNombre = nombrePorColegio.get(String(fila.colegioId)) ?? null;
      // La REFERENCIA que se ve en la columna `Prod`: `CC-01`. Reemplaza al numero de item, que
      // era GLOBAL y por eso ilegible —Cambridge 1 a 27 e Internacional SM arrancando en 28, que
      // es el `1, 28, 2, 3` de la matriz—.
      fila.prod = referencias.get(String(fila.productoId)) ?? null;
    }

    const ordenadas = ordenarPrendas(gridData as any, criterio as any, posiciones, { agruparPorColegio });
    const { pagina, porPagina } = leerPaginacion(q as any);
    const pag = paginar(ordenadas, pagina, porPagina);

    return c.json({
      success: true,
      tallas: allTallas.map((t: any) => ({ id: t.id, codigo: t.codigo, orden: t.orden })),
      // El orden y la paginacion se DECLARAN, para que la pantalla pueda mostrar lo que de
      // verdad esta viendo en vez de suponerlo.
      orden: criterio,
      agrupadoPorColegio: agruparPorColegio,
      // Cuantas prendas tienen el costo SUBESTIMADO, para que el encabezado del reporte lo
      // pueda decir. Un total impreso para un banco que incluye prendas costeadas en cero es
      // un numero correcto describiendo algo incompleto.
      diagnosticoCosto: resumirDiagnosticos(diagnosticos.values()),
      paginacion: { total: pag.total, pagina: pag.pagina, porPagina: pag.porPagina, paginas: pag.paginas },
      // Huella para el arnes de paridad: distingue esta version de la heredada.
      implementacion: 'unificada',
      // Huella del modo fiscal, para que la pantalla pueda verificar que le
      // respondieron con el modo que pidio.
      modalidad: fiscal.modalidad,
      modalidadEtiqueta: etiquetaModalidad(fiscal.modalidad),
      descuentoSinFacturaPct: parseFloat((fiscal.descuentoFraccion * 100).toFixed(2)),
      avisos: avisosFiscales,
      data: pag.filas,
    });
  } catch (e: any) {
    console.error('matriz-consolidada:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

/**
 * GET /api/calculo/matriz-telas
 * Reporte de Costeo e Inversión Total en Telas para el Stock Físico Actual.
 */
api.get('/matriz-telas', async (c) => {
  try {
    const db = (c as any).db;
    const colegioIdRaw = c.req.query('colegioId');
    const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;
    const snapshotId = c.req.query('snapshotId');
    const { ctx, filas } = await costearLote(db, { colegioId, snapshotId });

    let invList: any[] = [];
    try {
      invList = await db.select().from(inventario);
    } catch (e) {}
    const invMap = new Map<string, number>();
    invList.forEach((i: any) => invMap.set(`${i.productoId}_${i.tallaId}`, i.cantidad));

    const colegiosEnAmbito = new Set(
      ctx.productos.map((p: any) => String(p.colegioId)).filter((x: string) => x && x !== 'null')
    );
    const idsActivos = new Set<string>();
    for (const cid of colegiosEnAmbito) {
      for (const t of (ctx.tallasPorColegio.get(cid) || [])) idsActivos.add(String(t.id));
    }
    const mapTallasActivas = await obtenerMapTallasActivasPorColegio(db);
    const tallasGlobales = await obtenerTallasActivasPorColegio(db, colegioId);
    const allTallas = idsActivos.size > 0
      ? tallasGlobales.filter((t: any) => idsActivos.has(String(t.id)))
      : tallasGlobales;

    const porProducto = new Map<string, any[]>();
    for (const f of filas) {
      const arr = porProducto.get(f.meta.productoId) || [];
      arr.push(f);
      porProducto.set(f.meta.productoId, arr);
    }

    const mapaTelasResumen = new Map<string, {
      telaNombre: string;
      prendasSet: Set<string>;
      stockTotal: number;
      kilosTotales: number;
      costoTotalBs: number;
    }>();

    let inversionTotalTelasBs = 0;
    let kilosTotalesTelas = 0;
    let stockTotalConTela = 0;

    const gridData = ctx.productos.map((prod: any) => {
      const rowObj: any = {
        productoId: prod.id,
        itemNumero: prod.itemNumero,
        descripcion: prod.descripcion,
        colegioId: prod.colegioId ?? null,
        colegioNombre: prod.colegioNombre || 'Sin Colegio',
        telaNombre: prod.telaId ? (ctx.telasPorId.get(prod.telaId)?.descripcion || 'Sin Nombre') : 'Sin Tela Vinculada',
        orden: prod.orden ?? null,
        subtotalStock: 0,
        subtotalCostoTelaBs: 0,
        subtotalKilosTela: 0,
        tallas: {},
      };

      const porTalla = new Map<string, any>();
      for (const f of porProducto.get(prod.id) || []) porTalla.set(f.meta.tallaId, f);

      for (const talla of allTallas) {
        const cid = String(prod.colegioId);
        const activasSet = mapTallasActivas.get(cid);
        if (activasSet && !activasSet.has(String(talla.id))) {
          rowObj.tallas[talla.codigo] = { stock: 0, costoTelaUnidad: 0, costoTelaStock: 0, pesoKilosStock: 0, seOfrece: false };
          continue;
        }

        const inv = invMap.get(`${prod.id}_${talla.id}`) ?? 0;
        const f = porTalla.get(talla.id);

        if (!f || !f.meta.seOfrece) {
          rowObj.tallas[talla.codigo] = { stock: inv, costoTelaUnidad: 0, costoTelaStock: 0, pesoKilosStock: 0, seOfrece: false };
          rowObj.subtotalStock += inv;
          continue;
        }

        const r = f.resultado;
        const costoTelaUnidad = r.costoTela || 0;
        const costoTelaStock = r2(inv * costoTelaUnidad);
        const pesoKilosStock = r2((inv * (r.pesoConMerma || 0)) / 1000);

        rowObj.tallas[talla.codigo] = {
          stock: inv,
          costoTelaUnidad: r2(costoTelaUnidad),
          costoTelaStock,
          pesoKilosStock,
          seOfrece: true,
        };

        rowObj.subtotalStock += inv;
        rowObj.subtotalCostoTelaBs = r2(rowObj.subtotalCostoTelaBs + costoTelaStock);
        rowObj.subtotalKilosTela = r2(rowObj.subtotalKilosTela + pesoKilosStock);

        if (inv > 0 || f.meta.seOfrece) {
          const tNombre = f.meta.telaNombre || rowObj.telaNombre || 'Sin Tela Vinculada';
          if (!mapaTelasResumen.has(tNombre)) {
            mapaTelasResumen.set(tNombre, {
              telaNombre: tNombre,
              prendasSet: new Set(),
              stockTotal: 0,
              kilosTotales: 0,
              costoTotalBs: 0,
            });
          }
          const tEntry = mapaTelasResumen.get(tNombre)!;
          tEntry.prendasSet.add(prod.id);
          tEntry.stockTotal += inv;
          tEntry.kilosTotales = r2(tEntry.kilosTotales + pesoKilosStock);
          tEntry.costoTotalBs = r2(tEntry.costoTotalBs + costoTelaStock);
        }
      }

      inversionTotalTelasBs = r2(inversionTotalTelasBs + rowObj.subtotalCostoTelaBs);
      kilosTotalesTelas = r2(kilosTotalesTelas + rowObj.subtotalKilosTela);
      stockTotalConTela += rowObj.subtotalStock;

      return rowObj;
    });

    const resumenTiposTela = Array.from(mapaTelasResumen.values()).map((t) => ({
      telaNombre: t.telaNombre,
      prendasConteo: t.prendasSet.size,
      stockTotal: t.stockTotal,
      kilosTotales: r2(t.kilosTotales),
      costoTotalBs: r2(t.costoTotalBs),
      pctInversion: inversionTotalTelasBs > 0 ? r2((t.costoTotalBs / inversionTotalTelasBs) * 100) : 0,
    })).sort((a, b) => b.costoTotalBs - a.costoTotalBs);

    const colegiosParaOrden = await db
      .select({ id: colegios.id, nombre: colegios.nombre, orden: colegios.orden, creadoEn: colegios.creadoEn })
      .from(colegios);
    const posiciones = posicionesDeColegios(colegiosParaOrden as any);
    const nombrePorColegio = new Map<string, string>(
      colegiosParaOrden.map((c: any) => [String(c.id), String(c.nombre)])
    );

    const referencias = await referenciasDesdeBase(db);
    for (const fila of gridData) {
      fila.colegioNombre = nombrePorColegio.get(String(fila.colegioId)) ?? null;
      fila.prod = referencias.get(String(fila.productoId)) ?? null;
    }

    const ordenadas = ordenarPrendas(gridData as any, 'defecto', posiciones, { agruparPorColegio: true });

    return c.json({
      success: true,
      tallas: allTallas.map((t: any) => ({ id: t.id, codigo: t.codigo, orden: t.orden })),
      data: ordenadas,
      resumenTiposTela,
      totalesGlobales: {
        inversionTotalTelasBs,
        kilosTotalesTelas,
        stockTotalConTela,
        variedadTelas: resumenTiposTela.length,
      },
    });
  } catch (e: any) {
    console.error('matriz-telas:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

/**
 * Resuelve prenda y talla para los dos PUT de la matriz.
 *
 * PREFIERE LAS CLAVES PRIMARIAS. La pantalla ya tiene productoId y tallaId en cada
 * celda de la grilla —los devuelve matriz-consolidada— y sin embargo mandaba
 * itemNumero y tallaCodigo, que son claves de NEGOCIO. itemNumero se numera por
 * colegio, asi que con dos colegios puede identificar dos prendas y el lookup tiene
 * que rechazar por ambiguo.
 *
 * Resolver por clave de negocio cuando el llamador tiene la clave primaria es pedirle
 * al servidor que adivine algo que el cliente ya sabe. Con productoId no hay ambiguedad
 * posible y la clase entera de error 409 desaparece.
 *
 * Se mantiene el camino por itemNumero para no romper a quien ya lo usa —la
 * verificacion automatica, entre otros— pero el preferido es el directo.
 */
async function resolverCelda(
  db: any,
  body: any
): Promise<{ prenda: any; talla: any; estado: number; error: string | null }> {
  const { productoId, tallaId, itemNumero, tallaCodigo, colegioId } = body;

  // Camino directo: las dos claves primarias.
  if (productoId && tallaId) {
    const [prenda] = await db.select().from(productos).where(eq(productos.id, productoId)).limit(1);
    if (!prenda) {
      return { prenda: null, talla: null, estado: 404, error: `No existe la prenda ${productoId}.` };
    }
    const [talla] = await db.select().from(tallas).where(eq(tallas.id, tallaId)).limit(1);
    if (!talla) {
      return { prenda: null, talla: null, estado: 404, error: `No existe la talla ${tallaId}.` };
    }
    return { prenda, talla, estado: 200, error: null };
  }

  // Camino por clave de negocio, con la guarda de ambiguedad.
  if (!itemNumero || Number(itemNumero) <= 0 || !tallaCodigo) {
    return {
      prenda: null,
      talla: null,
      estado: 400,
      error: 'Hacen falta productoId y tallaId, o bien itemNumero y tallaCodigo.',
    };
  }

  const r = await resolverPrendaPorItem(db, Number(itemNumero), colegioId);
  if (!r.prenda) {
    return { prenda: null, talla: null, estado: r.estado, error: r.error };
  }

  const talla = await resolverTallaPorCodigo(db, String(tallaCodigo), r.prenda.colegioId);
  if (!talla) {
    return {
      prenda: null,
      talla: null,
      estado: 404,
      error: `No existe la talla ${tallaCodigo} para esa prenda.`,
    };
  }

  return { prenda: r.prenda, talla, estado: 200, error: null };
}

/** Busca la talla por codigo dentro del vocabulario visible para esa prenda. */
async function resolverTallaPorCodigo(db: any, tallaCodigo: string, colegioIdPrenda: string) {
  // Se traen las candidatas del colegio y se compara en FORMA CANONICA, no con un `WHERE codigo = ?`.
  //
  // El `eq` exacto que habia aca fallaba si los dos lados no estaban escritos igual: la base guarda
  // `2` y la pantalla puede mandar `02`. Y fallaba raro —el precio no se guardaba y el error decia
  // "No existe la talla 02" para una talla que si existe—. Son 16 filas: comparar en memoria no
  // cuesta nada y deja de depender de en que formato quedo la base.
  const candidatas = await db
    .select()
    .from(tallas)
    .where(or(eq(tallas.colegioId, colegioIdPrenda), isNull(tallas.colegioId)));
  return buscarTallaPorCodigo(candidatas as any[], tallaCodigo);
}

// PUT /api/calculo/precio-venta - Actualizar PrecioDeVenta directamente en la matriz
//
// Acepta colegioId opcional en el cuerpo. Sin colegio se comporta igual que antes
// mientras el item sea inequivoco; con dos colegios cargados exige que se diga cual.
api.put('/precio-venta', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json(); // { itemNumero, tallaCodigo, precioBs, colegioId? }

  const { itemNumero, tallaCodigo, precioBs } = body;

  // La base manda: primero se resuelve contra la base, y solo despues se toca el
  // cache del Excel. Al reves —como estaba— un fallo dejaba la matriz mostrando un
  // precio que nunca se guardo: el cache decia una cosa y la base otra.
  const { prenda, talla, estado, error } = await resolverCelda(db, body);
  if (!prenda || !talla) return c.json({ success: false, error }, estado as any);

  const nuevoPv = Number(precioBs) || 0;

  try {
    await db.delete(preciosVenta).where(and(eq(preciosVenta.productoId, prenda.id), eq(preciosVenta.tallaId, talla.id)));
    await db.insert(preciosVenta).values({
      productoId: prenda.id,
      tallaId: talla.id,
      precioBs: nuevoPv,
    });
  } catch (e: any) {
    // Antes el catch se tragaba el error y el handler devolvia success igual. Si la
    // escritura falla el usuario tiene que saberlo: la pantalla no puede mostrar
    // como guardado algo que no se guardo.
    console.error('Error actualizando DB para precioVenta:', e);
    return c.json({ success: false, error: 'No se pudo guardar el precio: ' + (e?.message || String(e)) }, 500);
  }

  // Aca vivia el mantenimiento del cache heredado del Excel: despues de guardar el precio en la
  // base, copiaba el valor —y recalculaba utilidad y margen— dentro de un mapa en memoria que
  // salia de CAMBRIDGE.xlsx. Nadie leia ese mapa: era una escritura sin lector. Los tres numeros
  // los da el motor de costeo cuando la pantalla vuelve a pedir la matriz.

  return c.json({ success: true, message: 'Precio de venta actualizado exitosamente' });
});

// PUT /api/calculo/inventario-unidades - Actualizar INVENTARIO directamente en la matriz
//
// Mismo tratamiento que /precio-venta: colegioId opcional, la base manda, y no se
// devuelve success si la escritura no ocurrio.
api.put('/inventario-unidades', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json(); // { itemNumero, tallaCodigo, cantidad, colegioId? }

  const { itemNumero, tallaCodigo, cantidad } = body;

  const { prenda, talla, estado, error } = await resolverCelda(db, body);
  if (!prenda || !talla) return c.json({ success: false, error }, estado as any);

  const cantNum = Number(cantidad) || 0;

  try {
    // .returning() para distinguir "actualice una fila" de "no habia ninguna".
    // Antes, si la prenda y la talla no tenian fila de inventario, el update no
    // afectaba nada y el handler devolvia success: el mismo defecto que tenia el
    // PUT de mano de obra.
    const filas = await db
      .update(inventario)
      .set({ cantidad: cantNum })
      .where(and(eq(inventario.productoId, prenda.id), eq(inventario.tallaId, talla.id)))
      .returning();

    if (filas.length === 0) {
      return c.json({
        success: false,
        error: `La prenda item ${itemNumero} y la talla ${tallaCodigo} no tienen fila de inventario.`,
      }, 404);
    }
  } catch (e: any) {
    console.error('Error actualizando DB para inventario:', e);
    return c.json({ success: false, error: 'No se pudo guardar el inventario: ' + (e?.message || String(e)) }, 500);
  }

  // El volcado a disco lo hace ahora el middleware de server.ts. La llamada
  // explicita a saveDbToDisk() que vivia aca era la unica de este archivo, y por eso
  // el precio de venta se guardaba solo si despues tocabas el inventario.
  // Igual que en el precio de venta: aca se mantenia el cache del Excel, sin lector. Se fue.

  return c.json({ success: true, message: 'Inventario actualizado exitosamente' });
});

// PUT /api/calculo/accesorio-total
//
// ESTE ENDPOINT YA NO HACE NADA, y se deja a proposito respondiendo 200.
//
// Su cuerpo entero era una linea que escribia el total de accesorios en el cache del Excel en
// memoria. Nadie leia ese cache, asi que el efecto real siempre fue ninguno: el total de
// accesorios lo calcula el motor de costeo desde `detalle_acc` cada vez que se pide la matriz.
//
// No se borra porque la pantalla lo sigue llamando al editar una receta (dashboard.html). Si
// devolviera 404, la edicion mostraria un error donde antes no habia ninguno —y por un pedido
// que nunca sirvio para nada—. Se saca junto con su llamada del frontend, no antes.
api.put('/accesorio-total', async (c) => {
  await c.req.json().catch(() => ({}));
  return c.json({
    success: true,
    message: 'El total de accesorios lo calcula el motor de costeo; no hay nada que guardar.',
  });
});

// GET /api/calculo/matriz-prenda/:productoId - Matriz por prenda individual
//
// UNIFICADO (Fase 2). Antes esta ruta tenia su propia copia de la formula, y en
// realidad casi no calculaba: leia los totales ya hechos del Excel y despejaba el
// costo de tela por resta, `costoTela = max(0, excelCb - costoMO - costoAcc)`.
// Donde el Excel no tenia valor, el costo de tela quedaba en 0: reportaba tela
// gratis, y no por redondeo sino por incapacidad estructural — nunca podia
// costear tela desde la base. El usuario fallo el 29-jul-2026 que gana el numero
// nuevo (causa 2 del arnes de paridad).
//
// Ahora delega en el motor. La aritmetica que habia aca no existe mas.
//
// El shape de la respuesta se conserva campo por campo, porque dashboard.html lee
// estos nombres directo. Se agregan dos campos nuevos, `seOfrece` y `diagnostico`,
// que son aditivos y no rompen a ningun consumidor.
api.get('/matriz-prenda/:productoId', async (c) => {
  try {
    const db = (c as any).db;
    const productoId = c.req.param('productoId');
    const snapshotId = c.req.query('snapshotId');
    const res = await costearPrendaTodasLasTallas(db, productoId, snapshotId);
    if (!res) {
      return c.json({ success: false, error: 'Producto no encontrado' }, 404);
    }
    const { producto: prod, filas, ctx } = res;

    const avisosFiscales: string[] = [];
    const fiscal = construirContextoFiscal(c, ctx, avisosFiscales);

    // El codigo del POS de cada talla, y la referencia de la prenda. En esta pantalla la fila es un
    // concepto y las columnas son tallas, asi que el codigo NO puede ser una columna: va en una
    // fila `Cod` con un codigo por talla, que es la unica forma en que no miente.
    const [codigosPos, referencias] = await Promise.all([
      codigosPosDesdeBase(db),
      referenciasDesdeBase(db),
    ]);

    const matriz = filas.map((f) => {
      const { meta, resultado } = f;

      // Regla decidida el 29-jul-2026: `precio_venta` es la fuente de verdad de
      // si la prenda se ofrece en esa talla. Sin precio vigente no se ofrece, y
      // los costos se muestran en 0 en vez de prorratearle un costo fijo a una
      // combinacion que no existe. Reemplaza al viejo `isProduced`, que era una
      // heuristica sobre peso y componentes.
      const existe = meta.seOfrece;

      // El precio que se MUESTRA depende del modo fiscal. Con factura es el de
      // lista; sin factura, el de lista menos el descuento comercial. Antes esta
      // fila devolvia siempre `meta.precioVentaBs` crudo, y por eso la pantalla de
      // Costeo Multitalla mostraba el mismo precio en los dos modos: lo unico que
      // cambiaba era que aparecia o desaparecia una seccion de la tabla.
      const { precioLista, precioVenta, ingresoNeto } = resolverPrecios(meta.precioVentaBs, fiscal);

      return {
        tallaId: meta.tallaId,
        tallaCodigo: meta.tallaCodigo,
        tallaNombre: meta.tallaNombre,
        // null cuando esa talla todavia no tiene codigo: la pantalla pone un guion en vez de
        // inventar uno.
        codigoPos: codigosPos.get(claveCodigoPos(prod.id, meta.tallaId)) ?? null,
        pesoExacto: r2(meta.pesoExactoGramos),
        pesoConMerma: r2(resultado.pesoConMerma),
        mermaPorcentaje: meta.mermaPorcentaje ?? 8,
        costoTela: existe ? resultado.costoTela : 0,
        costoAccesorios: existe ? resultado.costoAccesorios : 0,
        costoManoObra: existe ? resultado.costoManoObra : 0,
        costoBruto: existe ? resultado.costoBruto : 0,
        costoFijosVariable: existe ? resultado.costoFijosVariable : 0,
        // FASE 4: el indirecto ya no viaja disfrazado de costo fijo. Prorrateado
        // sobre volumen ANUAL y proporcional al factorComplejidad, normalizado
        // para que lo absorbido iguale el pool.
        costoIndirecto: existe ? resultado.costoIndirecto : 0,
        costoUnitarioNeto: existe ? resultado.costoUnitarioNeto : 0,
        precioVenta: existe ? r2(precioVenta) : precioVenta > 0 ? r2(precioVenta) : null,
        precioLista: precioLista > 0 ? r2(precioLista) : null,
        ingresoNetoEfectivo: existe ? r2(ingresoNeto) : null,
        ingresoNetoConFactura: existe ? resultado.ingresoNetoConFactura : null,
        ingresoNetoSinFactura: existe ? resultado.ingresoNetoSinFactura : null,
        utilidadConFactura: existe ? resultado.utilidadConFactura : null,
        utilidadSinFactura: existe ? resultado.utilidadSinFactura : null,
        margenConFactura: existe ? resultado.margenConFactura : null,
        margenSinFactura: existe ? resultado.margenSinFactura : null,

        // Aditivos. Lo que antes se resolvia devolviendo 0 en silencio.
        seOfrece: existe,
        diagnostico: {
          ...resultado.diagnostico,
          modoCosteo: meta.modoCosteo,
          telaVinculada: meta.telaVinculada,
          tieneManoObra: meta.tieneManoObra,
          faltantes: meta.faltantes,
          inconsistencias: meta.inconsistencias,
        },
      };
    });

    const [colObj] = prod.colegioId ? await db.select({ nombre: colegios.nombre }).from(colegios).where(eq(colegios.id, prod.colegioId)).limit(1) : [null];

    return c.json({
      success: true,
      producto: {
        id: prod.id,
        itemNumero: prod.itemNumero,
        colegioId: prod.colegioId,
        colegioNombre: colObj ? colObj.nombre : null,
        prod: referencias.get(String(prod.id)) ?? null,
        descripcion: prod.descripcion,
        factorComplejidad: prod.factorComplejidad,
        modoCosteo: prod.modoCosteo === 'adquirido' ? 'adquirido' : 'confeccion',
      },
      modalidad: fiscal.modalidad,
      modalidadEtiqueta: etiquetaModalidad(fiscal.modalidad),
      descuentoSinFacturaPct: parseFloat((fiscal.descuentoFraccion * 100).toFixed(2)),
      tasaIvaPct: parseFloat((fiscal.tasaIvaFraccion * 100).toFixed(2)),
      avisos: avisosFiscales,
      data: matriz,
    });
  } catch (e: any) {
    console.error('matriz-prenda:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

export default api;
