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
 * QUE REPORTA
 *  1. BLOQUEANTE: se ofrece pero no se puede costear. Se vende una prenda cuyo
 *     costo de material el sistema resuelve en 0. Es plata que se escapa.
 *  2. Prendas sin ningun precio: no se ofrecen en absoluto. Puede ser correcto
 *     (prenda en preparacion, discontinuada) o puede ser un olvido.
 *  3. Ruido: combinaciones con datos de costeo cargados que no se ofrecen.
 *     Inofensivo, pero infla los conteos y los promedios.
 */

import { getDb } from '../database/sqljs';

const SEPARADOR = '='.repeat(78);

async function main() {
  const db: any = await getDb();

  console.log('');
  console.log(SEPARADOR);
  console.log('  VALIDACION DE CATALOGO  —  la verdad la define precio_venta');
  console.log(SEPARADOR);

  // Se usa SQL crudo: son consultas de reporte con varios LEFT JOIN y queda
  // mucho mas legible que armarlas con el query builder.
  const sql = (q: string): any[] => {
    const res = (db as any).all
      ? (db as any).all(q)
      : (db as any).$client.exec(q);
    // sql.js devuelve [{columns, values}]
    if (Array.isArray(res) && res.length && res[0]?.values) {
      return res[0].values.map((fila: any[]) =>
        Object.fromEntries(res[0].columns.map((c: string, i: number) => [c, fila[i]]))
      );
    }
    return res as any[];
  };

  const [{ total }] = sql('select count(*) as total from peso_mat_prima');
  const [{ ofrecidas }] = sql('select count(*) as ofrecidas from precio_venta');

  console.log(`\nCombinaciones prenda x talla en la grilla: ${total}`);
  console.log(`Ofrecidas de verdad (con precio de venta):  ${ofrecidas}`);
  console.log(`No ofrecidas:                               ${total - ofrecidas}`);

  // ---------- 1. BLOQUEANTE ----------
  const sinBase = sql(`
    select p.item_numero as item, p.descripcion as prenda, t.codigo as talla,
           pv.precio_bs as precio, p.tela_id as tela
      from precio_venta pv
      join producto p on p.id = pv.producto_id
      join talla t on t.id = pv.talla_id
      left join peso_mat_prima m
             on m.producto_id = pv.producto_id and m.talla_id = pv.talla_id
     where coalesce(m.peso_gramos, 0) = 0
     order by p.item_numero, t.orden
  `);

  console.log('');
  console.log('-'.repeat(78));
  console.log('1) SE OFRECEN PERO NO SE PUEDEN COSTEAR');

  if (sinBase.length === 0) {
    console.log('   Ninguna. Todo lo que se vende tiene base de costeo.');
  } else {
    console.log('   Se venden con costo de material resuelto en 0.');
    console.log('   Nota: si la prenda se compra semiterminada esto es esperable,');
    console.log('   y lo que falta es cargar su precio de adquisicion.\n');
    console.log('   item | prenda                   | talla    | precio | tela');
    for (const r of sinBase) {
      console.log(
        `   ${String(r.item).padStart(4)} | ${String(r.prenda).slice(0, 24).padEnd(24)} | ` +
        `${String(r.talla).padEnd(8)} | ${String(r.precio).padStart(6)} | ${r.tela ? 'ok' : 'SIN TELA'}`
      );
    }
    // Agrupado por prenda, para ver si es una prenda entera o casos sueltos.
    const porPrenda = new Map<string, number>();
    for (const r of sinBase) {
      const k = `${r.item} ${r.prenda}`;
      porPrenda.set(k, (porPrenda.get(k) || 0) + 1);
    }
    console.log('\n   Resumen por prenda:');
    for (const [prenda, n] of [...porPrenda.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${prenda}: ${n} tallas`);
    }
    console.log(`\n   TOTAL: ${sinBase.length} combinaciones.`);
  }

  // ---------- 2. Prendas sin ningun precio ----------
  const sinPrecioAlguno = sql(`
    select p.item_numero as item, p.descripcion as prenda, p.tela_id as tela
      from producto p
     where not exists (select 1 from precio_venta pv where pv.producto_id = p.id)
     order by p.item_numero
  `);

  console.log('');
  console.log('-'.repeat(78));
  console.log('2) PRENDAS SIN NINGUN PRECIO  (no se ofrecen en absoluto)');
  if (sinPrecioAlguno.length === 0) {
    console.log('   Ninguna.');
  } else {
    for (const r of sinPrecioAlguno) {
      console.log(`   item ${String(r.item).padStart(3)} ${String(r.prenda).slice(0, 30).padEnd(30)} tela: ${r.tela ? 'ok' : 'SIN TELA'}`);
    }
    console.log('\n   Puede ser correcto (prenda en preparacion o discontinuada) o un olvido.');
    console.log('   Mientras no tengan precio, no entran en ningun calculo.');
  }

  // ---------- 3. Ruido ----------
  const [{ ruido }] = sql(`
    select count(*) as ruido
      from peso_mat_prima m
      left join precio_venta pv
             on pv.producto_id = m.producto_id and pv.talla_id = m.talla_id
     where pv.id is null and m.peso_gramos > 0
  `);

  console.log('');
  console.log('-'.repeat(78));
  console.log('3) DATOS DE COSTEO EN COMBINACIONES QUE NO SE OFRECEN');
  console.log(`   ${ruido} combinaciones con peso cargado que no se venden.`);
  console.log('   Inofensivo para el costo, pero infla conteos y promedios.');

  // ---------- Tallas ofrecidas por prenda ----------
  const porPrenda = sql(`
    select p.item_numero as item, p.descripcion as prenda, count(*) as tallas
      from precio_venta pv join producto p on p.id = pv.producto_id
     group by p.item_numero, p.descripcion
     order by p.item_numero
  `);

  console.log('');
  console.log('-'.repeat(78));
  console.log('TALLAS OFRECIDAS POR PRENDA');
  for (const r of porPrenda) {
    console.log(`   item ${String(r.item).padStart(3)} ${String(r.prenda).slice(0, 28).padEnd(28)} ${String(r.tallas).padStart(2)} tallas`);
  }

  console.log('');
  console.log(SEPARADOR);
  const bloqueantes = sinBase.length;
  console.log(
    bloqueantes === 0
      ? 'Catalogo consistente: todo lo ofrecido se puede costear.'
      : `Atencion: ${bloqueantes} combinaciones se venden sin base de costeo.`
  );
  console.log(SEPARADOR);
}

main().catch((err) => {
  console.error('\nFallo la validacion:', err);
  process.exit(1);
});
