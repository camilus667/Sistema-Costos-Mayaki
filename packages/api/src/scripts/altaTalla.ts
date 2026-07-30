/**
 * Da de alta una talla COMPARTIDA y la deja activa solo en los colegios indicados.
 *
 * POR QUE HACE FALTA. El POS trae `Talla 03` en ocho filas, y las ocho son de Saint
 * Jude. Esa talla no existe en el sistema. Crearla como compartida y activa en todos
 * los colegios agregaria una columna vacia a las matrices de Cambridge y de
 * Internacional SM: una talla que esos colegios no ofrecen, ocupando lugar en cada
 * grilla y en cada reporte.
 *
 * Con la tabla colegio_talla eso se puede evitar: la talla existe para el sistema y
 * queda ACTIVA solo donde se usa. Es el caso que motivo la tabla.
 *
 * EL ORDEN IMPORTA Y NO ES COSMETICO. `orden` es lo que determina la secuencia de
 * columnas de las matrices y tambien las tres bandas de mano de obra se leen en ese
 * orden. Una talla 03 insertada al final apareceria despues de 50/4XL, que para leer
 * una curva de tallas es un error de lectura. Este script la inserta en su lugar y
 * corre el resto, dentro de una transaccion.
 *
 * DISCIPLINA, la de siempre en este repo:
 *   - ENSAYO POR DEFECTO. Escribe solo con --aplicar.
 *   - Respaldo con timestamp antes de tocar nada.
 *   - Transaccion con ROLLBACK si la verificacion no cierra.
 *   - IDEMPOTENTE: si la talla ya existe no la duplica; solo ajusta su activacion.
 *
 * Uso:
 *   pnpm tsx src/scripts/altaTalla.ts --codigo 03 --orden 2 --colegios "Saint Jude"
 *   pnpm tsx src/scripts/altaTalla.ts --codigo 03 --orden 2 --colegios "Saint Jude" --aplicar
 *
 * Sin --colegios queda activa en todos, que es el comportamiento por defecto de una
 * talla nueva.
 */

import fs from 'fs';
import path from 'path';
import * as SqlJs from 'sql.js';
import { codigoTallaCanonico } from '../services/tallas';

const arg = (nombre: string): string | undefined => {
  const i = process.argv.indexOf('--' + nombre);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
};

const APLICAR = process.argv.includes('--aplicar');
const CODIGO = codigoTallaCanonico(arg('codigo') ?? '');
const ORDEN = arg('orden') != null ? Number(arg('orden')) : null;
const COLEGIOS = (arg('colegios') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const RUTA_DB = arg('db')
  ? path.resolve(arg('db')!)
  : path.resolve(process.cwd(), 'sistema_inventario.db');

const log = (...a: any[]) => console.log(...a);
const hex = () =>
  Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

async function main() {
  if (!CODIGO) {
    console.error('Falta --codigo. Ejemplo: --codigo 03');
    process.exit(1);
  }
  if (ORDEN == null || !Number.isFinite(ORDEN)) {
    console.error('Falta --orden. Es la posicion en la curva de tallas, no un detalle: ' +
                  'determina el orden de columnas de las matrices.');
    process.exit(1);
  }
  if (!fs.existsSync(RUTA_DB)) {
    console.error(`No existe la base en ${RUTA_DB}`);
    process.exit(1);
  }

  const initSqlJs: any = (SqlJs as any).default ?? SqlJs;
  const SQL: any = await initSqlJs({ locateFile: (f: string) => path.resolve(process.cwd(), f) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(RUTA_DB)));

  const q = (sql: string, p: any[] = []) => {
    const r = db.exec(sql, p)[0];
    return r ? r.values : [];
  };

  log(`Base:   ${RUTA_DB}`);
  log(`Modo:   ${APLICAR ? 'APLICAR (escribe)' : 'ENSAYO (no escribe)'}`);
  log(`Talla:  codigo ${CODIGO}, orden ${ORDEN}`);
  log('');

  // ---- resolver colegios pedidos ----
  interface Col { id: string; nombre: string }
  const todosColegios: Col[] = q('SELECT id, nombre FROM colegio').map((v: any[]) => ({
    id: String(v[0]), nombre: String(v[1]),
  }));

  const destino: Col[] = [];
  if (COLEGIOS.length === 0) {
    log('Sin --colegios: la talla queda activa en todos.');
  } else {
    for (const aguja of COLEGIOS) {
      const hits = todosColegios.filter((c: Col) =>
        c.nombre.toLowerCase().includes(aguja.toLowerCase()));
      if (hits.length === 0) {
        console.error(`ABORTA: ningun colegio contiene "${aguja}".`);
        console.error(`Colegios en el sistema: ${todosColegios.map((c: Col) => c.nombre).join(', ')}`);
        process.exit(1);
      }
      if (hits.length > 1) {
        // Elegir por el agente seria adivinar. Activar la talla en el colegio
        // equivocado la vuelve invisible donde se necesita y la agrega donde no.
        console.error(`ABORTA: "${aguja}" coincide con mas de un colegio: ` +
                      hits.map((h: Col) => h.nombre).join(', '));
        process.exit(1);
      }
      destino.push(hits[0]);
    }
    log(`Activa solo en: ${destino.map((d: Col) => d.nombre).join(', ')}`);
    const resto = todosColegios.filter((c: Col) => !destino.some((d: Col) => d.id === c.id));
    if (resto.length) log(`Apagada en:     ${resto.map((r: Col) => r.nombre).join(', ')}`);
  }
  log('');

  // ---- ¿ya existe? ----
  const existentes = q('SELECT id, codigo, orden FROM talla WHERE codigo = ?', [CODIGO]);
  const yaExiste = existentes.length > 0;
  const tallaId = yaExiste ? String(existentes[0][0]) : hex();

  if (yaExiste) {
    log(`La talla ${CODIGO} ya existe (orden ${existentes[0][2]}). No se duplica; solo se ajusta su activacion.`);
  } else {
    const desplazadas = q('SELECT COUNT(*) FROM talla WHERE orden >= ?', [ORDEN])[0][0];
    log(`Se creara la talla ${CODIGO} en la posicion ${ORDEN}, corriendo ${desplazadas} talla(s) posteriores.`);
  }

  const tallasAntes = Number(q('SELECT COUNT(*) FROM talla')[0][0]);
  const hijasAntes = {
    precios: Number(q('SELECT COUNT(*) FROM precio_venta')[0][0]),
    pesos: Number(q('SELECT COUNT(*) FROM peso_mat_prima')[0][0]),
    manoObra: Number(q('SELECT COUNT(*) FROM mano_obra')[0][0]),
    inventario: Number(q('SELECT COUNT(*) FROM inventario')[0][0]),
  };

  if (!APLICAR) {
    log('');
    log('Curva resultante (simulada):');
    const curva = q('SELECT codigo, orden FROM talla ORDER BY orden')
      .map((v: any[]) => ({ codigo: String(v[0]), orden: Number(v[1]) }));
    if (!yaExiste) {
      curva.forEach((c: { codigo: string; orden: number }) => { if (c.orden >= ORDEN) c.orden += 1; });
      curva.push({ codigo: CODIGO, orden: ORDEN });
    }
    curva.sort((a: { orden: number }, b: { orden: number }) => a.orden - b.orden);
    log('   ' + curva.map((c: { codigo: string }) => c.codigo).join(', '));
    log('');
    log('ENSAYO terminado. No se escribio nada.');
    log('Para aplicar, agregar --aplicar');
    return;
  }

  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const respaldo = RUTA_DB.replace(/\.db$/, '') + `.antes-de-alta-talla-${CODIGO}-${sello}.db`;
  fs.copyFileSync(RUTA_DB, respaldo);
  log(`Respaldo: ${respaldo}`);

  db.run('BEGIN TRANSACTION');
  try {
    if (!yaExiste) {
      // Corre las posteriores ANTES de insertar, para que el orden no colisione.
      db.run('UPDATE talla SET orden = orden + 1 WHERE orden >= ?', [ORDEN]);
      db.run(
        'INSERT INTO talla (id, colegio_id, codigo, nombre, orden, activo) VALUES (?, NULL, ?, ?, ?, 1)',
        [tallaId, CODIGO, `Talla ${CODIGO}`, ORDEN]
      );
    }

    // Activacion por colegio. Solo se escriben filas cuando hay una decision que
    // registrar: si la talla queda activa en todos, no hace falta ninguna fila.
    if (destino.length > 0) {
      for (const col of todosColegios) {
        const activa = destino.some((d: Col) => d.id === col.id);
        const ya = q('SELECT id FROM colegio_talla WHERE colegio_id = ? AND talla_id = ?',
                     [col.id, tallaId]);
        if (ya.length > 0) {
          db.run('UPDATE colegio_talla SET activo = ? WHERE id = ?', [activa ? 1 : 0, String(ya[0][0])]);
        } else {
          db.run('INSERT INTO colegio_talla (id, colegio_id, talla_id, activo, orden) VALUES (?, ?, ?, ?, NULL)',
                 [hex(), col.id, tallaId, activa ? 1 : 0]);
        }
      }
    }

    // ---- verificacion ----
    const problemas: string[] = [];
    const tallasDespues = Number(q('SELECT COUNT(*) FROM talla')[0][0]);
    if (tallasDespues !== tallasAntes + (yaExiste ? 0 : 1)) {
      problemas.push(`talla: ${tallasAntes} -> ${tallasDespues}, esperaba ${tallasAntes + (yaExiste ? 0 : 1)}`);
    }
    for (const [k, v] of Object.entries(hijasAntes)) {
      const t = { precios: 'precio_venta', pesos: 'peso_mat_prima', manoObra: 'mano_obra', inventario: 'inventario' }[k]!;
      const n = Number(q(`SELECT COUNT(*) FROM ${t}`)[0][0]);
      if (n !== v) problemas.push(`${t}: ${v} -> ${n} (una talla nueva no debe crear filas hijas)`);
    }
    const dupCod = q('SELECT codigo FROM talla GROUP BY codigo HAVING COUNT(*) > 1');
    if (dupCod.length) problemas.push(`codigos duplicados: ${dupCod.map((v: any[]) => v[0]).join(', ')}`);
    const dupOrden = q('SELECT orden FROM talla GROUP BY orden HAVING COUNT(*) > 1');
    if (dupOrden.length) problemas.push(`ordenes duplicados: ${dupOrden.map((v: any[]) => v[0]).join(', ')}`);
    const dupPar = q('SELECT colegio_id, talla_id FROM colegio_talla GROUP BY colegio_id, talla_id HAVING COUNT(*) > 1');
    if (dupPar.length) problemas.push(`${dupPar.length} par(es) colegio-talla duplicados`);

    if (problemas.length) {
      db.run('ROLLBACK');
      console.error('\nLA VERIFICACION NO CIERRA. No se guardo nada:');
      problemas.forEach((p: string) => console.error('   - ' + p));
      console.error(`\nRespaldo en ${respaldo}`);
      process.exit(1);
    }

    db.run('COMMIT');
    fs.writeFileSync(RUTA_DB, Buffer.from(db.export()));

    log('');
    log('APLICADO.');
    log(`   tallas                ${tallasAntes} -> ${tallasDespues}`);
    log(`   filas hijas creadas   0 (correcto: una talla nueva no crea peso ni stock)`);
    log(`   codigos duplicados    0`);
    log(`   ordenes duplicados    0`);
    log('');
    log('Curva resultante:');
    log('   ' + q('SELECT codigo FROM talla ORDER BY orden').map((v: any[]) => v[0]).join(', '));
    log('');
    log('Activacion por colegio:');
    for (const col of todosColegios) {
      const r = q('SELECT activo FROM colegio_talla WHERE colegio_id = ? AND talla_id = ?', [col.id, tallaId]);
      const estado = r.length === 0 ? 'activa (sin fila)' : (Number(r[0][0]) ? 'activa' : 'APAGADA');
      log(`   ${col.nombre.padEnd(22)} ${estado}`);
    }
  } catch (e) {
    db.run('ROLLBACK');
    console.error('Error, se hizo ROLLBACK:', e);
    console.error(`Respaldo en ${respaldo}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
