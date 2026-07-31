/**
 * Mide como resolveria el importador un export del POS, SIN ESCRIBIR NADA.
 *
 * Para que sirve: antes de importar, saber cuantas filas van a resolver solas, cuantas
 * exigen revision y por que. Es el mismo servicio que usa el endpoint de vista previa,
 * asi que lo que dice aca es lo que va a mostrar la pantalla.
 *
 * NO TOCA LA BASE: solo lee. Se puede correr con el servidor arriba o abajo.
 *
 * Uso:
 *   pnpm tsx src/scripts/medirImportacionPos.ts --archivo "ruta/al/export.xlsx"
 *   pnpm tsx src/scripts/medirImportacionPos.ts --archivo "..." --detalle
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import * as SqlJs from 'sql.js';
import {
  parsearFilasPos,
  resolverFilas,
  discrepanciasDeSufijo,
  CONFIANZA_MINIMA,
} from '../services/importarPos.service';

const opcion = (n: string): string | undefined => {
  const i = process.argv.indexOf('--' + n);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
};

const ARCHIVO = opcion('archivo');
const DETALLE = process.argv.includes('--detalle');
const RUTA_DB = opcion('db')
  ? path.resolve(opcion('db')!)
  : path.resolve(process.cwd(), 'sistema_inventario.db');

function exigirArchivo(ruta: string | undefined): string {
  // DOS CAUSAS DISTINTAS, DOS MENSAJES DISTINTOS. La primera version usaba
  // `if (!rutaArchivo || !fs.existsSync(ARCHIVO))` con un solo texto que decia "Falta
  // --archivo", asi que cuando la ruta estaba pero el archivo no, el error mandaba a
  // revisar el flag —que estaba bien— en vez de la ruta. El usuario perdio dos intentos
  // buscando el problema donde no estaba.
  if (!ruta) {
    console.error('Falta --archivo con la ruta del export del POS (.xlsx). Por ejemplo:');
    console.error('  pnpm tsx SCRIPT --archivo "C:\\Users\\Win10\\Downloads\\products_v2_export.xlsx"');
    process.exit(1);
  }
  const abs = path.resolve(ruta);
  if (!fs.existsSync(abs)) {
    console.error(`El flag --archivo llego bien, pero NO EXISTE ese archivo:`);
    console.error(`  se busco en: ${abs}`);
    console.error('');
    console.error('Revisar la ruta. En PowerShell, para encontrarlo:');
    console.error('  Get-ChildItem -Path $HOME -Recurse -Filter "*export*.xlsx" -ErrorAction SilentlyContinue | Select-Object FullName');
    process.exit(1);
  }
  return abs;
}

async function medir() {
  const rutaArchivo = exigirArchivo(ARCHIVO);
  if (!fs.existsSync(RUTA_DB)) {
    console.error(`No existe la base en ${RUTA_DB}`);
    process.exit(1);
  }

  const wb = XLSX.readFile(rutaArchivo);
  const hoja = wb.SheetNames[0];
  const matriz = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[hoja], {
    header: 1, raw: false, defval: '',
  });

  const p = parsearFilasPos(matriz);
  console.log(`\nArchivo: ${path.basename(rutaArchivo)}   hoja "${hoja}"`);
  console.log(`  filas de datos      ${matriz.length - 1}`);
  console.log(`  descartadas         ${p.descartadasPorCategoria}   ${JSON.stringify(p.detalleDescartes)}`);
  console.log(`  relevantes          ${p.filas.length}`);
  if (p.avisos.length) {
    console.log('  AVISOS DE ENCABEZADO:');
    p.avisos.forEach((a) => console.log('     ' + a));
  }
  const disc = discrepanciasDeSufijo(p.filas);
  console.log(`  sufijo vs categoria ${disc.length === 0
    ? `coinciden las ${p.filas.length}`
    : `${disc.length} DISCREPANCIAS, revisar antes de importar`}`);
  if (disc.length && DETALLE) {
    disc.slice(0, 10).forEach((d) =>
      console.log(`     fila ${d.fila}: ${d.categoria} con codigo ${d.codigo}, esperaba ${d.sufijoEsperado}`));
  }

  // ---- catalogos, solo lectura ----
  const initSqlJs: any = (SqlJs as any).default ?? SqlJs;
  const SQL: any = await initSqlJs({ locateFile: (f: string) => path.resolve(process.cwd(), f) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(RUTA_DB)));
  const q = (sql: string) => { const r = db.exec(sql)[0]; return r ? r.values : []; };

  const colegios = q('SELECT id, nombre FROM colegio')
    .map((v: any[]) => ({ id: String(v[0]), nombre: String(v[1]) }));
  const productos = q('SELECT id, descripcion, colegio_id FROM producto')
    .map((v: any[]) => ({ id: String(v[0]), descripcion: String(v[1]), colegioId: String(v[2]) }));

  for (const col of colegios) {
    // Tallas ACTIVAS de este colegio: el flag global mas la configuracion por colegio,
    // con la regla de que sin fila la talla esta activa.
    const tallasActivas = q(`
      SELECT t.id, t.codigo FROM talla t
      LEFT JOIN colegio_talla ct ON ct.talla_id = t.id AND ct.colegio_id = '${col.id}'
      WHERE t.activo = 1 AND (ct.id IS NULL OR ct.activo = 1)
      ORDER BY t.orden
    `).map((v: any[]) => ({ id: String(v[0]), codigo: String(v[1]) }));

    const r = resolverFilas({ filas: p.filas, colegioId: col.id, colegios, tallasActivas, productos });
    const s = r.resumen;
    const propias = s.total - s.otroColegio;

    console.log(`\n=== ${col.nombre}   categoria "${r.categoriaEsperada ?? 'NINGUNA'}" ===`);
    console.log(`  prendas en el sistema  ${productos.filter((x: { colegioId: string }) => x.colegioId === col.id).length}`);
    console.log(`  tallas activas         ${tallasActivas.length}`);
    console.log(`  filas de su categoria  ${propias}`);
    if (propias === 0) { if (r.avisos.length) r.avisos.forEach((a) => console.log('     ' + a)); continue; }
    const pct = (n: number) => `${n}  (${((n / propias) * 100).toFixed(0)}%)`;
    console.log(`     resuelven solas     ${pct(s.ok)}`);
    console.log(`     exigen revision     ${pct(s.revisar)}`);
    console.log(`     sin producto        ${pct(s.sinProducto)}`);
    console.log(`     sin talla           ${pct(s.sinTalla)}`);
    console.log(`     sin precio          ${pct(s.sinPrecio)}`);
    r.avisos.forEach((a) => console.log('     AVISO: ' + a));

    const sinVariante = r.resueltas.filter((x: { tallaAsignadaPorDefecto?: boolean }) => x.tallaAsignadaPorDefecto).length;
    if (sinVariante) console.log(`     sin variante, a la talla 14: ${sinVariante}`);

    // Una linea por PRENDA distinta que exige atencion, no por fila: dieciseis filas de
    // la misma prenda son un solo problema.
    const atencion = [...new Map(
      r.resueltas
        .filter((x) => x.estado === 'revisar' || x.estado === 'sin-producto' || x.estado === 'sin-talla')
        .map((x) => [x.origen.nombreProducto + '|' + x.estado, x])
    ).values()];
    if (atencion.length) {
      console.log(`  prendas que exigen atencion (${atencion.length}):`);
      for (const a of atencion.slice(0, DETALLE ? 100 : 15)) {
        const destino = a.productoDescripcion ?? '(ninguna)';
        console.log(`     ${a.origen.nombreProducto.slice(0, 28).padEnd(28)} -> ${destino.slice(0, 24).padEnd(24)} ` +
                    `${(a.confianza * 100).toFixed(0).padStart(3)}%  ${a.estado}`);
      }
      if (!DETALLE && atencion.length > 15) console.log(`     ... y ${atencion.length - 15} mas. Usar --detalle para verlas.`);
    }
  }

  console.log(`\nUmbral de confianza: ${(CONFIANZA_MINIMA * 100).toFixed(0)}%. Por debajo, la fila exige revision manual.`);
  console.log('No se escribio nada en la base.\n');
}

medir().catch((e) => { console.error(e); process.exit(1); });
