/**
 * Validacion del catalogo: que se ofrece y que se puede costear.
 *
 * Uso (desde packages/api):
 *   npx tsx src/scripts/validarCatalogo.ts
 *
 * Solo lee, nunca escribe.
 *
 * REGLA DE NEGOCIO (decidida por el usuario, 29-jul-2026)
 * La fuente de verdad de si una prenda se ofrece en una talla es
 * `precio_venta`. Sin precio para esa talla, la prenda NO se ofrece en esa
 * talla, sin importar si tiene peso, mano de obra o accesorios cargados.
 *
 * Por que importa: la grilla de prendas x tallas sugiere que todas las
 * combinaciones existen, y no es asi. En los datos de Cambridge son 281 de 432.
 * Una corbata existe en una sola talla y eso es correcto. Sin esta regla, el
 * sistema calcula costo y margen para combinaciones inexistentes y ensucia
 * cualquier promedio.
 *
 * Consecuencia de diseno: no hace falta una tabla aparte de tallas por prenda.
 * `precio_venta` ya cumple ese rol, y con su vigencia temporal incluso resuelve
 * el caso de dejar de ofrecer una talla sin perder el historico.
 *
 * NOTA DE IMPLEMENTACION
 * Todo el acceso a datos usa el query builder de Drizzle y los cruces se
 * resuelven en memoria. La primera version intentaba SQL crudo via
 * `db.$client.exec`, que no existe en el driver de sql.js y fallaba en runtime.
 */

import { asc, eq } from 'drizzle-orm';
import { getDb } from '../database/sqljs';
import { productos, tallas, pesoMateriaPrima, preciosVenta } from '../database/schema';

const SEP = '='.repeat(78);
const num = (v: any): number => Number(v) || 0;

async function main() {
  const db: any = await getDb();

  console.log('');
  console.log(SEP);
  console.log('  VALIDACION DE CATALOGO  —  la verdad la define precio_venta');
  console.log(SEP);

  const listaProductos = await db.select().from(productos).orderBy(asc(productos.itemNumero));
  const listaTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));
  const pesos = await db.select().from(pesoMateriaPrima);
  const precios = await db.select().from(preciosVenta);

  const tallaPorId = new Map<string, any>(listaTallas.map((t: any) => [t.id, t]));
  const prodPorId = new Map<string, any>(listaProductos.map((p: any) => [p.id, p]));

  // peso por (producto, talla)
  const pesoPor = new Map<string, number>();
  for (const p of pesos) pesoPor.set(`${p.productoId}|${p.tallaId}`, num(p.pesoGramos));

  // precio por (producto, talla)
  const precioPor = new Map<string, number>();
  for (const pv of precios) precioPor.set(`${pv.productoId}|${pv.tallaId}`, num(pv.precioBs));

  const totalGrilla = listaProductos.length * listaTallas.length;

  console.log(`\nPrendas: ${listaProductos.length}   Tallas: ${listaTallas.length}`);
  console.log(`Combinaciones en la grilla:                 ${totalGrilla}`);
  console.log(`Ofrecidas de verdad (con precio de venta):  ${precios.length}`);
  console.log(`No ofrecidas:                               ${totalGrilla - precios.length}`);

  // ---------- 1. Se ofrecen pero no se pueden costear ----------
  const sinBase: any[] = [];
  for (const [clv, precio] of precioPor.entries()) {
    const sep = clv.indexOf('|');
    const prodId = clv.slice(0, sep);
    const tallaId = clv.slice(sep + 1);
    if (pesoPor.get(clv) || 0) continue;
    const p = prodPorId.get(prodId);
    const t = tallaPorId.get(tallaId);
    if (!p || !t) continue;
    sinBase.push({ item: p.itemNumero, prenda: p.descripcion, talla: t.codigo, orden: t.orden, precio, tela: p.telaId });
  }
  sinBase.sort((a, b) => a.item - b.item || a.orden - b.orden);

  console.log('');
  console.log('-'.repeat(78));
  console.log('1) SE OFRECEN PERO NO SE PUEDEN COSTEAR');

  if (sinBase.length === 0) {
    console.log('   Ninguna. Todo lo que se vende tiene base de costeo.');
  } else {
    console.log('   Se venden con costo de material resuelto en 0.');
    console.log('   Si la prenda se compra semiterminada esto es esperable, y lo que falta');
    console.log('   es cargar su precio de adquisicion.\n');
    console.log('   item | prenda                   | talla    | precio | tela');
    for (const r of sinBase) {
      console.log(
        `   ${String(r.item).padStart(4)} | ${String(r.prenda).slice(0, 24).padEnd(24)} | ` +
        `${String(r.talla).padEnd(8)} | ${String(r.precio).padStart(6)} | ${r.tela ? 'ok' : 'SIN TELA'}`
      );
    }
    const porPrenda = new Map<string, number>();
    for (const r of sinBase) {
      const k = `item ${r.item} ${r.prenda}`;
      porPrenda.set(k, (porPrenda.get(k) || 0) + 1);
    }
    console.log('\n   Resumen por prenda:');
    for (const [prenda, n] of [...porPrenda.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${prenda}: ${n} tallas`);
    }
    console.log(`\n   TOTAL: ${sinBase.length} combinaciones.`);
  }

  // ---------- 2. Prendas sin ningun precio ----------
  const conPrecio = new Set<string>(precios.map((pv: any) => pv.productoId));
  const sinPrecioAlguno = listaProductos.filter((p: any) => !conPrecio.has(p.id));

  console.log('');
  console.log('-'.repeat(78));
  console.log('2) PRENDAS SIN NINGUN PRECIO  (no se ofrecen en absoluto)');
  if (sinPrecioAlguno.length === 0) {
    console.log('   Ninguna.');
  } else {
    for (const p of sinPrecioAlguno) {
      console.log(`   item ${String(p.itemNumero).padStart(3)} ${String(p.descripcion).slice(0, 30).padEnd(30)} tela: ${p.telaId ? 'ok' : 'SIN TELA'}`);
    }
    console.log('\n   Puede ser correcto (prenda en preparacion o discontinuada) o un olvido.');
    console.log('   Mientras no tengan precio, no entran en ningun calculo.');
  }

  // ---------- 3. Ruido ----------
  let ruido = 0;
  for (const [clv, g] of pesoPor.entries()) {
    if (g > 0 && !precioPor.has(clv)) ruido++;
  }

  console.log('');
  console.log('-'.repeat(78));
  console.log('3) DATOS DE COSTEO EN COMBINACIONES QUE NO SE OFRECEN');
  console.log(`   ${ruido} combinaciones con peso cargado que no se venden.`);
  console.log('   Inofensivo para el costo, pero infla conteos y promedios.');

  // ---------- Tallas ofrecidas por prenda ----------
  const tallasPorProd = new Map<string, number>();
  for (const pv of precios) tallasPorProd.set(pv.productoId, (tallasPorProd.get(pv.productoId) || 0) + 1);

  console.log('');
  console.log('-'.repeat(78));
  console.log('TALLAS OFRECIDAS POR PRENDA');
  for (const p of listaProductos) {
    const n = tallasPorProd.get(p.id) || 0;
    console.log(`   item ${String(p.itemNumero).padStart(3)} ${String(p.descripcion).slice(0, 28).padEnd(28)} ${String(n).padStart(2)} tallas`);
  }

  console.log('');
  console.log(SEP);
  console.log(
    sinBase.length === 0
      ? 'Catalogo consistente: todo lo ofrecido se puede costear.'
      : `Atencion: ${sinBase.length} combinaciones se venden sin base de costeo.`
  );
  console.log(SEP);
}

main().catch((err) => {
  console.error('\nFallo la validacion:', err);
  process.exit(1);
});
