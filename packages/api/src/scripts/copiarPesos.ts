/**
 * Copiar los pesos de materia prima de una prenda a otra.
 *
 * Uso (desde packages/api):
 *   npx tsx src/scripts/copiarPesos.ts --de 7 --a 26              # simulacion
 *   npx tsx src/scripts/copiarPesos.ts --de 7 --a 26 --aplicar    # escribe
 *   npx tsx src/scripts/copiarPesos.ts --de 7 --a 26 --aplicar --sobrescribir
 *
 * --de y --a son itemNumero. Por defecto simula y no escribe nada.
 *
 * PARA QUE SIRVE
 * Prendas equivalentes pesan practicamente lo mismo: una polera con serigrafia
 * distinta lleva la misma tela que la polera base. En vez de medir y cargar 14
 * tallas a mano, se copian de la prenda hermana. Es el mismo patron que el
 * clonado de receta de accesorios, y sirve igual para dar de alta un colegio
 * nuevo cuyas prendas son equivalentes a las de otro.
 *
 * DOS REGLAS DE SEGURIDAD
 *
 * 1. NO sobrescribe pesos existentes, salvo que se pida --sobrescribir.
 *    Un peso ya cargado puede ser una medicion real. Pisarlo en silencio seria
 *    reemplazar un dato medido por una estimacion. Cuando el destino ya tiene un
 *    valor y difiere del origen, se reporta la diferencia y la decision queda en
 *    manos de la persona.
 *
 * 2. Solo copia a las tallas que el destino REALMENTE OFRECE.
 *    La fuente de verdad de si una prenda se ofrece en una talla es
 *    `precio_venta`: sin precio, no se ofrece. Copiar peso a tallas que no se
 *    venden solo agrega ruido que despues infla los promedios.
 *
 * NOTA DE IMPLEMENTACION
 * Todo el acceso a datos usa el query builder de Drizzle. La primera version
 * intentaba SQL crudo via `db.$client.exec`, que no existe en el driver de
 * sql.js y fallaba en runtime. El query builder es la unica API que el resto del
 * codigo usa y que esta comprobada aca.
 */

import { asc, eq } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../database/sqljs';
import { productos, tallas, pesoMateriaPrima, preciosVenta, telas } from '../database/schema';

function argNum(flag: string): number | null {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return null;
  const n = parseInt(process.argv[i + 1], 10);
  return isNaN(n) ? null : n;
}

const ITEM_ORIGEN = argNum('--de');
const ITEM_DESTINO = argNum('--a');
const APLICAR = process.argv.includes('--aplicar');
const SOBRESCRIBIR = process.argv.includes('--sobrescribir');

function nuevoId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const SEP = '='.repeat(78);
const num = (v: any): number => Number(v) || 0;

async function main() {
  if (ITEM_ORIGEN == null || ITEM_DESTINO == null) {
    console.error('Faltan parametros.\n');
    console.error('  npx tsx src/scripts/copiarPesos.ts --de <itemNumero> --a <itemNumero> [--aplicar] [--sobrescribir]\n');
    console.error('Ejemplo: copiar los pesos de la Polera manga corta a la Polera Bullying');
    console.error('  npx tsx src/scripts/copiarPesos.ts --de 7 --a 26');
    process.exit(1);
  }
  if (ITEM_ORIGEN === ITEM_DESTINO) {
    console.error('El origen y el destino son la misma prenda.');
    process.exit(1);
  }

  // Los guards de arriba ya garantizaron que no son null. Se copian a locales
  // tipados porque TypeScript no estrecha el tipo despues de process.exit():
  // sin @types/node instalado, `process` no resuelve y exit() no se reconoce
  // como `never`, asi que ITEM_ORIGEN sigue siendo number | null para el
  // compilador y eq() rechaza el null.
  const itemOrigen: number = ITEM_ORIGEN;
  const itemDestino: number = ITEM_DESTINO;

  const db: any = await getDb();

  const [origen] = await db.select().from(productos).where(eq(productos.itemNumero, itemOrigen)).limit(1);
  const [destino] = await db.select().from(productos).where(eq(productos.itemNumero, itemDestino)).limit(1);

  if (!origen) { console.error(`No existe la prenda con itemNumero ${itemOrigen}.`); process.exit(1); }
  if (!destino) { console.error(`No existe la prenda con itemNumero ${itemDestino}.`); process.exit(1); }

  console.log('');
  console.log(SEP);
  console.log(APLICAR ? '  COPIA DE PESOS  —  MODO APLICAR' : '  COPIA DE PESOS  —  SIMULACION (no escribe nada)');
  console.log(SEP);
  console.log(`\n  origen : item ${origen.itemNumero}  ${origen.descripcion}`);
  console.log(`  destino: item ${destino.itemNumero}  ${destino.descripcion}`);

  const buscarTela = async (id: any) => {
    if (!id) return null;
    const [t] = await db.select().from(telas).where(eq(telas.id, id)).limit(1);
    return t || null;
  };
  const tOrigen = await buscarTela(origen.telaId);
  const tDestino = await buscarTela(destino.telaId);

  console.log(`\n  tela origen : ${tOrigen ? `${tOrigen.descripcion} (${tOrigen.precioBsG} Bs/g)` : 'sin tela'}`);
  console.log(`  tela destino: ${tDestino ? `${tDestino.descripcion} (${tDestino.precioBsG} Bs/g)` : 'sin tela'}`);
  if (origen.telaId !== destino.telaId) {
    console.log('\n  AVISO: las dos prendas usan telas distintas. El peso es una propiedad de');
    console.log('  la prenda y se puede copiar igual, pero el costo de tela resultante no va');
    console.log('  a ser comparable entre las dos.');
  }

  const listaTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  const pesosOrigen = await db.select().from(pesoMateriaPrima).where(eq(pesoMateriaPrima.productoId, origen.id));
  const pesosDestino = await db.select().from(pesoMateriaPrima).where(eq(pesoMateriaPrima.productoId, destino.id));
  const preciosDestino = await db.select().from(preciosVenta).where(eq(preciosVenta.productoId, destino.id));

  const porTallaOrigen = new Map<string, any>(pesosOrigen.map((p: any) => [p.tallaId, p]));
  const porTallaDestino = new Map<string, any>(pesosDestino.map((p: any) => [p.tallaId, p]));
  const ofrecidas = new Set<string>(preciosDestino.map((p: any) => p.tallaId));

  const aEscribir: any[] = [];
  const conflictos: any[] = [];
  let omitidas = 0;

  console.log('');
  console.log('-'.repeat(78));
  console.log(' talla    | origen c/merma | destino actual | ofrecida | accion');

  for (const t of listaTallas) {
    const o = porTallaOrigen.get(t.id);
    const d = porTallaDestino.get(t.id);
    const oG = num(o?.pesoGramos);
    const dG = num(d?.pesoGramos);
    const ofrecida = ofrecidas.has(t.id);
    let accion: string;

    if (!ofrecida) {
      accion = 'omitir (no se ofrece)';
      omitidas++;
    } else if (oG <= 0) {
      accion = 'omitir (origen sin peso)';
      omitidas++;
    } else if (dG > 0 && !SOBRESCRIBIR) {
      const dif = ((dG - oG) / oG) * 100;
      accion = `CONSERVAR (difiere ${dif >= 0 ? '+' : ''}${dif.toFixed(1)}%)`;
      conflictos.push({ talla: t.codigo, origen: oG, destino: dG, dif });
    } else {
      accion = dG > 0 ? 'SOBRESCRIBIR' : 'copiar';
      aEscribir.push({
        existenteId: d?.id ?? null,
        tallaId: t.id,
        talla: t.codigo,
        exacto: num(o.pesoExactoGramos),
        gramos: oG,
        merma: num(o.mermaPorcentaje),
        conMerma: num(o.pesoConMerma) || oG,
      });
    }

    console.log(
      ` ${String(t.codigo).padEnd(8)} | ${String(oG || '-').padStart(14)} | ${String(dG || '-').padStart(14)} | ` +
      `${(ofrecida ? 'si' : 'no').padEnd(8)} | ${accion}`
    );
  }

  console.log('');
  console.log('-'.repeat(78));
  console.log(`A copiar: ${aEscribir.length}    Conservadas por conflicto: ${conflictos.length}    Omitidas: ${omitidas}`);

  if (conflictos.length > 0 && !SOBRESCRIBIR) {
    console.log('\nEl destino YA tiene peso en estas tallas y NO se toca:');
    for (const c of conflictos) {
      console.log(`  talla ${String(c.talla).padEnd(8)} origen ${c.origen} g   destino ${c.destino} g   ` +
                  `(${c.dif >= 0 ? '+' : ''}${c.dif.toFixed(1)}%)`);
    }
    console.log('\n  Un peso ya cargado puede ser una medicion real. Si estas seguro de que');
    console.log('  corresponde reemplazarlo por el del origen, agrega --sobrescribir.');
  }

  console.log('');
  console.log(SEP);

  if (!APLICAR) {
    console.log('SIMULACION: no se escribio nada. Para aplicar, agrega --aplicar.');
    console.log(SEP);
    return;
  }

  if (aEscribir.length === 0) {
    console.log('No hay nada que escribir.');
    console.log(SEP);
    return;
  }

  for (const w of aEscribir) {
    if (w.existenteId) {
      await db.update(pesoMateriaPrima)
        .set({
          pesoExactoGramos: w.exacto,
          pesoGramos: w.gramos,
          mermaPorcentaje: w.merma,
          pesoConMerma: w.conMerma,
        })
        .where(eq(pesoMateriaPrima.id, w.existenteId));
    } else {
      await db.insert(pesoMateriaPrima).values({
        id: nuevoId(),
        productoId: destino.id,
        tallaId: w.tallaId,
        pesoExactoGramos: w.exacto,
        pesoGramos: w.gramos,
        mermaPorcentaje: w.merma,
        pesoConMerma: w.conMerma,
      });
    }
  }
  saveDbToDisk();

  console.log(`Escritas ${aEscribir.length} tallas en item ${destino.itemNumero} (${destino.descripcion}).`);
  console.log('Base guardada en disco.');
  console.log('\nConviene correr la validacion del catalogo para confirmar que quedo consistente:');
  console.log('  npx tsx src/scripts/validarCatalogo.ts');
  console.log(SEP);
}

main().catch((err) => {
  console.error('\nFallo la copia de pesos:', err);
  process.exit(1);
});
