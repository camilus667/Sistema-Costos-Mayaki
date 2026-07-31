/**
 * MUDA A LA BASE LOS INPUTS DE INSUMOS QUE HOY VIVEN SOLO EN CAMBRIDGE.xlsx.
 *
 * Se corre UNA VEZ. Despues de esto el sistema no necesita mas ese archivo, y las funciones que
 * lo parseaban en cada pedido se pueden borrar.
 *
 * QUE MUDA, Y QUE NO
 *
 *   MUDA (son inputs)          unidadesPorPrenda, ojales, unidadesPorMetro, costoCm2
 *   NO MUDA (se calculan)      costoUnitario = costoUdCompra / cantidadXud
 *                              costoUso      = costoUnitario x unidadesPorPrenda
 *
 * POR QUE `unidadesPorPrenda` SE DERIVA Y NO SE COPIA
 *
 * La columna "Unidades que se usan por prenda" de la planilla NO es la que su costo de uso
 * usa. Medido: seis filas declaran una cantidad y cobran otra.
 *
 *   Boton de 4 huecos para polo   declara 7     cobra 1
 *   Botamanga (par)               declara 2     cobra 1
 *   Entretela para pantalon       declara 500   cobra 0,0417
 *   Elastico Short o buzo         declara 1     cobra 0,6
 *
 * El multiplicador real vivia dentro de la formula de la celda. Este script recupera EL QUE SE
 * COBRA, dividiendo el costo de uso por el costo unitario. Mudar el declarado multiplicaria por
 * siete el costo de esa prenda sin que nadie lo pida.
 *
 * Las discrepancias se listan al final: si el 7 es lo correcto, es una correccion de datos y se
 * decide aparte, mirando los numeros.
 *
 * COMO SE USA
 *
 *   ENSAYO POR DEFECTO. No escribe nada sin --aplicar.
 *
 *     pnpm tsx src/scripts/mudarInsumosDesdeExcel.ts            muestra que haria
 *     pnpm tsx src/scripts/mudarInsumosDesdeExcel.ts --aplicar  escribe
 *     pnpm tsx src/scripts/mudarInsumosDesdeExcel.ts --excel otra.xlsx --db copia.db
 *
 * ES IDEMPOTENTE: volver a correrlo escribe los mismos valores. Y solo toca las cuatro columnas
 * nuevas; no modifica descripcion, codigo, ni ninguno de los costos de compra.
 */

import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import { getDb, saveDbToDisk } from '../database/sqljs';
import { accesorios } from '../database/schema';
import { eq } from 'drizzle-orm';
import { derivarUnidadesPorPrenda, numeroDeTextoConUnidad } from '../services/costoInsumo';

const APLICAR = process.argv.includes('--aplicar');

function opcion(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const log = (...a: any[]) => console.log(...a);

/** Encuentra la planilla: la ruta dada, o CAMBRIDGE.xlsx subiendo desde packages/api. */
function rutaExcel(): string {
  const dada = opcion('excel');
  if (dada) {
    if (!fs.existsSync(dada)) throw new Error(`No existe el archivo: ${dada}`);
    return dada;
  }
  const candidatas = [
    path.resolve(process.cwd(), 'CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '..', '..', 'CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '..', 'CAMBRIDGE.xlsx'),
  ];
  const hallada = candidatas.find((p) => fs.existsSync(p));
  if (!hallada) {
    throw new Error(
      'No se encontro CAMBRIDGE.xlsx. Pasar la ruta con --excel ruta/al/archivo.xlsx\n' +
      'Buscado en:\n  ' + candidatas.join('\n  ')
    );
  }
  return hallada;
}

interface FilaPlanilla {
  codigo: number;
  descripcion: string;
  costoUnitario: number | null;
  costoUso: number | null;
  ojales: string | null;
  udsDeclaradas: number | null;
  udsPorMetro: number | null;
  costoCm2: number | null;
}

/**
 * Lee la tabla auxiliar de la hoja `Acc`.
 *
 * El encabezado se busca por su contenido y no por numero de fila: la planilla la tiene en la
 * fila 32, pero buscar por texto sobrevive a que alguien inserte una fila arriba.
 */
function leerPlanilla(ruta: string): FilaPlanilla[] {
  const parse = (XLSX as any).default || XLSX;
  const wb = parse.readFile(ruta);
  const hoja = wb.Sheets['Acc'];
  if (!hoja) throw new Error("La planilla no tiene la hoja 'Acc'.");

  const filas: any[][] = parse.utils.sheet_to_json(hoja, { header: 1 });
  const iEnc = filas.findIndex((r: any) =>
    r && r.some((c: any) =>
      String(c).includes('UNIDAD DE COMPRA') || String(c).includes('COSTO Unitario')));
  if (iEnc === -1) throw new Error("No se encontro el encabezado de la tabla auxiliar en 'Acc'.");

  return filas
    .slice(iEnc + 1)
    .filter((r: any) => r && r[0] && (typeof r[1] === 'number' || !isNaN(Number(r[1]))))
    .map((r: any) => ({
      codigo: Number(r[1]),
      descripcion: String(r[0]).trim(),
      costoUnitario: numeroDeTextoConUnidad(r[5]),
      costoUso: numeroDeTextoConUnidad(r[6]),
      // Los ojales se guardan como TEXTO: la planilla pone cosas como "2 grandes".
      ojales: r[7] === undefined || r[7] === '' ? null : String(r[7]).trim(),
      udsDeclaradas: numeroDeTextoConUnidad(r[8]),
      udsPorMetro: numeroDeTextoConUnidad(r[9]),
      costoCm2: numeroDeTextoConUnidad(r[10]),
    }));
}

const n3 = (x: number | null) => (x === null ? '—' : String(Math.round(x * 10000) / 10000));

async function main() {
  // `--db` se traduce a SISTEMA_DB_PATH, que es lo que lee `getDb()`. Se hace ANTES de la
  // primera llamada a `getDb()` para que apunte a la copia y no a la base real.
  const dbDada = opcion('db');
  if (dbDada) {
    if (!fs.existsSync(dbDada)) throw new Error(`No existe la base: ${dbDada}`);
    process.env.SISTEMA_DB_PATH = path.resolve(dbDada);
  }

  const ruta = rutaExcel();
  log(`\n${APLICAR ? '=== APLICANDO ===' : '=== ENSAYO (no escribe nada) ==='}`);
  log(`Planilla: ${ruta}`);
  log(`Base:     ${process.env.SISTEMA_DB_PATH || '(la del proyecto)'}\n`);

  const planilla = leerPlanilla(ruta);
  log(`Filas en la tabla auxiliar: ${planilla.length}`);

  const db = await getDb();
  const enBase = await db.select().from(accesorios);
  log(`Insumos en la base: ${enBase.length}\n`);

  const porCodigo = new Map<number, any>();
  for (const a of enBase) {
    const c = parseInt(String(a.codigo ?? ''), 10);
    if (!isNaN(c)) porCodigo.set(c, a);
  }

  const cambios: Array<{ fila: FilaPlanilla; acc: any; uds: number }> = [];
  const sinPareja: FilaPlanilla[] = [];
  const discrepancias: Array<{ desc: string; declara: number; cobra: number }> = [];

  for (const f of planilla) {
    const acc = porCodigo.get(f.codigo);
    if (!acc) { sinPareja.push(f); continue; }

    // Se deriva del costo de uso, que es lo que el sistema venia cobrando.
    const uds = derivarUnidadesPorPrenda(f.costoUso, f.costoUnitario, f.udsDeclaradas);

    if (f.udsDeclaradas !== null && Math.abs(f.udsDeclaradas - uds) > 0.0005) {
      discrepancias.push({ desc: f.descripcion, declara: f.udsDeclaradas, cobra: uds });
    }
    cambios.push({ fila: f, acc, uds });
  }

  log('CODIGO  INSUMO                          UNITARIO   USO      -> UDS/PRENDA  OJALES  UDS/METRO  CM2');
  log('─'.repeat(104));
  for (const { fila, uds } of cambios) {
    log(
      String(fila.codigo).padStart(6) + '  ' +
      fila.descripcion.slice(0, 30).padEnd(32) +
      n3(fila.costoUnitario).padEnd(11) +
      n3(fila.costoUso).padEnd(9) +
      '   ' + n3(uds).padEnd(12) +
      (fila.ojales ?? '—').padEnd(8) +
      n3(fila.udsPorMetro).padEnd(11) +
      n3(fila.costoCm2)
    );
  }

  if (discrepancias.length) {
    log(`\n⚠  ${discrepancias.length} filas DECLARAN una cantidad y COBRAN otra.`);
    log('   Se muda la que se cobra, para no cambiar ningun costo actual.');
    log('   Si la declarada es la correcta, es una correccion de datos aparte:\n');
    for (const d of discrepancias) {
      log(`     ${d.desc.slice(0, 34).padEnd(35)} declara ${String(d.declara).padEnd(8)} cobra ${n3(d.cobra)}`);
    }
  }

  if (sinPareja.length) {
    log(`\n⚠  ${sinPareja.length} filas de la planilla sin insumo en la base (no se mudan):`);
    for (const f of sinPareja) log(`     codigo ${f.codigo}  ${f.descripcion}`);
  }

  const enBaseSinPlanilla = [...porCodigo.keys()]
    .filter((c) => !planilla.some((f) => f.codigo === c));
  if (enBaseSinPlanilla.length) {
    log(`\n   ${enBaseSinPlanilla.length} insumos de la base no estan en la planilla; quedan con`);
    log('   unidadesPorPrenda vacio, que el sistema lee como 1.');
  }

  if (!APLICAR) {
    log(`\n${cambios.length} insumos se actualizarian. NO se escribio nada.`);
    log('Para aplicar:  pnpm tsx src/scripts/mudarInsumosDesdeExcel.ts --aplicar\n');
    process.exit(0);
  }

  let escritos = 0;
  for (const { fila, acc, uds } of cambios) {
    await db.update(accesorios)
      .set({
        unidadesPorPrenda: uds,
        ojales: fila.ojales,
        unidadesPorMetro: fila.udsPorMetro,
        costoCm2: fila.costoCm2,
      } as any)
      .where(eq(accesorios.id, acc.id));
    escritos++;
  }
  saveDbToDisk();
  log(`\n✓ ${escritos} insumos actualizados y base guardada.`);
  log('  Ahora el sistema calcula el costo de uso y no necesita mas CAMBRIDGE.xlsx.\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFALLO la mudanza:', e?.message || e);
  console.error('No se escribio nada.\n');
  process.exit(1);
});
