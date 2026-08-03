/**
 * Script temporal de análisis: compara nombres de productos entre el Excel
 * products_v2_export_1785764754821.xlsx y la base de datos actual.
 *
 * Uso:
 *   pnpm --filter @sistema-uniformes/api tsx src/scripts/analizarNombresProductos.ts
 */
import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../database/sqljs';
import { productos as productosTable, posProductos as posProductosTable, tipoPrenda as tipoPrendaTable } from '../database/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta absoluta del Excel
const EXCEL_PATH = path.resolve(__dirname, '../../../../products_v2_export_1785764754821.xlsx');
console.log('📄 Leyendo Excel:', EXCEL_PATH);

// ============================================
// 1. LEER EXCEL
// ============================================
const workbook = XLSX.readFile(EXCEL_PATH);
const hoja = workbook.Sheets[workbook.SheetNames[0]];
const filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });

console.log(`\n✅ Excel leído: ${filas.length} filas, hoja: ${workbook.SheetNames[0]}`);

// Mostrar las primeras 3 filas para entender estructura
console.log('\n--- Primeras 3 filas del Excel (claves disponibles) ---');
for (let i = 0; i < Math.min(3, filas.length); i++) {
  console.log(filas[i]);
}

// Obtener nombres de producto únicos del Excel
const nombresExcel = new Set<string>();
const colNombreProducto = 'Nombre de Producto';
for (const f of filas as any[]) {
  if (f[colNombreProducto]) {
    nombresExcel.add(String(f[colNombreProducto]).trim());
  }
}
console.log(`\n📦 Nombres únicos en Excel: ${nombresExcel.size}`);

// Verificar tildes/ñ en el Excel
const nombresConTilde = [...nombresExcel].filter((n) => /[áéíóúüÁÉÍÓÚÜ]/.test(n));
const nombresConÑ = [...nombresExcel].filter((n) => /[ñÑ]/.test(n));
console.log(`\n🔤 Nombres del Excel con TILDES: ${nombresConTilde.length}`);
nombresConTilde.forEach((n) => console.log(`  - ${n}`));
console.log(`\n🔤 Nombres del Excel con Ñ: ${nombresConÑ.length}`);
nombresConÑ.forEach((n) => console.log(`  - ${n}`));

// ============================================
// 2. LEER BASE DE DATOS
// ============================================
console.log('\n\n============================================');
console.log('LEYENDO BASE DE DATOS...');
console.log('============================================\n');

const db = await getDb({ skipSeed: true });

// Productos de la tabla producto
const productosDb = db.select().from(productosTable).all();

console.log(`📦 Productos en BD (tabla producto): ${productosDb.length}`);
console.log('\n--- Primeros 10 productos de la BD ---');
for (const p of productosDb.slice(0, 10)) {
  console.log(`  item=${p.itemNumero} | descripcion="${p.descripcion}" | colegioId=${p.colegioId}`);
}

// Nombres de la tabla pos_producto
const posProductos = db.select().from(posProductosTable).all();
console.log(`\n📦 Productos en BD (tabla pos_producto): ${posProductos.length}`);
console.log('\n--- Primeros 10 pos_producto ---');
for (const p of posProductos.slice(0, 10)) {
  console.log(`  posId=${p.posIdProducto} | nombre="${p.nombreProducto}" | limpio="${p.nombreLimpio}" | grupo="${p.grupoMatriz}"`);
}

// Verificar tildes/ñ en BD
const descripciones = productosDb.map((p: any) => String(p.descripcion));
const posNombres = posProductos.map((p: any) => String(p.nombreProducto));

const descConTilde = descripciones.filter((d) => /[áéíóúüÁÉÍÓÚÜ]/.test(d));
const descConÑ = descripciones.filter((d) => /[ñÑ]/.test(d));
const posConTilde = posNombres.filter((d) => /[áéíóúüÁÉÍÓÚÜ]/.test(d));
const posConÑ = posNombres.filter((d) => /[ñÑ]/.test(d));

console.log(`\n🔤 descripcion con TILDES: ${descConTilde.length}`);
descConTilde.forEach((d) => console.log(`  - "${d}"`));
console.log(`\n🔤 descripcion con Ñ: ${descConÑ.length}`);
descConÑ.forEach((d) => console.log(`  - "${d}"`));

console.log(`\n🔤 pos_producto.nombreProducto con TILDES: ${posConTilde.length}`);
posConTilde.forEach((d) => console.log(`  - "${d}"`));
console.log(`\n🔤 pos_producto.nombreProducto con Ñ: ${posConÑ.length}`);
posConÑ.forEach((d) => console.log(`  - "${d}"`));

// Comparación: nombres únicos en BD vs Excel
console.log('\n\n============================================');
console.log('COMPARACIÓN DE NOMBRES');
console.log('============================================\n');

const nombresBd = new Set<string>([...descripciones, ...posNombres]);
const enExcelNoEnBd = [...nombresExcel].filter((n) => !nombresBd.has(n));
const enBdNoEnExcel = [...nombresBd].filter((n) => !nombresExcel.has(n));

console.log(`Nombres SOLO en Excel (no en BD): ${enExcelNoEnBd.length}`);
enExcelNoEnBd.forEach((n) => console.log(`  - "${n}"`));

console.log(`\nNombres SOLO en BD (no en Excel): ${enBdNoEnExcel.length}`);
enBdNoEnExcel.slice(0, 30).forEach((n) => console.log(`  - "${n}"`));
if (enBdNoEnExcel.length > 30) console.log(`  ... y ${enBdNoEnExcel.length - 30} más`);

// Normalización: quitar tildes y ñ
function normalizar(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N');
}

// Quitar sufijo de colegio: "Pantalon de Varon, CC" -> "Pantalon de Varon"
function quitarSufijo(n: string): string {
  return n.split(',')[0].trim();
}

// ============================================
// 3. COMPARACIÓN CON SUFIJO QUITADO
//    El Excel usa "Pantalon de Varon, CC" y la tabla producto
//    usa "Pantalón de Varon" (sin sufijo). Para comparar hay que
//    quitar el sufijo del Excel y normalizar ambos lados.
// ============================================
console.log('\n\n============================================');
console.log('COMPARACIÓN QUITANDO SUFIJO DE COLEGIO');
console.log('============================================\n');

// Mapa: nombre normalizado SIN sufijo (Excel) -> nombre original del Excel
const nombresExcelSinSufijoNorm = new Map<string, string>();
for (const n of nombresExcel) {
  const sinSufijo = quitarSufijo(n);
  const norm = normalizar(sinSufijo);
  if (!nombresExcelSinSufijoNorm.has(norm)) {
    nombresExcelSinSufijoNorm.set(norm, n);
  }
}
console.log(`Nombres únicos en Excel sin sufijo (normalizados): ${nombresExcelSinSufijoNorm.size}`);

// Para cada producto de la BD, ¿existe su nombre (normalizado) en el mapa del Excel?
const coincidenciasSinSufijo: Array<{ db: string; excel: string; normalizado: boolean }> = [];
const sinCoincidenciaSinSufijo: Array<{ db: string; excelNorm: string | null }> = [];

for (const d of descripciones) {
  const norm = normalizar(d);
  const match = nombresExcelSinSufijoNorm.get(norm);
  if (match) {
    coincidenciasSinSufijo.push({ db: d, excel: match, normalizado: d !== match });
  } else {
    sinCoincidenciaSinSufijo.push({ db: d, excelNorm: null });
  }
}

console.log(`\n✅ Productos BD que coinciden con Excel (quitando sufijo + normalizando): ${coincidenciasSinSufijo.length} / ${descripciones.length}`);

// Mostrar los que coinciden PERO necesitan normalización (tildes/ñ)
const conDiferencias = coincidenciasSinSufijo.filter((c) => c.normalizado);
console.log(`\n🔧 Coinciden pero con tildes/ñ que normalizar: ${conDiferencias.length}`);
conDiferencias.forEach((c) => console.log(`  BD: "${c.db}"  →  Excel: "${c.excel}"`));

// Mostrar los que NO coinciden
console.log(`\n❌ Productos BD SIN coincidencia (ni quitando sufijo ni normalizando): ${sinCoincidenciaSinSufijo.length}`);
for (const s of sinCoincidenciaSinSufijo) {
  console.log(`  - "${s.db}"`);
}

// ============================================
// 4. LO QUE HABRÍA QUE CAMBIAR EN CADA TABLA
// ============================================
console.log('\n\n============================================');
console.log('RESUMEN DE CAMBIOS NECESARIOS');
console.log('============================================\n');

// 4a. En producto.descripcion: quitar tildes/ñ
const cambiosProducto = coincidenciasSinSufijo
  .filter((c) => c.normalizado)
  .map((c) => ({ original: c.db, nuevo: quitarSufijo(c.excel) }));
console.log(`Tabla producto.descripcion: ${cambiosProducto.length} cambios (quitar tildes/ñ)`);
cambiosProducto.forEach((c) => console.log(`  "${c.original}"  →  "${c.nuevo}"`));

// 4b. En pos_producto.nombreProducto: quitar tildes/ñ (el sufijo SE MANTIENE porque es la
//     identidad del producto en el POS)
const posConTildeNormalizados = posNombres.filter((d) => /[áéíóúüÁÉÍÓÚÜñÑ]/.test(d));
console.log(`\nTabla pos_producto.nombreProducto: ${posConTildeNormalizados.length} cambios (quitar tildes/ñ, mantener sufijo)`);

// 4c. En pos_producto.nombreLimpio: quitar tildes/ñ
const posLimpio = posProductos.map((p: any) => String(p.nombreLimpio));
const posLimpioConTilde = posLimpio.filter((d) => /[áéíóúüÁÉÍÓÚÜñÑ]/.test(d));
console.log(`\nTabla pos_producto.nombreLimpio: ${posLimpioConTilde.length} cambios (quitar tildes/ñ)`);
console.log('  Ejemplos:');
[...new Set(posLimpioConTilde)].slice(0, 15).forEach((d) => console.log(`    "${d}" → "${normalizar(d)}"`));

// 4d. En tipo_prenda.nombre
const tiposPrenda = db.select().from(tipoPrendaTable).all();
const tiposConTilde = tiposPrenda.filter((t: any) => /[áéíóúüÁÉÍÓÚÜñÑ]/.test(String(t.nombre)));
console.log(`\nTabla tipo_prenda.nombre: ${tiposConTilde.length} cambios (quitar tildes/ñ)`);
tiposConTilde.forEach((t: any) => console.log(`  "${t.nombre}" → "${normalizar(String(t.nombre))}"`));
