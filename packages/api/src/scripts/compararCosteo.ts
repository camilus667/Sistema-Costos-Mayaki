import fs from 'fs';
import * as XLSX from 'xlsx';
import { getDb } from '../database/sqljs';
import { findExcelPath } from './seed';
import { costearLote } from '../services/calculo/costeoInputs.service';

/**
 * ARNES DE PARIDAD DE LA FASE 2.
 *
 * Compara a tres bandas, por (itemNumero, talla):
 *
 *   NUEVO   el servicio costeoInputs + el motor, leyendo la base
 *   VIEJO   las tres pantallas actuales, por HTTP contra el server levantado:
 *             - /api/calculo/matriz-consolidada
 *             - /api/calculo/matriz-prenda/:productoId
 *             - /api/inputs/desglose-inteligente-producto
 *   EXCEL   las hojas CostoBruto, CostoAntesImp y CostoTotal de CAMBRIDGE.xlsx
 *
 * ESTE SCRIPT NO DECIDE NADA. Clasifica cada diferencia en IGUAL, ESPERADA o
 * NUEVA y las reporta. Decidido con el usuario el 29-jul-2026: cada descuadre se
 * le presenta uno por uno antes de tocar el codigo viejo. Una NUEVA bloquea el
 * borrado de las copias hasta que se explique.
 *
 * Por que el Excel es el oraculo y no las pantallas. Las tres pantallas no son
 * tres copias de la misma formula. `matriz-consolidada` y `matriz-prenda` casi no
 * calculan: leen los totales ya hechos del Excel y despejan el costo de tela por
 * resta. Y `desglose-inteligente-producto` tiene tres defectos conocidos. Exigir
 * igualdad exacta contra ellas seria reproducir sus bugs. Por eso lo que mas
 * importa de la salida es la columna "nuevo coincide con Excel".
 *
 * SOLO LEE. Abre la base con `getDb({ skipSeed: true })`, que no siembra y no
 * escribe el archivo. Sin eso, abrir la base era una operacion de escritura.
 *
 * USO
 *   npx tsx src/scripts/compararCosteo.ts
 *   npx tsx src/scripts/compararCosteo.ts --url http://localhost:3000
 *   npx tsx src/scripts/compararCosteo.ts --item 27
 *   npx tsx src/scripts/compararCosteo.ts --solo-ofrecidas --csv paridad.csv
 *
 * Requiere el server corriendo, porque las pantallas viejas se consultan por HTTP.
 */

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (nombre: string): string | undefined => {
  const i = argv.indexOf(nombre);
  return i >= 0 ? argv[i + 1] : undefined;
};
const URL_BASE = (flag('--url') || 'http://localhost:3000').replace(/\/$/, '');
const CSV = flag('--csv');
const ITEM = flag('--item') ? Number(flag('--item')) : undefined;
const SOLO_OFRECIDAS = argv.includes('--solo-ofrecidas');
const TOL = flag('--tolerancia') ? Number(flag('--tolerancia')) : 0.01;
/** Cuantas filas de ejemplo mostrar por cada grupo de diferencias. */
const TOP = flag('--top') ? Number(flag('--top')) : 4;
/**
 * Baseline de diferencias ya falladas por el usuario. Ver la nota sobre por que
 * es un snapshot y no una lista de predicados.
 */
const BASELINE = flag('--baseline') || 'src/scripts/paridad.baseline.json';
const APROBAR = argv.includes('--aprobar-baseline');
const SEP = '='.repeat(78);

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (v: number | null | undefined) =>
  v === null || v === undefined ? '     -' : v.toFixed(2).padStart(6);

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

type Banda = 'consolidada' | 'prenda' | 'desglose';
const BANDAS: Banda[] = ['consolidada', 'prenda', 'desglose'];

/** Campos comparables. No todas las bandas exponen todos. */
type Campo =
  | 'costoTela'
  | 'costoAccesorios'
  | 'costoManoObra'
  | 'costoBruto'
  | 'costoUnitarioNeto';

const CAMPOS: Campo[] = [
  'costoTela',
  'costoAccesorios',
  'costoManoObra',
  'costoBruto',
  'costoUnitarioNeto',
];

interface Fila {
  item: number;
  descripcion: string;
  tallaCodigo: string;
  seOfrece: boolean;
  modoCosteo: string;
  tieneManoObra: boolean;
  sinBaseDeTela: boolean;
  sinPrecioDeTela: boolean;
  origenCostoTela: string;
  precioAdquisicionBs: number | null;
  nuevo: Partial<Record<Campo, number>>;
  excel: { costoBruto: number | null; costoAntesImpuestos: number | null; costoTotal: number | null };
  viejo: Partial<Record<Banda, Partial<Record<Campo, number>>>>;
}

interface Dif {
  fila: Fila;
  banda: Banda;
  campo: Campo;
  nuevo: number;
  viejo: number;
  delta: number;
  clase: 'ESPERADA' | 'NO_OFRECIDA' | 'ACEPTADA' | 'NUEVA';
  reglaId?: string;
  /** Si es ACEPTADA o NUEVA: el delta que tenia en el baseline aprobado. */
  deltaBaseline?: number;
}

/** Clave estable de una diferencia, para casarla contra el baseline. */
const claveDif = (banda: string, item: number, talla: string, campo: string) =>
  `${banda}|${item}|${talla}|${campo}`;

/**
 * BASELINE DE DIFERENCIAS FALLADAS.
 *
 * Por que un snapshot y no mas predicados. Las cinco reglas ESPERADAS de arriba
 * describen causas con una explicacion mecanica: se pueden expresar como
 * condicion y siguen siendo verdad si los datos cambian. Las 590 que el usuario
 * fallo el 29-jul-2026 no son asi. Varias son problemas de datos puntuales — el
 * +1,00 de la Blusa manga larga, el +2,00 de la Calza corta en las tallas
 * grandes, el 0,03 de redondeo de accesorios. Escribirlas como predicados
 * obligaria a algo del tipo "aceptar cualquier diferencia en los items 1, 5, 6,
 * 10, 12, 13 y 14", que es justamente la goma de borrar universal que se evito al
 * disenar el arnes: taparia una regresion futura en esas mismas prendas.
 *
 * Un snapshot con el delta exacto de cada celda no tiene ese problema:
 *   - misma celda y mismo delta  -> ACEPTADA, ya fallada
 *   - misma celda y delta distinto -> NUEVA, algo se movio
 *   - celda que no estaba        -> NUEVA, bloquea
 *   - celda del baseline que ya no aparece -> RESUELTA, buena noticia
 *
 * El ultimo caso es el que hace util el baseline mas alla de la reja: cuando se
 * arreglen las bandas de mano de obra, el arnes lo va a decir solo.
 */
interface Baseline {
  generado: string;
  fallos: Record<string, number>;
  rulings?: string[];
}

/** Los fallos del usuario del 29-jul-2026, tal como se decidieron. */
const RULINGS = [
  'Causa 1 — items 19 y 20, desglose viejo: GANA EL NUEVO. El desglose no conoce ' +
    'modoCosteo ni precio_adquisicion y daba 7,84 donde el Excel dice hasta 147,84. ' +
    'El nuevo coincide con el Excel en las 28 celdas, el viejo en 0.',
  'Causa 2 — matriz-prenda y matriz-consolidada no calculan el costo de tela, lo ' +
    'despejan del Excel por resta, asi que donde la planilla calla reportan tela ' +
    'gratis: GANA EL NUEVO.',
  'Causa 3 — subtotal de accesorios corrido 0,03 Bs en items 1, 6 y 12: SE DEJA COMO ' +
    'ESTA. Se prefiere que el desglose en pantalla sume exactamente su propio ' +
    'subtotal, aunque el total quede 0,03 apartado del total de la columna 41.',
  'Causas 4, 5 y 6 — bandas de talla de la mano de obra, el +1,00 de la Blusa manga ' +
    'larga y el peso copiado de la Polera Bullying: FRENTE APARTE de calidad de datos. ' +
    'Son problemas de datos que existen con o sin el refactor, y la unificacion avanza.',
];

/**
 * Valor de la hoja del Excel correspondiente al campo, o null si esa hoja no
 * tiene ese concepto. El Excel solo trae los tres totales, no el desglose.
 */
function valorExcel(fila: Fila, campo: Campo): number | null {
  if (campo === 'costoBruto') return fila.excel.costoBruto;
  // FASE 3: la hoja CostoAntesImp sigue siendo un arbitro valido, porque es
  // exactamente el costo neto sin IVA. La que quedo sin contraparte es CostoTotal:
  // esa le suma el 13% de IVA de compras, que es credito fiscal recuperable y no
  // costo. De las tres hojas de costo del Excel, solo una estaba equivocada.
  if (campo === 'costoUnitarioNeto') return fila.excel.costoAntesImpuestos;
  return null;
}

// ---------------------------------------------------------------------------
// Diferencias esperadas, escritas ANTES de correr la comparacion
// ---------------------------------------------------------------------------

/**
 * Se escriben por adelantado a proposito. Si se anotaran despues de ver la
 * salida, cualquier descuadre se podria racionalizar como "ya sabiamos".
 */
interface Regla {
  id: string;
  descripcion: string;
  aplica: (d: Omit<Dif, 'clase' | 'reglaId'>, tasaIva: number) => boolean;
}

const OJAL_BS = 1.6;

const REGLAS: Regla[] = [
  {
    id: 'semiterminados-sin-aplicar',
    descripcion:
      'Items 19 y 20 sin precio de adquisicion en la base: el importador de semiterminados no se aplico. ' +
      'Viejo y nuevo quedan igual de mal contra el Excel (7,84 contra 52,84 a 147,84). ' +
      'Deja de aplicar en cuanto se corra el importador; si despues de eso sigue habiendo diferencia, es NUEVA.',
    aplica: (d) => [19, 20].includes(d.fila.item) && d.fila.precioAdquisicionBs === null,
  },
  {
    id: 'ojal-grande',
    descripcion:
      'Items 16, 17 y 18 (Falda plisada, Jamper, Vestido): el desglose viejo muestra el accesorio ' +
      '"Ojal Grande" en 0,00. Busca el nombre del encabezado de la matriz contra un mapa armado con el ' +
      'nombre de la Tabla Auxiliar ("Ojal grande", con g minuscula), no lo encuentra, cae en costo ' +
      'unitario 0 y asume cantidad 1. Faltan exactamente 1,60 Bs = 2 unidades x 0,80.',
    aplica: (d, tasaIva) => {
      if (!([16, 17, 18].includes(d.fila.item) && d.banda === 'desglose')) return false;
      const esperado: Partial<Record<Campo, number>> = {
        costoAccesorios: OJAL_BS,
        costoBruto: OJAL_BS,
        costoUnitarioNeto: OJAL_BS,
      };
      const e = esperado[d.campo];
      return e !== undefined && Math.abs(d.delta - e) <= 0.02;
    },
  },
  {
    id: 'mano-obra-fabricada',
    descripcion:
      'El desglose viejo, cuando no encuentra fila de mano de obra para la talla, promedia todas las ' +
      'tallas de la prenda, y si tampoco hay ninguna usa 15,00 Bs hardcodeados. El nuevo no inventa: ' +
      'devuelve 0 y lo reporta en faltantes.',
    aplica: (d) => d.banda === 'desglose' && !d.fila.tieneManoObra,
  },
  {
    id: 'saco-sin-tela-vinculada',
    descripcion:
      'Item 27 Saco: producto.tela_id es NULL. El nuevo reporta sinPrecioDeTela y deja la tela en 0. ' +
      'Las matrices viejas despejan la tela por resta del total del Excel y por eso parecen correctas. ' +
      'Se cierra vinculando Casimir Italiano (0,1215 Bs/g); es dato faltante, no un bug de codigo.',
    aplica: (d) => d.fila.item === 27 && d.fila.sinPrecioDeTela,
  },
  {
    id: 'polera-bullying-sin-peso',
    descripcion:
      'Item 26 Polera Bullying: se vende en 14 tallas y no tiene peso de tela cargado en 13. ' +
      'Tela 0 en viejo y en nuevo; el sistema la costea con tela gratis en ambos.',
    aplica: (d) => d.fila.item === 26 && d.fila.sinBaseDeTela,
  },
];

// ---------------------------------------------------------------------------
// HTTP a las pantallas viejas
// ---------------------------------------------------------------------------

async function traer(ruta: string): Promise<any> {
  const res = await fetch(`${URL_BASE}${ruta}`);
  if (!res.ok) throw new Error(`${ruta} devolvio HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function main() {
  console.log(SEP);
  console.log('  PARIDAD DE COSTEO  —  nuevo vs pantallas viejas vs Excel');
  console.log(SEP);
  console.log(`Server viejo: ${URL_BASE}`);
  console.log(`Tolerancia:   ${TOL.toFixed(2)} Bs (redondeo, no cuenta como diferencia)`);
  console.log('Este script NO decide nada. Clasifica y reporta.');
  console.log('');

  // ---------- NUEVO ----------
  const db = await getDb({ skipSeed: true });
  const { ctx, filas: filasNuevas } = await costearLote(db);
  const tasaIva = ctx.tasaIvaFraccion;

  console.log(`Config: tasa IVA ${ctx.sysConfig.tasaIva}% = ${tasaIva} como fraccion`);
  console.log(
    `        indirectos ${ctx.totalIndirectosMensual.toFixed(2)} Bs/mes, ` +
    `volumen ${ctx.sysConfig.volumenMensualProduccion}/mes, ` +
    `tarifa por punto ${ctx.tarifaPuntoComplejidad.toFixed(4)}`
  );
  if (ctx.avisosGlobales.length) {
    console.log('');
    console.log('Avisos al cargar la base:');
    ctx.avisosGlobales.forEach((a) => console.log(`  ! ${a}`));
  }

  const colegioId = ctx.productos[0]?.colegioId;
  if (!colegioId) {
    console.log('No hay productos en la base. Nada que comparar.');
    return;
  }

  // ---------- EXCEL ----------
  // Mismo shim de interop que usa importarSemiterminados: bajo tsx el namespace
  // real de xlsx puede quedar colgado de .default.
  const X: any = (XLSX as any).default || XLSX;
  const wb = X.readFile(findExcelPath());
  // Layout verificado, el mismo que usa importarSemiterminados: encabezado en la
  // fila indice 1 con los codigos de talla desde la columna 2, itemNumero en la 0.
  const leerHoja = (nombre: string) => {
    const hoja = wb.Sheets[nombre];
    const filas: any[][] = hoja ? X.utils.sheet_to_json(hoja, { header: 1 }) : [];
    const enc = filas[1] || [];
    const colPorCodigo = new Map<string, number>();
    for (let c = 2; c < enc.length; c++) {
      const cod = String(enc[c] ?? '').trim();
      if (cod) colPorCodigo.set(cod, c);
    }
    const porItem = new Map<number, any[]>();
    for (const f of filas) {
      const it = num(f?.[0]);
      // Ultima fila gana si el item aparece repetido, igual que en
      // importarSemiterminados. Ese criterio es el que dio 28 de 28 exactas, asi
      // que se replica en vez de elegir otro.
      if (it > 0) porItem.set(it, f);
    }
    return {
      valor: (item: number, codigo: string): number | null => {
        const f = porItem.get(item);
        const c = colPorCodigo.get(codigo);
        if (!f || c === undefined) return null;
        const v = f[c];
        return v === null || v === undefined || v === '' ? null : num(v);
      },
    };
  };
  const hCB = leerHoja('CostoBruto');
  const hCA = leerHoja('CostoAntesImp');
  const hCT = leerHoja('CostoTotal');

  // Se detecta que implementacion esta viva de verdad. Sin esto, un server sin
  // reiniciar o un git pull faltante dan un verde enganoso: el arnes compara
  // contra el codigo viejo, no encuentra nada movido, y reporta la reja en verde
  // cuando en realidad no verifico nada. Paso una vez.
  const huellas: Record<Banda, 'unificada' | 'heredada' | 'sin datos'> = {
    consolidada: 'sin datos',
    prenda: 'sin datos',
    desglose: 'sin datos',
  };

  // ---------- VIEJO: matriz-consolidada ----------
  const viejoConsolidada = new Map<string, Partial<Record<Campo, number>>>();
  try {
    const j = await traer(`/api/calculo/matriz-consolidada?colegioId=${encodeURIComponent(colegioId)}`);
    huellas.consolidada = j.implementacion === 'unificada' ? 'unificada' : 'heredada';
    for (const row of j.data || []) {
      for (const [codigo, v] of Object.entries<any>(row.tallas || {})) {
        viejoConsolidada.set(`${row.itemNumero}_${codigo}`, {
          costoBruto: num(v.costoBruto),
          costoUnitarioNeto: num(v.costoUnitarioNeto),
        });
      }
    }
    console.log(`\nmatriz-consolidada: ${viejoConsolidada.size} celdas.`);
  } catch (e: any) {
    console.log(`\nmatriz-consolidada NO respondio: ${e.message}`);
    console.log('Levantar el server con "npx tsx src/server.ts" y volver a correr.');
    return;
  }

  // ---------- VIEJO: matriz-prenda ----------
  const viejoPrenda = new Map<string, Partial<Record<Campo, number>>>();
  for (const p of ctx.productos) {
    try {
      const j = await traer(`/api/calculo/matriz-prenda/${encodeURIComponent(p.id)}`);
      // `seOfrece` solo existe en la version unificada.
      if (huellas.prenda === 'sin datos' && (j.data || []).length > 0) {
        huellas.prenda = j.data[0]?.seOfrece !== undefined ? 'unificada' : 'heredada';
      }
      for (const d of j.data || []) {
        viejoPrenda.set(`${num(p.itemNumero)}_${d.tallaCodigo}`, {
          costoTela: num(d.costoTela),
          costoAccesorios: num(d.costoAccesorios),
          costoManoObra: num(d.costoManoObra),
          // matriz-prenda no devuelve costoBruto como campo propio, asi que se
          // reconstruye de sus tres componentes. De paso deja ver si su propio
          // desglose suma su propio costoAntesImpuestos.
          costoBruto: r2(num(d.costoTela) + num(d.costoAccesorios) + num(d.costoManoObra)),
          costoUnitarioNeto: num(d.costoUnitarioNeto),
        });
      }
    } catch (e: any) {
      console.log(`  ! matriz-prenda item ${p.itemNumero}: ${e.message}`);
    }
  }
  console.log(`matriz-prenda: ${viejoPrenda.size} celdas.`);

  // ---------- VIEJO: desglose-inteligente-producto ----------
  // Una llamada por talla: el endpoint devuelve UNA talla por prenda. Se indexa
  // por la talla que efectivamente devolvio (tallaActual), no por la pedida,
  // porque tiene su propia cadena de fallback.
  const viejoDesglose = new Map<string, Partial<Record<Campo, number>>>();
  const tallasDelColegio = ctx.tallasPorColegio.get(colegioId) || [];
  for (const t of tallasDelColegio) {
    try {
      const j = await traer(
        `/api/inputs/desglose-inteligente-producto?colegioId=${encodeURIComponent(colegioId)}` +
        `&tallaId=${encodeURIComponent(t.id)}`
      );
      // `seOfrece` solo existe en la version unificada.
      if (huellas.desglose === 'sin datos' && (j.data || []).length > 0) {
        huellas.desglose = j.data[0]?.seOfrece !== undefined ? 'unificada' : 'heredada';
      }
      for (const p of j.data || []) {
        const cod = p?.tallaActual?.codigo;
        if (!cod || cod !== t.codigo) continue; // devolvio otra talla, no comparable
        viejoDesglose.set(`${num(p.itemNumero)}_${cod}`, {
          costoTela: num(p?.tela?.costoTelaBs),
          costoAccesorios: num(p?.subtotalAccesoriosBs),
          costoManoObra: num(p?.manoDeObra?.totalManoObraBs),
          costoBruto: num(p?.costoDirectoTotalBs),
          costoUnitarioNeto: num(p?.costoUnitarioNetoBs),
        });
      }
    } catch (e: any) {
      console.log(`  ! desglose talla ${t.codigo}: ${e.message}`);
    }
  }
  console.log(`desglose-inteligente-producto: ${viejoDesglose.size} celdas.`);

  // ---------- Armado de filas ----------
  const filas: Fila[] = [];
  for (const f of filasNuevas) {
    const item = f.meta.itemNumero;
    if (ITEM !== undefined && item !== ITEM) continue;
    if (SOLO_OFRECIDAS && !f.meta.seOfrece) continue;
    const cod = f.meta.tallaCodigo;
    const k = `${item}_${cod}`;

    filas.push({
      item,
      descripcion: f.meta.descripcion,
      tallaCodigo: cod,
      seOfrece: f.meta.seOfrece,
      modoCosteo: f.meta.modoCosteo,
      tieneManoObra: f.meta.tieneManoObra,
      sinBaseDeTela: f.resultado.diagnostico.sinBaseDeTela,
      sinPrecioDeTela: f.resultado.diagnostico.sinPrecioDeTela,
      origenCostoTela: f.resultado.diagnostico.origenCostoTela,
      precioAdquisicionBs: f.meta.precioAdquisicionBs,
      nuevo: {
        costoTela: f.resultado.costoTela,
        costoAccesorios: f.resultado.costoAccesorios,
        costoManoObra: f.resultado.costoManoObra,
        costoBruto: f.resultado.costoBruto,
        costoUnitarioNeto: f.resultado.costoUnitarioNeto,
      },
      excel: {
        costoBruto: hCB.valor(item, cod),
        costoAntesImpuestos: hCA.valor(item, cod),
        costoTotal: hCT.valor(item, cod),
      },
      viejo: {
        consolidada: viejoConsolidada.get(k),
        prenda: viejoPrenda.get(k),
        desglose: viejoDesglose.get(k),
      },
    });
  }

  // ---------- Baseline ----------
  let baseline: Baseline | null = null;
  if (!APROBAR && fs.existsSync(BASELINE)) {
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
      const n = Object.keys(baseline!.fallos || {}).length;
      console.log(`\nBaseline: ${n} diferencias ya falladas, aprobadas el ${baseline!.generado?.slice(0, 10)}.`);
    } catch (e: any) {
      console.log(`\nNo se pudo leer el baseline ${BASELINE}: ${e.message}`);
    }
  } else if (!APROBAR) {
    console.log(`\nSin baseline en ${BASELINE}. Toda diferencia va a salir como NUEVA.`);
  }

  // ---------- Clasificacion ----------
  const difs: Dif[] = [];
  let comparaciones = 0;
  for (const fila of filas) {
    for (const banda of BANDAS) {
      const v = fila.viejo[banda];
      if (!v) continue;
      for (const campo of CAMPOS) {
        const nv = fila.nuevo[campo];
        const vv = v[campo];
        if (nv === undefined || vv === undefined) continue;
        comparaciones++;
        const delta = r2(nv - vv);
        if (Math.abs(delta) <= TOL) continue;

        const base = { fila, banda, campo, nuevo: nv, viejo: vv, delta };
        const regla = REGLAS.find((r) => r.aplica(base, tasaIva));

        // Regla decidida el 29-jul-2026: precio_venta es la fuente de verdad de
        // si la prenda se ofrece en esa talla. Una combinacion que no se ofrece
        // no existe, asi que un descuadre ahi no puede bloquear nada. Se cuenta
        // aparte y se reporta, no se esconde.
        const k = claveDif(banda, fila.item, fila.tallaCodigo, campo);
        const dBase = baseline?.fallos?.[k];
        const yaFallada = dBase !== undefined && Math.abs(delta - dBase) <= TOL;

        const clase: Dif['clase'] = regla
          ? 'ESPERADA'
          : !fila.seOfrece
          ? 'NO_OFRECIDA'
          : yaFallada
          ? 'ACEPTADA'
          : 'NUEVA';

        difs.push({ ...base, clase, reglaId: regla?.id, deltaBaseline: dBase });
      }
    }
  }

  // ---------- Reporte: nuevo vs Excel, lo que mas importa ----------
  console.log('');
  console.log(SEP);
  console.log('  NUEVO vs EXCEL  —  el oraculo. Por prenda, tallas que cuadran.');
  console.log(SEP);
  const porItem = new Map<number, Fila[]>();
  for (const f of filas) {
    const a = porItem.get(f.item) || [];
    a.push(f);
    porItem.set(f.item, a);
  }
  let itemsOk = 0;
  let itemsConDif = 0;
  for (const [item, fs2] of [...porItem.entries()].sort((a, b) => a[0] - b[0])) {
    const comparables = fs2.filter((f) => f.excel.costoBruto !== null && f.excel.costoBruto > 0);
    if (comparables.length === 0) continue;
    const cuadran = comparables.filter(
      (f) => Math.abs(num(f.nuevo.costoBruto) - num(f.excel.costoBruto)) <= TOL
    );
    const ok = cuadran.length === comparables.length;
    if (ok) itemsOk++;
    else itemsConDif++;
    const marca = ok ? 'OK  ' : '<-- ';
    console.log(
      `  ${marca} item ${String(item).padStart(2)}  ${String(fs2[0].descripcion).slice(0, 26).padEnd(26)} ` +
      `${String(cuadran.length).padStart(2)}/${String(comparables.length).padStart(2)} tallas cuadran en costoBruto`
    );
    if (!ok) {
      for (const f of comparables) {
        const d = r2(num(f.nuevo.costoBruto) - num(f.excel.costoBruto));
        if (Math.abs(d) <= TOL) continue;
        console.log(
          `           talla ${f.tallaCodigo.padEnd(8)} nuevo ${fmt(f.nuevo.costoBruto)}  ` +
          `excel ${fmt(f.excel.costoBruto)}  dif ${fmt(d)}   tela: ${f.origenCostoTela}`
        );
      }
    }
  }
  console.log('');
  console.log(`  ${itemsOk} prendas cuadran con el Excel, ${itemsConDif} no.`);

  // ---------- Reporte: costo NETO vs el CostoAntesImp del Excel ----------
  //
  // Este bloque existe por una leccion concreta. La primera corrida de la Fase 4
  // imprimio "reja en verde" sin medir lo que habia cambiado:
  //
  //   - nuevo vs pantallas viejas dio 0 porque las tres bandas usan el mismo motor
  //     y coinciden POR CONSTRUCCION. No prueba nada sobre la formula.
  //   - el bloque de arriba solo compara costoBruto, que NO incluye indirectos.
  //
  // Asi que el cambio de absorcion de indirectos, el de mas impacto economico de
  // todo el refactor, no producia ninguna senal. Verde sobre algo que no se estaba
  // midiendo: la misma familia de error que el falso verde de la Fase 2, pero mas
  // sutil, porque aca la verificacion corre bien y solo apunta al lugar equivocado.
  //
  // La hoja CostoAntesImp del Excel es el arbitro valido de costoUnitarioNeto: es
  // exactamente el costo sin IVA. Comparar contra ella mide el efecto del cambio de
  // absorcion en Bs, prenda por prenda.
  console.log('');
  console.log(SEP);
  console.log('  COSTO NETO vs CostoAntesImp del EXCEL  —  aca se ve la absorcion de indirectos');
  console.log(SEP);
  console.log('  Solo combinaciones que se ofrecen y con dato en la hoja.');
  console.log('');
  console.log('  item  descripcion                  n  nuevo>excel  dif media  dif total');

  let totalDelta = 0;
  let totalCeldas = 0;
  for (const [item, fs2] of [...porItem.entries()].sort((a, b) => a[0] - b[0])) {
    const comp = fs2.filter(
      (f) => f.seOfrece && f.excel.costoAntesImpuestos !== null && f.excel.costoAntesImpuestos > 0
    );
    if (comp.length === 0) continue;
    const deltas = comp.map((f) => r2(num(f.nuevo.costoUnitarioNeto) - num(f.excel.costoAntesImpuestos)));
    const suma = deltas.reduce((a, b) => a + b, 0);
    const arriba = deltas.filter((d) => d > TOL).length;
    totalDelta += suma;
    totalCeldas += comp.length;
    console.log(
      `  ${String(item).padStart(4)}  ${String(fs2[0].descripcion).slice(0, 26).padEnd(26)} ` +
      `${String(comp.length).padStart(2)}  ${String(arriba).padStart(11)}  ` +
      `${(suma / comp.length).toFixed(2).padStart(9)}  ${suma.toFixed(2).padStart(9)}`
    );
  }

  console.log('');
  if (totalCeldas > 0) {
    const media = totalDelta / totalCeldas;
    console.log(`  ${totalCeldas} combinaciones comparadas. Diferencia media ${media.toFixed(2)} Bs por prenda.`);
    console.log('');
    console.log('  Interpretacion: una diferencia POSITIVA significa que el costo nuevo es mayor');
    console.log('  que el del Excel. Eso es lo esperado despues de la Fase 4, porque el Excel');
    console.log('  absorbe solo una parte del pool de indirectos y el modelo nuevo absorbe el');
    console.log('  100%. La diferencia NO es un error: es el costo que el Excel no cargaba.');
    console.log('  Ojo que en esta cuenta tambien entran los descuadres de datos ya conocidos');
    console.log('  (mano de obra por bandas de talla, Blusa manga larga, Polera Bullying), asi');
    console.log('  que la media no es absorcion pura.');
  } else {
    console.log('  Sin combinaciones comparables.');
  }

  // ---------- Reporte: diferencias NUEVAS, agrupadas ----------
  //
  // Se agrupan a proposito. Listar una linea por diferencia daba mas de mil
  // lineas sueltas, que no se pueden leer ni pegar en ningun lado. Mil
  // diferencias casi nunca son mil problemas: son unos pocos patrones
  // sistematicos. El trabajo del arnes es encontrar el patron, no volcar filas.
  const nuevas = difs.filter((d) => d.clase === 'NUEVA');
  const noOfrecidas = difs.filter((d) => d.clase === 'NO_OFRECIDA');

  console.log('');
  console.log(SEP);
  console.log(`  DIFERENCIAS NUEVAS: ${nuevas.length}  —  bloquean el borrado de las copias`);
  console.log(SEP);

  if (nuevas.length === 0) {
    console.log('  Ninguna en combinaciones que se ofrecen.');
  } else {
    // Matriz campo x banda: donde se concentran.
    console.log('');
    console.log('  DONDE SE CONCENTRAN  (filas: campo, columnas: banda)');
    console.log(`  ${'campo'.padEnd(22)}${BANDAS.map((b) => b.slice(0, 11).padStart(13)).join('')}${'total'.padStart(9)}`);
    for (const campo of CAMPOS) {
      const porBanda = BANDAS.map((b) => nuevas.filter((d) => d.campo === campo && d.banda === b).length);
      const tot = porBanda.reduce((a, b) => a + b, 0);
      if (tot === 0) continue;
      console.log(
        `  ${campo.padEnd(22)}${porBanda.map((n) => String(n).padStart(13)).join('')}${String(tot).padStart(9)}`
      );
    }

    // Un bloque por cluster (banda, campo).
    for (const banda of BANDAS) {
      for (const campo of CAMPOS) {
        const grupo = nuevas.filter((d) => d.campo === campo && d.banda === banda);
        if (grupo.length === 0) continue;

        console.log('');
        console.log(`  ${'-'.repeat(74)}`);
        console.log(`  ${banda} / ${campo}  —  ${grupo.length} diferencias`);

        // Lo decisivo: contra el Excel, quien tiene razon.
        let nuevoGana = 0, viejoGana = 0, ninguno = 0, sinExcel = 0;
        for (const d of grupo) {
          const ex = valorExcel(d.fila, d.campo);
          if (ex === null || ex === 0) { sinExcel++; continue; }
          const cn = Math.abs(d.nuevo - ex) <= TOL;
          const cv = Math.abs(d.viejo - ex) <= TOL;
          if (cn && !cv) nuevoGana++;
          else if (cv && !cn) viejoGana++;
          else ninguno++;
        }
        if (sinExcel < grupo.length) {
          console.log(
            `    contra el Excel:  el nuevo coincide en ${nuevoGana},  el viejo en ${viejoGana},  ` +
            `ninguno en ${ninguno}` + (sinExcel ? `,  sin dato en ${sinExcel}` : '')
          );
        } else {
          console.log(`    El Excel no tiene este concepto, solo trae los tres totales. No hay arbitro.`);
        }

        // Patrones sistematicos.
        const deltas = grupo.map((d) => d.delta);
        const min = Math.min(...deltas), max = Math.max(...deltas);
        const viejoEnCero = grupo.filter((d) => Math.abs(d.viejo) <= TOL).length;
        const nuevoEnCero = grupo.filter((d) => Math.abs(d.nuevo) <= TOL).length;
        console.log(`    dif de ${min.toFixed(2)} a ${max.toFixed(2)} Bs, todas ${min > 0 ? 'el nuevo es mayor' : max < 0 ? 'el viejo es mayor' : 'con signo mezclado'}`);
        if (Math.abs(max - min) <= 0.02) {
          console.log(`    -> DELTA CONSTANTE de ${min.toFixed(2)} Bs en las ${grupo.length}. Apunta a una sola causa.`);
        }
        if (viejoEnCero === grupo.length) {
          console.log(`    -> El viejo devuelve 0 en TODAS. El viejo no calcula este campo en estos casos.`);
        } else if (viejoEnCero > 0) {
          console.log(`    -> El viejo devuelve 0 en ${viejoEnCero} de ${grupo.length}.`);
        }
        if (nuevoEnCero === grupo.length) {
          console.log(`    -> El nuevo devuelve 0 en TODAS.`);
        } else if (nuevoEnCero > 0) {
          console.log(`    -> El nuevo devuelve 0 en ${nuevoEnCero} de ${grupo.length}.`);
        }
        // La senal mas fuerte de regresion: la celda ya estaba fallada, pero el
        // numero se movio. No es una diferencia nueva, es una que cambio.
        const movidas = grupo.filter((d) => d.deltaBaseline !== undefined);
        if (movidas.length > 0) {
          console.log(`    -> ATENCION: ${movidas.length} ya estaban en el baseline con OTRO delta. Algo cambio.`);
          for (const d of movidas.slice(0, TOP)) {
            console.log(
              `       item ${d.fila.item} ${d.fila.tallaCodigo}: baseline ${d.deltaBaseline!.toFixed(2)} -> ahora ${d.delta.toFixed(2)}`
            );
          }
        }

        const items = [...new Set(grupo.map((d) => d.fila.item))].sort((a, b) => a - b);
        console.log(`    items afectados (${items.length}): ${items.join(', ')}`);

        // Ejemplos.
        const ejemplos = [...grupo].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, TOP);
        console.log(`    item talla      nuevo  viejo    dif   excel`);
        for (const d of ejemplos) {
          const ex = valorExcel(d.fila, d.campo);
          console.log(
            `    ${String(d.fila.item).padStart(4)} ${d.fila.tallaCodigo.padEnd(8)} ` +
            `${fmt(d.nuevo)} ${fmt(d.viejo)} ${fmt(d.delta)} ${fmt(ex)}`
          );
        }
      }
    }
  }

  // ---------- Reporte: combinaciones que no se ofrecen ----------
  console.log('');
  console.log(SEP);
  console.log(`  EN COMBINACIONES QUE NO SE OFRECEN: ${noOfrecidas.length}  —  no bloquean`);
  console.log(SEP);
  console.log('  Por la regla acordada, sin precio de venta vigente la prenda no se ofrece en esa');
  console.log('  talla, asi que la combinacion no existe y un descuadre ahi no decide nada.');
  if (noOfrecidas.length > 0) {
    const filasAfectadas = new Set(noOfrecidas.map((d) => `${d.fila.item}_${d.fila.tallaCodigo}`));
    console.log(`  Afecta ${filasAfectadas.size} combinaciones (de las ${filas.filter((f) => !f.seOfrece).length} que no se ofrecen).`);
    for (const campo of CAMPOS) {
      const n = noOfrecidas.filter((d) => d.campo === campo).length;
      if (n) console.log(`    ${campo.padEnd(22)} ${String(n).padStart(5)}`);
    }
  }

  // ---------- Aceptadas y resueltas ----------
  const aceptadas = difs.filter((d) => d.clase === 'ACEPTADA');
  const vistas = new Set(
    difs.map((d) => claveDif(d.banda, d.fila.item, d.fila.tallaCodigo, d.campo))
  );
  const resueltas = baseline
    ? Object.keys(baseline.fallos || {}).filter((k) => !vistas.has(k))
    : [];

  if (baseline) {
    console.log('');
    console.log(SEP);
    console.log(`  YA FALLADAS POR EL USUARIO: ${aceptadas.length}  —  no bloquean`);
    console.log(SEP);
    for (const r of baseline.rulings || []) console.log(`  ${r}`);
    if (aceptadas.length > 0) {
      const porBandaCampo = new Map<string, number>();
      for (const d of aceptadas) {
        const k = `${d.banda} / ${d.campo}`;
        porBandaCampo.set(k, (porBandaCampo.get(k) || 0) + 1);
      }
      console.log('');
      for (const [k, n] of [...porBandaCampo.entries()].sort()) {
        console.log(`    ${k.padEnd(40)} ${String(n).padStart(5)}`);
      }
    }

    if (resueltas.length > 0) {
      console.log('');
      console.log(SEP);
      console.log(`  RESUELTAS: ${resueltas.length}  —  estaban en el baseline y ya no aparecen`);
      console.log(SEP);
      console.log('  Buena noticia: estas celdas dejaron de discrepar. Si fue a proposito, conviene');
      console.log('  regenerar el baseline con --aprobar-baseline para que la reja quede ajustada.');
      const porGrupo = new Map<string, number>();
      for (const k of resueltas) {
        const [banda, , , campo] = k.split('|');
        const g = `${banda} / ${campo}`;
        porGrupo.set(g, (porGrupo.get(g) || 0) + 1);
      }
      for (const [g, n] of [...porGrupo.entries()].sort()) {
        console.log(`    ${g.padEnd(40)} ${String(n).padStart(5)}`);
      }
    }
  }

  // ---------- Reporte: diferencias ESPERADAS ----------
  console.log('');
  console.log(SEP);
  console.log('  DIFERENCIAS ESPERADAS, agrupadas por regla');
  console.log(SEP);
  for (const r of REGLAS) {
    const suyas = difs.filter((d) => d.reglaId === r.id);
    console.log(`\n  [${r.id}]  ${suyas.length} diferencias`);
    console.log(`  ${r.descripcion}`);
    if (suyas.length === 0) {
      console.log('  -> No se activo. Si esperabas que si, algo cambio.');
      continue;
    }
    const items = [...new Set(suyas.map((d) => d.fila.item))].sort((a, b) => a - b);
    const campos = [...new Set(suyas.map((d) => d.campo))];
    const rango = suyas.map((d) => Math.abs(d.delta));
    console.log(
      `  -> items ${items.join(', ')} | campos ${campos.join(', ')} | ` +
      `dif de ${Math.min(...rango).toFixed(2)} a ${Math.max(...rango).toFixed(2)} Bs`
    );
  }

  // ---------- Resumen ----------
  console.log('');
  console.log(SEP);
  console.log('  RESUMEN');
  console.log(SEP);
  console.log(`  Filas comparadas:        ${filas.length}`);
  console.log(`  Comparaciones de campo:  ${comparaciones}`);
  console.log(`  Iguales (dentro de ${TOL.toFixed(2)}): ${comparaciones - difs.length}`);
  console.log(`  Esperadas:               ${difs.filter((d) => d.clase === 'ESPERADA').length}`);
  console.log(`  En combinaciones que no se ofrecen: ${noOfrecidas.length}`);
  console.log(`  Ya falladas por el usuario: ${aceptadas.length}`);
  if (resueltas.length) console.log(`  Resueltas desde el baseline: ${resueltas.length}`);
  console.log(`  NUEVAS:                  ${nuevas.length}`);
  console.log('');
  for (const banda of BANDAS) {
    const dB = difs.filter((d) => d.banda === banda);
    const nB = dB.filter((d) => d.clase === 'NUEVA');
    console.log(`  ${banda.padEnd(12)} ${String(dB.length).padStart(4)} difs, ${nB.length} nuevas`);
  }
  // ---------- Que implementacion se comparo de verdad ----------
  console.log('');
  console.log('  IMPLEMENTACION VIVA EN EL SERVER');
  for (const b of BANDAS) {
    console.log(`    ${b.padEnd(14)} ${huellas[b]}`);
  }
  const heredadas = BANDAS.filter((b) => huellas[b] === 'heredada');

  console.log('');
  if (nuevas.length === 0 && heredadas.length === BANDAS.length) {
    console.log('  Sin diferencias nuevas, pero las tres bandas siguen con la implementacion');
    console.log('  HEREDADA. No se verifico ningun reemplazo: si esperabas ver resueltas, falta');
    console.log('  reiniciar el server o traer los commits (git pull).');
  } else if (nuevas.length === 0 && heredadas.length > 0) {
    console.log(`  Sin diferencias nuevas. Ojo: ${heredadas.join(', ')} sigue heredada, asi que`);
    console.log('  el verde no cubre esa banda todavia.');
  } else if (nuevas.length === 0) {
    console.log('  Sin diferencias nuevas y las bandas reemplazadas estan unificadas. Reja en verde.');
  } else {
    console.log('  Hay diferencias nuevas. No se borra ninguna copia hasta explicarlas una por una.');
  }

  // ---------- Aprobar baseline ----------
  if (APROBAR) {
    const fallos: Record<string, number> = {};
    for (const d of nuevas) {
      fallos[claveDif(d.banda, d.fila.item, d.fila.tallaCodigo, d.campo)] = d.delta;
    }
    const contenido: Baseline = {
      generado: new Date().toISOString(),
      rulings: RULINGS,
      fallos,
    };
    fs.writeFileSync(BASELINE, JSON.stringify(contenido, null, 2), 'utf8');
    console.log('');
    console.log(`  BASELINE APROBADO: ${Object.keys(fallos).length} diferencias escritas en ${BASELINE}.`);
    console.log('  De aca en adelante estas no bloquean, y cualquier otra sale como NUEVA.');
  }

  // ---------- CSV ----------
  if (CSV) {
    const cab = [
      'item', 'descripcion', 'talla', 'seOfrece', 'modoCosteo', 'origenCostoTela',
      'sinBaseDeTela', 'sinPrecioDeTela', 'tieneManoObra',
      ...CAMPOS.map((c) => `nuevo_${c}`),
      'excel_costoBruto', 'excel_costoAntesImp', 'excel_costoTotal',
      ...BANDAS.flatMap((b) => CAMPOS.map((c) => `${b}_${c}`)),
    ];
    const lineas = [cab.join(',')];
    for (const f of filas) {
      lineas.push([
        f.item, `"${String(f.descripcion).replace(/"/g, '""')}"`, f.tallaCodigo,
        f.seOfrece ? 1 : 0, f.modoCosteo, f.origenCostoTela,
        f.sinBaseDeTela ? 1 : 0, f.sinPrecioDeTela ? 1 : 0, f.tieneManoObra ? 1 : 0,
        ...CAMPOS.map((c) => f.nuevo[c] ?? ''),
        f.excel.costoBruto ?? '', f.excel.costoAntesImpuestos ?? '', f.excel.costoTotal ?? '',
        ...BANDAS.flatMap((b) => CAMPOS.map((c) => f.viejo[b]?.[c] ?? '')),
      ].join(','));
    }
    fs.writeFileSync(CSV, lineas.join('\n'), 'utf8');
    console.log(`\n  CSV escrito en ${CSV} (${filas.length} filas).`);
  }

  console.log(SEP);
}

main().catch((e) => {
  console.error('Error en la comparacion:', e);
  process.exit(1);
});
