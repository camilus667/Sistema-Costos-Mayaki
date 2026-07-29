/**
 * FASE 5 — analisis previo al catalogo compartido entre colegios. SOLO LEE.
 *
 * El diagnostico original del refactor fue contraintuitivo: el schema ya era
 * multi-colegio, y el problema era el OPUESTO. Esta demasiado scopeado por
 * colegio. Nueve tablas llevan `colegio_id` y solo cuatro deberian:
 *
 *   correcto:        usuario_colegio, anio_escolar, producto, auditoria
 *   sobre-scopeado:  talla, tela, accesorio, costo_indirecto, per_soles
 *
 * Por que importa. El precio de una tela pique y el tipo de cambio son hechos de
 * la EMPRESA, no de cada colegio. Con el scoping actual, agregar un colegio
 * obliga a duplicar todo el catalogo, y entonces:
 *   - sube el proveedor el precio de la tela y hay que editarlo N veces
 *   - los costos de dos colegios que usan la misma tela divergen por error de
 *     captura, no por realidad
 *   - clonar una prenda exige remapear UUIDs de talla, porque la talla 12 tiene
 *     un id distinto en cada colegio
 *   - dar de alta un colegio obliga a recrear la lista de tallas a mano
 *
 * Nota sobre `talla`: como `precio_venta` ya es la fuente de verdad de que tallas
 * se ofrecen (decidido el 29-jul-2026), la tabla no necesita scoping por colegio.
 * Es un vocabulario de codigos de industria, nada mas.
 *
 * Este script NO decide ni escribe. Propone una clasificacion de cada accesorio y
 * cada tela en COMPARTIDO o DEL COLEGIO, para que el usuario la corrija. La
 * heuristica mira el nombre, y un nombre no alcanza: "Etiqueta de Marca" puede
 * ser la marca de MAYAKI (compartida) o la del colegio (especifica), y solo el
 * usuario lo sabe.
 *
 * USO
 *   npx tsx src/scripts/analizarCatalogoCompartido.ts
 *   npx tsx src/scripts/analizarCatalogoCompartido.ts --csv catalogo.csv
 */

import fs from 'fs';
import { asc, eq } from 'drizzle-orm';
import { getDb } from '../database/sqljs';
import {
  colegios,
  tallas,
  telas,
  accesorios,
  detalleAccesorio,
  productos,
  costosIndirectos,
  perSoles,
} from '../database/schema';

const argv = process.argv.slice(2);
const CSV = argv.includes('--csv') ? argv[argv.indexOf('--csv') + 1] : undefined;
const SEP = '='.repeat(78);

/**
 * Palabras que sugieren que el insumo es especifico del colegio. Es una
 * PROPUESTA: el escudo y la insignia son claramente del colegio, pero el resto
 * necesita confirmacion humana.
 */
const SENALES_DEL_COLEGIO = [
  'escudo', 'insignia', 'emblema', 'logo', 'bordado',
  'cambridge', 'colegio', 'institucional',
];

function clasificar(nombre: string): { clase: 'DEL COLEGIO' | 'COMPARTIDO'; motivo: string } {
  const n = String(nombre || '').toLowerCase();
  const senal = SENALES_DEL_COLEGIO.find((s) => n.includes(s));
  if (senal) {
    return { clase: 'DEL COLEGIO', motivo: `el nombre dice "${senal}"` };
  }
  return { clase: 'COMPARTIDO', motivo: 'insumo generico por el nombre' };
}

async function main() {
  console.log(SEP);
  console.log('  CATALOGO COMPARTIDO — analisis previo a la Fase 5. SOLO LEE.');
  console.log(SEP);

  const db = await getDb({ skipSeed: true });

  const listaColegios = await db.select().from(colegios);
  const listaTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));
  const listaTelas = await db.select().from(telas).orderBy(asc(telas.orden));
  const listaAcc = await db.select().from(accesorios).orderBy(asc(accesorios.descripcion));
  const listaProd = await db.select().from(productos);
  const listaDet = await db.select().from(detalleAccesorio);
  let listaCI: any[] = [];
  let listaPS: any[] = [];
  try { listaCI = await db.select().from(costosIndirectos); } catch (e) {}
  try { listaPS = await db.select().from(perSoles); } catch (e) {}

  console.log('');
  console.log(`Colegios: ${listaColegios.length}  ${listaColegios.map((c: any) => c.nombre).join(', ')}`);
  console.log(
    `Catalogo: ${listaAcc.length} accesorios, ${listaTelas.length} telas, ` +
    `${listaTallas.length} tallas, ${listaCI.length} costos indirectos, ` +
    `${listaPS.length} tipos de cambio.`
  );

  // ---------- Cuanto costaria agregar un colegio HOY ----------
  const aDuplicar = listaAcc.length + listaTelas.length + listaTallas.length + listaPS.length;
  console.log('');
  console.log(SEP);
  console.log('  COSTO DE AGREGAR UN SEGUNDO COLEGIO CON EL SCHEMA ACTUAL');
  console.log(SEP);
  console.log(`  Habria que duplicar ${aDuplicar} filas:`);
  console.log(`    ${listaAcc.length} accesorios`);
  console.log(`    ${listaTelas.length} telas`);
  console.log(`    ${listaTallas.length} tallas`);
  console.log(`    ${listaPS.length} tipos de cambio`);
  console.log('');
  console.log('  Y a partir de ahi, cada cambio de precio de un insumo compartido hay que');
  console.log('  hacerlo en 2 lugares. Con 8 colegios, en 8. Los costos divergen por error');
  console.log('  de captura, no por realidad.');
  console.log('');
  console.log(`  Los ${listaCI.length} costos indirectos NO se duplicarian: ya se decidio que el`);
  console.log('  pool es a nivel empresa. Pero la columna colegio_id sigue ahi, y hoy los');
  console.log('  costos se suman SIN filtrar, asi que un segundo colegio le cargaria sus');
  console.log('  gastos a las prendas del primero.');

  // ---------- Accesorios ----------
  const usoPorAcc = new Map<string, number>();
  for (const d of listaDet) {
    usoPorAcc.set(d.accesorioId, (usoPorAcc.get(d.accesorioId) || 0) + 1);
  }

  console.log('');
  console.log(SEP);
  console.log('  ACCESORIOS — clasificacion PROPUESTA, a confirmar');
  console.log(SEP);
  console.log('  clase        prendas  costo ud  descripcion');

  const filasCsv: string[] = ['tipo,clase,descripcion,prendasQueLoUsan,costoUnitario,motivo'];
  let accCompartidos = 0;
  let accDelColegio = 0;

  for (const a of listaAcc) {
    const { clase, motivo } = clasificar(a.descripcion);
    if (clase === 'COMPARTIDO') accCompartidos++; else accDelColegio++;
    const usos = usoPorAcc.get(a.id) || 0;
    console.log(
      `  ${clase.padEnd(12)} ${String(usos).padStart(7)}  ${Number(a.costoUnitario || 0).toFixed(4).padStart(8)}  ${a.descripcion}`
    );
    filasCsv.push(
      `accesorio,${clase},"${String(a.descripcion).replace(/"/g, '""')}",${usos},${a.costoUnitario || 0},"${motivo}"`
    );
  }
  console.log('');
  console.log(`  ${accCompartidos} compartidos, ${accDelColegio} del colegio.`);
  const sinUso = listaAcc.filter((a: any) => !usoPorAcc.has(a.id));
  if (sinUso.length > 0) {
    console.log('');
    console.log(`  ATENCION: ${sinUso.length} accesorios no los usa ninguna prenda:`);
    sinUso.forEach((a: any) => console.log(`    - ${a.descripcion}`));
    console.log('  Pueden ser insumos cargados y nunca asignados, o restos del catalogo.');
  }

  // ---------- Telas ----------
  const usoPorTela = new Map<string, string[]>();
  for (const p of listaProd) {
    if (!p.telaId) continue;
    const arr = usoPorTela.get(p.telaId) || [];
    arr.push(String(p.descripcion));
    usoPorTela.set(p.telaId, arr);
  }

  console.log('');
  console.log(SEP);
  console.log('  TELAS — clasificacion PROPUESTA, a confirmar');
  console.log(SEP);
  console.log('  clase        prendas  Bs/g      descripcion');

  for (const t of listaTelas) {
    const { clase, motivo } = clasificar(t.descripcion);
    const usos = usoPorTela.get(t.id) || [];
    console.log(
      `  ${clase.padEnd(12)} ${String(usos.length).padStart(7)}  ${Number(t.precioBsG || 0).toFixed(4).padStart(8)}  ${t.descripcion}`
    );
    if (usos.length > 0 && usos.length <= 4) {
      console.log(`               usada por: ${usos.join(', ')}`);
    }
    filasCsv.push(
      `tela,${clase},"${String(t.descripcion).replace(/"/g, '""')}",${usos.length},${t.precioBsG || 0},"${motivo}"`
    );
  }

  const telasSinUso = listaTelas.filter((t: any) => !usoPorTela.has(t.id));
  if (telasSinUso.length > 0) {
    console.log('');
    console.log(`  ATENCION: ${telasSinUso.length} telas no las usa ninguna prenda:`);
    telasSinUso.forEach((t: any) => console.log(`    - ${t.descripcion}`));
  }

  const prodSinTela = listaProd.filter((p: any) => !p.telaId);
  if (prodSinTela.length > 0) {
    console.log('');
    console.log(`  ATENCION: ${prodSinTela.length} prendas sin tela vinculada:`);
    prodSinTela.forEach((p: any) => console.log(`    - item ${p.itemNumero} ${p.descripcion}`));
  }

  // ---------- Tallas y tipo de cambio ----------
  console.log('');
  console.log(SEP);
  console.log('  TALLAS Y TIPO DE CAMBIO — no necesitan confirmacion');
  console.log(SEP);
  console.log(`  Tallas (${listaTallas.length}): ${listaTallas.map((t: any) => t.codigo).join(', ')}`);
  console.log('  Son codigos de industria. Y como precio_venta ya define que tallas se');
  console.log('  ofrecen, la tabla no necesita scoping por colegio.');
  console.log('');
  if (listaPS.length > 0) {
    console.log(`  Tipos de cambio (${listaPS.length}): ${listaPS.map((p: any) => p.tipoCambio).join(', ')}`);
  } else {
    console.log('  Tipos de cambio: ninguno cargado.');
  }
  console.log('  El tipo de cambio del boliviano no es del colegio, es del mundo.');

  // ---------- Deduplicacion ----------
  console.log('');
  console.log(SEP);
  console.log('  DEDUPLICACION');
  console.log(SEP);
  if (listaColegios.length <= 1) {
    console.log('  NO HACE FALTA. Con un solo colegio no hay filas repetidas que fusionar,');
    console.log('  asi que hacer nullable el colegio_id es DDL puro, sin migracion de datos');
    console.log('  ni repunte de claves foraneas. Es el momento mas facil para hacerlo: con');
    console.log('  dos colegios cargados, el mismo cambio exige un pase de dedup con');
    console.log('  fusion de filas y repunte de detalle_acc.');
  } else {
    console.log(`  ${listaColegios.length} colegios cargados: SI hace falta un pase de dedup antes`);
    console.log('  de hacer nullable el colegio_id. Hay que identificar el mismo insumo');
    console.log('  repetido entre colegios, fusionarlo y repuntar las FK de detalle_acc.');
  }

  if (CSV) {
    fs.writeFileSync(CSV, filasCsv.join('\n'), 'utf8');
    console.log('');
    console.log(`  CSV escrito en ${CSV}.`);
  }

  console.log(SEP);
}

main().catch((e) => {
  console.error('Error en el analisis:', e);
  process.exit(1);
});
