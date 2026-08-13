import { Decimal } from 'decimal.js';
import { eq, and, asc, isNull, or } from 'drizzle-orm';
import {
  productos,
  tallas,
  colegioTallas,
  telas,
  pesoMateriaPrima,
  manoObraTipo,
  // manoObra se mantiene en el import solo para backward compat con snapshots viejos que
  // guardan datos en ese campo. El motor ya no lee de esta tabla directamente.
  manoObra,
  accesorios,
  detalleAccesorio,
  preciosVenta,
  preciosAdquisicion,
  costosIndirectos,
  costoSnapshots,
} from '../../database/schema';
import { getSystemConfig, type SystemConfig } from '../configService';
import { ordenarPrendasDesdeBase } from '../ordenPrendasDb';
import {
  calcularCostoTotal,
  calcularCostoAccesorios,
  type CalculoInputs,
  type CalculoResultado,
} from './costoTotal.service';

/**
 * Armado de los inputs del motor de costeo DESDE LA BASE DE DATOS.
 *
 * Por que existe este archivo. La formula de costeo vivia en tres lugares con
 * tres comportamientos distintos:
 *
 *   1. costoTotal.service.ts        el motor real, corregido y verificado
 *   2. routes/inputs.ts             desglose-inteligente-producto, calculo inline
 *   3. routes/calculo.ts            matriz-consolidada y matriz-prenda, inline
 *
 * Los dos ultimos no eran copias del primero: (2) saca las CANTIDADES de
 * accesorios del Excel por division inversa (costoDeLaCelda / costoUnitario) y
 * funde fijos e indirectos en un solo concepto; (3) casi no calcula, lee los
 * totales ya hechos del Excel y despeja el costo de tela por resta.
 *
 * Este servicio es la unica pieza que traduce filas de la base a CalculoInputs.
 * No calcula nada por su cuenta: la aritmetica sigue siendo del motor. Asi la
 * formula queda en un solo lugar y las pantallas dejan de poder discrepar.
 *
 * REGLA DE DISEÑO: no inventa datos. Donde falta un dato, el campo queda en
 * undefined y se registra en `meta.faltantes`. El camino viejo hacia lo
 * contrario: si no habia fila de mano de obra usaba 15.0 Bs hardcodeados, y si
 * el costo unitario del accesorio era 0 asumia cantidad 1. Esos numeros
 * fabricados son la causa de que dos pantallas mostraran cifras distintas para
 * la misma prenda sin que nada pareciera roto.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface LineaAccesorio {
  accesorioId: string;
  nombre: string;
  unidadCompra: string;
  costoUnitarioBs: number;
  cantidad: number;
  costoTotalBs: number;
  /** El accesorio esta marcado como inactivo en el catalogo pero la receta lo usa. */
  inactivo: boolean;
}

export interface MetaCosteo {
  productoId: string;
  itemNumero: number;
  descripcion: string;
  tallaId: string;
  tallaCodigo: string;
  tallaNombre: string;

  modoCosteo: 'confeccion' | 'adquirido';

  /** De donde salio el peso que se le paso al motor. */
  origenPeso: 'pesoGramos' | 'pesoExactoGramos' | 'ninguno';
  /** Valores crudos de peso_mat_prima, tal como estan en la base. */
  pesoGramos: number;
  pesoExactoGramos: number;
  mermaPorcentaje: number | null;
  telaVinculada: boolean;
  telaNombre: string | null;
  precioBsG: number | null;

  lineasAccesorios: LineaAccesorio[];
  subtotalAccesoriosBs: number;

  tieneManoObra: boolean;
  costoManoObraBs: number;

  factorComplejidad: number;
  tarifaPuntoComplejidad: number;

  /**
   * Regla decidida el 29-jul-2026: `precio_venta` es la fuente de verdad de si
   * la prenda se ofrece en esa talla. Sin precio vigente, no se ofrece.
   */
  seOfrece: boolean;
  precioVentaBs: number | null;
  precioAdquisicionBs: number | null;
  /**
   * Codigo de esta prenda-talla en el sistema POS, si se importo.
   *
   * Viaja con el precio porque vive en la misma fila de `precio_venta`, que es la unica tabla
   * del sistema con granularidad prenda + talla. Y es EXACTAMENTE la granularidad del codigo:
   * `001-cc` es el pantalon de Cambridge en UNA talla, no la prenda.
   *
   * `null` mientras no se haya importado. La consulta que trae los precios ya lo devolvia
   * —es un select completo— asi que exponerlo no cuesta una consulta mas.
   */
  codigoExterno: string | null;

  /**
   * Columnas de costo fijo que existen en `producto` y que el modelo vigente NO
   * cuenta. Se exponen en vez de ignorarlas en silencio: si alguna trae valor,
   * hay costo real que ninguna pantalla esta sumando. Decision de la Fase 4.
   */
  columnasFijasNoContadas: {
    costoFijo: number;
    planchadoExtra: number;
    colocacionBotones: number;
    operacionesExtra: number;
    algunaConValor: boolean;
  };

  faltantes: string[];
  inconsistencias: string[];
}

export interface ContextoCosteo {
  sysConfig: SystemConfig;
  /** Fraccion, no porcentaje. Ver `tasaIvaComoFraccion`. */
  tasaIvaFraccion: number;
  totalIndirectosMensual: number;
  /** FASE 4. Pool anual = mensual x 12. La captura sigue siendo mensual. */
  poolIndirectoAnual: number;
  volumenAnual: number;
  /** Promedio simple del factor entre las prendas del lote. Ver nota de normalizacion. */
  factorPromedio: number;
  /**
   * Bs de indirecto por cada punto de factorComplejidad. Normalizada para que la
   * suma absorbida iguale el pool. Ver la nota en `cargarContextoCosteo`.
   */
  tasaPorPuntoFactor: number;
  /**
   * La tarifa del modelo VIEJO, `indirectosMes / (volumenMes x 10)`. Se conserva
   * solo para poder medir cuanto se absorbia antes; no se usa para costear.
   */
  tarifaPuntoComplejidad: number;

  productos: any[];
  tallasPorId: Map<string, any>;
  tallasPorColegio: Map<string, any[]>;
  telasPorId: Map<string, any>;
  pesoPorClave: Map<string, any>;
  /**
   * MO keyed por `tipoPrendaId_tallaId`. Fuente principal desde Fase 6.
   * Se usa cuando `producto.tipoPrendaId` está asignado.
   */
  manoObraTipoPorClave: Map<string, any>;
  /**
   * MO keyed por `productoId_tallaId`. Fallback legacy para snapshots viejos
   * que tienen datos en el campo `manoObra` del JSON (sin `manoObraTipo`).
   * En una base post-migración este mapa siempre está vacío.
   */
  manoObraLegacyPorClave: Map<string, any>;
  accesoriosPorProducto: Map<string, LineaAccesorio[]>;
  precioVentaPorClave: Map<string, any>;
  precioAdquisicionPorClave: Map<string, any>;

  /** Inconsistencias de datos detectadas al cargar, no por prenda. */
  avisosGlobales: string[];
}

const clave = (productoId: string, tallaId: string) => `${productoId}_${tallaId}`;

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Conversion de IVA: la linea de mas riesgo de todo el refactor
// ---------------------------------------------------------------------------

/**
 * `configuracion_sistema.tasa_iva` guarda 13, es decir un PORCENTAJE, y
 * `configService` lo devuelve tal cual en `sysConfig.tasaIva` (y ademas expone
 * `factorIva = 1 + tasaIva/100 = 1.13`).
 *
 * El motor espera `tasaIva` como FRACCION: hace `costoAntesImpuestos * tasa` y
 * su default es `IVA_RATE || 0.13`.
 *
 * Pasar `sysConfig.tasaIva` directo al motor da 1300% de IVA. Es un error que no
 * rompe nada, no lanza excepcion y produce numeros catastroficamente grandes que
 * a simple vista parecen un problema de datos. De ahi esta funcion, con nombre
 * explicito, en vez de un `/ 100` suelto en medio del armado.
 */
export function tasaIvaComoFraccion(sysConfig: SystemConfig, avisos?: string[]): number {
  const bruto = num(sysConfig.tasaIva);
  if (bruto > 1) return bruto / 100;
  if (bruto > 0) {
    // Alguien guardo 0.13 en vez de 13. Dividir otra vez daria 0.13%.
    avisos?.push(
      `configuracion_sistema.tasa_iva vale ${bruto}, que parece ya ser una fraccion y no un ` +
      `porcentaje. Se usa tal cual. El resto del sistema asume porcentaje (13), revisar.`
    );
    return bruto;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Carga del contexto: una consulta por tabla, sin N+1
// ---------------------------------------------------------------------------

/**
 * Trae de la base todo lo necesario para costear un lote de prendas.
 *
 * Se carga en batch a proposito: el armado por (producto, talla) es despues una
 * funcion pura sobre este contexto. Asi la ruta y el arnes de comparacion usan
 * exactamente el mismo codigo de ensamblado y no pueden divergir.
 */
export async function cargarContextoCosteo(
  db: any,
  opts: { colegioId?: string; productoId?: string; snapshotId?: string; incluirInactivos?: boolean } = {}
): Promise<ContextoCosteo> {
  const avisosGlobales: string[] = [];
  const sysConfig = await getSystemConfig(db);
  const tasaIvaFraccion = tasaIvaComoFraccion(sysConfig, avisosGlobales);

  let snapData: any = null;
  if (opts.snapshotId && opts.snapshotId !== 'actual') {
    try {
      const [snap] = await db.select().from(costoSnapshots).where(eq(costoSnapshots.id, opts.snapshotId)).limit(1);
      if (snap && snap.datosJson) {
        snapData = JSON.parse(snap.datosJson);
      }
    } catch (e) {
      avisosGlobales.push('No se pudo cargar la instantánea especificada: ' + String(e));
    }
  }

  // --- productos ---
  let listaProductos: any[] = [];
  if (snapData && Array.isArray(snapData.productos)) {
    listaProductos = snapData.productos.filter((p: any) => {
      if (!opts.incluirInactivos && p.activo === false) return false;
      if (opts.productoId && p.id !== opts.productoId) return false;
      if (opts.colegioId && opts.colegioId !== 'all' && p.colegioId !== opts.colegioId) return false;
      return true;
    });
  } else {
    const filtrosProducto: any[] = [];
    if (!opts.incluirInactivos) {
      filtrosProducto.push(or(eq(productos.activo, true), isNull(productos.activo)));
    }
    if (opts.productoId) filtrosProducto.push(eq(productos.id, opts.productoId));
    if (opts.colegioId && opts.colegioId !== 'all') {
      filtrosProducto.push(eq(productos.colegioId, opts.colegioId));
    }
    listaProductos = filtrosProducto.length
      ? await db.select().from(productos)
          .where(filtrosProducto.length === 1 ? filtrosProducto[0] : and(...filtrosProducto))
      : await db.select().from(productos);
  }

  // EL ORDEN DE LAS PRENDAS, UNA SOLA VEZ Y PARA TODO EL MOTOR.
  //
  // Aca vivian la DUODECIMA y la DECIMOTERCERA copia del orden, y las dos con el criterio
  // equivocado: la rama de instantanea ordenaba en JavaScript y la rama viva en SQL, ambas por
  // `orden, item_numero`. `producto.orden` se numera POR COLEGIO, asi que la unica prenda de
  // Internacional SM tiene `orden = 1` igual que la primera de Cambridge, empatan, y el desempate
  // por item la mete en medio.
  //
  // No era invisible: el selector de Costeo Individual ofrecia `CAM-01, ISM-01, CAM-02, CAM-03`.
  // Las pantallas que ya pasaban por `ordenarPrendasDesdeBase` lo tapaban reordenando la salida;
  // las que confiaban en el contexto, no.
  //
  // Ordenar ACA y no en cada consumidor es la unica forma de que no aparezca una copia numero
  // catorce: `ctx.productos` lo recorren siete lugares entre rutas y servicios.
  listaProductos = await ordenarPrendasDesdeBase(db, listaProductos as any, 'defecto');

  // --- tallas ---
  // FASE 5. Las tallas pasan a ser vocabulario COMPARTIDO: colegio_id NULL. Antes
  // este mapa se indexaba por t.colegioId y se consultaba con producto.colegioId,
  // asi que con las tallas compartidas la busqueda habria devuelto vacio y CADA
  // PRENDA habria quedado sin ninguna talla — el costeo entero en cero filas.
  //
  // Ahora, para cada colegio, la lista es: las compartidas mas las propias. Eso
  // funciona igual antes de migrar (no hay compartidas, cada colegio ve las suyas)
  // y despues (todas compartidas, todos las ven), y ademas deja la puerta abierta a
  // que un colegio tenga una talla exclusiva si algun dia hace falta.
  const listaTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));
  const tallasPorId = new Map<string, any>();
  const tallasPorColegio = new Map<string, any[]>();

  // TALLAS ACTIVAS POR COLEGIO. `talla.activo` es un flag GLOBAL y las tallas del
  // sistema son compartidas (colegio_id nulo), asi que ese flag no puede expresar
  // "activa aca y apagada alla". La tabla colegio_talla si.
  //
  // REGLA: SIN FILA = ACTIVA. Es lo que hace que este cambio no mueva ningun costo
  // el dia que se aplica: una base sin filas en colegio_talla se comporta
  // exactamente como antes. La tabla solo habla cuando alguien apago algo.
  //
  // El flag global se sigue respetando: si una talla esta apagada globalmente, no la
  // ve nadie. Es la puerta de arriba; colegio_talla es la de cada colegio.
  let overridesPorColegio = new Map<string, Map<string, { activo: boolean; orden: number | null }>>();
  try {
    const filas = await db.select().from(colegioTallas);
    for (const f of filas) {
      const cid = String(f.colegioId);
      if (!overridesPorColegio.has(cid)) overridesPorColegio.set(cid, new Map());
      overridesPorColegio.get(cid)!.set(String(f.tallaId), {
        activo: f.activo !== false,
        orden: f.orden == null ? null : num(f.orden),
      });
    }
  } catch (e) {
    // La tabla puede no existir en una base muy vieja. Sin ella, todo activo, que es
    // el comportamiento previo. No se aborta el costeo por una tabla de preferencias.
    avisosGlobales.push(
      'No se pudo leer la configuracion de tallas por colegio; se consideran todas activas.'
    );
  }

  const tallasCompartidas: any[] = [];
  const tallasEspecificas = new Map<string, any[]>();
  for (const t of listaTallas) {
    tallasPorId.set(t.id, t);
    if (t.activo === false) continue;
    if (t.colegioId == null) {
      tallasCompartidas.push(t);
    } else {
      const arr = tallasEspecificas.get(t.colegioId) || [];
      arr.push(t);
      tallasEspecificas.set(t.colegioId, arr);
    }
  }

  const colegiosPresentes = new Set<string>();
  for (const p of listaProductos) if (p.colegioId) colegiosPresentes.add(String(p.colegioId));
  for (const cid of tallasEspecificas.keys()) colegiosPresentes.add(cid);
  for (const cid of overridesPorColegio.keys()) colegiosPresentes.add(cid);
  for (const cid of colegiosPresentes) {
    const propias = tallasEspecificas.get(cid) || [];
    const overrides = overridesPorColegio.get(cid);
    tallasPorColegio.set(
      cid,
      [...tallasCompartidas, ...propias]
        .filter((t: any) => {
          const o = overrides?.get(String(t.id));
          return o ? o.activo : true; // sin fila = activa
        })
        .sort((a: any, b: any) => {
          const oa = overrides?.get(String(a.id))?.orden;
          const ob = overrides?.get(String(b.id))?.orden;
          return (oa == null ? num(a.orden) : oa) - (ob == null ? num(b.orden) : ob);
        })
    );
  }

  // --- telas ---
  const listaTelas = (snapData && Array.isArray(snapData.telas)) ? snapData.telas : await db.select().from(telas);
  const telasPorId = new Map<string, any>();
  for (const t of listaTelas) telasPorId.set(t.id, t);

  // --- peso materia prima ---
  const listaPeso = (snapData && Array.isArray(snapData.pesoMateriaPrima)) ? snapData.pesoMateriaPrima : await db.select().from(pesoMateriaPrima);
  const pesoPorClave = new Map<string, any>();
  for (const p of listaPeso) {
    const k = clave(p.productoId, p.tallaId);
    if (pesoPorClave.has(k)) {
      avisosGlobales.push(`peso_mat_prima duplicado para ${k}. Se usa la primera fila.`);
      continue;
    }
    pesoPorClave.set(k, p);
  }

  // --- mano de obra ---
  //
  // Desde Fase 6 la MO se guarda en mano_obra_tipo (por tipoPrendaId + tallaId).
  // Para snapshots viejos que tienen datos en `snapData.manoObra` (sin `manoObraTipo`)
  // se construye también el mapa legacy, que el ensamblador usa como fallback cuando
  // el producto no tiene tipoPrendaId.
  //
  // En producción post-migración: manoObraTipoPorClave tiene datos, manoObraLegacyPorClave
  // está vacío, y todos los productos tienen tipoPrendaId → el fallback nunca se activa.

  // Mapa principal: tipoPrendaId_tallaId → fila de mano_obra_tipo
  const listaMOTipo = (snapData && Array.isArray(snapData.manoObraTipo))
    ? snapData.manoObraTipo
    : await db.select().from(manoObraTipo);
  const manoObraTipoPorClave = new Map<string, any>();
  for (const m of listaMOTipo) {
    const k = clave(m.tipoPrendaId, m.tallaId);
    if (manoObraTipoPorClave.has(k)) {
      avisosGlobales.push(`mano_obra_tipo duplicada para ${k}. Se usa la primera fila.`);
      continue;
    }
    manoObraTipoPorClave.set(k, m);
  }

  // Mapa legacy: productoId_tallaId → fila de mano_obra (solo snapshots viejos)
  // En producción post-migración mano_obra está vacía; esto devuelve [] siempre.
  const listaMOLegacy = (snapData && Array.isArray(snapData.manoObra))
    ? snapData.manoObra
    : [];
  const manoObraLegacyPorClave = new Map<string, any>();
  for (const m of listaMOLegacy) {
    const k = clave(m.productoId, m.tallaId);
    if (manoObraLegacyPorClave.has(k)) continue;
    manoObraLegacyPorClave.set(k, m);
  }

  // --- receta de accesorios: detalle_acc unido al catalogo ---
  // Esto reemplaza la lectura de CAMBRIDGE.xlsx en runtime. `detalle_acc` tiene
  // unique en (productoId, accesorioId), asi que no hay riesgo de doble linea.
  const filasAcc = await db
    .select({
      productoId: detalleAccesorio.productoId,
      accesorioId: detalleAccesorio.accesorioId,
      cantidadUso: detalleAccesorio.cantidadUso,
      nombre: accesorios.descripcion,
      unidadCompra: accesorios.unidadCompra,
      costoUnitario: accesorios.costoUnitario,
      activo: accesorios.activo,
    })
    .from(detalleAccesorio)
    .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id));

  const accesoriosPorProducto = new Map<string, LineaAccesorio[]>();
  for (const f of filasAcc) {
    const cantidad = num(f.cantidadUso);
    const costoUnitarioBs = num(f.costoUnitario);
    const linea: LineaAccesorio = {
      accesorioId: f.accesorioId,
      nombre: (f.nombre || '').trim(),
      unidadCompra: f.unidadCompra || 'unidad',
      costoUnitarioBs,
      cantidad,
      // Se redondea por linea con el MISMO mecanismo que `calcularCostoAccesorios`
      // (decimal.js, 2 decimales), no con Math.round sobre floats. Asi el
      // desglose que se muestra linea por linea suma exactamente su propio
      // subtotal, que es una de las cosas que hoy no se cumple en pantalla.
      costoTotalBs: new Decimal(cantidad).times(costoUnitarioBs).toDecimalPlaces(2).toNumber(),
      inactivo: f.activo === false,
    };
    const arr = accesoriosPorProducto.get(f.productoId) || [];
    arr.push(linea);
    accesoriosPorProducto.set(f.productoId, arr);
  }
  for (const arr of accesoriosPorProducto.values()) {
    arr.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  // --- precio de venta vigente ---
  const listaPV = (snapData && Array.isArray(snapData.preciosVenta))
    ? snapData.preciosVenta.filter((pv: any) => !pv.vigenteHasta)
    : await db.select().from(preciosVenta).where(isNull(preciosVenta.vigenteHasta));
  const precioVentaPorClave = new Map<string, any>();
  for (const pv of listaPV) {
    const k = clave(pv.productoId, pv.tallaId);
    const previo = precioVentaPorClave.get(k);
    if (previo) {
      avisosGlobales.push(
        `Dos precios de venta abiertos a la vez para ${k}. Se usa el de vigenteDesde mas reciente.`
      );
      if (String(pv.vigenteDesde || '') <= String(previo.vigenteDesde || '')) continue;
    }
    precioVentaPorClave.set(k, pv);
  }

  // --- precio de adquisicion vigente (prendas semiterminadas o de reventa) ---
  const precioAdquisicionPorClave = new Map<string, any>();
  try {
    const listaPA = (snapData && Array.isArray(snapData.preciosAdquisicion))
      ? snapData.preciosAdquisicion.filter((pa: any) => !pa.vigenteHasta)
      : await db.select().from(preciosAdquisicion).where(isNull(preciosAdquisicion.vigenteHasta));
    for (const pa of listaPA) {
      const k = clave(pa.productoId, pa.tallaId);
      const previo = precioAdquisicionPorClave.get(k);
      if (previo && String(pa.vigenteDesde || '') <= String(previo.vigenteDesde || '')) continue;
      precioAdquisicionPorClave.set(k, pa);
    }
  } catch (e) {
    avisosGlobales.push(
      'No se pudo leer precio_adquisicion. Las prendas con modoCosteo=adquirido van a quedar sin costo de material.'
    );
  }

  // --- indirectos ---
  let totalIndirectosMensual = 0;
  try {
    const listaCI = (snapData && Array.isArray(snapData.costosIndirectos))
      ? snapData.costosIndirectos
      : await db.select().from(costosIndirectos);
    totalIndirectosMensual = listaCI.reduce((s: number, r: any) => s + num(r.montoMensual), 0);
  } catch (e) {
    avisosGlobales.push('No se pudieron leer los costos indirectos. Se costea con indirectos en 0.');
  }

  // ---------- FASE 4: absorcion de indirectos ----------
  //
  // El modelo viejo hacia `indirectosMes / (volumenMes * 10)` y multiplicaba por
  // el factorComplejidad. Ese `* 10` era un numero magico sin documentar, y su
  // efecto real es que el sistema absorbia solo factor/10 del pool: con factores
  // de 1 a 3 se cargaba entre el 10% y el 30% de los indirectos y el resto no lo
  // pagaba ninguna prenda. Sobre 21.480 Bs/mes son del orden de 180.000 Bs al año
  // de costos reales que quedaban fuera del costeo.
  //
  // Ahora la tasa se NORMALIZA para que lo absorbido iguale el pool:
  //
  //   tasaPorPuntoFactor = poolAnual / (volumenAnual x factorPromedio)
  //   indirectoUnitario  = tasaPorPuntoFactor x factor(prenda)
  //
  // Asi una prenda con el doble de factor absorbe el doble, y la suma sobre la
  // produccion anual da exactamente el pool. Una asignacion que no suma el pool
  // no es una asignacion, es un ajuste a ojo.
  //
  // SIMPLIFICACION DECLARADA: el factor promedio es el promedio SIMPLE entre las
  // prendas del lote, no ponderado por unidades producidas, porque el sistema no
  // guarda produccion por prenda. Si la mezcla real esta sesgada hacia prendas de
  // factor alto o bajo, la absorcion se desvia del pool en esa proporcion. Se
  // cierra el dia que haya volumen por prenda.
  const volumenMes = num(sysConfig.volumenMensualProduccion);
  const poolIndirectoAnual = totalIndirectosMensual * 12;
  const volumenAnual = num(sysConfig.volumenAnualProduccion) > 0
    ? num(sysConfig.volumenAnualProduccion)
    : volumenMes * 12;

  // EL FACTOR PROMEDIO NO PUEDE DEPENDER DEL FILTRO DEL LLAMADOR.
  //
  // Bug real que introdujo la primera version de esto y que detecto el arnes de
  // paridad. El promedio se calculaba sobre `listaProductos`, que viene filtrada
  // por `opts.productoId`. Cuando el llamador pedia UNA prenda — que es lo que
  // hace `matriz-prenda` via costearPrendaTodasLasTallas — el promedio era el
  // factor de esa misma prenda, y entonces:
  //
  //   tasaPorPuntoFactor x factor = (pool / (volumen x factor)) x factor
  //                               = pool / volumen
  //
  // o sea el factor se cancelaba y toda prenda absorbia el promedio del pool,
  // 11,93 Bs, en vez de su parte proporcional. Resultado: costear una prenda sola
  // daba un numero distinto que costearla dentro del lote. Exactamente la clase de
  // inconsistencia que este refactor vino a eliminar.
  //
  // Se detecto porque el arnes mostro 281 diferencias SOLO en la banda `prenda`,
  // con `consolidada` y `desglose` en cero — las tres usando el mismo motor. Una
  // discrepancia entre bandas que comparten codigo solo puede venir del contexto.
  //
  // La tasa es una propiedad del NEGOCIO, no de la consulta: el pool de indirectos
  // es de la empresa y se reparte sobre toda la produccion. Asi que el denominador
  // se calcula siempre sobre el catalogo completo, ignorando los filtros.
  let factoresCatalogo: any[] = [];
  try {
    factoresCatalogo = await db
      .select({ factorComplejidad: productos.factorComplejidad, activo: productos.activo })
      .from(productos);
  } catch (e) {
    avisosGlobales.push('No se pudo leer el catalogo completo para el factor promedio de indirectos.');
  }
  const factores = factoresCatalogo
    .filter((p: any) => p.activo !== false)
    .map((p: any) => (num(p.factorComplejidad) > 0 ? num(p.factorComplejidad) : 1));
  const factorPromedio = factores.length > 0
    ? factores.reduce((a: number, b: number) => a + b, 0) / factores.length
    : 1;

  // El porcentaje de absorcion separa el HECHO de la POLITICA: el pool y el
  // volumen son hechos, cuanto de ese pool se vuelca al costo unitario es una
  // decision. Default 100. Ver la nota en configService sobre por que esto es
  // exactamente lo que era el `* 10` del modelo viejo.
  const pctAbsorcion = num(sysConfig.porcentajeAbsorcionIndirectos);
  const absorcion = pctAbsorcion > 0 ? pctAbsorcion / 100 : 0;
  const poolAbsorbido = poolIndirectoAnual * absorcion;

  const tasaPorPuntoFactor = volumenAnual > 0 && factorPromedio > 0
    ? poolAbsorbido / (volumenAnual * factorPromedio)
    : 0;

  // Solo para poder medir el cambio. No se usa para costear.
  const tarifaPuntoComplejidad = volumenMes > 0 ? totalIndirectosMensual / (volumenMes * 10) : 0;

  if (tasaPorPuntoFactor > 0) {
    const porPrenda = tasaPorPuntoFactor * factorPromedio;
    avisosGlobales.push(
      `Indirectos: ${porPrenda.toFixed(2)} Bs por prenda promedio, absorbiendo el ` +
      `${pctAbsorcion.toFixed(1)}% del pool. Factor promedio ${factorPromedio.toFixed(2)}, ` +
      `volumen anual ${volumenAnual}, pool ${poolIndirectoAnual.toFixed(0)} Bs/año.`
    );
  }

  // Si se absorbe menos del 100%, la plata que queda afuera se dice en voz alta.
  // Es una decision legitima, pero no puede ser invisible: son gastos que se pagan
  // igual y que ningun costo unitario carga, asi que cualquier decision de precio
  // tomada sobre esos costos esta tomada sobre un costo incompleto.
  if (absorcion < 0.9999 && poolIndirectoAnual > 0) {
    const afuera = poolIndirectoAnual - poolAbsorbido;
    avisosGlobales.push(
      `ATENCION: con absorcion al ${pctAbsorcion.toFixed(1)}% quedan ${afuera.toFixed(0)} Bs al año ` +
      `(${(afuera / 12).toFixed(0)} Bs al mes) de gastos indirectos FUERA del costo de las ` +
      `prendas. Se pagan igual; no los carga ningun costo unitario.`
    );
  }

  return {
    sysConfig,
    tasaIvaFraccion,
    totalIndirectosMensual,
    poolIndirectoAnual,
    volumenAnual,
    factorPromedio,
    tasaPorPuntoFactor,
    tarifaPuntoComplejidad,
    productos: listaProductos,
    tallasPorId,
    tallasPorColegio,
    telasPorId,
    pesoPorClave,
    manoObraTipoPorClave,
    manoObraLegacyPorClave,
    accesoriosPorProducto,
    precioVentaPorClave,
    precioAdquisicionPorClave,
    avisosGlobales,
  };
}

// ---------------------------------------------------------------------------
// Ensamblado: funcion pura sobre el contexto
// ---------------------------------------------------------------------------

/**
 * Traduce una fila (producto, talla) a los inputs del motor.
 *
 * Pura a proposito: sin `await`, sin acceso a base. Es la unica traduccion de
 * datos a formula en todo el sistema, asi que conviene poder testearla sin base.
 */
export function ensamblarInputs(
  ctx: ContextoCosteo,
  producto: any,
  talla: any
): { inputs: CalculoInputs; meta: MetaCosteo } {
  const faltantes: string[] = [];
  const inconsistencias: string[] = [];
  const k = clave(producto.id, talla.id);

  const modoCosteo: 'confeccion' | 'adquirido' =
    producto.modoCosteo === 'adquirido' ? 'adquirido' : 'confeccion';

  // ---------- peso ----------
  const filaPeso = ctx.pesoPorClave.get(k);
  const pesoGramos = num(filaPeso?.pesoGramos);
  const pesoExacto = num(filaPeso?.pesoExactoGramos);
  const mermaPct = filaPeso?.mermaPorcentaje != null ? num(filaPeso.mermaPorcentaje) : undefined;

  let origenPeso: MetaCosteo['origenPeso'] = 'ninguno';
  let pesoConMermaGramos: number | undefined;
  let pesoExactoGramos: number | undefined;

  if (pesoGramos > 0) {
    // La base guarda `peso_gramos` YA CON la merma aplicada. Verificado sobre
    // las 432 filas: peso_gramos / peso_exacto_gramos = 1.08 exacto en las 270
    // donde el exacto es > 0, y peso_gramos == peso_con_merma en las 432.
    pesoConMermaGramos = pesoGramos;
    origenPeso = 'pesoGramos';

    if (pesoExacto > 0 && mermaPct != null) {
      const esperado = pesoExacto * (1 + mermaPct / 100);
      if (Math.abs(esperado - pesoGramos) > 0.01) {
        inconsistencias.push(
          `peso_gramos (${pesoGramos}) no es peso_exacto_gramos x (1 + merma/100) ` +
          `(${pesoExacto} x ${1 + mermaPct / 100} = ${esperado.toFixed(2)}). Las dos columnas se contradicen.`
        );
      }
    }
  } else if (pesoExacto > 0) {
    pesoExactoGramos = pesoExacto;
    origenPeso = 'pesoExactoGramos';
  } else if (modoCosteo === 'confeccion') {
    // FALLBACK INTELIGENTE: Si esta talla no tiene peso registrado pero la prenda tiene peso en otra talla,
    // utilizar el peso conocido de la otra talla para no dejar el costo de tela en 0.
    let pesoFallback: number | null = null;
    for (const [clavePeso, fP] of ctx.pesoPorClave.entries()) {
      if (clavePeso.startsWith(`${producto.id}_`)) {
        const pVal = num(fP.pesoGramos) || num(fP.pesoConMerma) || num(fP.pesoExactoGramos);
        if (pVal > 0) {
          pesoFallback = pVal;
          break;
        }
      }
    }
    if (pesoFallback && pesoFallback > 0) {
      pesoConMermaGramos = pesoFallback;
      origenPeso = 'pesoGramos';
    } else {
      faltantes.push('Sin peso de tela cargado para esta talla ni en otras tallas de la prenda.');
    }
  }

  // ---------- tela ----------
  const tela = producto.telaId ? ctx.telasPorId.get(producto.telaId) : undefined;
  const precioBsG = tela && num(tela.precioBsG) > 0 ? num(tela.precioBsG) : null;

  if (modoCosteo === 'confeccion' && !tela) {
    faltantes.push(
      'La prenda no tiene tela vinculada (producto.tela_id es NULL). El costo de tela va a quedar en 0.'
    );
  }

  // NOTA sobre el fallback de precio de tela. El camino viejo de inputs.ts hacia
  // `precioBsG || precioCompra / 1000`, que solo es correcto si precioCompra
  // esta en Bs por kilo, y la columna que declara eso es `precioBsKg`, no
  // `precioCompra`. Aca no se replica ese atajo: se le pasa al motor el par
  // (precioUnitario, rendimiento), que es el camino que el motor corrige y que
  // quedo verificado contra el Excel (45,94 y no 15,24 para el Saco talla 2).

  // ---------- accesorios ----------
  const lineasAccesorios = ctx.accesoriosPorProducto.get(producto.id) || [];
  const subtotalAccesoriosBs = calcularCostoAccesorios(
    lineasAccesorios.map((l) => ({ cantidadUso: l.cantidad, costoUnitario: l.costoUnitarioBs }))
  );
  if (lineasAccesorios.length === 0) {
    faltantes.push('La prenda no tiene receta de accesorios en detalle_acc.');
  }
  for (const l of lineasAccesorios) {
    if (l.inactivo) {
      inconsistencias.push(`La receta usa el accesorio "${l.nombre}", que esta inactivo en el catalogo.`);
    }
    if (l.costoUnitarioBs <= 0) {
      inconsistencias.push(`El accesorio "${l.nombre}" tiene costo unitario 0 en el catalogo.`);
    }
  }

  // ---------- mano de obra ----------
  // Sin fabricar nada. Desde Fase 6 la MO viene del tipo de prenda genérico;
  // para snapshots viejos (sin manoObraTipo) se cae al mapa legacy por productoId.
  let filaMO: any;
  if (producto.tipoPrendaId) {
    // Camino normal post-migración: buscar por tipoPrendaId + tallaId
    filaMO = ctx.manoObraTipoPorClave.get(clave(producto.tipoPrendaId, talla.id));
  } else {
    // Fallback para snapshots viejos o prendas sin tipo asignado
    filaMO = ctx.manoObraLegacyPorClave.get(k);
  }
  const tieneManoObra = !!filaMO;
  const costoManoObraBs = num(filaMO?.costoBs);
  if (!tieneManoObra && modoCosteo === 'confeccion') {
    faltantes.push('Sin fila de mano de obra para esta talla.');
  }

  // ---------- precios ----------
  const filaPV = ctx.precioVentaPorClave.get(k);
  const precioVentaBs = filaPV ? num(filaPV.precioBs) : null;
  const codigoExterno = filaPV && filaPV.codigoExterno ? String(filaPV.codigoExterno) : null;
  const filaPA = ctx.precioAdquisicionPorClave.get(k);
  const precioAdquisicionBs = filaPA ? num(filaPA.precioBs) : null;

  if (modoCosteo === 'adquirido' && !precioAdquisicionBs) {
    faltantes.push(
      'modoCosteo es "adquirido" pero no hay precio de adquisicion vigente para esta talla. ' +
      'Correr el importador de semiterminados.'
    );
  }

  // ---------- fijos e indirectos ----------
  //
  // FASE 4. El indirecto ahora va en `costoIndirectoUnitario`, que es su lugar,
  // en vez de entrar disfrazado de costo fijo. Antes el pool se colaba por la via
  // de `costoFijo` y `indirectosXprenda` quedaba siempre en 0, lo que hacia
  // parecer que el sistema no prorrateaba indirectos cuando en realidad los
  // prorrateaba mal.
  //
  // `costoFijo` queda en 0 a proposito. Las columnas costo_fijo, planchado_extra,
  // colocacion_botones y operaciones_extra existen en `producto` y ninguna
  // pantalla las suma; se siguen exponiendo en meta.columnasFijasNoContadas. Si
  // se cuentan o no es una decision pendiente del usuario.
  const factorComplejidad = num(producto.factorComplejidad) > 0 ? num(producto.factorComplejidad) : 1;
  const indirectoUnitario = ctx.tasaPorPuntoFactor * factorComplejidad;

  const colFijas = {
    costoFijo: num(producto.costoFijo),
    planchadoExtra: num(producto.planchadoExtra),
    colocacionBotones: num(producto.colocacionBotones),
    operacionesExtra: num(producto.operacionesExtra),
    algunaConValor: false,
  };
  colFijas.algunaConValor =
    colFijas.costoFijo > 0 ||
    colFijas.planchadoExtra > 0 ||
    colFijas.colocacionBotones > 0 ||
    colFijas.operacionesExtra > 0;
  if (colFijas.algunaConValor) {
    inconsistencias.push(
      'La prenda tiene valor en costo_fijo, planchado_extra, colocacion_botones u operaciones_extra, ' +
      'y el modelo vigente de puntos de complejidad NO las cuenta. Hay costo real que ninguna pantalla suma.'
    );
  }

  const inputs: CalculoInputs = {
    pesoConMermaGramos,
    pesoExactoGramos,
    mermaPorcentaje: mermaPct,

    precioBsG: precioBsG ?? undefined,
    precioTelaUnitario: tela && num(tela.precioUnitario) > 0 ? num(tela.precioUnitario) : undefined,
    rendimientoTela: tela && num(tela.rendimiento) > 0 ? num(tela.rendimiento) : undefined,

    precioAdquisicion:
      modoCosteo === 'adquirido' && precioAdquisicionBs ? precioAdquisicionBs : undefined,

    costoAccesorios: subtotalAccesoriosBs,
    costoManoObra: costoManoObraBs,
    factorComplejidad,
    costoFijo: 0,

    // Prorrateado sobre volumen ANUAL y proporcional al factor, normalizado para
    // que la suma absorbida iguale el pool. Se pasa ya calculado a proposito: el
    // motor avisa cuando recibe el par mensual, porque ese camino es el que hace
    // que la misma prenda cueste distinto segun el mes.
    costoIndirectoUnitario: indirectoUnitario,
    costoIndirectoMensual: undefined,
    produccionTotalMes: undefined,

    precioVenta: precioVentaBs,
    // Fraccion, ya convertida. Ver `tasaIvaComoFraccion`.
    tasaIva: ctx.tasaIvaFraccion,

    // FASE 3. Solo afectan el lado del precio; el costo neto nunca lleva IVA.
    impuestosActivos: ctx.sysConfig.impuestosActivos,
    descuentoSinFactura: ctx.sysConfig.descuentoSinFactura,
  };

  const meta: MetaCosteo = {
    productoId: producto.id,
    itemNumero: num(producto.itemNumero),
    descripcion: producto.descripcion,
    tallaId: talla.id,
    tallaCodigo: talla.codigo,
    tallaNombre: talla.nombre,
    modoCosteo,
    origenPeso,
    pesoGramos,
    pesoExactoGramos: pesoExacto,
    mermaPorcentaje: mermaPct ?? null,
    telaVinculada: !!tela,
    telaNombre: tela ? tela.descripcion : null,
    precioBsG,
    lineasAccesorios,
    subtotalAccesoriosBs,
    tieneManoObra,
    costoManoObraBs,
    factorComplejidad,
    tarifaPuntoComplejidad: ctx.tarifaPuntoComplejidad,
    seOfrece: precioVentaBs != null && precioVentaBs > 0,
    precioVentaBs,
    codigoExterno,
    precioAdquisicionBs,
    columnasFijasNoContadas: colFijas,
    faltantes,
    inconsistencias,
  };

  return { inputs, meta };
}

// ---------------------------------------------------------------------------
// Envoltorios de conveniencia
// ---------------------------------------------------------------------------

export interface PrendaCosteada {
  meta: MetaCosteo;
  inputs: CalculoInputs;
  resultado: CalculoResultado;
}

/** Costea una sola combinacion (producto, talla). */
export async function costearPrenda(
  db: any,
  args: { productoId: string; tallaId: string }
): Promise<PrendaCosteada | null> {
  const ctx = await cargarContextoCosteo(db, { productoId: args.productoId });
  const producto = ctx.productos[0];
  if (!producto) return null;
  const talla = ctx.tallasPorId.get(args.tallaId);
  if (!talla) return null;

  const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
  return { meta, inputs, resultado: calcularCostoTotal(inputs) };
}

/** Costea todas las tallas de una prenda. */
export async function costearPrendaTodasLasTallas(
  db: any,
  productoId: string,
  snapshotId?: string
): Promise<{ producto: any; filas: PrendaCosteada[]; ctx: ContextoCosteo } | null> {
  const ctx = await cargarContextoCosteo(db, { productoId, snapshotId });
  const producto = ctx.productos[0];
  if (!producto) return null;

  const lista = ctx.tallasPorColegio.get(producto.colegioId) || [];
  const filas = lista.map((talla) => {
    const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
    return { meta, inputs, resultado: calcularCostoTotal(inputs) };
  });
  // Devuelve tambien el contexto, igual que costearLote. Sin esto, matriz-prenda
  // no tenia de donde sacar la tasa de IVA ni el descuento sin factura y habria
  // que releer la configuracion por su cuenta, que es como un default termina
  // viviendo en tres lugares distintos.
  return { producto, filas, ctx };
}

/** Costea todas las prendas de un colegio, en todas sus tallas. */
export async function costearLote(
  db: any,
  opts: { colegioId?: string; snapshotId?: string } = {}
): Promise<{ ctx: ContextoCosteo; filas: PrendaCosteada[] }> {
  const ctx = await cargarContextoCosteo(db, opts);
  const filas: PrendaCosteada[] = [];
  for (const producto of ctx.productos) {
    const lista = ctx.tallasPorColegio.get(producto.colegioId) || [];
    for (const talla of lista) {
      const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
      filas.push({ meta, inputs, resultado: calcularCostoTotal(inputs) });
    }
  }
  return { ctx, filas };
}
