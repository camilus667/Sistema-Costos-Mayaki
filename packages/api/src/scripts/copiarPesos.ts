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
 *    valor y difiere del origen, se reporta la diferencia para que la persona
 *    decida, en vez de resolverla por su cuenta.
 *
 * 2. Solo copia a las tallas que el destino REALMENTE OFRECE.
 *    La fuente de verdad de si una prenda se ofrece en una talla es
 *    `precio_venta`: sin precio, no se ofrece. Copiar peso a tallas que no se
 *    venden solo agrega ruido que despues infla los promedios.
 *
 * Ademas avisa si las dos prendas usan telas distintas: el peso se puede copiar
 * igual, porque es una propiedad de la prenda y no de la tela, pero el costo
 * resultante no va a ser comparable y conviene saberlo.
 */

import { getDb, saveDbToDisk } from '../database/sqljs';

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

  const db: any = await getDb();

  const q = (sql: string): any[] => {
    const res = (db as any).$client.exec(sql);
    if (Array.isArray(res) && res.length && res[0]?.values) {
      return res[0].values.map((fila: any[]) =>
        Object.fromEntries(res[0].columns.map((c: string, i: number) => [c, fila[i]]))
      );
    }
    return [];
  };

  const [origen] = q(`select id, item_numero, descripcion, tela_id from producto where item_numero = ${ITEM_ORIGEN}`);
  const [destino] = q(`select id, item_numero, descripcion, tela_id from producto where item_numero = ${ITEM_DESTINO}`);

  if (!origen) { console.error(`No existe la prenda con itemNumero ${ITEM_ORIGEN}.`); process.exit(1); }
  if (!destino) { console.error(`No existe la prenda con itemNumero ${ITEM_DESTINO}.`); process.exit(1); }

  console.log('');
  console.log(SEP);
  console.log(APLICAR ? '  COPIA DE PESOS  —  MODO APLICAR' : '  COPIA DE PESOS  —  SIMULACION (no escribe nada)');
  console.log(SEP);
  console.log(`\n  origen : item ${origen.item_numero}  ${origen.descripcion}`);
  console.log(`  destino: item ${destino.item_numero}  ${destino.descripcion}`);

  // Aviso de telas distintas: el peso se puede copiar igual, pero el costo no
  // va a ser comparable.
  const telaDe = (id: any) => id ? (q(`select descripcion, precio_bs_g from tela where id = '${id}'`)[0] || null) : null;
  const tOrigen = telaDe(origen.tela_id);
  const tDestino = telaDe(destino.tela_id);
  console.log(`\n  tela origen : ${tOrigen ? `${tOrigen.descripcion} (${tOrigen.precio_bs_g} Bs/g)` : 'sin tela'}`);
  console.log(`  tela destino: ${tDestino ? `${tDestino.descripcion} (${tDestino.precio_bs_g} Bs/g)` : 'sin tela'}`);
  if (origen.tela_id !== destino.tela_id) {
    console.log('\n  AVISO: las dos prendas usan telas distintas. El peso es una propiedad de');
    console.log('  la prenda y se puede copiar igual, pero el costo de tela resultante no va');
    console.log('  a ser comparable entre las dos.');
  }

  const filas = q(`
    select t.id as talla_id, t.codigo as talla, t.orden,
           o.peso_exacto_gramos as o_exacto, o.peso_gramos as o_gramos,
           o.merma_porcentaje as o_merma, o.peso_con_merma as o_conmerma,
           d.id as d_id, d.peso_gramos as d_gramos,
           (select count(*) from precio_venta pv
             where pv.producto_id = '${destino.id}' and pv.talla_id = t.id) as ofrecida
      from talla t
      left join peso_mat_prima o on o.producto_id = '${origen.id}'  and o.talla_id = t.id
      left join peso_mat_prima d on d.producto_id = '${destino.id}' and d.talla_id = t.id
     order by t.orden
  `);

  const aEscribir: any[] = [];
  const conflictos: any[] = [];
  const omitidas: string[] = [];

  console.log('');
  console.log('-'.repeat(78));
  console.log(' talla    | origen c/merma | destino actual | ofrecida | accion');

  for (const f of filas) {
    const oG = Number(f.o_gramos) || 0;
    const dG = Number(f.d_gramos) || 0;
    const ofrecida = Number(f.ofrecida) > 0;
    let accion: string;

    if (!ofrecida) {
      accion = 'omitir (no se ofrece)';
      omitidas.push(`${f.talla}: el destino no la ofrece`);
    } else if (oG <= 0) {
      accion = 'omitir (origen sin peso)';
      omitidas.push(`${f.talla}: el origen no tiene peso`);
    } else if (dG > 0 && !SOBRESCRIBIR) {
      const dif = ((dG - oG) / oG) * 100;
      accion = `CONSERVAR (difiere ${dif >= 0 ? '+' : ''}${dif.toFixed(1)}%)`;
      conflictos.push({ talla: f.talla, origen: oG, destino: dG, dif });
    } else {
      accion = dG > 0 ? 'SOBRESCRIBIR' : 'copiar';
      aEscribir.push({
        d_id: f.d_id,
        tallaId: f.talla_id,
        talla: f.talla,
        exacto: Number(f.o_exacto) || 0,
        gramos: oG,
        merma: Number(f.o_merma) || 0,
        conMerma: Number(f.o_conmerma) || oG,
      });
    }

    console.log(
      ` ${String(f.talla).padEnd(8)} | ${String(oG || '-').padStart(14)} | ${String(dG || '-').padStart(14)} | ` +
      `${(ofrecida ? 'si' : 'no').padEnd(8)} | ${accion}`
    );
  }

  console.log('');
  console.log('-'.repeat(78));
  console.log(`A copiar: ${aEscribir.length}    Conservadas por conflicto: ${conflictos.length}    Omitidas: ${omitidas.length}`);

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
    if (w.d_id) {
      (db as any).$client.run(
        `update peso_mat_prima set peso_exacto_gramos = ${w.exacto}, peso_gramos = ${w.gramos},
           merma_porcentaje = ${w.merma}, peso_con_merma = ${w.conMerma}
         where id = '${w.d_id}'`
      );
    } else {
      (db as any).$client.run(
        `insert into peso_mat_prima
           (id, producto_id, talla_id, peso_exacto_gramos, peso_gramos, merma_porcentaje, peso_con_merma)
         values ('${nuevoId()}', '${destino.id}', '${w.tallaId}', ${w.exacto}, ${w.gramos}, ${w.merma}, ${w.conMerma})`
      );
    }
  }
  saveDbToDisk();

  console.log(`Escritas ${aEscribir.length} tallas en item ${destino.item_numero} (${destino.descripcion}).`);
  console.log('Base guardada en disco.');
  console.log('\nConviene correr la validacion del catalogo para confirmar que quedo consistente:');
  console.log('  npx tsx src/scripts/validarCatalogo.ts');
  console.log(SEP);
}

main().catch((err) => {
  console.error('\nFallo la copia de pesos:', err);
  process.exit(1);
});
