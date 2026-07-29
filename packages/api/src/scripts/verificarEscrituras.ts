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

/**
 * Tercer estado: el chequeo corrio pero NO PUEDE distinguir el exito del fracaso con
 * los datos que hay.
 *
 * Existe porque la seccion de aislamiento cayo en esa trampa: con el segundo colegio
 * en cero prendas, "devolvio 27 y el colegio tiene 27" se cumple igual si el filtro
 * esta roto, porque no hay filas ajenas que se puedan colar. Reportarlo como PASA da
 * confianza sin dar evidencia, y un verde vacio es peor que no tener chequeo.
 */
const inconclusos: Resultado[] = [];

function noConcluye(nombre: string, detalle: string) {
  inconclusos.push({ nombre, ok: false, detalle });
  console.log(`  ????  ${nombre}`);
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
    // Con el otro colegio SIN prendas, los dos conteos de abajo no pueden fallar: si el
    // filtro estuviera roto y devolviera todo, "todo" seria igual a "las de este
    // colegio". Un chequeo que no puede distinguir el exito del fracaso no debe decir
    // PASA, porque un verde vacio es peor que no tener chequeo: da confianza sin dar
    // evidencia. Se reportan como NO CONCLUYENTES.
    const puedeDiscriminar = prendasOtro > 0;
    if (!puedeDiscriminar) {
      console.log('');
      console.log(`  ATENCION: ${otroNombre} no tiene prendas, asi que los conteos de abajo`);
      console.log('  no discriminan. Una consulta sin filtro devolveria el mismo numero que una');
      console.log('  filtrada, porque no hay filas ajenas que se puedan colar.');
      console.log('');
      console.log('  Para que esto mida de verdad hace falta UNA prenda en el otro colegio.');
      console.log('  Se crea desde Configuracion, pestaña Prendas & Recetas, con el ambito en ese');
      console.log('  colegio, y despues se le copia la receta de la prenda equivalente con el');
      console.log('  boton Copiar. Es exactamente el alta de colegio para la que se hizo todo esto.');
      console.log('');
    }


    // Cuantas prendas tiene cada uno segun el DISCO, que es la verdad.
    const enDiscoDelColegio = Number(await unoDesdeDisco(
      `SELECT COUNT(*) FROM producto WHERE colegio_id = '${esc(colegioId)}';`
    ));

    const prodFiltrados = await http('GET', `/api/productos?colegioId=${encodeURIComponent(colegioId)}`);
    const nProd = Array.isArray(prodFiltrados.json?.data) ? prodFiltrados.json.data.length : -1;
    const detalleProd =
      `devolvio ${nProd}, en disco ese colegio tiene ${enDiscoDelColegio}` +
      ` y el otro tiene ${prendasOtro}. `;

    if (!puedeDiscriminar) {
      noConcluye(
        'GET /api/productos?colegioId= devuelve SOLO las prendas de ese colegio',
        detalleProd + 'No discrimina: sin prendas en el otro colegio, un filtro roto daria el mismo numero.'
      );
    } else {
      anotar(
        'GET /api/productos?colegioId= devuelve SOLO las prendas de ese colegio',
        nProd === enDiscoDelColegio,
        detalleProd +
          (nProd > enDiscoDelColegio
            ? 'Devolvio mas: se estan colando prendas de otro colegio.'
            : 'Correcto, y esta vez con evidencia: si el filtro fallara, se verian las del otro.')
      );
    }

    // La matriz de accesorios, que es la que se acaba de repuntar a detalle_acc.
    const matrizFiltrada = await http('GET', `/api/inputs/accesorios-matriz?colegioId=${encodeURIComponent(colegioId)}`);
    const nMatriz = Array.isArray(matrizFiltrada.json?.data) ? matrizFiltrada.json.data.length : -1;
    const detalleMatriz = `devolvio ${nMatriz} prenda(s), ese colegio tiene ${enDiscoDelColegio}. `;

    if (!puedeDiscriminar) {
      noConcluye(
        'la matriz de accesorios se acota al colegio pedido',
        detalleMatriz + 'No discrimina, por la misma razon.'
      );
    } else {
      anotar(
        'la matriz de accesorios se acota al colegio pedido',
        nMatriz === enDiscoDelColegio,
        detalleMatriz + (nMatriz > enDiscoDelColegio ? 'Incluye prendas de otro colegio.' : 'Correcto.')
      );
    }

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
      // ESTO ERA UN console.log, y por eso no contaba para nada. El chequeo mas importante de
      // la seccion —una ESCRITURA de un colegio sobre datos del otro— se salteaba con dos
      // lineas en consola que nadie mira, y el resumen decia "todo verde".
      //
      // Es la misma falla que ya corregi una vez en esta seccion: un chequeo que no puede
      // medir tiene que DECIRLO en el resumen, porque un verde vacio es peor que no tener
      // chequeo. Sin chequeo uno sabe que no sabe. Saltearlo en silencio es peor todavia que
      // un verde vacuo: no queda ni el rastro.
      noConcluye(
        'asignar un insumo exclusivo de otro colegio se rechaza',
        `El colegio de comparacion no tiene ningun insumo exclusivo (medido: 0), asi que no hay ` +
          `con que intentar la asignacion cruzada. Para que este chequeo mida, ese colegio ` +
          `necesita al menos un insumo propio: se crea en Configuracion > Insumos poniendole ` +
          `Ambito = ese colegio. Es justo lo que le falta a su Camisa Formal, que hoy no lleva ` +
          `escudo porque el de Cambridge no puede viajar.`
      );
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

  // ==========================================================================
  // 7) EXPORTACIONES  —  las que volcaban tablas enteras
  console.log('');
  console.log(SEP);
  console.log('  7. EXPORTACIONES  —  filtros que no filtraban');
  console.log(SEP);

  const invSinFiltro = await http('GET', '/api/export/inventario');
  const nInvTodo = invSinFiltro.json?.data?.inventario?.length ?? -1;
  const invDelColegio = await http('GET', `/api/export/inventario?colegioId=${encodeURIComponent(colegioId)}`);
  const filasInv: any[] = invDelColegio.json?.data?.inventario || [];
  const ajenas = filasInv.filter((f) => f.colegioId && f.colegioId !== colegioId);

  anotar(
    'la exportacion de inventario trae el colegio de cada fila',
    filasInv.length > 0 && filasInv.every((f) => f.colegioId),
    `${filasInv.length} fila(s), ${filasInv.filter((f) => f.colegioId).length} con colegioId. ` +
      'Antes la exportacion no incluia el colegio, asi que era imposible saber de quien era cada fila.'
  );

  anotar(
    'ninguna fila exportada pertenece a otro colegio',
    ajenas.length === 0,
    ajenas.length === 0
      ? `las ${filasInv.length} filas son del colegio pedido.`
      : `${ajenas.length} fila(s) de otro colegio se colaron en la exportacion.`
  );

  anotar(
    'la exportacion declara su alcance',
    typeof invSinFiltro.json?.data?.alcance === 'string' &&
      invSinFiltro.json.data.alcance.includes('EMPRESA'),
    `sin filtro el alcance dice ${JSON.stringify(invSinFiltro.json?.data?.alcance)} ` +
      `sobre ${nInvTodo} fila(s). Un volcado de toda la empresa tiene que decir que lo es.`
  );

  // Este SI discrimina aunque el otro colegio este vacio: filtrar por una prenda dentro
  // del mismo colegio reduce el conteo. Antes /generar ignoraba `filtros` por completo,
  // asi que devolvia lo mismo con filtro y sin filtro.
  const unaPrenda = await filasDesdeDisco(
    `SELECT id FROM producto WHERE colegio_id = '${esc(colegioId)}' LIMIT 1;`
  );
  if (unaPrenda.length === 0) {
    noConcluye('POST /api/export/generar aplica sus filtros', 'No hay ninguna prenda para filtrar.');
  } else {
    const idPrenda = String(unaPrenda[0][0]);
    const filasEsperadas = Number(await unoDesdeDisco(
      `SELECT COUNT(*) FROM inventario WHERE producto_id = '${esc(idPrenda)}';`
    ));
    const gen = await http('POST', '/api/export/generar', {
      tipo: 'inventario',
      filtros: { productoId: idPrenda },
    });
    const nGen = gen.json?.data?.resultados?.length ?? -1;
    anotar(
      'POST /api/export/generar aplica sus filtros',
      nGen === filasEsperadas && nGen < nInvTodo,
      `filtrando por una prenda devolvio ${nGen}, en disco esa prenda tiene ${filasEsperadas} ` +
        `fila(s) de inventario, y sin filtro son ${nInvTodo}. ` +
        (nGen === nInvTodo
          ? 'Devolvio TODO: el parametro filtros se sigue ignorando.'
          : 'Correcto, y discrimina: el conteo bajo respecto del total.')
    );
  }

  // ==========================================================================
  // 8) COPIAR DE UNA PRENDA DE REFERENCIA
  //
  // LA VERSION ANTERIOR DE ESTA SECCION ESTABA MAL, de las dos formas que este proyecto ya
  // conoce, y lo digo aca porque el error es mas instructivo que el chequeo.
  //
  // Decia: "copiar sobre una prenda que ya tiene todo cargado, sin marcar reemplazar, no
  // debe tocar nada", y para medirlo tomaba las DOS PRIMERAS prendas del colegio y leia el
  // peso de la primera talla del destino. En la base real ese peso vale CERO —el item 1 no
  // se hace en la talla mas chica— y cero es EXACTAMENTE el criterio de vacio. O sea que la
  // copia hizo lo correcto llenandolo, y el chequeo lo reporto como falla.
  //
  //   1. NO DISCRIMINABA. Muestreaba una posicion donde la propiedad no existe, igual que
  //      los chequeos de aislamiento que pasaban en verde con el segundo colegio vacio.
  //      Ahi el defecto daba un verde falso; aca un rojo falso. La causa es la misma:
  //      medir una propiedad sobre datos que no la ejercen.
  //
  //   2. Y PEOR: MUTABA DATOS REALES. Al escribir sobre el item 1 de un colegio de verdad y
  //      no restaurar nada, dejaba pesos, mano de obra y lineas de receta cambiadas para
  //      siempre. Escribi en su propio comentario que "se puede hacer SIN mutar datos" y
  //      despues escribi lo contrario. Una verificacion que corrompe lo que verifica es
  //      peor que no tenerla.
  //
  // ESTA VERSION CREA SU PROPIA PRENDA, le carga un peso conocido, y la borra al final. Con
  // eso las dos cosas se arreglan solas: el peso cargado es distinto de cero, asi que la
  // propiedad se puede medir, y nada real se toca.
  //
  // Y mide las DOS direcciones, porque "no pisa" sin "si pisa cuando se lo piden" es medio
  // chequeo: una copia que no hiciera nada en absoluto pasaria la primera mitad.
  console.log('');
  console.log(SEP);
  console.log('  8. COPIAR DE UNA PRENDA DE REFERENCIA');
  console.log(SEP);

  // Origen: una prenda del colegio que tenga receta. Copiar de una receta vacia da 400.
  const origen = await filasDesdeDisco(`
    SELECT p.id, p.item_numero, p.descripcion, p.tela_id, COUNT(d.id) AS lineas
    FROM producto p
    LEFT JOIN detalle_acc d ON d.producto_id = p.id
    WHERE p.colegio_id = '${esc(colegioId)}'
    GROUP BY p.id
    HAVING lineas > 0
    ORDER BY lineas DESC
    LIMIT 1;
  `);

  if (origen.length === 0) {
    noConcluye(
      'copiar de referencia respeta lo ya cargado',
      'Ninguna prenda del colegio tiene receta, asi que no hay de donde copiar.'
    );
  } else {
    const [origenId, origenItem, origenDesc, origenTela] = origen[0];
    const FACTOR_SONDA = 3.25;
    const PESO_SONDA = 137.5;

    // --------------------------------------------------------- prenda de prueba
    const alta = await http('POST', `/api/colegios/${colegioId}/prendas`, {
      descripcion: `${MARCA} copia`,
      telaId: origenTela,
      factorComplejidad: FACTOR_SONDA,
    });
    const destinoId = alta.json?.data?.id;

    anotar(
      'el alta crea la prenda CON sus filas por talla',
      alta.json?.success === true && !!destinoId && (alta.json?.tallas?.creadas || 0) > 0,
      `status ${alta.status}, ${alta.json?.tallas?.creadas} talla(s). Con el filtro de la Fase 5 ` +
        'mal escrito esto daba CERO tallas y la prenda nacia imposible de costear, con status 200.'
    );

    if (!destinoId) {
      noConcluye('copiar de referencia respeta lo ya cargado', 'No se pudo crear la prenda de prueba.');
    } else {
      const pedidoVacio = await http('POST', `/api/productos/${destinoId}/copiar-de/${origenId}`, {
        receta: false, pesos: false, manoObra: false, factor: false, tela: false,
      });
      anotar(
        'un pedido de copia sin nada marcado devuelve 400',
        pedidoVacio.status === 400 && pedidoVacio.json?.success === false,
        `status ${pedidoVacio.status}. Un pedido vacio no es un error del sistema, es un pedido ` +
          'vacio: se dice, en vez de responder success sobre cero trabajo.'
      );

      // ------------------------------------- se carga UN peso, para que haya que respetar
      const primeraTalla = await filasDesdeDisco(`
        SELECT t.id, t.codigo FROM peso_mat_prima p
        JOIN talla t ON t.id = p.talla_id
        WHERE p.producto_id = '${esc(String(destinoId))}'
        ORDER BY t.orden LIMIT 1;
      `);
      const tallaCodigo = primeraTalla.length ? String(primeraTalla[0][1]) : null;

      await http('PUT', '/api/inputs/peso-mat-prima', {
        productoId: destinoId,
        tallaCodigo,
        pesoExacto: PESO_SONDA,
      });

      const pesoCargado = Number(await unoDesdeDisco(`
        SELECT p.peso_con_merma FROM peso_mat_prima p
        JOIN talla t ON t.id = p.talla_id
        WHERE p.producto_id = '${esc(String(destinoId))}' AND t.codigo = '${esc(String(tallaCodigo))}';
      `));

      anotar(
        'la sonda de peso quedo cargada EN DISCO',
        pesoCargado > 0,
        `talla ${tallaCodigo}: peso con merma ${pesoCargado} g a partir de ${PESO_SONDA} g exactos. ` +
          'Sin un peso distinto de cero, el chequeo siguiente no puede distinguir "respeto el dato" ' +
          'de "no habia dato".'
      );

      const cerosAntes = Number(await unoDesdeDisco(`
        SELECT COUNT(*) FROM peso_mat_prima
        WHERE producto_id = '${esc(String(destinoId))}' AND peso_con_merma = 0;
      `));

      // ------------------------------------------------------- SIN reemplazar
      const sinReemplazar = await http('POST', `/api/productos/${destinoId}/copiar-de/${origenId}`, {
        receta: true, pesos: true, manoObra: true, factor: true, tela: false, reemplazar: false,
      });

      const pesoTrasCopia = Number(await unoDesdeDisco(`
        SELECT p.peso_con_merma FROM peso_mat_prima p
        JOIN talla t ON t.id = p.talla_id
        WHERE p.producto_id = '${esc(String(destinoId))}' AND t.codigo = '${esc(String(tallaCodigo))}';
      `));
      const factorTrasCopia = Number(await unoDesdeDisco(
        `SELECT factor_complejidad FROM producto WHERE id = '${esc(String(destinoId))}';`
      ));
      const cerosDespues = Number(await unoDesdeDisco(`
        SELECT COUNT(*) FROM peso_mat_prima
        WHERE producto_id = '${esc(String(destinoId))}' AND peso_con_merma = 0;
      `));

      anotar(
        'copiar SIN reemplazar no pisa el peso que ya estaba cargado',
        sinReemplazar.status === 201 && Math.abs(pesoTrasCopia - pesoCargado) < 0.0005,
        `desde item ${origenItem} (${origenDesc}): la talla ${tallaCodigo} valia ${pesoCargado} y ` +
          `quedo en ${pesoTrasCopia}. ` +
          (Math.abs(pesoTrasCopia - pesoCargado) >= 0.0005
            ? 'CAMBIO: la copia piso un dato cargado sin que se lo pidieran.'
            : `Correcto, y el server lo reporta: ${sinReemplazar.json?.pesos?.saltados} peso(s) sin tocar.`)
      );

      // GUARDA CONTRA LA VACUIDAD. Sin esto, una copia que no hiciera absolutamente nada
      // pasaria el chequeo de arriba. Que los ceros hayan bajado prueba que SI escribio.
      anotar(
        'y aun asi llena los pesos que estaban en cero',
        cerosDespues < cerosAntes,
        `pesos en cero: ${cerosAntes} antes, ${cerosDespues} despues, y el server dice ` +
          `${sinReemplazar.json?.pesos?.actualizados} actualizado(s). Si este numero no bajara, ` +
          'el chequeo anterior estaria pasando porque la copia no hace nada, no porque respete.'
      );

      anotar(
        'copiar SIN reemplazar no pisa un factor distinto del default',
        Math.abs(factorTrasCopia - FACTOR_SONDA) < 0.0005,
        `el factor era ${FACTOR_SONDA} —puesto a proposito distinto de 1— y quedo en ${factorTrasCopia}. ` +
          'Un factor distinto de 1 es una decision de alguien: copiar no debe deshacerla.'
      );

      // ------------------------------------------------------- CON reemplazar
      const conReemplazar = await http('POST', `/api/productos/${destinoId}/copiar-de/${origenId}`, {
        pesos: true, factor: true, receta: false, manoObra: false, tela: false, reemplazar: true,
      });

      const pesoTrasReemplazo = Number(await unoDesdeDisco(`
        SELECT p.peso_con_merma FROM peso_mat_prima p
        JOIN talla t ON t.id = p.talla_id
        WHERE p.producto_id = '${esc(String(destinoId))}' AND t.codigo = '${esc(String(tallaCodigo))}';
      `));

      anotar(
        'copiar CON reemplazar SI pisa el peso cargado',
        conReemplazar.status === 201 && Math.abs(pesoTrasReemplazo - pesoCargado) >= 0.0005,
        `la talla ${tallaCodigo} paso de ${pesoTrasCopia} a ${pesoTrasReemplazo}. ` +
          'Es la otra mitad de la propiedad: sin este chequeo, una copia que nunca escribiera ' +
          'nada pasaria por prudente.'
      );

      const origenFantasma = await http('POST', `/api/productos/${destinoId}/copiar-de/${MARCA}`, {
        receta: true,
      });
      anotar(
        'copiar de una prenda inexistente devuelve 404',
        origenFantasma.status === 404 && origenFantasma.json?.success === false,
        `status ${origenFantasma.status}, success ${JSON.stringify(origenFantasma.json?.success)}.`
      );

      // ------------------------------------------- borrado: se niega, y despues cumple
      //
      // La prenda de prueba ya tiene receta, pesos y mano de obra, o sea trabajo humano a
      // los ojos del endpoint. Eso la vuelve el sujeto ideal para probar las dos ramas del
      // DELETE nuevo sin arriesgar nada.
      const borradoSinForzar = await http('DELETE', `/api/productos/${destinoId}`);
      anotar(
        'DELETE se niega a borrar una prenda con datos cargados',
        borradoSinForzar.status === 409 && borradoSinForzar.json?.success === false,
        `status ${borradoSinForzar.status}. Antes este endpoint borraba la prenda y dejaba VIVAS ` +
          'sus filas hijas: con las foreign keys apagadas, una fabrica de huerfanas.'
      );

      const borrado = await http('DELETE', `/api/productos/${destinoId}?forzar=true`);
      const quedaPrenda = Number(await unoDesdeDisco(
        `SELECT COUNT(*) FROM producto WHERE id = '${esc(String(destinoId))}';`
      ));
      let hijasVivas = 0;
      for (const t of ['detalle_acc', 'precio_venta', 'peso_mat_prima', 'mano_obra', 'inventario']) {
        hijasVivas += Number(await unoDesdeDisco(
          `SELECT COUNT(*) FROM ${t} WHERE producto_id = '${esc(String(destinoId))}';`
        ));
      }

      anotar(
        'DELETE con forzar borra la prenda Y todas sus hijas, en disco',
        borrado.status === 200 && quedaPrenda === 0 && hijasVivas === 0,
        `status ${borrado.status}, ${borrado.json?.totalFilasHijas} fila(s) hija(s) borradas. ` +
          `En disco quedan ${quedaPrenda} prenda(s) y ${hijasVivas} fila(s) hija(s), y las dos ` +
          'tienen que ser cero: una hija sin padre es invisible para toda pantalla y contada ' +
          'en los totales sin filtro.'
      );
    }
  }

  // ==========================================================================
  // 9) FASE 6 EN precio.ts Y producto.ts
  //
  // precio_venta e historico_precio NO tienen colegio_id: son tablas derivadas y la unica
  // forma de acotarlas es pasando por producto. Ninguno de los siete endpoints de precio.ts
  // lo hacia, asi que GET /api/precios devolvia los precios de TODOS los colegios y
  // /exportar/costos hacia un volcado completo —el peor lugar para una fuga, porque el
  // resultado SALE del sistema.
  //
  // Y producto.ts tenia el agujero de la huerfana en DOS endpoints mas: POST / no validaba
  // el colegio, y PUT /:id aceptaba colegioId sin validarlo, asi que podia mover una prenda
  // a un colegio inexistente.
  // ==========================================================================
  console.log('');
  console.log(SEP);
  console.log('  9. FASE 6  —  precios y prendas acotados por colegio');
  console.log(SEP);

  const dosColegios = await filasDesdeDisco('SELECT id, nombre FROM colegio ORDER BY nombre;');
  const totalPrecios = Number(await unoDesdeDisco('SELECT COUNT(*) FROM precio_venta;'));

  if (dosColegios.length < 2) {
    noConcluye(
      'los precios se acotan por colegio',
      'Hace falta un segundo colegio: con uno solo, filtrar y no filtrar dan lo mismo.'
    );
  } else {
    const colA = String(dosColegios[0][0]);
    const nomA = String(dosColegios[0][1]);
    const colB = String(dosColegios[1][0]);
    const nomB = String(dosColegios[1][1]);

    const enDiscoB = Number(await unoDesdeDisco(`
      SELECT COUNT(*) FROM precio_venta pv
      JOIN producto p ON p.id = pv.producto_id
      WHERE p.colegio_id = '${esc(colB)}';
    `));

    const preciosB = await http('GET', `/api/precios?colegioId=${colB}`);
    const devueltos = (preciosB.json?.data || []).length;
    const ajenos = (preciosB.json?.data || []).filter((r: any) => r.colegioId && r.colegioId !== colB).length;

    anotar(
      'GET /api/precios?colegioId= devuelve SOLO los precios de ese colegio',
      preciosB.json?.success === true && devueltos === enDiscoB && ajenos === 0 && enDiscoB < totalPrecios,
      `${nomB}: devolvio ${devueltos}, en disco tiene ${enDiscoB}, y en toda la empresa hay ` +
        `${totalPrecios}. ${ajenos} fila(s) de otro colegio. Discrimina: ${enDiscoB} es MENOR que ` +
        `${totalPrecios}, asi que un filtro roto se veria.`
    );

    const sinFiltro = await http('GET', '/api/precios');
    anotar(
      'GET /api/precios sin filtro declara que es TODA LA EMPRESA',
      sinFiltro.json?.alcance?.tipo === 'empresa' && (sinFiltro.json?.data || []).length === totalPrecios,
      `alcance "${sinFiltro.json?.alcance?.descripcion}" sobre ${(sinFiltro.json?.data || []).length} ` +
        `fila(s) de ${totalPrecios}. Sin el alcance declarado, el volcado de la empresa y el de un ` +
        'colegio se ven iguales desde afuera.'
    );

    const expo = await http('GET', `/api/precios/exportar/costos?colegioId=${colB}`);
    const expoFilas = expo.json?.data || [];
    anotar(
      'la exportacion de precios se acota y trae el numero de item',
      expo.json?.success === true &&
        expoFilas.length === enDiscoB &&
        expoFilas.every((r: any) => r.colegioId === colB && r.itemNumero !== undefined),
      `${expoFilas.length} fila(s), todas de ${nomB} y con itemNumero. Una exportacion sin el ` +
        'numero de item obliga a cruzarla a mano contra otra planilla.'
    );

    // --------------------------------------------- huerfanos por falta de validacion
    const unaTalla = String(await unoDesdeDisco('SELECT id FROM talla LIMIT 1;'));
    const precioHuerfano = await http('POST', '/api/precios', {
      productoId: MARCA, tallaId: unaTalla, precioBs: 99.99,
    });
    anotar(
      'POST /api/precios con una prenda inexistente devuelve 404',
      precioHuerfano.status === 404 && precioHuerfano.json?.success === false,
      `status ${precioHuerfano.status}. Antes la fila entraba: un precio huerfano es invisible en ` +
        'toda pantalla que pase por producto y se suma en los totales sin filtro.'
    );

    const borradoFantasma = await http('DELETE', `/api/precios/${MARCA}`);
    anotar(
      'DELETE /api/precios de un id inexistente devuelve 404, no success',
      borradoFantasma.status === 404 && borradoFantasma.json?.success === false,
      `status ${borradoFantasma.status}. Antes respondia "Precio eliminado exitosamente" habiendo ` +
        'borrado cero filas. Es la familia de defecto que aparecio cinco veces en esta sesion.'
    );

    // ------------------------------------------------- prendas: dueño y colegio destino
    const prendaDeA = String(await unoDesdeDisco(
      `SELECT id FROM producto WHERE colegio_id = '${esc(colA)}' LIMIT 1;`
    ));

    const ajena = await http('GET', `/api/productos/${prendaDeA}?colegioId=${colB}`);
    anotar(
      'GET /api/productos/:id no entrega una prenda de otro colegio',
      ajena.status === 404 && ajena.json?.success === false,
      `pidiendo una prenda de ${nomA} como si fuera de ${nomB}: status ${ajena.status}. Es 404 y no ` +
        '403 a proposito: un 403 confirmaria que la prenda existe en otro colegio.'
    );

    const mudanzaImposible = await http('PUT', `/api/productos/${prendaDeA}`, { colegioId: MARCA });
    const siguePerteneciendo = String(await unoDesdeDisco(
      `SELECT colegio_id FROM producto WHERE id = '${esc(prendaDeA)}';`
    ));
    anotar(
      'PUT /api/productos/:id no mueve una prenda a un colegio inexistente',
      mudanzaImposible.status === 404 && siguePerteneciendo === colA,
      `status ${mudanzaImposible.status}, y en disco la prenda sigue en ${nomA}. Antes este PUT ` +
        'aceptaba cualquier colegioId: un solo pedido creaba una huerfana, que es el mismo estado ' +
        'que hubo que limpiar a mano esta mañana.'
    );

    const altaImposible = await http('POST', '/api/productos', {
      colegioId: MARCA, descripcion: `${MARCA} huerfana`,
    });
    const cuantasConEseColegio = Number(await unoDesdeDisco(
      `SELECT COUNT(*) FROM producto WHERE colegio_id = '${esc(MARCA)}';`
    ));
    anotar(
      'POST /api/productos con un colegio inexistente devuelve 404 y no crea nada',
      altaImposible.status === 404 && cuantasConEseColegio === 0,
      `status ${altaImposible.status}, y en disco hay ${cuantasConEseColegio} prenda(s) con ese ` +
        'colegio fantasma. Este era el SEGUNDO camino de creacion, el que quedo abierto cuando ' +
        'tape el de colegio.ts y di el problema por cerrado.'
    );
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
  if (inconclusos.length > 0) {
    console.log('');
    console.log(`  Y ${inconclusos.length} NO CONCLUYENTE(S): corrieron, pero con estos datos no`);
    console.log('  pueden distinguir el exito del fracaso. NO cuentan como verde.');
    for (const r of inconclusos) console.log(`    ????  ${r.nombre}`);
  }
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
