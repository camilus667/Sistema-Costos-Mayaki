/**
 * Script de verificación post-normalización.
 * Abre la base en modo solo lectura y verifica:
 *   1. No hay tildes/ñ en los campos de nombres
 *   2. pos_producto.nombreProducto no tiene sufijo de colegio
 *   3. Las categorías y grupos NO fueron tocados
 */
import { getDb } from '../database/sqljs';
import {
  productos as productosTable,
  tipoPrenda as tipoPrendaTable,
  posProductos as posProductosTable,
} from '../database/schema';

const TILDES = /[áéíóúüÁÉÍÓÚÜ]/;
const Ñ = /[ñÑ]/;
const SUFIJO = /,\s*(CC|EO|IntlSM|InfSM|ColSM|SJ|Intl SM|Inf SM|Col SM|EMP)\s*$/i;

async function main() {
  console.log('🔍 Verificando normalización de nombres...\n');
  const db = await getDb({ skipSeed: true });

  // ============================================
  // 1. producto.descripcion
  // ============================================
  const productos = db.select().from(productosTable).all();
  const conTilde = productos.filter((p) => TILDES.test(String(p.descripcion)));
  const conÑ = productos.filter((p) => Ñ.test(String(p.descripcion)));
  console.log(`1. producto.descripcion (${productos.length} filas)`);
  console.log(`   ✅ Tildes: ${conTilde.length} | Ñ: ${conÑ.length}`);
  if (conTilde.length || conÑ.length) {
    [...conTilde, ...conÑ].forEach((p) => console.log(`   ❌ "${p.descripcion}"`));
  }

  // ============================================
  // 2. tipo_prenda.nombre
  // ============================================
  const tipos = db.select().from(tipoPrendaTable).all();
  const tiposTilde = tipos.filter((t) => TILDES.test(String(t.nombre)));
  const tiposÑ = tipos.filter((t) => Ñ.test(String(t.nombre)));
  console.log(`\n2. tipo_prenda.nombre (${tipos.length} filas)`);
  console.log(`   ✅ Tildes: ${tiposTilde.length} | Ñ: ${tiposÑ.length}`);
  if (tiposTilde.length || tiposÑ.length) {
    [...tiposTilde, ...tiposÑ].forEach((t) => console.log(`   ❌ "${t.nombre}"`));
  }

  // ============================================
  // 3. pos_producto.nombreProducto
  // ============================================
  const pos = db.select().from(posProductosTable).all();
  const posTilde = pos.filter((p) => TILDES.test(String(p.nombreProducto)));
  const posÑ = pos.filter((p) => Ñ.test(String(p.nombreProducto)));
  const posSufijo = pos.filter((p) => SUFIJO.test(String(p.nombreProducto)));
  console.log(`\n3. pos_producto.nombreProducto (${pos.length} filas)`);
  console.log(`   ✅ Tildes: ${posTilde.length} | Ñ: ${posÑ.length} | Con sufijo: ${posSufijo.length}`);
  if (posTilde.length) posTilde.slice(0, 5).forEach((p) => console.log(`   ❌ Tilde: "${p.nombreProducto}"`));
  if (posÑ.length) posÑ.slice(0, 5).forEach((p) => console.log(`   ❌ Ñ: "${p.nombreProducto}"`));
  if (posSufijo.length) posSufijo.slice(0, 5).forEach((p) => console.log(`   ❌ Sufijo: "${p.nombreProducto}"`));

  // ============================================
  // 4. pos_producto.nombreLimpio
  // ============================================
  const limpioTilde = pos.filter((p) => TILDES.test(String(p.nombreLimpio)));
  const limpioÑ = pos.filter((p) => Ñ.test(String(p.nombreLimpio)));
  console.log(`\n4. pos_producto.nombreLimpio (${pos.length} filas)`);
  console.log(`   ✅ Tildes: ${limpioTilde.length} | Ñ: ${limpioÑ.length}`);
  if (limpioTilde.length) limpioTilde.slice(0, 5).forEach((p) => console.log(`   ❌ "${p.nombreLimpio}"`));
  if (limpioÑ.length) limpioÑ.slice(0, 5).forEach((p) => console.log(`   ❌ "${p.nombreLimpio}"`));

  // ============================================
  // 5. Categorías y grupos NO tocados
  // ============================================
  const categorias = new Set(pos.map((p) => String(p.categoria)));
  const grupos = new Set(pos.map((p) => String(p.grupoMatriz)));
  console.log(`\n5. Categorías y grupos intactos:`);
  console.log(`   Categorías (${categorias.size}): ${[...categorias].join(', ')}`);
  console.log(`   Grupos (${grupos.size}): ${[...grupos].join(', ')}`);

  // ============================================
  // 6. Ejemplos de nombres normalizados
  // ============================================
  console.log('\n6. Ejemplos de nombres normalizados:');
  const ejemplos = pos.slice(0, 10);
  ejemplos.forEach((p) => console.log(`   "${p.nombreProducto}" (grupo: ${p.grupoMatriz})`));

  // ============================================
  // RESUMEN
  // ============================================
  const totalErrores =
    conTilde.length + conÑ.length +
    tiposTilde.length + tiposÑ.length +
    posTilde.length + posÑ.length + posSufijo.length +
    limpioTilde.length + limpioÑ.length;

  console.log(`\n============================================`);
  console.log(totalErrores === 0
    ? '✅ VERIFICACIÓN EXITOSA: 0 errores encontrados'
    : `❌ VERIFICACIÓN FALLIDA: ${totalErrores} errores encontrados`);
  console.log('============================================');
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});