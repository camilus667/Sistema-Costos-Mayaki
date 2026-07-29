/**
 * Importador: hoja `Semit.` del Excel hacia `precio_adquisicion`.
 *
 * Uso (desde packages/api, con el server APAGADO):
 *   npx tsx src/scripts/importarSemiterminados.ts            # simulacion
 *   npx tsx src/scripts/importarSemiterminados.ts --aplicar   # escribe
 *
 * QUE HACE
 *  1. Lee la hoja `Semit.` (Costo de Fabricacion semit): una fila por prenda,
 *     una columna por talla, con el precio al que se compra la prenda.
 *  2. Inserta esos precios en `precio_adquisicion`.
 *  3. Marca esas prendas con modo_costeo = 'adquirido'.
 *  4. Verifica paridad: precio de adquisicion + accesorios de `detalle_acc`
 *     contra la hoja CostoBruto del Excel, talla por talla.
 *
 * POR QUE HACE FALTA
 * La hoja `Semit.` no se importa hoy, asi que el precio de compra de estas
 * prendas no existe en la base. El motor termina calculando 10.21 Bs para la
 * Chompa cuando el costo real en talla 2 es 66.71 y en 48/3XL es 168.41.
 *
 * ESTRUCTURA DE LA HOJA (verificada)
 *   fila 0: titulo "Costo de Fabricacion semit"
 *   fila 1: encabezado -> col 0 = ITEM, col 1 = DETALLE, cols 2..16 = tallas
 *   filas 2+: una por prenda; se corta al llegar a "Costos anteriores"
 *   Las filas de "Costos anteriores" son historial llevado a mano y se ignoran:
 *   son justamente el motivo por el que precio_adquisicion tiene vigencia.
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { asc, eq } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../database/sqljs';
import { productos, tallas, preciosAdquisicion, detalleAccesorio, accesorios } from '../database/schema';

const APLICAR = process.argv.includes('--aplicar');
const SEP = '='.repeat(78);
const num = (v: any): number => (typeof v === 'number' ? v : Number(v)) || 0;
const r2 = (n: number): number => Math.round(n * 100) / 100;

function nuevoId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function ubicarExcel(): string {
  const cands = ['CAMBRIDGE.xlsx', '../CAMBRIDGE.xlsx', '../../CAMBRIDGE.xlsx', '../../../CAMBRIDGE.xlsx']
    .map((c) => path.resolve(process.cwd(), c));
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('No se encontro CAMBRIDGE.xlsx. Rutas probadas:\n  ' + cands.join('\n  '));
}

async function main() {
  console.log('');
  console.log(SEP);
  console.log(APLICAR
    ? '  IMPORTACION DE SEMITERMINADOS  —  MODO APLICAR'
    : '  IMPORTACION DE SEMITERMINADOS  —  SIMULACION (no escribe nada)');
  console.log(SEP);

  const excelPath = ubicarExcel();
  console.log(`\nExcel: ${excelPath}`);

  const X: any = (XLSX as any).default || XLSX;
  const wb = X.readFile(excelPath);
  const hoja = wb.Sheets['Semit.'];
  if (!hoja) throw new Error('El workbook no tiene una hoja llamada "Semit."');

  const filas: any[][] = X.utils.sheet_to_json(hoja, { header: 1 });

  // Encabezado: cols 2 en adelante son codigos de talla.
  const encabezado = filas[1] || [];
  const columnaTalla: Array<{ col: number; codigo: string }> = [];
  for (let c = 2; c < encabezado.length; c++) {
    const cod = String(encabezado[c] ?? '').trim();
    if (cod) columnaTalla.push({ col: c, codigo: cod });
  }
  console.log(`Tallas en la hoja: ${columnaTalla.length}  ->  ${columnaTalla.map((t) => t.codigo).join(', ')}`);

  // Filas de prendas: se corta en "Costos anteriores" (historial manual).
  const prendasHoja: Array<{ item: number; detalle: string; precios: Map<string, number> }> = [];
  for (let f = 2; f < filas.length; f++) {
    const fila = filas[f] || [];
    const textoFila = fila.map((v) => String(v ?? '')).join(' ').toLowerCase();
    if (textoFila.includes('costos anteriores')) break;
    const item = num(fila[0]);
    if (item <= 0) continue;
    const precios = new Map<string, number>();
    for (const t of columnaTalla) {
      const v = num(fila[t.col]);
      if (v > 0) precios.set(t.codigo, v);
    }
    prendasHoja.push({ item, detalle: String(fila[1] ?? '').trim(), precios });
  }

  if (prendasHoja.length === 0) throw new Error('No se encontraron prendas en la hoja Semit.');

  console.log('');
  for (const p of prendasHoja) {
    const vals = [...p.precios.values()];
    console.log(`  item ${p.item}  ${p.detalle}: ${p.precios.size} tallas con precio, de ${Math.min(...vals)} a ${Math.max(...vals)} Bs`);
  }

  // ---------- Base de datos ----------
  const db: any = await getDb();
  const listaProductos = await db.select().from(productos);
  const listaTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  if (listaProductos.length === 0 || listaTallas.length === 0) {
    console.error('\nABORTA: la base abierta no tiene prendas o no tiene tallas.');
    console.error(`  ruta abierta: ${path.resolve(process.cwd(), 'sistema_inventario.db')}`);
    console.error('\nCasi con seguridad el directorio de trabajo esta mal. Correr desde packages/api:');
    console.error('  cd packages/api');
    console.error('  npx tsx src/scripts/importarSemiterminados.ts');
    process.exit(1);
  }

  const prodPorItem = new Map<number, any>(listaProductos.map((p: any) => [Number(p.itemNumero), p]));
  const tallaPorCodigo = new Map<string, any>(listaTallas.map((t: any) => [String(t.codigo).trim(), t]));

  // Accesorios ya asignados, para la verificacion de paridad.
  const recetas = await db
    .select({
      productoId: detalleAccesorio.productoId,
      cantidadUso: detalleAccesorio.cantidadUso,
      costoUnitario: accesorios.costoUnitario,
    })
    .from(detalleAccesorio)
    .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id));

  const accPorProducto = new Map<string, number>();
  for (const l of recetas) {
    const linea = r2(num(l.cantidadUso) * num(l.costoUnitario));
    accPorProducto.set(l.productoId, r2((accPorProducto.get(l.productoId) || 0) + linea));
  }

  // Hoja CostoBruto para la paridad.
  const hojaCB = wb.Sheets['CostoBruto'];
  const filasCB: any[][] = hojaCB ? X.utils.sheet_to_json(hojaCB, { header: 1 }) : [];
  const encCB = filasCB[1] || [];
  const colCBPorCodigo = new Map<string, number>();
  for (let c = 2; c < encCB.length; c++) {
    const cod = String(encCB[c] ?? '').trim();
    if (cod) colCBPorCodigo.set(cod, c);
  }
  const filaCBPorItem = new Map<number, any[]>();
  for (const f of filasCB) {
    const it = num(f?.[0]);
    if (it > 0) filaCBPorItem.set(it, f);
  }

  const aInsertar: any[] = [];
  const aMarcar: any[] = [];
  const sinTalla: string[] = [];
  const sinPrenda: number[] = [];
  let descuadres = 0;
  let comparadas = 0;

  console.log('');
  console.log('-'.repeat(78));
  console.log('PARIDAD: precio de adquisicion + accesorios  vs  hoja CostoBruto');

  for (const p of prendasHoja) {
    const prod = prodPorItem.get(p.item);
    if (!prod) { sinPrenda.push(p.item); continue; }

    const acc = accPorProducto.get(prod.id) || 0;
    const filaCB = filaCBPorItem.get(p.item);

    console.log(`\n  item ${p.item}  ${prod.descripcion}   (accesorios en base: ${acc.toFixed(2)} Bs)`);
    console.log('   talla    |  precio adq |  + acc = calc |  CostoBruto |    dif');

    if (String(prod.modoCosteo || 'confeccion') !== 'adquirido') {
      aMarcar.push(prod);
    }

    for (const [codigo, precio] of p.precios.entries()) {
      const talla = tallaPorCodigo.get(codigo);
      if (!talla) { sinTalla.push(`item ${p.item} talla "${codigo}"`); continue; }

      aInsertar.push({ productoId: prod.id, tallaId: talla.id, item: p.item, talla: codigo, precio });

      const calc = r2(precio + acc);
      let cb: number | null = null;
      const colCB = colCBPorCodigo.get(codigo);
      if (filaCB && colCB != null) cb = r2(num(filaCB[colCB]));

      let marca = '';
      if (cb != null && cb > 0) {
        comparadas++;
        const dif = r2(calc - cb);
        if (Math.abs(dif) > 0.05) { marca = '  <-- DESCUADRE'; descuadres++; }
        console.log(`   ${codigo.padEnd(8)} | ${precio.toFixed(2).padStart(11)} | ${calc.toFixed(2).padStart(13)} | ` +
                    `${cb.toFixed(2).padStart(11)} | ${dif.toFixed(2).padStart(6)}${marca}`);
      } else {
        console.log(`   ${codigo.padEnd(8)} | ${precio.toFixed(2).padStart(11)} | ${calc.toFixed(2).padStart(13)} | ` +
                    `${'sin dato'.padStart(11)} |      -`);
      }
    }
  }

  console.log('');
  console.log('-'.repeat(78));
  console.log(`Precios a insertar: ${aInsertar.length}`);
  console.log(`Prendas a marcar como 'adquirido': ${aMarcar.length}`);
  if (sinPrenda.length) console.log(`itemNumero de la hoja sin prenda en la base: ${sinPrenda.join(', ')}`);
  if (sinTalla.length) {
    console.log(`Tallas de la hoja que no existen en la base (${sinTalla.length}):`);
    for (const s of sinTalla) console.log(`  · ${s}`);
  }

  console.log('');
  if (comparadas === 0) {
    console.log('No se pudo comparar contra CostoBruto (sin datos en la hoja).');
  } else if (descuadres === 0) {
    console.log(`OK: las ${comparadas} tallas comparadas cuadran con la hoja CostoBruto.`);
    console.log('El costo de estas prendas va a reproducir exactamente el del Excel.');
  } else {
    console.log(`ATENCION: ${descuadres} de ${comparadas} tallas no cuadran.`);
    console.log('Revisar antes de aplicar: un descuadre significa que el costo de esas');
    console.log('tallas va a quedar distinto al del Excel.');
  }

  console.log('');
  console.log(SEP);

  if (!APLICAR) {
    console.log('SIMULACION: no se escribio nada. Para aplicar, agrega --aplicar.');
    console.log(SEP);
    return;
  }

  const yaHay = await db.select().from(preciosAdquisicion);
  if (yaHay.length > 0) {
    console.log(`precio_adquisicion ya tiene ${yaHay.length} filas. No se escribe nada para no`);
    console.log('duplicar. Vaciar la tabla a mano si se quiere reimportar desde cero.');
    console.log(SEP);
    return;
  }

  for (const w of aInsertar) {
    await db.insert(preciosAdquisicion).values({
      id: nuevoId(),
      productoId: w.productoId,
      tallaId: w.tallaId,
      precioBs: w.precio,
      proveedor: null,
      // Sin dato en el Excel. Se deja en false, que es el caso conservador:
      // asume que no hay credito fiscal y por lo tanto el precio completo es
      // costo. Corregir por prenda cuando se sepa.
      conFactura: false,
    });
  }

  for (const prod of aMarcar) {
    await db.update(productos).set({ modoCosteo: 'adquirido' }).where(eq(productos.id, prod.id));
  }

  saveDbToDisk();

  console.log(`Insertados ${aInsertar.length} precios de adquisicion.`);
  console.log(`Marcadas ${aMarcar.length} prendas como modo_costeo = 'adquirido'.`);
  console.log('Base guardada en disco.');
  console.log('\nConviene correr la validacion del catalogo:');
  console.log('  npx tsx src/scripts/validarCatalogo.ts');
  console.log(SEP);
}

main().catch((err) => {
  console.error('\nFallo la importacion de semiterminados:', err);
  process.exit(1);
});
