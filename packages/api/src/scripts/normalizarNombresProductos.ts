/**
 * Script de normalización de nombres de productos.
 *
 * Objetivo: que los nombres de productos en la base de datos queden sin tildes,
 * sin ñ y sin sufijo de colegio, usando el Excel products_v2_export_1785764754821.xlsx
 * como referencia (que ya está 100% normalizado).
 *
 * Tablas y campos que se modifican:
 *   - producto.descripcion          -> quitar tildes/ñ
 *   - tipo_prenda.nombre            -> quitar tildes/ñ
 *   - pos_producto.nombreProducto   -> quitar sufijo (después de la coma) + quitar tildes/ñ
 *   - pos_producto.nombreLimpio     -> quitar tildes/ñ
 *
 * Campos que NO se tocan:
 *   - pos_producto.categoria        (es la categoría del POS)
 *   - pos_producto.grupoMatriz      (es el grupo de la matriz, conserva identidad del colegio)
 *   - pos_producto.datosOriginales  (snapshot JSON crudo del Excel)
 *
 * Uso:
 *   pnpm --filter @sistema-uniformes/api exec tsx src/scripts/normalizarNombresProductos.ts
 */
import { eq } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../database/sqljs';
import {
  productos as productosTable,
  tipoPrenda as tipoPrendaTable,
  posProductos as posProductosTable,
} from '../database/schema';

// ============================================
// FUNCIONES DE NORMALIZACIÓN
// ============================================

/** Quita tildes y ñ de un texto. */
function normalizar(n: string): string {
  return n
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita tildes
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N');
}

/** Quita el sufijo de colegio: "Pantalon de Varon, CC" -> "Pantalon de Varon" */
function quitarSufijo(n: string): string {
  return n.split(',')[0].trim();
}

/** ¿Tiene tildes o ñ? */
function tieneTildesON(n: string): boolean {
  return /[áéíóúüÁÉÍÓÚÜñÑ]/.test(n);
}

// ============================================
// MAIN
// ============================================
async function main() {
  console.log('🚀 Iniciando normalización de nombres de productos...\n');

  const db = await getDb();

  // ============================================
  // 1. TABLA producto.descripcion
  // ============================================
  console.log('============================================');
  console.log('1. TABLA producto.descripcion');
  console.log('============================================\n');

  const productos = db.select().from(productosTable).all();
  let cambiosProducto = 0;

  for (const p of productos) {
    const desc = String(p.descripcion);
    if (tieneTildesON(desc)) {
      const nuevo = normalizar(desc);
      console.log(`  "${desc}" → "${nuevo}"`);
      await db.update(productosTable).set({ descripcion: nuevo }).where(eq(productosTable.id, p.id));
      cambiosProducto++;
    }
  }
  console.log(`\n✅ producto.descripcion: ${cambiosProducto} cambios\n`);

  // ============================================
  // 2. TABLA tipo_prenda.nombre
  // ============================================
  console.log('============================================');
  console.log('2. TABLA tipo_prenda.nombre');
  console.log('============================================\n');

  const tipos = db.select().from(tipoPrendaTable).all();
  let cambiosTipo = 0;

  for (const t of tipos) {
    const nombre = String(t.nombre);
    if (tieneTildesON(nombre)) {
      const nuevo = normalizar(nombre);
      console.log(`  "${nombre}" → "${nuevo}"`);
      await db.update(tipoPrendaTable).set({ nombre: nuevo }).where(eq(tipoPrendaTable.id, t.id));
      cambiosTipo++;
    }
  }
  console.log(`\n✅ tipo_prenda.nombre: ${cambiosTipo} cambios\n`);

  // ============================================
  // 3. TABLA pos_producto.nombreProducto
  //    Quitar sufijo (después de la coma) + quitar tildes/ñ
  // ============================================
  console.log('============================================');
  console.log('3. TABLA pos_producto.nombreProducto');
  console.log('   (quitar sufijo + tildes/ñ)');
  console.log('============================================\n');

  const posProductos = db.select().from(posProductosTable).all();
  let cambiosPosNombre = 0;
  let cambiosPosSufijo = 0;

  for (const p of posProductos) {
    const nombre = String(p.nombreProducto);
    const sinSufijo = quitarSufijo(nombre);
    const normalizado = normalizar(sinSufijo);

    if (nombre !== normalizado) {
      if (nombre !== sinSufijo) {
        cambiosPosSufijo++;
      }
      console.log(`  "${nombre}" → "${normalizado}"`);
      await db.update(posProductosTable).set({ nombreProducto: normalizado }).where(eq(posProductosTable.id, p.id));
      cambiosPosNombre++;
    }
  }
  console.log(`\n✅ pos_producto.nombreProducto: ${cambiosPosNombre} cambios (${cambiosPosSufijo} con sufijo quitado)\n`);

  // ============================================
  // 4. TABLA pos_producto.nombreLimpio
  //    Quitar tildes/ñ (ya no tiene sufijo)
  // ============================================
  console.log('============================================');
  console.log('4. TABLA pos_producto.nombreLimpio');
  console.log('============================================\n');

  let cambiosPosLimpio = 0;

  for (const p of posProductos) {
    const limpio = String(p.nombreLimpio);
    if (tieneTildesON(limpio)) {
      const nuevo = normalizar(limpio);
      console.log(`  "${limpio}" → "${nuevo}"`);
      await db.update(posProductosTable).set({ nombreLimpio: nuevo }).where(eq(posProductosTable.id, p.id));
      cambiosPosLimpio++;
    }
  }
  console.log(`\n✅ pos_producto.nombreLimpio: ${cambiosPosLimpio} cambios\n`);

  // ============================================
  // RESUMEN
  // ============================================
  console.log('============================================');
  console.log('📊 RESUMEN DE CAMBIOS');
  console.log('============================================\n');
  console.log(`  producto.descripcion:        ${cambiosProducto} cambios`);
  console.log(`  tipo_prenda.nombre:          ${cambiosTipo} cambios`);
  console.log(`  pos_producto.nombreProducto: ${cambiosPosNombre} cambios`);
  console.log(`  pos_producto.nombreLimpio:   ${cambiosPosLimpio} cambios`);
  console.log(`\n  TOTAL: ${cambiosProducto + cambiosTipo + cambiosPosNombre + cambiosPosLimpio} cambios\n`);

  // ============================================
  // PERSISTIR
  // ============================================
  saveDbToDisk();
  console.log('💾 Base de datos guardada en disco.');
  console.log('✅ Normalización completada.');
}

main().catch((err) => {
  console.error('❌ Error durante la normalización:', err);
  process.exit(1);
});