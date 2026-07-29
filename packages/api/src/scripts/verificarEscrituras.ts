/**
 * Verifica los caminos de ESCRITURA contra el servidor vivo.
 *
 * POR QUE EXISTE. La reja de paridad (compararCosteo.ts) abre la base con
 * skipSeed y consulta matrices por GET: no llama a ningun PUT, no pide
 * /api/telas, y no escribe nunca. Es la reja de REGRESION del costeo, y responde
 * bien a "romper el costeo al tocar estos archivos": no. Pero no responde a
 * "los arreglos de escritura funcionan", que es otra pregunta.
 *
 * Los cuatro commits del 29-jul (tela, talla, persistencia, escritura cruzada)
 * caen enteros fuera de lo que la reja mira. Sin esto quedarian verificados por
 * ausencia de contradiccion, que es exactamente el patron que se repitio seis
 * veces en este refactor.
 *
 * COMO LO VERIFICA. Cada chequeo abre el archivo .db DESDE EL DISCO con su
 * propia instancia de sql.js, independiente de la que tiene el servidor en
 * memoria. Asi se prueba que los bytes en disco cambiaron, no que el servidor
 * dice que cambiaron. Esa distincion es justo el bug de persistencia: el
 * servidor respondia 200 y el disco no se tocaba.
 *
 * SEGURIDAD. Hace backup del .db antes de nada. Escribe un valor sonda y
 * restaura el original, verificando la restauracion. Las filas que crea llevan
 * un nombre reconocible y se borran al final; si una corrida anterior murio a
 * medias, las limpia al arrancar.
 *
 * Necesita el servidor arriba:  pnpm dev:local
 * Uso:                         pnpm tsx src/scripts/verificarEscrituras.ts
 */

import fs from 'fs';
import path from 'path';
import { getDbFilePath } from '../database/sqljs';

const BASE = process.env.SISTEMA_API_URL || 'http://localhost:3000';
const MARCA = 'ZZZ_PRUEBA_ESCRITURA';
const SEP = '='.repeat(78);

let SQL: any = null;
async function sqlEngine() {
  if (!SQL) {
    const initSqlJs = (await import('sql.js')).default as any;
    SQL = await initSqlJs();
  }
  return SQL;
}

/** Abre el .db tal como esta EN DISCO, con una instancia nueva. */
async function filasDesdeDisco(sql: string): Promise<any[][]> {
  const engine = await sqlEngine();
  const db = new engine.Database(fs.readFileSync(getDbFilePath()));
  try {
    const res = db.exec(sql);
    return res.length ? res[0].values : [];
  } finally {
    db.close();
  }
}

async function unoDesdeDisco(sql: string): Promise<any> {
  const f = await filasDesdeDisco(sql);
  return f.length ? f[0][0] : null;
}

async function http(metodo: string, ruta: string, cuerpo?: any) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* respuesta no-JSON */
  }
  return { status: res.status, json };
}

// ---------------------------------------------------------------- resultados
type Resultado = { nombre: string; ok: boolean; detalle: string };
const resultados: Resultado[] = [];

function anotar(nombre: string, ok: boolean, detalle: string) {
  resultados.push({ nombre, ok, detalle });
  console.log(`  ${ok ? 'PASA ' : 'FALLA'}  ${nombre}`);
  console.log(`         ${detalle}`);
}

const esc = (s: string) => String(s).replace(/'/g, "''");

async function main() {
  console.log(SEP);
  console.log('  VERIFICACION DE ESCRITURAS  —  lo que la reja de paridad no puede ver');
  console.log(SEP);
  console.log(`Servidor: ${BASE}`);

  const dbPath = getDbFilePath();
  console.log(`Base:     ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.log('\nABORTA: no existe el archivo de base. Arranca el servidor primero.');
    process.exit(1);
  }

  // El servidor tiene que estar arriba, si no todo falla por la razon equivocada.
  try {
    const salud = await http('GET', '/health');
    if (salud.status !== 200) throw new Error('status ' + salud.status);
  } catch (e: any) {
    console.log(`\nABORTA: el servidor no responde en ${BASE} (${e?.message || e}).`);
    console.log('Arrancalo con  pnpm dev:local  y volve a correr esto.');
    process.exit(1);
  }

  // Backup, porque esto escribe sobre datos reales.
  const sello = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(path.dirname(dbPath), `sistema_inventario.antes-de-verificar-${sello}.db`);
  fs.copyFileSync(dbPath, backup);
  console.log(`Backup:   ${path.basename(backup)}`);

  // Restos de una corrida anterior que murio a medias.
  const restos =
    Number(await unoDesdeDisco(`SELECT COUNT(*) FROM tela WHERE descripcion LIKE '${MARCA}%';`)) +
    Number(await unoDesdeDisco(`SELECT COUNT(*) FROM talla WHERE codigo LIKE '${MARCA}%';`));
  if (restos > 0) {
    console.log(`\nAviso: hay ${restos} fila(s) de una corrida anterior. Se limpian al final.`);
  }

  const colegioId = String(await unoDesdeDisco('SELECT id FROM colegio LIMIT 1;'));
  console.log(`Colegio:  ${colegioId}`);
  console.log('');

  // ==========================================================================
  console.log(SEP);
  console.log('  1. PERSISTENCIA  —  el bug que respondia 200 y no tocaba el disco');
  console.log(SEP);

  const objetivo = await filasDesdeDisco(`
    SELECT p.item_numero, t.codigo, pv.precio_bs
    FROM precio_venta pv
    JOIN producto p ON p.id = pv.producto_id
    JOIN talla t ON t.id = pv.talla_id
    ORDER BY p.item_numero, t.orden
    LIMIT 1;
  `);

  if (objetivo.length === 0) {
    anotar('precio de venta persiste en disco', false, 'No hay ninguna fila en precio_venta para usar de sonda.');
  } else {
    const [itemNumero, tallaCodigo, precioOriginal] = objetivo[0];
    const sonda = Math.round((Number(precioOriginal) + 7.77) * 100) / 100;
    const leerEnDisco = () =>
      unoDesdeDisco(`
        SELECT pv.precio_bs FROM precio_venta pv
        JOIN producto p ON p.id = pv.producto_id
        JOIN talla t ON t.id = pv.talla_id
        WHERE p.item_numero = ${Number(itemNumero)} AND t.codigo = '${esc(String(tallaCodigo))}';
      `);

    console.log(`  Sonda: item ${itemNumero}, talla ${tallaCodigo}, precio actual ${precioOriginal} -> ${sonda}`);

    const put = await http('PUT', '/api/calculo/precio-venta', {
      itemNumero: Number(itemNumero),
      tallaCodigo: String(tallaCodigo),
      precioBs: sonda,
    });

    const enDisco = Number(await leerEnDisco());
    anotar(
      'el precio de venta llega al DISCO, no solo a la memoria',
      put.status === 200 && Math.abs(enDisco - sonda) < 0.005,
      `PUT devolvio ${put.status}; en disco quedo ${enDisco} y se esperaba ${sonda}. ` +
        (Math.abs(enDisco - Number(precioOriginal)) < 0.005
          ? 'El disco todavia tiene el valor viejo: el flush no ocurrio.'
          : 'El flush del middleware funciono.')
    );

    // Restaurar.
    const vuelta = await http('PUT', '/api/calculo/precio-venta', {
      itemNumero: Number(itemNumero),
      tallaCodigo: String(tallaCodigo),
      precioBs: Number(precioOriginal),
    });
    const restaurado = Number(await leerEnDisco());
    anotar(
      'el valor original queda restaurado',
      vuelta.status === 200 && Math.abs(restaurado - Number(precioOriginal)) < 0.005,
      `en disco quedo ${restaurado}, original ${precioOriginal}.`
    );

    // ========================================================================
    console.log('');
    console.log(SEP);
    console.log('  2. NO MENTIR  —  antes devolvia success sin escribir nada');
    console.log(SEP);

    const itemFantasma = await http('PUT', '/api/calculo/precio-venta', {
      itemNumero: 9999,
      tallaCodigo: String(tallaCodigo),
      precioBs: 1,
    });
    anotar(
      'item inexistente devuelve 404, no success',
      itemFantasma.status === 404 && itemFantasma.json?.success === false,
      `status ${itemFantasma.status}, success ${JSON.stringify(itemFantasma.json?.success)}. ` +
        'Antes: 200 con success true y ninguna escritura.'
    );

    const tallaFantasma = await http('PUT', '/api/calculo/precio-venta', {
      itemNumero: Number(itemNumero),
      tallaCodigo: MARCA,
      precioBs: 1,
    });
    anotar(
      'talla inexistente devuelve 404, no success',
      tallaFantasma.status === 404 && tallaFantasma.json?.success === false,
      `status ${tallaFantasma.status}, success ${JSON.stringify(tallaFantasma.json?.success)}.`
    );

    const invFantasma = await http('PUT', '/api/calculo/inventario-unidades', {
      itemNumero: 9999,
      tallaCodigo: String(tallaCodigo),
      cantidad: 1,
    });
    anotar(
      'inventario con item inexistente devuelve 404',
      invFantasma.status === 404 && invFantasma.json?.success === false,
      `status ${invFantasma.status}, success ${JSON.stringify(invFantasma.json?.success)}.`
    );
  }

  // ==========================================================================
  console.log('');
  console.log(SEP);
  console.log('  3. CATALOGO COMPARTIDO  —  el filtro que escondia las telas genericas');
  console.log(SEP);

  const telasEnBase = Number(await unoDesdeDisco('SELECT COUNT(*) FROM tela;'));
  const compartidas = Number(await unoDesdeDisco('SELECT COUNT(*) FROM tela WHERE colegio_id IS NULL;'));

  const conColegio = await http('GET', `/api/telas?colegioId=${encodeURIComponent(colegioId)}`);
  const nCon = Array.isArray(conColegio.json?.data) ? conColegio.json.data.length : -1;
  anotar(
    'GET /api/telas?colegioId= devuelve las compartidas mas las del colegio',
    nCon === telasEnBase,
    `devolvio ${nCon}, en la base hay ${telasEnBase} (${compartidas} compartidas). ` +
      (nCon === telasEnBase - compartidas
        ? 'Devolvio SOLO las del colegio: el filtro sigue sin el IS NULL.'
        : nCon === telasEnBase
          ? 'Correcto.'
          : 'Conteo inesperado, mirar a mano.')
  );

  const sinColegio = await http('GET', '/api/telas');
  const nSin = Array.isArray(sinColegio.json?.data) ? sinColegio.json.data.length : -1;
  anotar(
    'GET /api/telas sin filtro devuelve todas',
    nSin === telasEnBase,
    `devolvio ${nSin}, esperado ${telasEnBase}.`
  );

  // ==========================================================================
  // Agregado despues de que este bug se escapara a las DOS rejas: la de paridad
  // no pide este endpoint, y la primera version de esta verificacion tampoco. El
  // filtro de /config devolvia 1 tela de 12 y CERO tallas de 16, asi que la
  // pantalla de Configuracion salia con la lista de tallas vacia.
  console.log('');
  console.log(SEP);
  console.log('  3b. PANTALLA DE CONFIGURACION  —  el endpoint que la alimenta');
  console.log(SEP);

  const tallasEnBase = Number(await unoDesdeDisco('SELECT COUNT(*) FROM talla;'));
  const cfg = await http('GET', `/api/colegios/${encodeURIComponent(colegioId)}/config`);
  const nCfgTelas = Array.isArray(cfg.json?.telas) ? cfg.json.telas.length : -1;
  const nCfgTallas = Array.isArray(cfg.json?.tallas) ? cfg.json.tallas.length : -1;

  anotar(
    'GET /api/colegios/:id/config trae TODAS las telas visibles',
    nCfgTelas === telasEnBase,
    `devolvio ${nCfgTelas} telas, en la base hay ${telasEnBase}. ` +
      (nCfgTelas === 1 ? 'Devolvio solo el tartan: el filtro sigue sin el IS NULL.' : 'Correcto.')
  );

  anotar(
    'GET /api/colegios/:id/config trae TODAS las tallas',
    nCfgTallas === tallasEnBase,
    `devolvio ${nCfgTallas} tallas, en la base hay ${tallasEnBase}. ` +
      (nCfgTallas === 0
        ? 'CERO: es el bug que dejaba la pestaña de tallas vacia.'
        : 'Correcto: la lista de tallas de la pantalla no sale vacia.')
  );

  // ==========================================================================
  console.log('');
  console.log(SEP);
  console.log("  4. CREACION  —  el literal 'default-colegio' y el colegio obligatorio");
  console.log(SEP);

  const telaNueva = await http('POST', '/api/telas', {
    descripcion: `${MARCA} tela`,
    anchoMts: 1.5,
    densidadGm2: 200,
    precioCompra: 50,
  });
  const colegioDeLaTela = await unoDesdeDisco(
    `SELECT colegio_id FROM tela WHERE descripcion = '${MARCA} tela' LIMIT 1;`
  );
  const existeTela = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM tela WHERE descripcion = '${MARCA} tela';`));
  anotar(
    'POST /api/telas sin colegio crea una tela COMPARTIDA y la persiste',
    telaNueva.status === 201 && existeTela === 1 && colegioDeLaTela === null,
    `status ${telaNueva.status}; en disco colegio_id = ${JSON.stringify(colegioDeLaTela)}. ` +
      (colegioDeLaTela === 'default-colegio'
        ? "Sigue poniendo el literal 'default-colegio'."
        : colegioDeLaTela === null
          ? 'NULL, correcto: la tela es de la empresa.'
          : 'Valor inesperado.')
  );

  const tallaNueva = await http('POST', '/api/tallas', {
    codigo: `${MARCA}1`,
    nombre: `${MARCA} talla`,
    orden: 999,
  });
  const colegioDeLaTalla = await unoDesdeDisco(
    `SELECT colegio_id FROM talla WHERE codigo = '${MARCA}1' LIMIT 1;`
  );
  const existeTalla = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM talla WHERE codigo = '${MARCA}1';`));
  anotar(
    'POST /api/tallas sin colegio crea una talla COMPARTIDA y la persiste',
    tallaNueva.status === 201 && existeTalla === 1 && colegioDeLaTalla === null,
    `status ${tallaNueva.status}; en disco colegio_id = ${JSON.stringify(colegioDeLaTalla)}. ` +
      (tallaNueva.status === 400
        ? 'Rechazo el pedido: el schema sigue exigiendo colegioId.'
        : colegioDeLaTalla === null
          ? 'NULL, correcto: la talla es vocabulario comun.'
          : 'Valor inesperado.')
  );

  // ==========================================================================
  // Agregado con el commit que repunto la matriz de accesorios a detalle_acc.
  //
  // Ni la reja de paridad ni los chequeos de arriba tocan este endpoint, asi que la
  // afirmacion central de ese commit —"se mueven exactamente tres celdas, el Ojal de
  // los items 16, 17 y 18, de 0,00 a 1,60"— quedaba sin verificar. Es el mismo hueco
  // que dejo pasar el bug de los filtros de colegio.ts: lo encontro el usuario
  // mirando la pantalla.
  console.log('');
  console.log(SEP);
  console.log('  5. MATRIZ DE ACCESORIOS  —  la receta ahora vive en detalle_acc');
  console.log(SEP);

  const matriz = await http('GET', `/api/inputs/accesorios-matriz?colegioId=${encodeURIComponent(colegioId)}`);
  anotar(
    'la matriz declara que su fuente es detalle_acc',
    matriz.json?.fuente === 'detalle_acc',
    `fuente = ${JSON.stringify(matriz.json?.fuente)}. ` +
      (matriz.json?.fuente === undefined ? 'Viene undefined: el server no tiene el codigo nuevo, reinicialo.' : 'Correcto.')
  );

  // El Ojal de la Falda plisada. El motor cobraba 1,60 Bs (2 unidades x 0,80) y la
  // pantalla mostraba 0,00, porque la columna del Excel se llama "Ojal Grande" y el
  // accesorio de la base "Ojal grande". Con las columnas saliendo del catalogo, esa
  // discrepancia de grafias no puede existir.
  const fila16 = (matriz.json?.data || []).find((f: any) => Number(f.itemNumero) === 16);
  const colOjal = fila16
    ? Object.keys(fila16.accesorios || {}).find((k) => k.toLowerCase() === 'ojal grande')
    : undefined;
  const costoOjal = colOjal ? Number(fila16.accesorios[colOjal]) : -1;
  anotar(
    'el Ojal grande de la Falda plisada muestra 1,60 y no 0,00',
    Math.abs(costoOjal - 1.6) < 0.005,
    `columna "${colOjal}" = ${costoOjal} Bs. ` +
      (costoOjal === 0
        ? 'Sigue en cero: la union por nombre no se elimino.'
        : costoOjal < 0
          ? 'No hay ninguna columna llamada "Ojal grande" en la respuesta.'
          : 'Correcto: la pantalla muestra lo que el motor cobra.')
  );

  // Escritura. Antes esto escribia en un Map de modulo y se perdia al reiniciar.
  const sondaAcc = await filasDesdeDisco(`
    SELECT p.item_numero, a.descripcion, d.cantidad_uso
    FROM detalle_acc d
    JOIN producto p ON p.id = d.producto_id
    JOIN accesorio a ON a.id = d.accesorio_id
    ORDER BY p.item_numero, a.descripcion
    LIMIT 1;
  `);

  if (sondaAcc.length === 0) {
    anotar('la cantidad de accesorio llega al disco', false, 'No hay ninguna linea en detalle_acc para usar de sonda.');
  } else {
    const [itemAcc, nombreAcc, cantOriginal] = sondaAcc[0];
    const cantSonda = Math.round((Number(cantOriginal) + 3) * 100) / 100;
    const leerCant = () =>
      unoDesdeDisco(`
        SELECT d.cantidad_uso FROM detalle_acc d
        JOIN producto p ON p.id = d.producto_id
        JOIN accesorio a ON a.id = d.accesorio_id
        WHERE p.item_numero = ${Number(itemAcc)} AND a.descripcion = '${esc(String(nombreAcc))}';
      `);

    console.log(`  Sonda: item ${itemAcc}, "${nombreAcc}", cantidad ${cantOriginal} -> ${cantSonda}`);

    const putAcc = await http('PUT', '/api/inputs/accesorios-matriz-celda', {
      itemNumero: Number(itemAcc),
      accesorioNombre: String(nombreAcc),
      cantidad: cantSonda,
    });
    const enDiscoAcc = Number(await leerCant());
    anotar(
      'la cantidad de accesorio llega al DISCO, no a un Map',
      putAcc.status === 200 && Math.abs(enDiscoAcc - cantSonda) < 0.005,
      `PUT devolvio ${putAcc.status}; en disco quedo ${enDiscoAcc} y se esperaba ${cantSonda}. ` +
        (Math.abs(enDiscoAcc - Number(cantOriginal)) < 0.005
          ? 'El disco tiene el valor viejo: se sigue escribiendo en memoria.'
          : 'Correcto: la edicion entra a detalle_acc, o sea que el costeo la ve.')
    );

    const vueltaAcc = await http('PUT', '/api/inputs/accesorios-matriz-celda', {
      itemNumero: Number(itemAcc),
      accesorioNombre: String(nombreAcc),
      cantidad: Number(cantOriginal),
    });
    const restauradoAcc = Number(await leerCant());
    anotar(
      'la cantidad original de accesorio queda restaurada',
      vueltaAcc.status === 200 && Math.abs(restauradoAcc - Number(cantOriginal)) < 0.005,
      `en disco quedo ${restauradoAcc}, original ${cantOriginal}.`
    );

    const accFantasma = await http('PUT', '/api/inputs/accesorios-matriz-celda', {
      itemNumero: Number(itemAcc),
      accesorioNombre: MARCA,
      cantidad: 1,
    });
    anotar(
      'un accesorio inexistente devuelve 404, no success',
      accFantasma.status === 404 && accFantasma.json?.success === false,
      `status ${accFantasma.status}, success ${JSON.stringify(accFantasma.json?.success)}. ` +
        'Antes cualquier nombre entraba al Map sin chequear nada.'
    );
  }

  // ---------------------------------------------------------------- limpieza
  console.log('');
  console.log(SEP);
  console.log('  LIMPIEZA');
  console.log(SEP);

  const idsTela = (await filasDesdeDisco(`SELECT id FROM tela WHERE descripcion LIKE '${MARCA}%';`)).map((f) => String(f[0]));
  const idsTalla = (await filasDesdeDisco(`SELECT id FROM talla WHERE codigo LIKE '${MARCA}%';`)).map((f) => String(f[0]));

  for (const id of idsTela) {
    const r = await http('DELETE', `/api/telas/${id}`);
    console.log(`  DELETE tela ${id}: ${r.status}`);
  }
  for (const id of idsTalla) {
    const r = await http('DELETE', `/api/tallas/${id}`);
    console.log(`  DELETE talla ${id}: ${r.status}`);
  }

  const quedanTela = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM tela WHERE descripcion LIKE '${MARCA}%';`));
  const quedanTalla = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM talla WHERE codigo LIKE '${MARCA}%';`));
  anotar(
    'las filas de prueba quedaron borradas EN DISCO',
    quedanTela === 0 && quedanTalla === 0,
    `quedan ${quedanTela} tela(s) y ${quedanTalla} talla(s). ` +
      (quedanTela + quedanTalla > 0
        ? 'El DELETE respondio pero el disco no cambio: el flush no cubre DELETE.'
        : 'Tambien confirma que el flush cubre DELETE.')
  );

  // ---------------------------------------------------------------- resumen
  const pasan = resultados.filter((r) => r.ok).length;
  const fallan = resultados.length - pasan;

  console.log('');
  console.log(SEP);
  console.log('  RESUMEN');
  console.log(SEP);
  for (const r of resultados) {
    console.log(`  ${r.ok ? 'PASA ' : 'FALLA'}  ${r.nombre}`);
  }
  console.log('');
  console.log(`  ${pasan} pasan, ${fallan} fallan, de ${resultados.length}.`);
  console.log('');
  if (fallan === 0) {
    console.log('  Los caminos de escritura quedan verificados contra el disco.');
    console.log(`  El backup ${path.basename(backup)} se puede borrar.`);
  } else {
    console.log('  HAY FALLAS. El backup esta en:');
    console.log(`    ${backup}`);
    console.log('  Los datos deberian estar intactos igual: la sonda se restaura y las');
    console.log('  filas de prueba se borran. Verificar antes de descartar el backup.');
  }
  console.log(SEP);

  process.exit(fallan === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nError inesperado:', e);
  console.error('Si quedaron filas con la marca ' + MARCA + ', borrarlas a mano.');
  process.exit(1);
});
