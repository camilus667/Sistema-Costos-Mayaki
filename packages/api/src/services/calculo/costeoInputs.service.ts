import { Decimal } from 'decimal.js';
import { eq, and, asc, isNull } from 'drizzle-orm';
import {
  productos,
  tallas,
  telas,
  pesoMateriaPrima,
  manoObra,
  accesorios,
  detalleAccesorio,
  preciosVenta,
  preciosAdquisicion,
  costosIndirectos,
} from '../../database/schema';
import { getSystemConfig, type SystemConfig } from '../configService';
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
  tarifaPuntoComplejidad: number;

  productos: any[];
  tallasPorId: Map<string, any>;
  tallasPorColegio: Map<string, any[]>;
  telasPorId: Map<string, any>;
  pesoPorClave: Map<string, any>;
  manoObraPorClave: Map<string, any>;
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
  opts: { colegioId?: string; productoId?: string } = {}
): Promise<ContextoCosteo> {
  const avisosGlobales: string[] = [];
  const sysConfig = await getSystemConfig(db);
  const tasaIvaFraccion = tasaIvaComoFraccion(sysConfig, avisosGlobales);

  // --- productos ---
  const filtrosProducto: any[] = [];
  if (opts.productoId) filtrosProducto.push(eq(productos.id, opts.productoId));
  if (opts.colegioId && opts.colegioId !== 'all') {
    filtrosProducto.push(eq(productos.colegioId, opts.colegioId));
  }
  const listaProductos = filtrosProducto.length
    ? await db.select().from(productos)
        .where(filtrosProducto.length === 1 ? filtrosProducto[0] : and(...filtrosProducto))
        .orderBy(asc(productos.orden), asc(productos.itemNumero))
    : await db.select().from(productos).orderBy(asc(productos.orden), asc(productos.itemNumero));

  // --- tallas ---
  const listaTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));
  const tallasPorId = new Map<string, any>();
  const tallasPorColegio = new Map<string, any[]>();
  for (const t of listaTallas) {
    tallasPorId.set(t.id, t);
    if (t.activo === false) continue;
    const arr = tallasPorColegio.get(t.colegioId) || [];
    arr.push(t);
    tallasPorColegio.set(t.colegioId, arr);
  }

  // --- telas ---
  const listaTelas = await db.select().from(telas);
  const telasPorId = new Map<string, any>();
  for (const t of listaTelas) telasPorId.set(t.id, t);

  // --- peso materia prima ---
  const listaPeso = await db.select().from(pesoMateriaPrima);
  const pesoPorClave = new Map<string, any>();
  for (const p of listaPeso) {
    const k = clave(p.productoId, p.tallaId);
    if (pesoPorClave.has(k)) {
      // No hay unique en (producto, talla): una fila duplicada duplica el costo
      // en silencio segun el join. Se avisa en vez de elegir una al azar.
      avisosGlobales.push(`peso_mat_prima duplicado para ${k}. Se usa la primera fila.`);
      continue;
    }
    pesoPorClave.set(k, p);
  }

  // --- mano de obra ---
  const listaMO = await db.select().from(manoObra);
  const manoObraPorClave = new Map<string, any>();
  for (const m of listaMO) {
    const k = clave(m.productoId, m.tallaId);
    if (manoObraPorClave.has(k)) {
      avisosGlobales.push(`mano_obra duplicada para ${k}. Se usa la primera fila.`);
      continue;
    }
    manoObraPorClave.set(k, m);
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
  // Vigente = vigenteHasta IS NULL. Corregido en Fase 1: antes se comparaba con
  // eq(campo, null), que en SQL nunca es verdadero, y devolvia 0 filas.
  const listaPV = await db.select().from(preciosVenta).where(isNull(preciosVenta.vigenteHasta));
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
    const listaPA = await db
      .select()
      .from(preciosAdquisicion)
      .where(isNull(preciosAdquisicion.vigenteHasta));
    for (const pa of listaPA) {
      const k = clave(pa.productoId, pa.tallaId);
      const previo = precioAdquisicionPorClave.get(k);
      if (previo && String(pa.vigenteDesde || '') <= String(previo.vigenteDesde || '')) continue;
      precioAdquisicionPorClave.set(k, pa);
    }
  } catch (e) {
    // La tabla se agrego en Fase 1; en una base sin migrar todavia no existe.
    avisosGlobales.push(
      'No se pudo leer precio_adquisicion. Las prendas con modoCosteo=adquirido van a quedar sin costo de material.'
    );
  }

  // --- indirectos ---
  // PRESERVADO A PROPOSITO: se suma sin filtrar por colegio, igual que los tres
  // caminos viejos. Con un solo colegio es inocuo. Filtrarlo cambiaria los
  // numeros y contaminaria la comparacion de paridad. Es tarea de la Fase 6.
  let totalIndirectosMensual = 0;
  try {
    const listaCI = await db.select().from(costosIndirectos);
    totalIndirectosMensual = listaCI.reduce((s: number, r: any) => s + num(r.montoMensual), 0);
  } catch (e) {
    avisosGlobales.push('No se pudieron leer los costos indirectos. Se costea con indirectos en 0.');
  }

  // PRESERVADO A PROPOSITO: el `* 10` es un numero magico sin documentar, al
  // parecer una escala de puntos de complejidad de 1 a 10. Aparece identico en
  // inputs.ts (fijos-x-prenda y desglose-inteligente-producto) y en calculo.ts.
  // Se replica tal cual para lograr paridad. Documentarlo o eliminarlo es Fase 4.
  const volumenMes = num(sysConfig.volumenMensualProduccion);
  const tarifaPuntoComplejidad = volumenMes > 0 ? totalIndirectosMensual / (volumenMes * 10) : 0;

  return {
    sysConfig,
    tasaIvaFraccion,
    totalIndirectosMensual,
    tarifaPuntoComplejidad,
    productos: listaProductos,
    tallasPorId,
    tallasPorColegio,
    telasPorId,
    pesoPorClave,
    manoObraPorClave,
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
    faltantes.push('Sin peso de tela cargado para esta talla.');
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
  // Sin fabricar nada. El camino viejo, cuando no encontraba la fila, promediaba
  // todas las tallas y si tampoco habia usaba 15.0 Bs hardcodeados.
  const filaMO = ctx.manoObraPorClave.get(k);
  const tieneManoObra = !!filaMO;
  const costoManoObraBs = num(filaMO?.costoBs);
  if (!tieneManoObra && modoCosteo === 'confeccion') {
    faltantes.push('Sin fila de mano de obra para esta talla.');
  }

  // ---------- precios ----------
  const filaPV = ctx.precioVentaPorClave.get(k);
  const precioVentaBs = filaPV ? num(filaPV.precioBs) : null;
  const filaPA = ctx.precioAdquisicionPorClave.get(k);
  const precioAdquisicionBs = filaPA ? num(filaPA.precioBs) : null;

  if (modoCosteo === 'adquirido' && !precioAdquisicionBs) {
    faltantes.push(
      'modoCosteo es "adquirido" pero no hay precio de adquisicion vigente para esta talla. ' +
      'Correr el importador de semiterminados.'
    );
  }

  // ---------- fijos ----------
  // MODELO VIGENTE, replicado para paridad: los fijos por prenda son
  // `factorComplejidad x tarifaPuntoComplejidad`, y los indirectos van en 0.
  // O sea el pool de indirectos entra por la via de los fijos, no como linea
  // propia. En el motor eso se expresa como costoFijo = tarifa, y el motor la
  // multiplica por el factor. `indirectosXprenda` era y sigue siendo 0.
  const factorComplejidad = num(producto.factorComplejidad) > 0 ? num(producto.factorComplejidad) : 1;

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
    costoFijo: ctx.tarifaPuntoComplejidad,

    costoIndirectoUnitario: undefined,
    costoIndirectoMensual: undefined,
    produccionTotalMes: undefined,

    precioVenta: precioVentaBs,
    // Fraccion, ya convertida. Ver `tasaIvaComoFraccion`.
    tasaIva: ctx.tasaIvaFraccion,
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
  productoId: string
): Promise<{ producto: any; filas: PrendaCosteada[] } | null> {
  const ctx = await cargarContextoCosteo(db, { productoId });
  const producto = ctx.productos[0];
  if (!producto) return null;

  const lista = ctx.tallasPorColegio.get(producto.colegioId) || [];
  const filas = lista.map((talla) => {
    const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
    return { meta, inputs, resultado: calcularCostoTotal(inputs) };
  });
  return { producto, filas };
}

/** Costea todas las prendas de un colegio, en todas sus tallas. */
export async function costearLote(
  db: any,
  opts: { colegioId?: string } = {}
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
