/**
 * Importador: receta de accesorios desde CAMBRIDGE.xlsx hacia `detalle_acc`
 *
 * Uso:
 *   npx tsx packages/api/src/scripts/importarRecetaAccesorios.ts            # simulacion, no escribe
 *   npx tsx packages/api/src/scripts/importarRecetaAccesorios.ts --aplicar  # escribe y guarda
 *
 * Por defecto NO escribe nada: imprime el reporte para revisar y recien con
 * --aplicar inserta.
 *
 * POR QUE EXISTE
 * La hoja `Acc` es hoy la unica fuente de la receta de cada prenda. Cambiar el
 * calculo para que lea de `detalle_acc` sin migrar antes daria costo de
 * accesorios en cero para todas las prendas. Este script hace ese puente una
 * sola vez.
 *
 * DETALLE IMPORTANTE SOBRE LA HOJA
 * Las celdas de la matriz (columnas 2 a 39) NO guardan cantidades: guardan el
 * COSTO en Bs, o sea cantidad x costo unitario ya multiplicado. Para obtener la
 * cantidad hay que dividir por el costo unitario del accesorio. Esa division
 * solo es valida si el costo unitario es mayor que cero; cuando es cero la
 * cantidad es indeterminable y este script lo reporta como caso a revisar en vez
 * de inventar un 1, que es lo que hace hoy el codigo de lectura.
 *
 * ADEMAS CORRIGE UN DESALINEAMIENTO
 * `inputs.ts` arma los encabezados con `.slice(2, 40).filter(Boolean)` y despues
 * lee la celda como `r[2 + idx]`. Si alguna celda de encabezado entre las
 * columnas 2 y 39 esta vacia, `filter(Boolean)` compacta el arreglo y a partir
 * de ese punto cada accesorio queda leyendo la columna de otro. Aca se conserva
 * el indice real de columna junto al nombre, y el reporte avisa si detecta
 * encabezados vacios intercalados (senal de que los costos que se muestran hoy
 * ya estan mal atribuidos).
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../database/sqljs';
import { productos, accesorios, detalleAccesorio } from '../database/schema';

const APLICAR = process.argv.includes('--aplicar');

function nuevoId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

function ubicarExcel(): string {
  const candidatos = [
    path.resolve(process.cwd(), 'CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '../CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '../../CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '../../../CAMBRIDGE.xlsx'),
  ];
  for (const c of candidatos) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'No se encontro CAMBRIDGE.xlsx. Rutas probadas:\n  ' + candidatos.join('\n  ')
  );
}

/** "5-8" -> [5,6,7,8]; 3 -> [3] */
function parseItemNumbers(val: any): number[] {
  if (typeof val === 'number') return [val];
  const str = String(val ?? '').trim();
  if (str.includes('-')) {
    const partes = str.split('-').map((p) => parseInt(p.trim(), 10)).filter((p) => !isNaN(p));
    if (partes.length === 2) {
      const nums: number[] = [];
      for (let i = partes[0]; i <= partes[1]; i++) nums.push(i);
      return nums;
    }
  }
  const n = parseInt(str, 10);
  return !isNaN(n) ? [n] : [];
}

interface Encabezado {
  nombre: string;
  col: number;
}

async function main() {
  console.log('');
  console.log('='.repeat(78));
  console.log(
    APLICAR
      ? '  IMPORTACION DE RECETA DE ACCESORIOS  —  MODO APLICAR (escribe en la base)'
      : '  IMPORTACION DE RECETA DE ACCESORIOS  —  SIMULACION (no escribe nada)'
  );
  console.log('='.repeat(78));

  const excelPath = ubicarExcel();
  console.log(`\nExcel: ${excelPath}`);

  const parseXLSX: any = (XLSX as any).default || XLSX;
  const workbook = parseXLSX.readFile(excelPath);
  const accSheet = workbook.Sheets['Acc'];
  if (!accSheet) throw new Error('El workbook no tiene una hoja llamada "Acc"');

  const accRows: any[][] = parseXLSX.utils.sheet_to_json(accSheet, { header: 1 });

  // --- Encabezados de accesorios, conservando el indice real de columna ---
  const filaEncabezado = accRows[1] || [];
  const encabezados: Encabezado[] = [];
  const columnasVacias: number[] = [];
  let vistoNoVacio = false;

  for (let col = 39; col >= 2; col--) {
    const nombre = String(filaEncabezado[col] ?? '').trim();
    if (nombre) vistoNoVacio = true;
    // Solo interesan los huecos intercalados, no la cola vacia de la derecha.
    else if (vistoNoVacio) columnasVacias.push(col);
  }
  for (let col = 2; col <= 39; col++) {
    const nombre = String(filaEncabezado[col] ?? '').trim();
    if (nombre) encabezados.push({ nombre, col });
  }

  console.log(`Accesorios en la hoja: ${encabezados.length}`);

  if (columnasVacias.length > 0) {
    console.log('');
    console.log('*** ATENCION: encabezados vacios intercalados en las columnas ' +
      columnasVacias.reverse().join(', ') + ' ***');
    console.log('    inputs.ts compacta los encabezados con filter(Boolean) y luego lee');
    console.log('    r[2 + idx], asi que a partir del primer hueco cada accesorio lee la');
    console.log('    columna de otro. Los costos que muestra el sistema HOY estan mal');
    console.log('    atribuidos. Este importador usa el indice real de columna, asi que');
    console.log('    los numeros importados NO van a coincidir con los que se ven en');
    console.log('    pantalla, y los correctos son los importados.');
  }

  // --- Tabla Auxiliar: costo unitario por accesorio ---
  const auxHeaderIdx = accRows.findIndex(
    (r: any) => r && r.some((celda: any) =>
      String(celda).includes('UNIDAD DE COMPRA') || String(celda).includes('COSTO Unitario')
    )
  );
  if (auxHeaderIdx === -1) throw new Error('No se encontro el encabezado de la Tabla Auxiliar en la hoja Acc');

  const costoUnitarioExcel = new Map<string, number>();
  for (const r of accRows.slice(auxHeaderIdx + 1)) {
    if (!r || !r[0]) continue;
    const nombre = String(r[0]).trim();
    const cu = Number(r[5]) || 0;
    if (nombre) costoUnitarioExcel.set(nombre, cu);
  }

  // --- Matriz item x accesorio (valores en Bs) ---
  const matrixRows = accRows.slice(2, auxHeaderIdx);
  const costoCelda = new Map<string, number>();   // `${item}|${nombre}` -> Bs
  const totalExcelPorItem = new Map<number, number>(); // col 41

  for (const r of matrixRows) {
    if (!r || r[1] === undefined) continue;
    for (const item of parseItemNumbers(r[1])) {
      if (item <= 0) continue;
      for (const h of encabezados) {
        const bs = Number(r[h.col]) || 0;
        if (bs !== 0) costoCelda.set(`${item}|${h.nombre}`, bs);
      }
      totalExcelPorItem.set(item, Number(r[41]) || 0);
    }
  }

  console.log(`Celdas con valor en la matriz: ${costoCelda.size}`);

  // --- Base de datos ---
  const db: any = await getDb();
  const prods = await db.select().from(productos);
  const accs = await db.select().from(accesorios);

  const prodPorItem = new Map<number, any>();
  for (const p of prods) prodPorItem.set(Number(p.itemNumero), p);

  const accPorNombre = new Map<string, any>();
  for (const a of accs) accPorNombre.set(String(a.descripcion).trim(), a);

  console.log(`Prendas en base: ${prods.length}   Accesorios en base: ${accs.length}`);

  // --- Resolucion celda por celda ---
  const aInsertar: any[] = [];
  const sinCostoUnitario: string[] = [];
  const accesorioNoEnBase = new Set<string>();
  const itemNoEnBase = new Set<number>();
  const derivadoPorItem = new Map<number, number>();

  for (const [clave, bs] of costoCelda.entries()) {
    const sep = clave.indexOf('|');
    const item = Number(clave.slice(0, sep));
    const nombre = clave.slice(sep + 1);

    const prod = prodPorItem.get(item);
    if (!prod) { itemNoEnBase.add(item); continue; }

    const acc = accPorNombre.get(nombre);
    if (!acc) { accesorioNoEnBase.add(nombre); continue; }

    // El costo unitario de la base es la fuente; el del Excel es el respaldo.
    const cu = Number(acc.costoUnitario) || costoUnitarioExcel.get(nombre) || 0;

    if (cu <= 0) {
      // Sin costo unitario la cantidad no se puede derivar. No se inventa un 1.
      sinCostoUnitario.push(`  item ${item} · ${nombre} · ${redondear(bs)} Bs en la hoja`);
      continue;
    }

    const cantidad = redondear(bs / cu);
    if (cantidad <= 0) continue;

    aInsertar.push({
      id: nuevoId(),
      productoId: prod.id,
      accesorioId: acc.id,
      cantidadUso: cantidad,
    });

    derivadoPorItem.set(item, (derivadoPorItem.get(item) || 0) + cantidad * cu);
  }

  // --- Reporte ---
  console.log('');
  console.log('-'.repeat(78));
  console.log(`Lineas de receta a crear: ${aInsertar.length}`);

  if (accesorioNoEnBase.size > 0) {
    console.log(`\nAccesorios de la hoja sin fila en la base (${accesorioNoEnBase.size}):`);
    for (const n of accesorioNoEnBase) console.log(`  · ${n}`);
    console.log('  Hay que crearlos en /api/accesorios antes de volver a correr esto.');
  }

  if (itemNoEnBase.size > 0) {
    console.log(`\nitemNumero de la hoja sin prenda en la base: ${[...itemNoEnBase].join(', ')}`);
  }

  if (sinCostoUnitario.length > 0) {
    console.log(`\nCeldas que NO se pueden convertir a cantidad (${sinCostoUnitario.length}):`);
    for (const l of sinCostoUnitario) console.log(l);
    console.log('  Costo unitario en cero, asi que la cantidad es indeterminable.');
    console.log('  El codigo actual asume cantidad = 1 en estos casos, lo cual es un');
    console.log('  dato inventado. Hay que cargar el costo unitario real del accesorio');
    console.log('  y volver a correr, o asignar la cantidad a mano.');
  }

  // --- Verificacion de paridad contra el total de la hoja (columna 41) ---
  console.log('');
  console.log('-'.repeat(78));
  console.log('PARIDAD contra el total de la hoja (columna 41), por prenda:');
  console.log('');
  console.log('  item |  derivado Bs |    hoja Bs |   dif Bs');

  let itemsDescuadrados = 0;
  const items = [...derivadoPorItem.keys()].sort((a, b) => a - b);
  for (const item of items) {
    const derivado = redondear(derivadoPorItem.get(item) || 0);
    const hoja = redondear(totalExcelPorItem.get(item) || 0);
    const dif = redondear(derivado - hoja);
    const marca = Math.abs(dif) > 0.05 ? '  <-- descuadre' : '';
    if (marca) itemsDescuadrados++;
    console.log(
      `  ${String(item).padStart(4)} | ${derivado.toFixed(2).padStart(12)} | ${hoja.toFixed(2).padStart(10)} | ${dif.toFixed(2).padStart(8)}${marca}`
    );
  }

  console.log('');
  if (itemsDescuadrados === 0) {
    console.log(`OK: las ${items.length} prendas cuadran con el total de la hoja.`);
    console.log('La receta importada reproduce el costo de accesorios del Excel.');
  } else {
    console.log(`ATENCION: ${itemsDescuadrados} de ${items.length} prendas no cuadran.`);
    console.log('Revisar antes de cambiar el calculo a detalle_acc: un descuadre aca');
    console.log('significa que el costo de accesorios va a cambiar para esas prendas.');
  }

  // --- Escritura ---
  console.log('');
  console.log('='.repeat(78));

  if (!APLICAR) {
    console.log('SIMULACION: no se escribio nada.');
    console.log('Para aplicar: agregar --aplicar al comando.');
    console.log('='.repeat(78));
    return;
  }

  const yaHay = await db.select().from(detalleAccesorio);
  if (yaHay.length > 0) {
    console.log(`detalle_acc ya tiene ${yaHay.length} filas. No se escribe nada para no`);
    console.log('duplicar. Vaciar la tabla a mano si se quiere reimportar desde cero.');
    console.log('='.repeat(78));
    return;
  }

  if (aInsertar.length === 0) {
    console.log('No hay nada que insertar.');
    console.log('='.repeat(78));
    return;
  }

  // Se inserta por lotes: sql.js arma una sola sentencia y un INSERT con
  // cientos de filas puede pasarse del limite de variables de SQLite.
  const LOTE = 100;
  for (let i = 0; i < aInsertar.length; i += LOTE) {
    await db.insert(detalleAccesorio).values(aInsertar.slice(i, i + LOTE));
  }
  saveDbToDisk();

  console.log(`Insertadas ${aInsertar.length} lineas de receta en detalle_acc.`);
  console.log('Base guardada en disco.');
  console.log('='.repeat(78));
}

main().catch((err) => {
  console.error('\nFallo la importacion:', err);
  process.exit(1);
});
