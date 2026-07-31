/**
 * Compara la receta de accesorios del EXCEL contra detalle_acc, la tabla real.
 *
 * EL PROBLEMA QUE MIDE. Hoy hay DOS fuentes de datos de accesorios que no se
 * hablan entre si:
 *
 *   detalle_acc          lo que el MOTOR usa para costear. Persistente.
 *   CAMBRIDGE.xlsx       lo que la PANTALLA de la matriz muestra y edita.
 *
 * Y la edicion es peor que eso: PUT /api/inputs/accesorios-matriz-celda no toca la
 * base, escribe en un Map de modulo (overriddenCellQtyMap) indexado por NOMBRE de
 * accesorio. O sea que cambiar una cantidad en la matriz mueve el numero en
 * pantalla, no cambia el costeo, y se pierde al reiniciar el proceso. Devuelve
 * success: true siempre, incluso cuando el `if` de adentro no entra.
 *
 * Es la misma familia que el precio de venta que no llegaba al disco, pero un paso
 * mas grave: ahi el dato al menos entraba a la base en memoria. Aca nunca entra.
 *
 * POR QUE COMPARAR ANTES DE CAMBIAR. La correccion es que la pantalla lea y escriba
 * detalle_acc. Pero al cambiar la fuente, los numeros que se ven se moverian en toda
 * celda donde el Excel y la base no coincidan. Antes de mover nada hay que saber
 * donde y cuanto. Es la regla que el usuario fijo para la Fase 2: paridad primero,
 * borrado despues.
 *
 * CUIDADO CON LAS UNIDADES, que la primera version de este script se comio y por eso
 * reporto que las 27 prendas diferian:
 *
 *   la celda del Excel es un COSTO EN BS
 *   detalle_acc.cantidadUso es una CANTIDAD EN UNIDADES
 *
 * y el endpoint deriva una de la otra dividiendo:
 *
 *   qty = (costoDelExcel / costoUnitario).toFixed(2)
 *
 * Compararlas de frente da diferencias en todas las filas que no significan nada.
 * Aca se compara Bs contra Bs: cantidadUso x costoUnitario contra la celda del Excel.
 *
 * Y el .toFixed(2) de esa division es el mecanismo exacto del descuadre de 0,03 Bs
 * que el usuario ya adjudico en la reja: Entretela para pantalon vale 0,75 Bs, sale
 * 0,75/18 = 0,041666, se redondea a 0,04, y 0,04 x 18 = 0,72. Repuntar la pantalla a
 * detalle_acc elimina esa deriva, porque usa la cantidad guardada en vez de
 * derivarla.
 *
 * SOLO LEE. Abre la base con skipSeed y no escribe una sola fila.
 *
 * Uso:  pnpm tsx src/scripts/compararAccesorios.ts
 */

import { getDb } from '../database/sqljs';
import { productos, accesorios, detalleAccesorio } from '../database/schema';
import { asc } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import { findExcelPath } from './seed';

// Cache en memoria de la planilla, para no releerla en cada llamada dentro de una corrida.
let inputsExcelCache: any = null;

// ESTA FUNCION VIVIA EN routes/inputs.ts, donde el servidor la llamaba en cada pedido. Se mudo
// aca porque este script existe justamente para comparar la planilla contra la base: es el unico
// lugar donde leer CAMBRIDGE.xlsx sigue teniendo sentido. Ninguna ruta la toca mas.
export function loadExcelInputs() {
  if (inputsExcelCache) return inputsExcelCache;

  try {
    const excelPath = findExcelPath();
    const parseXLSX = (XLSX as any).default || XLSX;
    const workbook = parseXLSX.readFile(excelPath);

    // 1. PesoMatPrima
    const pesoSheet = workbook.Sheets['PesoMatPrima'];
    const pesoRows: any[][] = pesoSheet ? parseXLSX.utils.sheet_to_json(pesoSheet, { header: 1 }) : [];
    const tallasHeaderPeso = pesoRows[1]?.slice(2) || [];

    // 2. Acc (Accesorios por prenda + Tabla Auxiliar)
    const accSheet = workbook.Sheets['Acc'];
    const accRows: any[][] = accSheet ? parseXLSX.utils.sheet_to_json(accSheet, { header: 1 }) : [];
    const accHeaders = accRows[1]?.slice(2, 40).map(h => String(h || '').trim()).filter(Boolean) || [];

    // Cargar Tabla Auxiliar (fila 31 en adelante)
    const auxHeaderIdx = accRows.findIndex((r: any) => r && r.some((c: any) => String(c).includes('UNIDAD DE COMPRA') || String(c).includes('COSTO Unitario')));
    const tablaAuxiliarRows = auxHeaderIdx !== -1 ? accRows.slice(auxHeaderIdx + 1).filter((r: any) => r && r[0] && (typeof r[1] === 'number' || !isNaN(Number(r[1])))) : [];

    // 3. ManoDeObra
    const moSheet = workbook.Sheets['ManoDeObra'];
    const moRows: any[][] = moSheet ? parseXLSX.utils.sheet_to_json(moSheet, { header: 1 }) : [];

    // 4. fijosXprenda
    const fxpSheet = workbook.Sheets['fijosXprenda'];
    const fxpRows: any[][] = fxpSheet ? parseXLSX.utils.sheet_to_json(fxpSheet, { header: 1 }) : [];

    // 5. Fij&Var
    const fjvSheet = workbook.Sheets['Fij&Var'];
    const fjvRows: any[][] = fjvSheet ? parseXLSX.utils.sheet_to_json(fjvSheet, { header: 1 }) : [];

    inputsExcelCache = { pesoRows, tallasHeaderPeso, accRows, accHeaders, tablaAuxiliarRows, moRows, fxpRows, fjvRows };
    return inputsExcelCache;
  } catch (e) {
    console.error('Error al cargar datos fijos desde Excel:', e);
    return null;
  }
}

const SEP = '='.repeat(78);
const TOL = 0.001;
/** Un centavo: por debajo de eso es redondeo, no una diferencia de datos. */
const CENTAVO = 0.011;
const bs = (n: number) => (n >= 0 ? ' ' : '') + n.toFixed(2);

/** Misma logica que el endpoint: "19-20" en la columna de item significa 19 y 20. */
function parseItemNumbers(val: any): number[] {
  if (typeof val === 'number') return [val];
  const str = String(val).trim();
  if (str.includes('-')) {
    const parts = str.split('-').map((p) => parseInt(p.trim())).filter((p) => !isNaN(p));
    if (parts.length === 2) {
      const nums: number[] = [];
      for (let i = parts[0]; i <= parts[1]; i++) nums.push(i);
      return nums;
    }
  }
  const num = parseInt(str);
  return !isNaN(num) ? [num] : [];
}

async function main() {
  console.log(SEP);
  console.log('  RECETA DE ACCESORIOS  —  Excel contra detalle_acc');
  console.log(SEP);

  const db = await getDb({ skipSeed: true });

  const prods = await db.select().from(productos).orderBy(asc(productos.itemNumero));
  const accs = await db.select().from(accesorios);
  const detalles = await db
    .select({
      productoId: detalleAccesorio.productoId,
      accesorioId: detalleAccesorio.accesorioId,
      cantidadUso: detalleAccesorio.cantidadUso,
    })
    .from(detalleAccesorio);

  console.log(`Prendas: ${prods.length}   Accesorios: ${accs.length}   Lineas en detalle_acc: ${detalles.length}`);

  // ------------------------------------------------------------- Excel
  const inputs = loadExcelInputs();
  if (!inputs || !inputs.accRows || inputs.accRows.length === 0) {
    console.log('\nABORTA: no se pudo leer la matriz de accesorios del Excel.');
    process.exit(1);
  }
  const accRows: any[] = inputs.accRows;
  const accHeaders: string[] = inputs.accHeaders || [];

  const auxHeaderIdx = accRows.findIndex(
    (r: any) => r && r.some((c: any) => String(c).includes('UNIDAD DE COMPRA') || String(c).includes('COSTO Unitario'))
  );
  const matrixRows = accRows.slice(2, auxHeaderIdx !== -1 ? auxHeaderIdx : 30);

  /** clave `item_nombre` -> cantidad del Excel */
  const excel = new Map<string, number>();
  for (const r of matrixRows) {
    if (!r || r[1] === undefined) continue;
    for (const itemNum of parseItemNumbers(r[1])) {
      if (itemNum <= 0) continue;
      accHeaders.forEach((h: string, idx: number) => {
        const val = Number(r[2 + idx]) || 0;
        if (val !== 0) excel.set(`${itemNum}_${String(h).trim()}`, val);
      });
    }
  }

  console.log(`Columnas de accesorio en el Excel: ${accHeaders.length}`);
  console.log(`Celdas con cantidad distinta de cero en el Excel: ${excel.size}`);

  // ------------------------------------------------- 1. cruce de nombres
  //
  // La pantalla actual une Excel y base POR NOMBRE. Cualquier nombre que no cruce
  // es un cero silencioso: la celda muestra 0,00 y nadie avisa. Ya hay un caso
  // conocido en las reglas del arnes ("Ojal Grande" contra "Ojal grande").
  console.log('');
  console.log(SEP);
  console.log('  1. CRUCE DE NOMBRES  —  la pantalla une Excel y base por nombre');
  console.log(SEP);

  const porNombre = new Map<string, any>();
  for (const a of accs) porNombre.set(String(a.descripcion).trim(), a);

  const headersSinAcc = accHeaders
    .map((h) => String(h).trim())
    .filter((h) => h.length > 0 && !porNombre.has(h));

  const nombresExcel = new Set(accHeaders.map((h) => String(h).trim()));
  const accsSinHeader = accs
    .map((a: any) => String(a.descripcion).trim())
    .filter((d: string) => !nombresExcel.has(d));

  if (headersSinAcc.length === 0) {
    console.log('  Todas las columnas del Excel cruzan con un accesorio de la base.');
  } else {
    console.log(`  ${headersSinAcc.length} columna(s) del Excel SIN accesorio en la base.`);
    console.log('  Estas celdas se muestran en 0,00 y no cuestan nada, en silencio:');
    for (const h of headersSinAcc) console.log(`    "${h}"`);
  }

  console.log('');
  if (accsSinHeader.length === 0) {
    console.log('  Todos los accesorios de la base tienen columna en el Excel.');
  } else {
    console.log(`  ${accsSinHeader.length} accesorio(s) de la base SIN columna en el Excel:`);
    for (const d of accsSinHeader) console.log(`    "${d}"`);
  }

  // ------------------------------------------- 2. cantidades, prenda por prenda
  console.log('');
  console.log(SEP);
  console.log('  2. CANTIDADES  —  Excel contra detalle_acc, prenda por prenda');
  console.log(SEP);

  const accPorId = new Map<string, any>();
  for (const a of accs) accPorId.set(a.id, a);

  /** productoId -> Map(nombreAccesorio -> cantidad) */
  const baseporProd = new Map<string, Map<string, number>>();
  for (const d of detalles) {
    const a = accPorId.get(d.accesorioId);
    if (!a) continue;
    if (!baseporProd.has(d.productoId)) baseporProd.set(d.productoId, new Map());
    baseporProd.get(d.productoId)!.set(String(a.descripcion).trim(), Number(d.cantidadUso) || 0);
  }

  let prendasIguales = 0;
  const filasDif: any[] = [];
  let deltaTotalBs = 0;

  for (const p of prods) {
    const item = Number(p.itemNumero);
    const enBase = baseporProd.get(p.id) || new Map<string, number>();

    // Union de nombres presentes en cualquiera de las dos fuentes.
    const nombres = new Set<string>([...enBase.keys()]);
    for (const h of accHeaders) {
      const nom = String(h).trim();
      if (excel.has(`${item}_${nom}`)) nombres.add(nom);
    }

    const difs: any[] = [];
    let deltaPrenda = 0;

    for (const nom of nombres) {
      // La celda del Excel ya viene en Bs. La base guarda cantidad, asi que se
      // multiplica por el costo unitario para poder comparar en la misma unidad.
      const costoExcel = excel.get(`${item}_${nom}`) || 0;
      const cantBase = enBase.get(nom) || 0;
      const costoUnit = Number(porNombre.get(nom)?.costoUnitario) || 0;
      const costoBase = cantBase * costoUnit;

      const delta = costoBase - costoExcel;
      if (Math.abs(delta) <= CENTAVO) continue;

      // La cantidad que la pantalla MUESTRA hoy, derivada por division y redondeada.
      const cantDerivada = costoUnit > 0 ? Math.round((costoExcel / costoUnit) * 100) / 100 : 0;

      deltaPrenda += delta;
      difs.push({ nom, costoExcel, costoBase, cantBase, cantDerivada, costoUnit, delta });
    }

    if (difs.length === 0) {
      prendasIguales++;
      continue;
    }

    deltaTotalBs += deltaPrenda;
    filasDif.push({ item, desc: p.descripcion, difs, deltaPrenda, sinReceta: enBase.size === 0 });
  }

  for (const f of filasDif) {
    const marca = f.sinReceta ? '  SIN RECETA EN LA BASE' : '';
    console.log('');
    console.log(`  item ${String(f.item).padStart(2)}  ${f.desc}${marca}`);
    console.log(`        efecto en el costo de accesorios: ${bs(f.deltaPrenda)} Bs`);
    for (const d of f.difs) {
      const porRedondeo = Math.abs(d.cantDerivada - d.cantBase) <= TOL;
      console.log(
        `        ${d.nom.padEnd(30).slice(0, 30)}  excel ${d.costoExcel.toFixed(2).padStart(8)} Bs` +
          `   base ${d.costoBase.toFixed(2).padStart(8)} Bs   dif ${bs(d.delta)}` +
          (porRedondeo ? '   (solo redondeo de la cantidad derivada)' : '')
      );
      console.log(
        `        ${''.padEnd(30)}  cantidad: la pantalla deriva ${d.cantDerivada}, la base guarda ${d.cantBase}`
      );
    }
  }

  // ------------------------------------------------------------- resumen
  console.log('');
  console.log(SEP);
  console.log('  RESUMEN');
  console.log(SEP);
  console.log(`  Prendas que ya coinciden:              ${prendasIguales} de ${prods.length}`);
  console.log(`  Prendas con alguna diferencia:         ${filasDif.length}`);
  console.log(`  Prendas sin ninguna linea en la base:  ${filasDif.filter((f) => f.sinReceta).length}`);
  console.log(`  Columnas del Excel sin accesorio:      ${headersSinAcc.length}`);
  console.log('');
  console.log(`  Efecto neto si la pantalla pasa a leer detalle_acc: ${bs(deltaTotalBs)} Bs`);
  console.log('  sumado sobre todas las prendas, en costo de accesorios por unidad.');
  console.log('');
  console.log('  COMO LEERLO. Todo esta en Bs a esta altura, las dos fuentes en la misma');
  console.log('  unidad. Un delta POSITIVO significa que la base cobra mas que lo que muestra');
  console.log('  el Excel. El motor ya costea con la base, asi que estos numeros NO son un');
  console.log('  cambio de costos: son la parte que la pantalla no venia mostrando.');
  console.log('');
  console.log('  Las diferencias marcadas "solo redondeo" salen del .toFixed(2) que el');
  console.log('  endpoint aplica a la cantidad derivada, no de datos distintos. Repuntar la');
  console.log('  pantalla a detalle_acc las elimina, porque usa la cantidad guardada.');
  console.log('');
  console.log('  Las prendas SIN RECETA EN LA BASE son las importantes: el Excel les asigna');
  console.log('  accesorios y detalle_acc no tiene ninguna linea, asi que hoy se costean con');
  console.log('  accesorios en cero.');
  console.log(SEP);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
