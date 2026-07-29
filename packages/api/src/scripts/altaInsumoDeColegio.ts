/**
 * Da de alta un insumo EXCLUSIVO de un colegio y lo asigna a sus prendas.
 *
 * POR QUE EXISTE, y no es por un caso puntual. Al dar de alta el segundo colegio quedo a la
 * vista un paso que nadie habia automatizado ni escrito en ninguna lista: sus INSUMOS DE
 * IDENTIDAD. Los escudos bordados, las serigrafias, las etiquetas con logo, los cuellos
 * propios. En Cambridge son ONCE insumos exclusivos, ocho de ellos en uso, y el "Bordado
 * escudo" solo aparece en 13 de sus 27 prendas.
 *
 * Copiar una receta de un colegio a otro NO los trae, y hace bien: el escudo de Cambridge no
 * va en la camisa de otro colegio. copiarPrenda.service.ts los saltea y lo avisa. Pero el
 * resultado es que la prenda del colegio nuevo queda con una receta que PARECE completa
 * —ocho insumos, todos correctos— y le falta lo unico que la identifica.
 *
 * Eso costaba 5,00 Bs por unidad sin reconocer en la Camisa Formal de Internacional SM: 350
 * Bs sobre las 70 unidades en stock, y el margen reportado 4,3 puntos mas alto que el real.
 * Un numero plausible que nadie revisa, que es la clase de error mas caro de este sistema.
 *
 * ESTE SCRIPT ES EL PASO QUE FALTABA en el alta de un colegio, y por eso es generico y no un
 * arreglo para un escudo: el colegio numero tres va a necesitar lo mismo.
 *
 * VA POR LA API Y NO POR SQL, a proposito. Escribiendo directo a la base habria que replicar
 * dos cosas que ya estan resueltas: la derivacion de costo_unitario a partir del costo de
 * compra y la cantidad por unidad, y la guarda que impide asignar un insumo de un colegio a
 * la prenda de otro. Replicar logica es como este proyecto termino con la formula de costeo
 * en seis lugares y dos de las copias mal.
 *
 * SEGURIDAD
 * - Dry-run por defecto. Solo escribe con --aplicar.
 * - IDEMPOTENTE: si ya existe un insumo con esa descripcion en ese colegio, no crea otro.
 * - Mide el costo de cada prenda ANTES y DESPUES, y lo reporta. Un insumo que no mueve el
 *   costo de ninguna prenda es un insumo que no quedo asignado, y hay que verlo.
 * - Si el colegio no se resuelve a UNO solo, aborta en vez de elegir.
 *
 * Uso:
 *   pnpm tsx src/scripts/altaInsumoDeColegio.ts --colegio "Internacional" \
 *     --insumo "Bordado escudo Internacional" --costo 5 --prendas 28
 *
 *   ... --aplicar          escribe
 *   ... --prendas todas    a todas las prendas del colegio
 *   ... --cantidad 2       cantidad de uso por prenda (default 1)
 *   ... --codigo 16        codigo del insumo, opcional
 *
 * Necesita el servidor local levantado (npx tsx src/server.ts).
 */

const BASE = process.env.SISTEMA_API_URL || 'http://localhost:3000';
const SEP = '='.repeat(78);

const APLICAR = process.argv.includes('--aplicar');

function arg(nombre: string): string | null {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function http(metodo: string, ruta: string, cuerpo?: any) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* respuesta no-JSON */ }
  return { status: res.status, json };
}

/** Costo de una prenda, promediado sobre sus tallas, mas el subtotal de su receta. */
async function costoDe(productoId: string) {
  const r = await http('GET', `/api/costeo/prenda/${productoId}`);
  const filas: any[] = r.json?.data || [];
  if (filas.length === 0) return null;
  const netos = filas.map((f) => f.resultado?.costoUnitarioNeto || 0);
  const margenes = filas.map((f) => f.resultado?.margenConFactura).filter((m: any) => m !== null && m !== undefined);
  return {
    tallas: filas.length,
    accesorios: filas[0]?.resultado?.costoAccesorios || 0,
    netoPromedio: netos.reduce((a, b) => a + b, 0) / netos.length,
    margenPromedio: margenes.length ? margenes.reduce((a: number, b: number) => a + b, 0) / margenes.length : null,
    recetaLineas: (r.json?.receta || []).length,
  };
}

async function main() {
  console.log(SEP);
  console.log('  ALTA DE UN INSUMO EXCLUSIVO DE UN COLEGIO' + (APLICAR ? '  —  MODO APLICAR' : '  —  SIMULACION'));
  console.log(SEP);

  const nombreColegio = arg('colegio');
  const descripcion = arg('insumo');
  const costoTxt = arg('costo');
  const prendasTxt = arg('prendas');
  const cantidad = Number(arg('cantidad') || '1');
  const codigo = arg('codigo');
  const unidadCompra = arg('unidad') || 'Unidad';

  if (!nombreColegio || !descripcion || !costoTxt) {
    console.log('');
    console.log('  Faltan parametros. Minimo:');
    console.log('    --colegio "<parte del nombre o el id>"');
    console.log('    --insumo  "<descripcion>"');
    console.log('    --costo   <Bs por unidad de compra>');
    console.log('  Opcionales: --prendas "28,29" | --prendas todas, --cantidad, --codigo, --unidad');
    process.exit(1);
  }

  const costo = Number(costoTxt);
  if (!isFinite(costo) || costo < 0) {
    console.log(`\n  El costo "${costoTxt}" no es un numero valido.`);
    process.exit(1);
  }

  // ------------------------------------------------------- el servidor responde
  const ping = await http('GET', '/api/colegios');
  if (ping.status !== 200) {
    console.log('');
    console.log('  El servidor no responde en ' + BASE);
    console.log('  Levantarlo con:  npx tsx src/server.ts');
    process.exit(1);
  }

  // --------------------------------------------------------- resolver el colegio
  const colegios: any[] = ping.json?.data || [];
  const candidatos = colegios.filter(
    (c) => c.id === nombreColegio || String(c.nombre).toLowerCase().includes(nombreColegio.toLowerCase())
  );

  if (candidatos.length === 0) {
    console.log(`\n  No hay ningun colegio que coincida con "${nombreColegio}". Los que existen:`);
    for (const c of colegios) console.log(`    ${c.nombre}   ${c.id}`);
    process.exit(1);
  }
  if (candidatos.length > 1) {
    // No se elige por el usuario: asignar un insumo al colegio equivocado lo vuelve
    // invisible para el que lo necesita y lo cobra en las prendas del que no.
    console.log(`\n  "${nombreColegio}" coincide con ${candidatos.length} colegios y no se elige por vos:`);
    for (const c of candidatos) console.log(`    ${c.nombre}   ${c.id}`);
    process.exit(1);
  }
  const colegio = candidatos[0];
  console.log(`Colegio:  ${colegio.nombre}   ${colegio.id}`);
  console.log(`Insumo:   "${descripcion}"   ${costo} Bs por ${unidadCompra.toLowerCase()}`);

  // -------------------------------------------------------------- idempotencia
  const todos = await http('GET', '/api/accesorios');
  const yaExiste = (todos.json?.data || []).find(
    (a: any) => String(a.descripcion).trim().toLowerCase() === descripcion.trim().toLowerCase()
      && a.colegioId === colegio.id
  );
  if (yaExiste) {
    console.log('');
    console.log(`  YA EXISTE un insumo "${yaExiste.descripcion}" exclusivo de este colegio.`);
    console.log(`    id ${yaExiste.id}, costo unitario ${yaExiste.costoUnitario} Bs`);
    console.log('  No se crea otro: dos insumos con el mismo nombre en el mismo colegio hacen');
    console.log('  imposible saber cual cobra cada prenda. Para asignarlo a mas prendas, usar');
    console.log('  el panel de Receta, o cambiar su costo con PUT /api/accesorios/:id.');
    process.exit(0);
  }

  // ----------------------------------------------------------- prendas destino
  const prods = await http('GET', `/api/productos?colegioId=${colegio.id}`);
  const delColegio: any[] = prods.json?.data || [];
  console.log(`Prendas del colegio: ${delColegio.length}`);

  let destino: any[] = [];
  if (prendasTxt === 'todas') {
    destino = delColegio;
  } else if (prendasTxt) {
    const items = prendasTxt.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    destino = delColegio.filter((p) => items.includes(Number(p.itemNumero)));
    const noEncontrados = items.filter((n) => !delColegio.some((p) => Number(p.itemNumero) === n));
    if (noEncontrados.length > 0) {
      console.log('');
      console.log(`  Estos items no existen en ${colegio.nombre}: ${noEncontrados.join(', ')}`);
      console.log('  Se aborta en vez de asignar a las que si existen: un alta a medias es peor');
      console.log('  que ninguna, porque parece completa.');
      process.exit(1);
    }
  }

  if (destino.length === 0) {
    console.log('');
    console.log('  Sin --prendas, el insumo se crea pero no se asigna a ninguna prenda.');
    console.log('  Eso es valido —queda en el catalogo del colegio— pero no cambia ningun costo.');
  } else {
    console.log(`Se asignaria a ${destino.length} prenda(s), cantidad ${cantidad} en cada una:`);
    for (const p of destino) console.log(`    item ${String(p.itemNumero).padStart(3)}  ${p.descripcion}`);
  }

  // ------------------------------------------------------------ costo de ANTES
  const antes = new Map<string, any>();
  for (const p of destino) antes.set(p.id, await costoDe(p.id));

  if (!APLICAR) {
    console.log('');
    console.log(SEP);
    console.log('  QUE HARIA --aplicar');
    console.log(SEP);
    console.log(`  1. POST /api/accesorios  con colegioId = ${colegio.id}`);
    console.log(`     descripcion "${descripcion}", ${costo} Bs, cantidadXUd 1`);
    console.log(`     El costo unitario lo deriva el endpoint: ${costo} / 1 = ${costo} Bs.`);
    for (const p of destino) {
      const a = antes.get(p.id);
      console.log(`  2. POST /api/productos/${p.id}/accesorios  cantidad ${cantidad}`);
      console.log(`     item ${p.itemNumero} ${p.descripcion}: hoy ${a?.recetaLineas ?? '?'} insumo(s), ` +
        `receta ${a?.accesorios?.toFixed(2) ?? '?'} Bs, costo neto promedio ${a?.netoPromedio?.toFixed(2) ?? '?'} Bs`);
      console.log(`     quedaria en ${((a?.netoPromedio || 0) + costo * cantidad).toFixed(2)} Bs`);
    }
    console.log('');
    console.log('  Nada se escribio. Para hacerlo: --aplicar');
    return;
  }

  // ------------------------------------------------------------------ aplicar
  console.log('');
  console.log(SEP);
  console.log('  APLICANDO');
  console.log(SEP);

  const creado = await http('POST', '/api/accesorios', {
    descripcion,
    codigo: codigo || undefined,
    colegioId: colegio.id,
    unidadCompra,
    cantidadXUd: 1,
    costoUdCompra: costo,
  });

  if (creado.json?.success !== true) {
    console.log('  FALLO al crear el insumo:');
    console.log('  ' + JSON.stringify(creado.json));
    process.exit(1);
  }
  const insumo = creado.json.data;
  console.log(`  ok  insumo creado: ${insumo.id}, costo unitario ${insumo.costoUnitario} Bs`);

  if (insumo.colegioId !== colegio.id) {
    // Vale chequearlo: un insumo que nace con colegio_id NULL queda COMPARTIDO, o sea que
    // se lo puede cobrar a las prendas de cualquier colegio. Es lo contrario de lo pedido.
    console.log(`  ATENCION: el insumo quedo con colegioId ${JSON.stringify(insumo.colegioId)} y se`);
    console.log(`  pidio ${colegio.id}. Si quedo en null, es COMPARTIDO por todos los colegios.`);
  }

  let asignadas = 0;
  for (const p of destino) {
    const r = await http('POST', `/api/productos/${p.id}/accesorios`, {
      accesorioId: insumo.id,
      cantidadUso: cantidad,
    });
    if (r.json?.success === true) {
      asignadas++;
      console.log(`  ok  asignado a item ${p.itemNumero} ${p.descripcion}  (${r.json.data?.costoTotalBs} Bs)`);
    } else {
      console.log(`  FALLO en item ${p.itemNumero}: ${JSON.stringify(r.json?.error || r.json)}`);
    }
  }

  // --------------------------------------------------------------- verificacion
  console.log('');
  console.log(SEP);
  console.log('  EFECTO EN EL COSTO  —  medido, no supuesto');
  console.log(SEP);

  let algunoSeMovio = false;
  for (const p of destino) {
    const a = antes.get(p.id);
    const d = await costoDe(p.id);
    if (!a || !d) continue;
    const dNeto = d.netoPromedio - a.netoPromedio;
    const dMargen = (d.margenPromedio ?? 0) - (a.margenPromedio ?? 0);
    if (Math.abs(dNeto) > 0.0005) algunoSeMovio = true;
    console.log(`  item ${p.itemNumero}  ${p.descripcion}`);
    console.log(`    receta          ${a.recetaLineas} -> ${d.recetaLineas} insumo(s)`);
    console.log(`    costo receta    ${a.accesorios.toFixed(2)} -> ${d.accesorios.toFixed(2)} Bs   (${dNeto >= 0 ? '+' : ''}${(d.accesorios - a.accesorios).toFixed(2)})`);
    console.log(`    costo neto      ${a.netoPromedio.toFixed(2)} -> ${d.netoPromedio.toFixed(2)} Bs   (${dNeto >= 0 ? '+' : ''}${dNeto.toFixed(2)}, ${(100 * dNeto / a.netoPromedio).toFixed(1)}%)`);
    if (a.margenPromedio !== null && d.margenPromedio !== null) {
      console.log(`    margen          ${a.margenPromedio.toFixed(2)}% -> ${d.margenPromedio.toFixed(2)}%   (${dMargen >= 0 ? '+' : ''}${dMargen.toFixed(2)} puntos)`);
    }
  }

  console.log('');
  console.log(`  Insumo creado y asignado a ${asignadas} de ${destino.length} prenda(s).`);

  if (destino.length > 0 && !algunoSeMovio) {
    // Un insumo que no mueve NINGUN costo no quedo asignado, o quedo con costo cero. En los
    // dos casos el trabajo no sirvio, y decirlo importa mas que el "listo" de arriba.
    console.log('');
    console.log('  PERO NINGUN COSTO SE MOVIO, y eso es una falla aunque las escrituras dieran 200.');
    console.log('  O el insumo no quedo asignado, o su costo unitario es cero. Revisar con:');
    console.log(`    GET /api/productos/${destino[0].id}/accesorios`);
    process.exit(1);
  }

  console.log('  El costo de las prendas afectadas subio, o sea que el insumo ENTRO al costeo.');
  console.log(SEP);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
