/**
 * Verifica que una instantánea sea una RED DE SEGURIDAD y no solo una foto.
 *
 * DOS HUECOS QUE ESTE CHEQUEO FIJA:
 *
 * 1. La instantánea NO guardaba el inventario. Capturaba productos, telas,
 *    accesorios, mano de obra, indirectos, pesos y los dos tipos de precio — todo
 *    menos las cantidades. Importar stock era irreversible.
 *
 * 2. NO existía forma de reponerla. El archivo tenía GET, POST, DELETE y comparar, y
 *    ninguno escribía de vuelta: las instantáneas servían para SIMULAR con el
 *    parámetro `snapshotId` del motor, no para volver atrás. Exigir una instantánea
 *    antes de importar era, hasta ahora, exigir un consuelo.
 *
 * EL CHEQUEO QUE DISCRIMINA. No alcanza con que el endpoint responda 200: eso lo
 * cumple una restauración que repone cero filas. Este script CAMBIA un precio y una
 * cantidad a valores reconocibles, comprueba que el cambio se ve, restaura, y exige
 * que los DOS valores hayan vuelto al original. Si la restauración no hiciera nada, el
 * precio seguiría modificado y el chequeo lo diría.
 *
 * NO DEJA RASTRO: al final repone el estado previo aunque algo falle.
 *
 * Uso, con el servidor levantado:
 *   pnpm tsx src/scripts/verificarInstantanea.ts
 */

export {};

const BASE_INST = process.env.BASE_URL || 'http://localhost:3000';

let fallos = 0;
const chk = (cond: boolean, msg: string, detalle = '') => {
  console.log(`  ${cond ? 'PASA ' : 'FALLA'}  ${msg}${detalle ? '  ::  ' + detalle : ''}`);
  if (!cond) fallos++;
};

const pedir = async (ruta: string, opciones?: RequestInit) => {
  const r = await fetch(BASE_INST + ruta, opciones);
  const json = (await r.json()) as any;
  return { status: r.status, json };
};

const json = (metodo: string, cuerpo: any): RequestInit => ({
  method: metodo,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(cuerpo),
});

async function correr() {
  // ---- estado de partida ----
  const resumen = (await pedir('/api/dashboard-resumen?colegioId=all')).json;
  const prenda = (resumen.prendas || []).find((p: any) => p.precioMax > 0 && p.stockTotal > 0);
  if (!prenda) {
    console.log('No hay ninguna prenda con precio Y stock: no se puede medir la restauracion.');
    console.log('Con datos vacios este chequeo pasaria en verde sin haber probado nada.');
    process.exit(0);
  }

  const matriz = (await pedir(`/api/calculo/matriz-prenda/${prenda.id}?colegioId=all`)).json;
  const fila = (matriz.data || []).find((t: any) => t.precioVenta > 0);
  if (!fila) {
    console.log('La prenda elegida no tiene ninguna talla con precio. Sin datos no se mide.');
    process.exit(0);
  }

  const stock = (await pedir('/api/inventario/stock?colegioId=all')).json;
  const filaStock = (stock.data || []).find(
    (i: any) => String(i.productoId) === String(prenda.id) && i.cantidad > 0
  );
  if (!filaStock) {
    console.log('La prenda elegida no tiene stock en ninguna talla. Sin datos no se mide.');
    process.exit(0);
  }

  const precioOriginal = Number(fila.precioLista ?? fila.precioVenta);
  const stockOriginal = Number(filaStock.cantidad);
  console.log(`\nPrenda de prueba: #${prenda.itemNumero} ${prenda.descripcion}`);
  console.log(`  talla ${fila.tallaCodigo}: precio de lista ${precioOriginal}`);
  console.log(`  talla ${filaStock.talla}: stock ${stockOriginal}\n`);

  // ---- 1. tomar la instantanea ----
  const creada = await pedir('/api/snapshots', json('POST', {
    nombre: `Verificacion automatica ${new Date().toISOString()}`,
    descripcion: 'Creada por verificarInstantanea.ts. Se elimina al terminar.',
  }));
  chk(creada.status === 200 && !!creada.json.id, 'la instantánea se crea');
  const snapId = creada.json.id;
  if (!snapId) { process.exit(1); }

  // EL HUECO 1: el inventario tiene que estar DENTRO de la foto.
  const detalle = (await pedir(`/api/snapshots/${snapId}`)).json;
  const d = detalle.data?.datos || {};
  chk(Array.isArray(d.inventario) && d.inventario.length > 0,
      'la instantánea GUARDA el inventario',
      `${(d.inventario || []).length} fila(s)`);
  chk(Array.isArray(d.preciosVenta) && d.preciosVenta.length > 0,
      'y sigue guardando los precios de venta',
      `${(d.preciosVenta || []).length} fila(s)`);

  const PRECIO_RARO = 12345.67;
  const STOCK_RARO = 98765;

  try {
    // ---- 2. cambiar precio y stock a valores reconocibles ----
    await pedir('/api/calculo/precio-venta', json('PUT', {
      productoId: prenda.id, tallaId: fila.tallaId, precioBs: PRECIO_RARO,
    }));
    await pedir('/api/calculo/inventario-unidades', json('PUT', {
      productoId: prenda.id, tallaId: filaStock.tallaId, cantidad: STOCK_RARO,
    }));

    const m1 = (await pedir(`/api/calculo/matriz-prenda/${prenda.id}?colegioId=all`)).json;
    const f1 = (m1.data || []).find((t: any) => String(t.tallaId) === String(fila.tallaId));
    const s1 = ((await pedir('/api/inventario/stock?colegioId=all')).json.data || []).find(
      (i: any) => String(i.tallaId) === String(filaStock.tallaId) &&
                  String(i.productoId) === String(prenda.id));

    chk(Number(f1?.precioLista ?? f1?.precioVenta) === PRECIO_RARO,
        'el cambio de precio SE VE antes de restaurar',
        `${f1?.precioLista ?? f1?.precioVenta}`);
    chk(Number(s1?.cantidad) === STOCK_RARO,
        'el cambio de stock SE VE antes de restaurar',
        `${s1?.cantidad}`);

    // ---- 3. restaurar exige confirmacion ----
    const sinConfirmar = await pedir(`/api/snapshots/${snapId}/restaurar`, json('POST', {}));
    chk(sinConfirmar.status === 400,
        'restaurar SIN confirmar se rechaza: no se dispara por accidente');

    const inexistente = await pedir('/api/snapshots/no-existe/restaurar', json('POST', { confirmar: true }));
    chk(inexistente.status === 404, 'una instantánea inexistente devuelve 404');

    // ---- 4. restaurar de verdad ----
    const rest = await pedir(`/api/snapshots/${snapId}/restaurar`, json('POST', { confirmar: true }));
    chk(rest.status === 200, 'la restauración responde 200');
    chk(!!rest.json.respaldo, 'se creó un respaldo del archivo ANTES de escribir',
        String(rest.json.respaldo));
    chk((rest.json.reporte?.precio_venta?.repuestas ?? 0) > 0,
        'el reporte dice CUANTAS filas de precio repuso, no solo exito',
        `${rest.json.reporte?.precio_venta?.repuestas} precios`);
    chk((rest.json.reporte?.inventario?.repuestas ?? 0) > 0,
        'y cuántas de inventario',
        `${rest.json.reporte?.inventario?.repuestas} filas`);

    // ---- 5. EL CHEQUEO CENTRAL: los valores volvieron ----
    const m2 = (await pedir(`/api/calculo/matriz-prenda/${prenda.id}?colegioId=all`)).json;
    const f2 = (m2.data || []).find((t: any) => String(t.tallaId) === String(fila.tallaId));
    const s2 = ((await pedir('/api/inventario/stock?colegioId=all')).json.data || []).find(
      (i: any) => String(i.tallaId) === String(filaStock.tallaId) &&
                  String(i.productoId) === String(prenda.id));

    chk(Math.abs(Number(f2?.precioLista ?? f2?.precioVenta) - precioOriginal) < 0.005,
        'el PRECIO volvió a su valor original',
        `${f2?.precioLista ?? f2?.precioVenta} (esperado ${precioOriginal})`);
    chk(Number(s2?.cantidad) === stockOriginal,
        'el STOCK volvió a su valor original — el hueco que hacía irreversible importar cantidades',
        `${s2?.cantidad} (esperado ${stockOriginal})`);
  } finally {
    // Red por si algo fallo a mitad: se reponen los dos valores a mano y se borra la
    // instantanea de prueba. Una verificacion que deja datos de prueba en la base es
    // la que hizo que este repo tuviera que limpiar filas espurias.
    await pedir('/api/calculo/precio-venta', json('PUT', {
      productoId: prenda.id, tallaId: fila.tallaId, precioBs: precioOriginal,
    }));
    await pedir('/api/calculo/inventario-unidades', json('PUT', {
      productoId: prenda.id, tallaId: filaStock.tallaId, cantidad: stockOriginal,
    }));
    if (snapId) await pedir(`/api/snapshots/${snapId}`, { method: 'DELETE' });

    const lista = (await pedir('/api/snapshots')).json;
    const quedan = (lista.data || []).filter((s: any) => /Verificacion automatica/.test(s.nombre));
    chk(quedan.length === 0, 'la instantánea de prueba se eliminó: no queda rastro');
  }

  console.log(`\n  ${fallos === 0 ? 'INSTANTANEA: guarda inventario y se puede restaurar.' : fallos + ' CHEQUEO(S) FALLAN'}\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

correr().catch((e) => { console.error(e); process.exit(1); });
