/**
 * Borra las prendas HUERFANAS: las que apuntan a un colegio que no existe.
 *
 * QUE ENCONTRO EL DIAGNOSTICO (29-jul, base con 2 colegios):
 *
 *   item 28  Camisa Formal   colegio_id = "all"
 *            arrastra 0 precios, 16 filas de inventario, 16 pesos, 0 receta
 *
 * Creada por POST /api/colegios/all/prendas, porque el dashboard armaba la URL con el
 * ambito actual y el ambito caia en 'all' por el literal 'CAMBRIDGE' roto del selector.
 * El agujero quedo tapado en eb7293d; esto limpia lo que ya entro.
 *
 * Y EXPLICA UN SEGUNDO SINTOMA. Internacional SM tiene su propia Camisa Formal, tambien
 * con itemNumero 28. O sea que hay DOS prendas con el item 28, y
 * resolverPrendaPorItem(28) sin colegioId encuentra las dos y devuelve 409 por ambiguo.
 * La matriz mandaba itemNumero sin colegio, la pantalla no miraba la respuesta y
 * re-renderizaba: de ahi que un precio tecleado "no se quedara fijo". El +1 en el conteo
 * y el precio que se borraba eran el MISMO defecto visto por dos lados.
 *
 * SEGURIDAD, porque esto borra filas de una base real:
 * - Dry-run por defecto. Solo escribe con --aplicar.
 * - Backup del .db con timestamp antes de tocar nada.
 * - SE NIEGA a borrar una prenda que tenga PRECIOS o RECETA, salvo con --forzar. Esas
 *   dos cosas son trabajo humano: si estan, la prenda probablemente no es un descarte
 *   sino una prenda real mal asignada, y lo que corresponde es reasignarle el colegio,
 *   no borrarla. El script dice como.
 * - Borra los hijos antes que el padre, en orden de dependencia.
 * - Todo en una transaccion, con ROLLBACK si algo falla.
 * - Verifica despues: que no queden huerfanas y que no queden hijos sin padre.
 *
 * Uso:
 *   pnpm tsx src/scripts/limpiarHuerfanas.ts             simula
 *   pnpm tsx src/scripts/limpiarHuerfanas.ts --aplicar   borra
 *   pnpm tsx src/scripts/limpiarHuerfanas.ts --aplicar --forzar   borra aunque tenga datos
 */

import fs from 'fs';
import path from 'path';
import { getDb, getRawDb, getDbFilePath, saveDbToDisk } from '../database/sqljs';

const SEP = '='.repeat(78);
const APLICAR = process.argv.includes('--aplicar');
const FORZAR = process.argv.includes('--forzar');

/** Las tablas que cuelgan de producto, en orden de borrado. */
const HIJAS = [
  'detalle_acc',
  'precio_venta',
  'precio_adquisicion',
  'peso_mat_prima',
  'mano_obra',
  'inventario_transaccion',
  'inventario',
  'historico_precio',
];

const esc = (s: string) => String(s).replace(/'/g, "''");

function filas(sql: string): any[][] {
  const res = getRawDb().exec(sql);
  return res.length ? res[0].values : [];
}

function uno(sql: string): any {
  const f = filas(sql);
  return f.length ? f[0][0] : null;
}

/** Cuenta filas de una tabla hija, tolerando que la tabla no exista. */
function contarHijas(tabla: string, productoId: string): number {
  try {
    return Number(uno(`SELECT COUNT(*) FROM ${tabla} WHERE producto_id = '${esc(productoId)}';`)) || 0;
  } catch {
    return 0; // la tabla no existe en este schema
  }
}

async function main() {
  console.log(SEP);
  console.log('  LIMPIAR PRENDAS HUERFANAS' + (APLICAR ? '  —  MODO APLICAR' : '  —  SIMULACION'));
  console.log(SEP);

  await getDb({ skipSeed: true });
  const dbPath = getDbFilePath();
  console.log(`Base: ${dbPath}`);
  if (!APLICAR) {
    console.log('Simulacion: no se escribe nada. Con --aplicar borra de verdad.');
  }

  const huerfanas = filas(`
    SELECT p.id, p.item_numero, p.descripcion, p.colegio_id
    FROM producto p
    LEFT JOIN colegio c ON c.id = p.colegio_id
    WHERE c.id IS NULL
    ORDER BY p.item_numero;
  `);

  if (huerfanas.length === 0) {
    console.log('');
    console.log('No hay prendas huerfanas. Nada que hacer.');
    return;
  }

  console.log('');
  console.log(`${huerfanas.length} prenda(s) huerfana(s):`);
  console.log('');

  const aBorrar: Array<{ id: string; item: any; desc: string; colId: any; hijas: Record<string, number>; tieneTrabajo: boolean }> = [];

  for (const [id, item, desc, colId] of huerfanas) {
    const hijas: Record<string, number> = {};
    for (const t of HIJAS) hijas[t] = contarHijas(t, String(id));

    // Precios y receta son trabajo humano: si estan, esto no parece un descarte.
    const tieneTrabajo = (hijas['precio_venta'] || 0) > 0 || (hijas['detalle_acc'] || 0) > 0;

    console.log(`  item ${String(item).padStart(3)}  ${String(desc)}`);
    console.log(`        colegio_id fantasma: ${JSON.stringify(colId)}`);
    console.log(`        producto.id: ${id}`);
    console.log(`        hijas: ${HIJAS.map((t) => `${t}=${hijas[t]}`).join(', ')}`);
    console.log(`        ${tieneTrabajo ? 'TIENE PRECIOS O RECETA' : 'sin precios ni receta: parece un descarte'}`);
    console.log('');

    aBorrar.push({ id: String(id), item, desc: String(desc), colId, hijas, tieneTrabajo });
  }

  const conTrabajo = aBorrar.filter((p) => p.tieneTrabajo);
  if (conTrabajo.length > 0 && !FORZAR) {
    console.log(SEP);
    console.log('  SE NIEGA A BORRAR');
    console.log(SEP);
    console.log(`  ${conTrabajo.length} de las huerfanas tienen PRECIOS o RECETA cargados. Eso es trabajo`);
    console.log('  humano, y su presencia sugiere que no son descartes sino prendas REALES mal');
    console.log('  asignadas. Borrarlas perderia ese trabajo.');
    console.log('');
    console.log('  Lo que corresponde en ese caso es REASIGNARLES el colegio, no borrarlas:');
    console.log('');
    for (const p of conTrabajo) {
      console.log(`    UPDATE producto SET colegio_id = '<id del colegio correcto>'`);
      console.log(`      WHERE id = '${p.id}';   -- item ${p.item} ${p.desc}`);
    }
    console.log('');
    console.log('  Los ids de colegio salen de: pnpm tsx src/scripts/diagnosticoColegios.ts');
    console.log('  Si igual son descartes, volve a correr esto con --forzar.');
    process.exit(1);
  }

  if (!APLICAR) {
    console.log(SEP);
    console.log('  QUE HARIA --aplicar');
    console.log(SEP);
    let totalHijas = 0;
    for (const p of aBorrar) {
      for (const t of HIJAS) totalHijas += p.hijas[t];
    }
    console.log(`  Borraria ${aBorrar.length} prenda(s) y ${totalHijas} fila(s) hija(s).`);
    console.log('  Nada se escribio. Para hacerlo: --aplicar');
    return;
  }

  // ------------------------------------------------------------- backup
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(path.dirname(dbPath), `sistema_inventario.antes-de-limpiar-${sello}.db`);
  fs.copyFileSync(dbPath, backup);
  console.log(SEP);
  console.log(`Backup: ${path.basename(backup)}`);

  const raw = getRawDb();
  let borradasHijas = 0;

  try {
    raw.run('BEGIN TRANSACTION;');

    for (const p of aBorrar) {
      // Hijas primero, padre despues: al reves quedarian filas apuntando a la nada.
      for (const t of HIJAS) {
        if (p.hijas[t] === 0) continue;
        raw.run(`DELETE FROM ${t} WHERE producto_id = '${esc(p.id)}';`);
        borradasHijas += p.hijas[t];
        console.log(`  ok  ${t}: ${p.hijas[t]} fila(s) de item ${p.item}`);
      }
      raw.run(`DELETE FROM producto WHERE id = '${esc(p.id)}';`);
      console.log(`  ok  producto item ${p.item} ${p.desc}`);
    }

    raw.run('COMMIT;');
  } catch (e) {
    raw.run('ROLLBACK;');
    console.log('');
    console.log('FALLO y se hizo ROLLBACK. La base quedo como estaba.');
    console.log(`Backup por si acaso: ${backup}`);
    console.error(e);
    process.exit(1);
  }

  // -------------------------------------------------------- verificacion
  const quedanHuerfanas = Number(uno(`
    SELECT COUNT(*) FROM producto p
    LEFT JOIN colegio c ON c.id = p.colegio_id
    WHERE c.id IS NULL;
  `)) || 0;

  let hijasSinPadre = 0;
  for (const t of HIJAS) {
    try {
      hijasSinPadre += Number(uno(`
        SELECT COUNT(*) FROM ${t} d
        LEFT JOIN producto p ON p.id = d.producto_id
        WHERE p.id IS NULL;
      `)) || 0;
    } catch { /* tabla inexistente */ }
  }

  const totalPrendas = Number(uno('SELECT COUNT(*) FROM producto;')) || 0;
  const sumaPorColegio = Number(uno(`
    SELECT COUNT(*) FROM producto p INNER JOIN colegio c ON c.id = p.colegio_id;
  `)) || 0;

  console.log('');
  console.log(SEP);
  console.log('  VERIFICACION');
  console.log(SEP);
  console.log(`  Prendas huerfanas restantes:        ${quedanHuerfanas}   (esperado 0)`);
  console.log(`  Filas hijas sin prenda:             ${hijasSinPadre}   (esperado 0)`);
  console.log(`  Total de prendas:                   ${totalPrendas}`);
  console.log(`  Suma por colegio:                   ${sumaPorColegio}`);
  console.log(`  Las dos cuentas cierran:            ${totalPrendas === sumaPorColegio ? 'SI' : 'NO'}`);
  console.log(`  Filas hijas borradas:               ${borradasHijas}`);

  if (quedanHuerfanas !== 0 || hijasSinPadre !== 0 || totalPrendas !== sumaPorColegio) {
    console.log('');
    console.log('  ALGO NO CIERRA. NO se guarda en disco. La base en memoria tiene los cambios');
    console.log(`  pero el archivo sigue como estaba. Backup: ${backup}`);
    process.exit(1);
  }

  saveDbToDisk();
  console.log('');
  console.log('  Todo cierra y se guardo en disco.');
  console.log(`  El backup ${path.basename(backup)} se puede borrar cuando lo verifiques en pantalla.`);
  console.log(SEP);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
