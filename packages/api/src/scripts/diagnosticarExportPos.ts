/**
 * DICE QUE VE EL IMPORTADOR EN UN EXPORT DEL POS, antes de importar nada.
 *
 * POR QUE EXISTE. El importador descartaba en silencio los colegios que no estaban tecleados en
 * `CATEGORIAS_POS`, y desde la pantalla eso se veia como "no leyó el archivo". Este script muestra
 * lo mismo que ve el importador, para que un archivo que no funciona se explique en una corrida en
 * vez de a fuerza de pruebas.
 *
 * NO ESCRIBE NADA. Solo lee el archivo y, si se le pide, compara contra la base.
 *
 * Uso:
 *   pnpm tsx src/scripts/diagnosticarExportPos.ts --excel "C:\\ruta\\al\\export.xlsx"
 *   pnpm tsx src/scripts/diagnosticarExportPos.ts --excel export.xlsx --db copia.db
 *
 * Sin `--db` no toca la base: solo dice que trae el archivo.
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import {
  parsearFilasPos,
  descubrirColegiosDelArchivo,
  tallaDeVariante,
  ubicarColumnas,
  categoriaDeColegio,
} from '../services/importarPos.service';
import { codigoTallaCanonico } from '../services/tallas';

const log = (...a: any[]) => console.log(...a);

function opcion(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : null;
}

async function main() {
  const ruta = opcion('excel');
  if (!ruta) {
    console.error('Falta --excel. Ejemplo:');
    console.error('  pnpm tsx src/scripts/diagnosticarExportPos.ts --excel "C:\\\\ruta\\\\export.xlsx"');
    process.exit(1);
  }
  if (!fs.existsSync(ruta)) {
    console.error(`No existe el archivo: ${ruta}`);
    process.exit(1);
  }

  const parse = (XLSX as any).default || XLSX;
  const wb = parse.readFile(ruta);
  const hoja = wb.SheetNames[0];
  const matriz: any[][] = parse.utils.sheet_to_json(wb.Sheets[hoja], { header: 1 });

  log(`\nArchivo: ${path.resolve(ruta)}`);
  log(`Hoja:    ${hoja}`);
  log(`Filas:   ${matriz.length - 1} (sin el encabezado)\n`);

  // ---- las columnas que el importador necesita, ubicadas POR NOMBRE
  const ubic = ubicarColumnas(matriz[0] || []);
  if (!ubic.ok) {
    log('⚠  EL IMPORTADOR NO PUEDE LEER ESTE ARCHIVO. Es la causa mas comun de que un export');
    log('   "no se lea": salio con otro juego de columnas.\n');
    for (const f of ubic.faltantes) log(`     falta la columna: ${f}`);
    for (const d of ubic.duplicadas) {
      log(`     la columna "${d.nombre}" aparece ${d.posiciones.length} veces ` +
          `(posiciones ${d.posiciones.join(', ')})`);
    }
    log(`\n   Columnas que SI trae el archivo:\n     ${ubic.encabezados.filter(Boolean).join(' | ')}\n`);
    process.exit(1);
  }
  log('✓  Estan las seis columnas que el importador necesita, y las ubico por nombre:');
  for (const [rol, idx] of Object.entries(ubic.indices)) {
    log(`     ${rol.padEnd(16)} columna ${idx + 1}  ("${ubic.encabezados[idx]}")`);
  }
  log('');

  const { filas, descartadasPorCategoria, detalleDescartes, avisos } = parsearFilasPos(matriz);
  log(`Filas utiles:                 ${filas.length}`);
  log(`Descartadas por categoria:    ${descartadasPorCategoria}  ${JSON.stringify(detalleDescartes)}`);
  for (const a of avisos) log(`   aviso: ${a}`);

  // ---- los colegios, descubiertos del archivo
  const descubiertos = descubrirColegiosDelArchivo(filas);
  log('\n=== COLEGIOS QUE TRAE EL ARCHIVO ===');
  log('CATEGORIA                      FILAS  SUFIJO      COBERTURA  ES COLEGIO');
  log('─'.repeat(78));
  for (const d of descubiertos) {
    log(
      '  ' + d.categoria.slice(0, 28).padEnd(30) +
      String(d.filas).padStart(5) + '  ' +
      (d.sufijo || '(ninguno)').padEnd(12) +
      (Math.round(d.cobertura * 100) + '%').padStart(9) + '  ' +
      (d.esColegio ? 'si' : 'no')
    );
    if (d.minoritarios.length) {
      log(`       ⚠  sufijos raros en esta categoria: ` +
          d.minoritarios.map((m) => `${m.sufijo} (${m.filas} fila/s)`).join(', '));
      log('          Casi siempre son un error de carga del POS. Conviene revisarlos.');
    }
  }
  const colegiosArchivo = descubiertos.filter((d) => d.esColegio);
  log(`\n  ${colegiosArchivo.length} colegio(s) en el archivo, ` +
      `${descubiertos.length - colegiosArchivo.length} categoria(s) que no son colegio.`);

  // ---- las tallas
  const codigos = new Map<string, number>();
  for (const f of filas) {
    const c = codigoTallaCanonico(tallaDeVariante(f.variante));
    if (c) codigos.set(c, (codigos.get(c) ?? 0) + 1);
  }
  log(`\n=== TALLAS QUE TRAE EL ARCHIVO (${codigos.size}) ===`);
  log('  ' + [...codigos.keys()].sort().join(', '));
  const sinVariante = filas.filter((f) => !tallaDeVariante(f.variante)).length;
  if (sinVariante) log(`  ${sinVariante} fila(s) sin variante: se les asigna la talla del medio.`);

  // ---- contra la base, si se pide
  const dbDada = opcion('db');
  if (!dbDada) {
    log('\n(Sin --db no se compara contra la base. Agregarlo para ver que colegios y tallas faltan.)\n');
    process.exit(0);
  }
  if (!fs.existsSync(dbDada)) {
    console.error(`\nNo existe la base: ${dbDada}`);
    process.exit(1);
  }
  process.env.SISTEMA_DB_PATH = path.resolve(dbDada);

  const { getDb } = await import('../database/sqljs');
  const { colegios, tallas } = await import('../database/schema');
  const db = await getDb();

  const cols = await db
    .select({ id: colegios.id, nombre: colegios.nombre, abreviatura: colegios.abreviatura })
    .from(colegios);
  const catalogo = cols.map((c: any) => ({
    id: String(c.id), nombre: String(c.nombre), abreviatura: c.abreviatura ?? null,
  }));

  log('\n=== CONTRA LA BASE ===');
  log(`Colegios en la base: ${cols.length}`);
  for (const c of cols) {
    log(`   ${String(c.nombre).padEnd(28)} abreviatura: ${c.abreviatura ?? '(sin cargar)'}`);
  }

  // Se usa `categoriaDeColegio`, que es EXACTAMENTE lo que hace el importador: abreviatura primero
  // y nombre como respaldo. Un diagnostico mas estricto que la cosa real manda a perseguir
  // problemas que no existen —con solo la abreviatura, Cambridge salia como "sin colegio" cuando el
  // importador lo resuelve igual por su nombre—.
  log('\nEMPAREJAMIENTO archivo -> base (la misma logica que usa el importador):');
  const cubiertas = new Map<string, { nombre: string; via: string }>();
  for (const c of catalogo) {
    const cat = categoriaDeColegio(c.id, catalogo, descubiertos);
    if (!cat) continue;
    const porAbrev = String(c.abreviatura ?? '').trim() !== '';
    cubiertas.set(cat, { nombre: c.nombre, via: porAbrev ? 'abreviatura' : 'nombre' });
  }

  const faltan: typeof colegiosArchivo = [];
  for (const d of colegiosArchivo) {
    const hit = cubiertas.get(d.categoria);
    if (hit) {
      log(`   ✓  ${d.categoria.padEnd(28)} -> ${hit.nombre}  (por ${hit.via})`);
      if (hit.via === 'nombre') {
        log(`         ⚠  sin abreviatura cargada. Anda por el nombre, pero cargarle ` +
            `${d.sufijo.toUpperCase()} lo hace exacto.`);
      }
    } else {
      faltan.push(d);
      log(`   ✗  ${d.categoria.padEnd(28)} -> SIN COLEGIO en el sistema`);
    }
  }

  if (faltan.length) {
    log(`\n⚠  ${faltan.length} colegio(s) del archivo no tienen colegio en la base.`);
    log('   El importador los ofrece crear desde la pantalla, con estas abreviaturas:\n');
    for (const f of faltan) {
      log(`     ${f.categoria.padEnd(28)} abreviatura sugerida: ${f.sufijo.toUpperCase()}  (${f.filas} filas)`);
    }
    log('\n   Si el colegio YA existe con otro nombre, cargarle esa abreviatura en');
    log('   Configuracion -> Perfil & Colegios alcanza: el emparejamiento es por abreviatura.');
  }

  const tallasBase = await db.select({ codigo: tallas.codigo }).from(tallas);
  const setBase = new Set(tallasBase.map((t: any) => codigoTallaCanonico(t.codigo)));
  const tallasFaltantes = [...codigos.keys()].filter((c) => !setBase.has(c));
  log(`\nTallas del archivo que NO estan en la base: ${tallasFaltantes.length}`);
  if (tallasFaltantes.length) {
    for (const t of tallasFaltantes.sort()) {
      const cuales = colegiosArchivo
        .filter((d) => filas.some((f) =>
          f.categoria === d.categoria && codigoTallaCanonico(tallaDeVariante(f.variante)) === t))
        .map((d) => d.categoria);
      log(`     ${t.padEnd(10)} usada por: ${cuales.join(', ') || '(ninguna categoria de colegio)'}`);
    }
    log('\n   Para crear una:  pnpm tsx src/scripts/altaTalla.ts --codigo XX --orden N --colegios "Nombre"');
  }
  log('');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFALLO el diagnostico:', e?.message || e);
  process.exit(1);
});
