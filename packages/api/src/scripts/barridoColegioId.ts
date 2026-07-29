/**
 * Barrido del modelo de la Fase 5: que tablas llevan colegio y que tablas no.
 *
 * POR QUE EXISTE. La Fase 5 volvio compartidas cinco tablas (tela, talla,
 * accesorio, costo_indirecto, per_soles). Ese cambio tiene DOS consecuencias en el
 * codigo, y las dos se me escaparon repetidas veces, de a un archivo:
 *
 *   A) FILTRAR. Un `where(eq(tabla.colegioId, X))` sobre una tabla compartida
 *      esconde todas las filas con colegio_id NULL. Aparecio en inputs.ts,
 *      tela.ts y colegio.ts (tres consultas). El caso de colegio.ts devolvia CERO
 *      tallas de 16 y dejaba la pantalla de Configuracion vacia, y una de las tres
 *      creaba prendas sin ninguna talla.
 *
 *   B) CREAR. Un `colegioId: z.string().min(1)` en el schema de creacion obliga a
 *      asignar colegio a cada fila nueva, y una fila con colegio queda FUERA del
 *      catalogo compartido: solo la ve ese colegio. Aparecio en talla.ts,
 *      accesorio.ts y como default falso ('default-colegio') en tela.ts.
 *
 * La primera version de este barrido solo miraba A. Encontro las tres de colegio.ts
 * y me dio confianza para decir que estaba limpio, mientras accesorio.ts tenia B sin
 * corregir. Un barrido que cubre una cara del problema y se reporta como completo es
 * el mismo error que venia cometiendo, ahora automatizado.
 *
 * SALVAGUARDA CONTRA MI PROPIO ERROR MAS REPETIDO. Todo archivo de rutas tiene que
 * estar en TABLA_PRINCIPAL. Si aparece uno que no esta, el barrido FALLA en vez de
 * ignorarlo. La razon: seis veces en este refactor hice una busqueda rigurosa sobre
 * un universo incompleto y la trate como exhaustiva. Un barrido que ignora en
 * silencio lo que no conoce reproduce exactamente eso.
 *
 * Uso:  pnpm tsx src/scripts/barridoColegioId.ts
 * Sale con codigo 1 si encuentra algo, asi que sirve de compuerta.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..');
const SEP = '='.repeat(78);

/** Tablas que la Fase 5 volvio de la EMPRESA. NULL = compartido. */
const COMPARTIDAS = ['telas', 'tallas', 'accesorios', 'costosIndirectos', 'perSoles'];

/** Tablas que SI llevan colegio, y donde exigirlo es correcto. */
const DEL_COLEGIO = ['productos', 'aniosEscolares', 'usuarioColegios'];

/**
 * Tabla principal de cada archivo de rutas, para saber si su schema de creacion
 * debe exigir colegio o no. Si falta un archivo, el barrido falla a proposito.
 */
const TABLA_PRINCIPAL: Record<string, string> = {
  'accesorio.ts': 'accesorios',
  'calculo.ts': 'productos',
  'colegio.ts': 'colegios',
  'costeo.ts': 'productos',
  'detalleAccesorio.ts': 'detalleAccesorio',
  'export.ts': 'varias',
  'inputs.ts': 'varias',
  'inventario.ts': 'inventario',
  'precio.ts': 'preciosVenta',
  'producto.ts': 'productos',
  'talla.ts': 'tallas',
  'tela.ts': 'telas',
  'usuario.ts': 'usuarios',
};

type Hallazgo = { archivo: string; linea: number; tipo: 'A' | 'B'; detalle: string; txt: string };
const hallazgos: Hallazgo[] = [];

function archivosDe(dir: string, ext: RegExp): string[] {
  const salida: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules/.test(p)) salida.push(...archivosDe(p, ext));
    } else if (ext.test(e.name)) {
      salida.push(p);
    }
  }
  return salida;
}

function main() {
  console.log(SEP);
  console.log('  BARRIDO DEL MODELO DE COLEGIO  —  filtrar y crear');
  console.log(SEP);

  // ---------------------------------------------------------------- corpus
  const dirRutas = path.join(SRC, 'routes');
  const rutas = fs.readdirSync(dirRutas).filter((f) => f.endsWith('.ts'));
  const sinClasificar = rutas.filter((f) => !(f in TABLA_PRINCIPAL));

  console.log(`Archivos de rutas: ${rutas.length}`);
  if (sinClasificar.length > 0) {
    console.log('');
    console.log('FALLA EL BARRIDO, y es a proposito:');
    console.log(`  hay ${sinClasificar.length} archivo(s) de rutas sin clasificar en TABLA_PRINCIPAL:`);
    for (const f of sinClasificar) console.log(`    ${f}`);
    console.log('');
    console.log('  Agregalos al mapa indicando su tabla principal. Un barrido que ignora');
    console.log('  en silencio lo que no conoce no sirve como verificacion.');
    process.exit(1);
  }
  console.log('Todos clasificados en TABLA_PRINCIPAL.');

  // ------------------------------------------- A) filtros sobre compartidas
  const todos = archivosDe(SRC, /\.(ts|html)$/);
  let comparaciones = 0;

  for (const p of todos) {
    const rel = path.relative(SRC, p);
    const lineas = fs.readFileSync(p, 'utf8').split('\n');
    lineas.forEach((l, i) => {
      for (const t of COMPARTIDAS) {
        if (!new RegExp(`eq\\(${t}\\.colegioId`).test(l)) continue;
        comparaciones++;
        if (!/isNull/.test(l)) {
          hallazgos.push({
            archivo: rel,
            linea: i + 1,
            tipo: 'A',
            detalle: `filtra ${t} por colegio sin incluir las compartidas (falta isNull)`,
            txt: l.trim().slice(0, 120),
          });
        }
      }
    });
  }

  // ------------------------------------------ B) creacion que exige colegio
  for (const archivo of rutas) {
    const tabla = TABLA_PRINCIPAL[archivo];
    if (!COMPARTIDAS.includes(tabla)) continue; // exigir colegio es correcto o no aplica

    const lineas = fs.readFileSync(path.join(dirRutas, archivo), 'utf8').split('\n');
    lineas.forEach((l, i) => {
      if (!/colegioId\s*:\s*z\./.test(l)) return;
      const laxo = /nullable\(\)/.test(l) || /optional\(\)/.test(l);
      if (!laxo) {
        hallazgos.push({
          archivo: `routes/${archivo}`,
          linea: i + 1,
          tipo: 'B',
          detalle: `exige colegio al crear ${tabla}, que es tabla de la empresa`,
          txt: l.trim().slice(0, 120),
        });
      }
    });

    // Defaults falsos: un literal en vez de NULL deja la fila invisible para todos.
    lineas.forEach((l, i) => {
      const m = l.match(/colegioId\s*:\s*[^,;]*\|\|\s*'([^']+)'/);
      if (m) {
        hallazgos.push({
          archivo: `routes/${archivo}`,
          linea: i + 1,
          tipo: 'B',
          detalle: `default '${m[1]}' en vez de NULL: la fila no la ve nadie y viola la foreign key`,
          txt: l.trim().slice(0, 120),
        });
      }
    });
  }

  // ---------------------------------------------------------------- reporte
  console.log('');
  console.log(SEP);
  console.log('  RESULTADO');
  console.log(SEP);
  console.log(`  Comparaciones de colegioId sobre tablas compartidas: ${comparaciones}`);
  console.log(`  Tablas de la empresa: ${COMPARTIDAS.join(', ')}`);
  console.log(`  Tablas del colegio:   ${DEL_COLEGIO.join(', ')}`);
  console.log('');

  if (hallazgos.length === 0) {
    console.log('  Sin hallazgos. Los filtros incluyen las compartidas y ningun schema de');
    console.log('  creacion exige colegio sobre una tabla de la empresa.');
    console.log(SEP);
    return;
  }

  for (const h of hallazgos) {
    console.log(`  [${h.tipo}]  ${h.archivo}:${h.linea}`);
    console.log(`        ${h.detalle}`);
    console.log(`        ${h.txt}`);
    console.log('');
  }
  console.log(`  ${hallazgos.length} hallazgo(s): ` +
    `${hallazgos.filter((h) => h.tipo === 'A').length} de filtrado, ` +
    `${hallazgos.filter((h) => h.tipo === 'B').length} de creacion.`);
  console.log(SEP);
  process.exit(1);
}

main();
