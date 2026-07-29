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
    Number(await unoDesdeDisco(`SELECT COUNT(*) FROM talla WHERE codigo LIKE '${MARCA}%';`)) +
    Number(await unoDesdeDisco(`SELECT COUNT(*) FROM accesorio WHERE descripcion LIKE '${MARCA}%';`));
  if (restos > 0) {
    console.log(`\nAviso: hay ${restos} fila(s) de una corrida anterior. Se limpian al final.`);
  }

  // ---------------------------------------------------------------- colegio
  //
  // Elegir el colegio CON PRENDAS, y no el primero que devuelva la base.
  //
  // La primera version hacia `SELECT id FROM colegio LIMIT 1`, que asumia que hay un
  // solo colegio. En cuanto aparecio el segundo, el script agarro el nuevo —sin
  // prendas— y reporto cinco fallas que no eran bugs: las telas del colegio eran 11 y
  // no 12 porque el tartan es del otro, y el item 16 no existia. Escribi un verificador
  // con el mismo supuesto de un solo colegio que veniamos sacando del sistema.
  const colegios = await filasDesdeDisco(`
    SELECT c.id, c.nombre, COUNT(p.id) AS prendas
    FROM colegio c
    LEFT JOIN producto p ON p.colegio_id = c.id
    GROUP BY c.id, c.nombre
    ORDER BY prendas DESC, c.nombre;
  `);

  if (colegios.length === 0) {
    console.log('\nABORTA: no hay ningun colegio en la base.');
    process.exit(1);
  }

  console.log(`Colegios:  ${colegios.length}`);
  for (const [cid, nombre, prendas] of colegios) {
    console.log(`  ${String(nombre).padEnd(24)} ${String(prendas).padStart(3)} prenda(s)  ${cid}`);
  }

  const colegioId = String(colegios[0][0]);
  const prendasDelColegio = Number(colegios[0][2]);
  console.log(`Se usa:    ${colegios[0][1]} (el que tiene mas prendas)`);

  if (prendasDelColegio === 0) {
    console.log('\nABORTA: ningun colegio tiene prendas, no hay nada que sondear.');
    process.exit(1);
  }

  // Las telas que ESE colegio tiene que ver: las compartidas mas las propias. Con un
  // solo colegio eso es el total de la tabla; con dos, no.
  const telasCompartidas = Number(await unoDesdeDisco('SELECT COUNT(*) FROM tela WHERE colegio_id IS NULL;'));
  const telasPropias = Number(await unoDesdeDisco(
    `SELECT COUNT(*) FROM tela WHERE colegio_id = '${esc(colegioId)}';`
  ));
  const telasVisibles = telasCompartidas + telasPropias;
  const telasTotales = Number(await unoDesdeDisco('SELECT COUNT(*) FROM tela;'));
  console.log(`Telas:     ${telasVisibles} visibles para este colegio (${telasCompartidas} compartidas + ${telasPropias} propias) de ${telasTotales} en la base`);
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

  const conColegio = await http('GET', `/api/telas?colegioId=${encodeURIComponent(colegioId)}`);
  const nCon = Array.isArray(conColegio.json?.data) ? conColegio.json.data.length : -1;
  anotar(
    'GET /api/telas?colegioId= devuelve las compartidas mas las del colegio',
    nCon === telasVisibles,
    `devolvio ${nCon}, visibles para este colegio ${telasVisibles} ` +
      `(${telasCompartidas} compartidas + ${telasPropias} propias). ` +
      (nCon === telasPropias && telasCompartidas > 0
        ? 'Devolvio SOLO las del colegio: el filtro sigue sin el IS NULL.'
        : nCon === telasVisibles
          ? 'Correcto.'
          : 'Conteo inesperado, mirar a mano.')
  );

  const sinColegio = await http('GET', '/api/telas');
  const nSin = Array.isArray(sinColegio.json?.data) ? sinColegio.json.data.length : -1;
  anotar(
    'GET /api/telas sin filtro devuelve todas',
    nSin === telasTotales,
    `devolvio ${nSin}, en la base hay ${telasTotales}.`
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

  const tallasEnBase = Number(await unoDesdeDisco(
    `SELECT COUNT(*) FROM talla WHERE colegio_id IS NULL OR colegio_id = '${esc(colegioId)}';`
  ));
  const cfg = await http('GET', `/api/colegios/${encodeURIComponent(colegioId)}/config`);
  const nCfgTelas = Array.isArray(cfg.json?.telas) ? cfg.json.telas.length : -1;
  const nCfgTallas = Array.isArray(cfg.json?.tallas) ? cfg.json.tallas.length : -1;

  anotar(
    'GET /api/colegios/:id/config trae TODAS las telas visibles',
    nCfgTelas === telasVisibles,
    `devolvio ${nCfgTelas} telas, visibles ${telasVisibles} ` +
      `(${telasCompartidas} compartidas + ${telasPropias} propias). ` +
      (nCfgTelas === telasPropias && telasCompartidas > 0
        ? 'Devolvio solo las propias: el filtro sigue sin el IS NULL.'
        : 'Correcto.')
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
  // Se busca la prenda que EFECTIVAMENTE lleva el Ojal, en vez de hardcodear el item
  // 16. Hardcodearlo asumia que existe la Falda plisada de Cambridge, y ese supuesto se
  // rompio en cuanto hubo un segundo colegio.
  const filasMatriz: any[] = matriz.json?.data || [];
  const colOjal = (matriz.json?.accesorios || []).find((k: string) => k.toLowerCase() === 'ojal grande');
  const conOjal = colOjal
    ? filasMatriz.filter((f: any) => Number(f.accesorios?.[colOjal] || 0) > 0)
    : [];

  if (!colOjal) {
    anotar(
      'el Ojal grande aparece como columna del catalogo',
      false,
      'No hay ninguna columna "Ojal grande" en la respuesta. Antes la columna venia del ' +
        'Excel y decia "Ojal Grande" con mayuscula; si desaparecio, revisar el catalogo.'
    );
  } else if (conOjal.length === 0) {
    anotar(
      'alguna prenda de este colegio lleva Ojal grande',
      false,
      `la columna "${colOjal}" existe pero ninguna de las ${filasMatriz.length} prendas de ` +
        'este colegio la usa. Con Cambridge cargado deberian ser la Falda plisada, el ' +
        'Jamper y el Vestido. Si este colegio es nuevo, es esperable y el chequeo no aplica.'
    );
  } else {
    const costoOjal = Number(conOjal[0].accesorios[colOjal]);
    anotar(
      'el Ojal grande cuesta 1,60 en la matriz, no 0,00',
      Math.abs(costoOjal - 1.6) < 0.005,
      `item ${conOjal[0].itemNumero} ${conOjal[0].descripcion}: columna "${colOjal}" = ${costoOjal} Bs ` +
        `(${conOjal.length} prenda(s) la usan). ` +
        (costoOjal === 0
          ? 'En cero: la union por nombre no se elimino.'
          : 'Correcto: la pantalla muestra lo que el motor cobra.')
    );
  }

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

  // Alta de insumo, agregado cuando la pantalla gano el formulario de Nuevo Insumo.
  // Verifica de paso que costoUnitario se DERIVA en el servidor: se manda solo
  // cantidadXUd y costoUdCompra, y el resultado tiene que ser la division.
  const insumoNuevo = await http('POST', '/api/accesorios', {
    descripcion: `${MARCA} insumo`,
    unidadCompra: 'bolsa',
    cantidadXUd: 4,
    costoUdCompra: 10,
  });
  const insumoEnDisco = await filasDesdeDisco(
    `SELECT colegio_id, costo_unitario FROM accesorio WHERE descripcion = '${MARCA} insumo' LIMIT 1;`
  );
  const colInsumo = insumoEnDisco.length ? insumoEnDisco[0][0] : 'sin fila';
  const costoInsumo = insumoEnDisco.length ? Number(insumoEnDisco[0][1]) : -1;
  anotar(
    'POST /api/accesorios sin colegio crea un insumo COMPARTIDO y deriva el costo',
    insumoNuevo.status === 201 && colInsumo === null && Math.abs(costoInsumo - 2.5) < 0.0005,
    `status ${insumoNuevo.status}; en disco colegio_id = ${JSON.stringify(colInsumo)}, ` +
      `costo unitario = ${costoInsumo} (10 / 4 = 2.5). ` +
      (insumoNuevo.status === 400
        ? 'Un 400 casi siempre significa que el server esta corriendo codigo viejo, de ' +
          'antes de que costoUnitario pasara a opcional: reinicialo. Mensaje: ' +
          JSON.stringify(insumoNuevo.json) + '. '
        : '') +
      (colInsumo !== null && colInsumo !== 'sin fila'
        ? 'Quedo con colegio: el insumo no seria del catalogo compartido.'
        : Math.abs(costoInsumo - 2.5) >= 0.0005
          ? 'El costo unitario no es la division: el servidor no lo derivo.'
          : 'Correcto.')
  );

  // Y la EDICION del insumo, que es donde estaba el bug de verdad: el PUT hacia
  // .set(body) sin recalcular costoUnitario, asi que corregir el costo de compra
  // dejaba el costo unitario viejo — y ese es el que multiplica la cantidad de uso en
  // el costeo de cada prenda. Corregir el precio de un boton no cambiaba el costo de
  // ninguna prenda, y nada avisaba.
  const idInsumo = insumoNuevo.json?.data?.id;
  if (!idInsumo) {
    anotar('PUT /api/accesorios/:id re-deriva el costo unitario', false,
      'No se pudo obtener el id del insumo recien creado.');
  } else {
    const editado = await http('PUT', `/api/accesorios/${idInsumo}`, {
      descripcion: `${MARCA} insumo`,
      unidadCompra: 'bolsa',
      cantidadXUd: 4,
      costoUdCompra: 20,
    });
    const costoTrasEdicion = Number(await unoDesdeDisco(
      `SELECT costo_unitario FROM accesorio WHERE id = '${esc(idInsumo)}';`
    ));
    anotar(
      'PUT /api/accesorios/:id re-deriva el costo unitario',
      editado.status === 200 && Math.abs(costoTrasEdicion - 5) < 0.0005,
      `se cambio el costo de compra de 10 a 20 con cantidad 4; en disco el costo ` +
        `unitario quedo en ${costoTrasEdicion} y debia ser 5. ` +
        (Math.abs(costoTrasEdicion - 2.5) < 0.0005
          ? 'Quedo en 2.5, el valor viejo: el PUT no re-derivo y el costeo usaria el precio anterior.'
          : Math.abs(costoTrasEdicion - 5) < 0.0005
            ? 'Correcto.'
            : 'Valor inesperado.')
    );
  }

  // ==========================================================================
  // 6) AISLAMIENTO ENTRE COLEGIOS  —  solo se puede medir con dos cargados
  //
  // Toda la Fase 6 se hizo a ciegas: con un solo colegio, una fuga de datos entre
  // colegios no se puede observar ni con la mejor reja. El inventario del barrido
  // señala DONDE podria haber fuga leyendo el codigo, pero no prueba que la haya.
  //
  // Con dos colegios en la base eso cambia: ahora se puede pedir los datos de uno y
  // exigir que no aparezcan los del otro. Estos chequeos no corren si hay uno solo.
  if (colegios.length < 2) {
    console.log('');
    console.log(SEP);
    console.log('  6. AISLAMIENTO ENTRE COLEGIOS  —  no aplica, hay un solo colegio');
    console.log(SEP);
    console.log('  Con un colegio cargado una fuga entre colegios es inobservable. Estos');
    console.log('  chequeos empiezan a correr solos cuando exista el segundo.');
  } else {
    console.log('');
    console.log(SEP);
    console.log('  6. AISLAMIENTO ENTRE COLEGIOS  —  hay ' + colegios.length + ', ahora se puede medir');
    console.log(SEP);

    // El || colegios[1] es para el tipo, no para la logica: dentro de este else hay al
    // menos dos colegios, asi que find() siempre encuentra uno. TypeScript no lo sabe.
    const otro: any[] = colegios.find((c: any[]) => String(c[0]) !== colegioId) || colegios[1];
    const otroId = String(otro[0]);
    const otroNombre = String(otro[1]);
    const prendasOtro = Number(otro[2]);
    console.log(`  Se compara contra: ${otroNombre} (${prendasOtro} prenda(s))`);

    // Cuantas prendas tiene cada uno segun el DISCO, que es la verdad.
    const enDiscoDelColegio = Number(await unoDesdeDisco(
      `SELECT COUNT(*) FROM producto WHERE colegio_id = '${esc(colegioId)}';`
    ));

    const prodFiltrados = await http('GET', `/api/productos?colegioId=${encodeURIComponent(colegioId)}`);
    const nProd = Array.isArray(prodFiltrados.json?.data) ? prodFiltrados.json.data.length : -1;
    anotar(
      'GET /api/productos?colegioId= devuelve SOLO las prendas de ese colegio',
      nProd === enDiscoDelColegio,
      `devolvio ${nProd}, en disco ese colegio tiene ${enDiscoDelColegio}. ` +
        (nProd > enDiscoDelColegio
          ? 'Devolvio mas: se estan filtrando prendas de otro colegio.'
          : 'Correcto.')
    );

    // La matriz de accesorios, que es la que se acaba de repuntar a detalle_acc.
    const matrizFiltrada = await http('GET', `/api/inputs/accesorios-matriz?colegioId=${encodeURIComponent(colegioId)}`);
    const nMatriz = Array.isArray(matrizFiltrada.json?.data) ? matrizFiltrada.json.data.length : -1;
    anotar(
      'la matriz de accesorios se acota al colegio pedido',
      nMatriz === enDiscoDelColegio,
      `devolvio ${nMatriz} prenda(s), ese colegio tiene ${enDiscoDelColegio}. ` +
        (nMatriz > enDiscoDelColegio ? 'Incluye prendas de otro colegio.' : 'Correcto.')
    );

    // Y la que mas importa: que un insumo exclusivo de un colegio NO se le pueda
    // asignar a una prenda del otro. Esto es una ESCRITURA cruzada, la clase de falla
    // mas grave que aparecio hoy.
    const exclusivoDelOtro = await filasDesdeDisco(
      `SELECT id, descripcion FROM accesorio WHERE colegio_id = '${esc(otroId)}' LIMIT 1;`
    );
    const prendaPropia = await filasDesdeDisco(
      `SELECT id, item_numero FROM producto WHERE colegio_id = '${esc(colegioId)}' LIMIT 1;`
    );

    if (exclusivoDelOtro.length === 0 || prendaPropia.length === 0) {
      console.log('  (sin insumo exclusivo del otro colegio o sin prenda propia, no se puede probar');
      console.log('   la asignacion cruzada)');
    } else {
      const [accAjenoId, accAjenoNombre] = exclusivoDelOtro[0];
      const [prendaId] = prendaPropia[0];
      const cruzado = await http('POST', `/api/productos/${prendaId}/accesorios`, {
        accesorioId: String(accAjenoId),
        cantidadUso: 1,
      });
      anotar(
        'un insumo exclusivo de otro colegio NO se puede asignar a esta prenda',
        cruzado.status === 409 && cruzado.json?.success === false,
        `se intento asignar "${accAjenoNombre}" (de ${otroNombre}) y el server devolvio ` +
          `${cruzado.status}. ` +
          (cruzado.status === 201
            ? 'LO ACEPTO: se asigno un insumo de otro colegio y hay que revisar ' +
              'accesorioUsablePorProducto.'
            : 'Correcto: rechazado con 409.')
      );

      // Si por algun motivo lo acepto, se deshace para no dejar basura.
      if (cruzado.status === 201 && cruzado.json?.data?.id) {
        await http('DELETE', `/api/productos/${prendaId}/accesorios/${cruzado.json.data.id}`);
        console.log('  (se deshizo la asignacion cruzada que el server acepto)');
      }
    }
  }

  // ---------------------------------------------------------------- limpieza
  console.log('');
  console.log(SEP);
  console.log('  LIMPIEZA');
  console.log(SEP);

  const idsTela = (await filasDesdeDisco(`SELECT id FROM tela WHERE descripcion LIKE '${MARCA}%';`)).map((f) => String(f[0]));
  const idsTalla = (await filasDesdeDisco(`SELECT id FROM talla WHERE codigo LIKE '${MARCA}%';`)).map((f) => String(f[0]));
  const idsAcc = (await filasDesdeDisco(`SELECT id FROM accesorio WHERE descripcion LIKE '${MARCA}%';`)).map((f) => String(f[0]));

  for (const id of idsTela) {
    const r = await http('DELETE', `/api/telas/${id}`);
    console.log(`  DELETE tela ${id}: ${r.status}`);
  }
  for (const id of idsTalla) {
    const r = await http('DELETE', `/api/tallas/${id}`);
    console.log(`  DELETE talla ${id}: ${r.status}`);
  }
  for (const id of idsAcc) {
    const r = await http('DELETE', `/api/accesorios/${id}`);
    console.log(`  DELETE insumo ${id}: ${r.status}`);
  }

  const quedanTela = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM tela WHERE descripcion LIKE '${MARCA}%';`));
  const quedanTalla = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM talla WHERE codigo LIKE '${MARCA}%';`));
  const quedanAcc = Number(await unoDesdeDisco(`SELECT COUNT(*) FROM accesorio WHERE descripcion LIKE '${MARCA}%';`));
  anotar(
    'las filas de prueba quedaron borradas EN DISCO',
    quedanTela === 0 && quedanTalla === 0 && quedanAcc === 0,
    `quedan ${quedanTela} tela(s), ${quedanTalla} talla(s) y ${quedanAcc} insumo(s). ` +
      (quedanTela + quedanTalla + quedanAcc > 0
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
