/**
 * Renombra los codigos de talla de una cifra a la forma canonica de dos digitos.
 *
 *   2 -> 02      4 -> 04      6 -> 06      8 -> 08
 *
 * Los compuestos no se tocan: `10`, `16/34`, `36/XS`, `50/4XL` ya estan bien.
 *
 * POR QUE. El sistema POS del que se importan precios e inventario escribe
 * `Talla 04`. El sistema escribia `4`. Dos formas del mismo codigo no son una clave:
 * el emparejamiento del importador fallaba en 249 de 732 filas por ese cero.
 *
 * LO QUE ESTE SCRIPT NO PUEDE ROMPER, y conviene decirlo porque es lo que hace que el
 * cambio sea seguro: `precio_venta`, `peso_mat_prima`, `mano_obra` e `inventario`
 * apuntan a `talla_id`, no al codigo. Renombrar el codigo NO mueve ninguna relacion.
 * Lo que si depende del texto del codigo son las tres bandas de mano de obra, y por
 * eso este script no se puede correr solo: services/tallas.ts tiene que estar en su
 * lugar, comparando normalizado. Sin eso, la mano de obra de las tallas chicas se
 * agruparia con la de las grandes en silencio.
 *
 * DISCIPLINA, la misma de limpiarHuerfanas.ts y de la migracion de la Fase 5:
 *   - ENSAYO POR DEFECTO. Escribe solo con --aplicar.
 *   - Respaldo con timestamp antes de tocar nada.
 *   - Todo en una transaccion, con ROLLBACK si algo no cierra.
 *   - IDEMPOTENTE: correrlo dos veces no hace daño. `codigoTallaCanonico` sobre `02`
 *     devuelve `02`, asi que la segunda corrida no encuentra nada que cambiar.
 *   - Verificacion DESPUES que exige tres cosas, y si alguna falla no guarda.
 *
 * Uso:
 *   pnpm tsx src/scripts/renombrarTallas.ts             ensaya
 *   pnpm tsx src/scripts/renombrarTallas.ts --aplicar   escribe
 *   pnpm tsx src/scripts/renombrarTallas.ts --db ruta.db --aplicar
 */

import fs from 'fs';
import path from 'path';
import * as SqlJs from 'sql.js';
import { codigoTallaCanonico } from '../services/tallas';

const APLICAR = process.argv.includes('--aplicar');
const idxDb = process.argv.indexOf('--db');
const RUTA_DB = idxDb !== -1 && process.argv[idxDb + 1]
  ? path.resolve(process.argv[idxDb + 1])
  : path.resolve(process.cwd(), 'sistema_inventario.db');

interface Talla { id: string; codigo: string; nombre: string }

function log(...a: any[]) { console.log(...a); }

async function main() {
  if (!fs.existsSync(RUTA_DB)) {
    console.error(`No existe la base en ${RUTA_DB}`);
    process.exit(1);
  }

  // Mismo patron que src/database/sqljs.ts y test-sqljs.ts: el paquete expone la
  // fabrica en `default` y los tipos no la declaran callable.
  const initSqlJs: any = (SqlJs as any).default ?? SqlJs;
  const SQL: any = await initSqlJs({
    locateFile: (f: string) => path.resolve(process.cwd(), f),
  });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(RUTA_DB)));

  const filas = db.exec('SELECT id, codigo, nombre FROM talla ORDER BY orden')[0];
  if (!filas) {
    log('La tabla talla esta vacia. Nada que renombrar.');
    return;
  }

  const tallas: Talla[] = filas.values.map((v: any[]) => ({
    id: String(v[0]), codigo: String(v[1]), nombre: String(v[2] ?? ''),
  }));

  const cambios = tallas
    .map((t: Talla) => ({ ...t, nuevo: codigoTallaCanonico(t.codigo) }))
    .filter((t: Talla & { nuevo: string }) => t.nuevo !== t.codigo);

  log(`Base:  ${RUTA_DB}`);
  log(`Modo:  ${APLICAR ? 'APLICAR (escribe)' : 'ENSAYO (no escribe)'}`);
  log(`Tallas en la base: ${tallas.length}`);
  log('');

  if (cambios.length === 0) {
    log('Todos los codigos ya estan en la forma canonica. Nada que hacer.');
    log('(Es idempotente: si ya se corrio, esta es la salida esperada.)');
    return;
  }

  log('Renombres a aplicar:');
  for (const c of cambios) {
    const nombreNuevo = /^Talla\s+/i.test(c.nombre) ? `Talla ${c.nuevo}` : c.nombre;
    log(`   ${c.codigo.padEnd(6)} -> ${c.nuevo.padEnd(6)}   nombre: ${JSON.stringify(c.nombre)} -> ${JSON.stringify(nombreNuevo)}`);
  }
  log('');

  // GUARDA CONTRA COLISIONES, antes de escribir. Si un codigo canonico ya existiera
  // en otra fila, el renombre crearia dos tallas con el mismo codigo y el
  // emparejamiento por codigo pasaria a ser ambiguo — que es justamente el problema
  // que este cambio viene a eliminar.
  const codigosFinales = tallas.map((t: Talla) => codigoTallaCanonico(t.codigo));
  const duplicados = codigosFinales.filter((c: string, i: number) => codigosFinales.indexOf(c) !== i);
  if (duplicados.length > 0) {
    console.error(`ABORTA: el renombre produciria codigos duplicados: ${[...new Set(duplicados)].join(', ')}`);
    console.error('Hay que resolver esas tallas a mano antes de migrar.');
    process.exit(1);
  }
  log('Chequeo de colisiones: ninguna.');

  // Huella de las relaciones ANTES. Se compara despues: el renombre no debe mover ni
  // una fila hija. Si se movieran, el problema no seria el codigo sino algo que
  // empareja por texto donde deberia emparejar por id.
  const contar = (t: string) => {
    const r = db.exec(`SELECT COUNT(*) FROM ${t}`)[0];
    return r ? Number(r.values[0][0]) : 0;
  };
  const antes = {
    precios: contar('precio_venta'),
    pesos: contar('peso_mat_prima'),
    manoObra: contar('mano_obra'),
    inventario: contar('inventario'),
  };

  if (!APLICAR) {
    log('');
    log('ENSAYO terminado. No se escribio nada.');
    log('Para aplicar:  pnpm tsx src/scripts/renombrarTallas.ts --aplicar');
    return;
  }

  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const respaldo = RUTA_DB.replace(/\.db$/, '') + `.antes-de-renombrar-tallas-${sello}.db`;
  fs.copyFileSync(RUTA_DB, respaldo);
  log(`Respaldo: ${respaldo}`);

  db.run('BEGIN TRANSACTION');
  try {
    for (const c of cambios) {
      const nombreNuevo = /^Talla\s+/i.test(c.nombre) ? `Talla ${c.nuevo}` : c.nombre;
      db.run('UPDATE talla SET codigo = ?, nombre = ? WHERE id = ?', [c.nuevo, nombreNuevo, c.id]);
    }

    // VERIFICACION, y no guarda si alguna no cierra.
    const despues = {
      precios: contar('precio_venta'),
      pesos: contar('peso_mat_prima'),
      manoObra: contar('mano_obra'),
      inventario: contar('inventario'),
    };
    const problemas: string[] = [];

    for (const k of Object.keys(antes) as (keyof typeof antes)[]) {
      if (antes[k] !== despues[k]) problemas.push(`${k}: ${antes[k]} -> ${despues[k]}`);
    }

    const nTallas = contar('talla');
    if (nTallas !== tallas.length) problemas.push(`talla: ${tallas.length} -> ${nTallas}`);

    const dup = db.exec('SELECT codigo, COUNT(*) c FROM talla GROUP BY codigo HAVING c > 1')[0];
    if (dup) problemas.push(`codigos duplicados: ${dup.values.map((v: any[]) => v[0]).join(', ')}`);

    const sinCanon = db.exec("SELECT codigo FROM talla WHERE codigo GLOB '[0-9]' ")[0];
    if (sinCanon) problemas.push(`quedaron codigos de una cifra: ${sinCanon.values.map((v: any[]) => v[0]).join(', ')}`);

    // Huerfanas: ninguna hija debe apuntar a una talla inexistente.
    for (const t of ['precio_venta', 'peso_mat_prima', 'mano_obra', 'inventario']) {
      const h = db.exec(`SELECT COUNT(*) FROM ${t} x LEFT JOIN talla t ON t.id = x.talla_id WHERE t.id IS NULL`)[0];
      const n = h ? Number(h.values[0][0]) : 0;
      if (n > 0) problemas.push(`${t}: ${n} fila(s) sin talla`);
    }

    if (problemas.length > 0) {
      db.run('ROLLBACK');
      console.error('\nLA VERIFICACION NO CIERRA. No se guardo nada:');
      problemas.forEach((p: string) => console.error('   - ' + p));
      console.error(`\nLa base quedo como estaba. Respaldo en ${respaldo}`);
      process.exit(1);
    }

    db.run('COMMIT');
    fs.writeFileSync(RUTA_DB, Buffer.from(db.export()));

    log('');
    log('APLICADO. Verificacion:');
    log(`   tallas                 ${nTallas} (sin cambio)`);
    log(`   precio_venta           ${despues.precios} (sin cambio)`);
    log(`   peso_mat_prima         ${despues.pesos} (sin cambio)`);
    log(`   mano_obra              ${despues.manoObra} (sin cambio)`);
    log(`   inventario             ${despues.inventario} (sin cambio)`);
    log(`   codigos duplicados     0`);
    log(`   filas hijas huerfanas  0`);
    log('');
    log('Codigos resultantes:');
    const fin = db.exec('SELECT codigo FROM talla ORDER BY orden')[0];
    log('   ' + fin.values.map((v: any[]) => v[0]).join(', '));
  } catch (e) {
    db.run('ROLLBACK');
    console.error('Error, se hizo ROLLBACK:', e);
    console.error(`Respaldo en ${respaldo}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
