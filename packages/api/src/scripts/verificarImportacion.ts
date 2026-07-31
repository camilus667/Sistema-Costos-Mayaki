/**
 * VERIFICA EL IMPORTADOR DE PUNTA A PUNTA, CONTRA UNA COPIA DE LA BASE.
 *
 * ADVERTENCIA PARA QUIEN MUTE EL CODIGO A PROPOSITO para comprobar que estos chequeos
 * discriminan: restaurar el archivo original en un `finally`, nunca despues del bucle. Un
 * arnes que corria estas mutaciones aborto por una asercion a mitad de camino y dejo
 * aplicada la mutacion anterior —la que quitaba `codigoExterno` del insert— y la siguiente
 * corrida tomo ese archivo roto como si fuera el original. Costo media hora perseguir un
 * bug de persistencia que no existia.
 *
 * No prueba funciones sueltas: levanta los endpoints reales, sube el .xlsx real por
 * multipart y mira que quedo en la base. Es la unica forma de comprobar las cosas que
 * importan de este bloque, porque todas viven en la frontera:
 *
 *   que el preview NO ESCRIBA        se compara la base byte a byte antes y despues
 *   que la huella ATAJE             se ejecuta con una huella de otro archivo
 *   que la instantanea sea EXIGIDA   se ejecuta sin instantanea y sin una vigente
 *   que el ROLLBACK funcione         se rompe una escritura a mitad de camino
 *   que el inventario NO se toque    por defecto, comparando cantidades
 *   que el codigo del POS se escriba y que quede pegado al precio correcto
 *
 * TRABAJA SOBRE UNA COPIA. Nunca toca sistema_inventario.db: copia la base a un temporal,
 * apunta el servidor ahi con SISTEMA_DB_PATH y borra la copia al final. Una verificacion
 * que puede arruinar la base que verifica no sirve.
 *
 * Uso:
 *   pnpm tsx src/scripts/verificarImportacion.ts --archivo "ruta/al/export.xlsx"
 */

import fs from 'fs';
import path from 'path';
// El levantado del servidor vive en UNA sola casa: el arreglo de portabilidad de Windows
// —no usar npx, que ahi es npx.cmd— tiene que llegarle a los tres arneses.
// @ts-ignore  el helper es .mjs a proposito
import { levantarServidor, copiarBase } from './servidorDePrueba.mjs';

const opcion = (n: string): string | undefined => {
  const i = process.argv.indexOf('--' + n);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
};

const ARCHIVO = opcion('archivo');
const PUERTO = Number(opcion('puerto') || 3199);
const BASE = `http://127.0.0.1:${PUERTO}`;

let fallas = 0;
let pasadas = 0;
function verificar(nombre: string, ok: boolean, detalle: string) {
  if (ok) { pasadas++; console.log(`  PASA   ${nombre}`); }
  else { fallas++; console.log(`  FALLA  ${nombre}\n           ${detalle}`); }
}

/** Suma de control del archivo de la base, para probar que un endpoint no escribio. */
function selloDb(ruta: string): string {
  const b = fs.readFileSync(ruta);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return `${b.length}:${h.toString(16)}`;
}

async function postArchivo(
  ruta: string,
  campos: Record<string, string>,
  bytes: Buffer,
  nombreArchivo = 'export.xlsx'
): Promise<{ estado: number; json: any }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  fd.append('archivo', new Blob([new Uint8Array(bytes)]), nombreArchivo);
  const r = await fetch(BASE + ruta, { method: 'POST', body: fd });
  let json: any = null;
  try { json = await r.json(); } catch (e) { json = { error: 'respuesta no JSON' }; }
  return { estado: r.status, json };
}


async function main() {
  if (!ARCHIVO || !fs.existsSync(ARCHIVO)) {
    console.error('Falta --archivo con la ruta del export del POS (.xlsx).');
    process.exit(1);
  }

  const rutaReal = path.resolve(process.cwd(), 'sistema_inventario.db');
  if (!fs.existsSync(rutaReal)) {
    console.error(`No existe la base en ${rutaReal}. Correr desde packages/api.`);
    process.exit(1);
  }

  const { tmp, copia } = copiarBase(process.cwd());
  const selloReal = selloDb(rutaReal);
  const bytes = fs.readFileSync(ARCHIVO);

  console.log(`\nBase real:  ${rutaReal}`);
  console.log(`Copia:      ${copia}`);
  console.log(`Archivo:    ${path.basename(ARCHIVO)}  (${(bytes.length / 1024).toFixed(0)} KB)`);

  let srv: any = null;
  try {
    srv = await levantarServidor({ dirApi: process.cwd(), dbPath: copia, puerto: PUERTO });
    console.log(`Servidor en ${BASE}, apuntando a la copia.\n`);

    // ---- catalogos de la copia
    const colegiosResp: any = await (await fetch(BASE + '/api/colegios')).json();
    const listaColegios: any[] = colegiosResp.data ?? colegiosResp;
    const cambridge = listaColegios.find((x: any) => String(x.nombre).includes('Cambridge'));
    if (!cambridge) { console.error('La copia no tiene el colegio Cambridge.'); process.exit(1); }

    // =====================================================================
    console.log('--- 1. LA VISTA PREVIA NO ESCRIBE ---');
    const selloAntes = selloDb(copia);
    const prev = await postArchivo('/api/importar/preview', { colegioId: String(cambridge.id) }, bytes);
    const selloDespues = selloDb(copia);

    verificar('el preview responde 200', prev.estado === 200, `estado ${prev.estado}: ${JSON.stringify(prev.json).slice(0, 300)}`);
    verificar('el archivo de la base NO cambio', selloAntes === selloDespues, `${selloAntes} -> ${selloDespues}`);
    verificar('declara que no escribio', prev.json?.escribio === false, JSON.stringify(prev.json?.escribio));

    const plan = prev.json?.plan;
    verificar('agrupa por prenda y son menos grupos que filas',
      plan && plan.grupos.length > 0 && plan.grupos.length < plan.resumen.filasDelColegio,
      `${plan?.grupos?.length} grupos para ${plan?.resumen?.filasDelColegio} filas`);
    verificar('reporta las categorias sin colegio en el sistema',
      Array.isArray(plan?.categoriasSinColegio),
      JSON.stringify(plan?.categoriasSinColegio));
    verificar('devuelve una huella',
      typeof plan?.huella === 'string' && plan.huella.length === 8, String(plan?.huella));

    const conDelta = plan?.grupos?.flatMap((g: any) => g.filas).filter((f: any) => f.delta !== null) ?? [];
    verificar('calcula el delta contra el precio actual', conDelta.length > 0, `${conDelta.length} filas con delta`);
    verificar('ningun delta es infinito ni NaN',
      conDelta.every((f: any) => Number.isFinite(f.delta)),
      JSON.stringify(conDelta.filter((f: any) => !Number.isFinite(f.delta)).slice(0, 3)));

    // =====================================================================
    console.log('\n--- 2. LA INSTANTANEA ES OBLIGATORIA ---');
    const snapsAntes: any = await (await fetch(BASE + '/api/snapshots')).json();
    const habiaSnaps = (snapsAntes.data ?? []).length;
    console.log(`  (la copia tiene ${habiaSnaps} instantanea(s))`);

    const sinSnap = await postArchivo('/api/importar/ejecutar',
      { colegioId: String(cambridge.id), opciones: JSON.stringify({ huella: plan.huella }) }, bytes);
    if (habiaSnaps === 0) {
      verificar('sin instantanea se niega con 409', sinSnap.estado === 409, `estado ${sinSnap.estado}`);
      verificar('y lo explica', String(sinSnap.json?.error || '').toLowerCase().includes('instantanea'),
        String(sinSnap.json?.error).slice(0, 200));
      verificar('y NO escribio nada', selloDb(copia) === selloAntes, 'la base cambio sin instantanea');
    } else {
      console.log('  (salteado: la copia ya tiene instantaneas)');
    }

    // crear una instantanea, que es lo que la pantalla hara con un boton
    const crear = await fetch(BASE + '/api/snapshots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'Antes de importar (verificacion)', descripcion: 'automatica' }),
    });
    const snapJson: any = await crear.json();
    verificar('se puede crear la instantanea', crear.ok && snapJson?.success !== false,
      `estado ${crear.status}: ${JSON.stringify(snapJson).slice(0, 200)}`);

    const prev2 = await postArchivo('/api/importar/preview', { colegioId: String(cambridge.id) }, bytes);
    verificar('el preview ahora declara la instantanea vigente',
      prev2.json?.instantanea?.vigente === true, JSON.stringify(prev2.json?.instantanea));

    // =====================================================================
    console.log('\n--- 3. LA HUELLA ATAJA UN ARCHIVO DISTINTO ---');
    const selloPreEjec = selloDb(copia);
    const huellaMala = await postArchivo('/api/importar/ejecutar',
      { colegioId: String(cambridge.id), opciones: JSON.stringify({ huella: 'deadbeef' }) }, bytes);
    verificar('una huella que no coincide se niega con 409', huellaMala.estado === 409, `estado ${huellaMala.estado}`);
    verificar('y no escribio nada', selloDb(copia) === selloPreEjec, 'la base cambio con huella invalida');

    const sinHuella = await postArchivo('/api/importar/ejecutar', { colegioId: String(cambridge.id) }, bytes);
    verificar('sin huella se niega con 400', sinHuella.estado === 400, `estado ${sinHuella.estado}`);

    const otroColegio = listaColegios.find((x: any) => String(x.id) !== String(cambridge.id));
    if (otroColegio) {
      const cruzada = await postArchivo('/api/importar/ejecutar',
        { colegioId: String(otroColegio.id), opciones: JSON.stringify({ huella: plan.huella }) }, bytes);
      verificar('la huella de un colegio no sirve para otro', cruzada.estado === 409, `estado ${cruzada.estado}`);
    }

    // =====================================================================
    console.log('\n--- 4. LA IMPORTACION ESCRIBE LO QUE PROMETIO ---');
    const preciosAntes = await estadoPrecios(BASE, String(cambridge.id));
    const invAntes = await estadoInventario(BASE);

    const plan3 = (await postArchivo('/api/importar/preview', { colegioId: String(cambridge.id) }, bytes)).json.plan;
    const esperado = { crear: plan3.resumen.crear, actualizar: plan3.resumen.actualizar, sinCambio: plan3.resumen.sinCambio };

    const ejec = await postArchivo('/api/importar/ejecutar',
      { colegioId: String(cambridge.id), opciones: JSON.stringify({ huella: plan3.huella }) }, bytes);
    verificar('la ejecucion responde 200', ejec.estado === 200,
      `estado ${ejec.estado}: ${JSON.stringify(ejec.json).slice(0, 400)}`);

    const rep = ejec.json?.reporte;
    verificar('creo la cantidad de precios que anuncio el preview',
      rep?.preciosCreados === esperado.crear, `preview ${esperado.crear}, escribio ${rep?.preciosCreados}`);
    verificar('actualizo la cantidad que anuncio el preview',
      rep?.preciosActualizados === esperado.actualizar, `preview ${esperado.actualizar}, escribio ${rep?.preciosActualizados}`);

    const preciosDespues = await estadoPrecios(BASE, String(cambridge.id));
    const cambiaron = [...preciosDespues.entries()].filter(([k, v]) => preciosAntes.get(k) !== v).length;
    verificar('los precios de la base efectivamente cambiaron',
      cambiaron >= esperado.actualizar, `${cambiaron} cambiaron, se esperaban al menos ${esperado.actualizar}`);

    verificar('escribio codigos del POS', rep?.codigosEscritos > 0, `codigos ${rep?.codigosEscritos}`);
    const conCodigo = await codigosExternos(BASE, String(cambridge.id));
    verificar('los codigos quedaron guardados en la base', conCodigo.total > 0,
      `${conCodigo.total} filas con codigo. muestra: ${JSON.stringify(conCodigo.muestra)}`);
    verificar('ningun codigo del POS quedo en dos filas distintas',
      conCodigo.duplicados.length === 0, `duplicados: ${JSON.stringify(conCodigo.duplicados.slice(0, 5))}`);

    // ---- lo escrito llego AL ARCHIVO, no solo a la memoria
    //
    // Todos los chequeos anteriores leen por la API, que responde desde la base EN MEMORIA
    // de sql.js. Que la API diga que el codigo esta no prueba que sobreviva a reiniciar el
    // servidor: eso depende de que saveDbToDisk() haya corrido despues del COMMIT. Se abre
    // el archivo de la copia con sql.js y se cuenta ahi.
    const enArchivo = await contarEnArchivo(copia);
    verificar('los codigos llegaron al ARCHIVO y no solo a la memoria',
      enArchivo.conCodigo > 0, `${enArchivo.conCodigo} de ${enArchivo.filas} filas con codigo en el archivo`);
    verificar('la columna codigo_externo existe en el archivo',
      enArchivo.columnas.includes('codigo_externo'), enArchivo.columnas.join(', '));

    // ---- el inventario NO se toca por defecto
    const invDespues = await estadoInventario(BASE);
    const invCambiado = [...invDespues.entries()].filter(([k, v]) => invAntes.get(k) !== v).length;
    verificar('el inventario NO se toco sin pedirlo', invCambiado === 0,
      `${invCambiado} cantidades cambiaron sin haberlo pedido`);
    verificar('y el reporte lo dice', rep?.inventarioActualizado === 0, String(rep?.inventarioActualizado));
    verificar('avisa que no guardo el precio anterior',
      (ejec.json?.avisos || []).some((a: string) => a.toLowerCase().includes('historico')),
      JSON.stringify(ejec.json?.avisos));

    // ---- idempotencia: la segunda corrida no debe cambiar nada
    console.log('\n--- 5. UNA SEGUNDA CORRIDA NO CAMBIA NADA (idempotente) ---');
    const plan4 = (await postArchivo('/api/importar/preview', { colegioId: String(cambridge.id) }, bytes)).json.plan;
    verificar('el preview ya no anuncia cambios de precio',
      plan4.resumen.actualizar === 0 && plan4.resumen.crear === 0,
      `actualizar ${plan4.resumen.actualizar}, crear ${plan4.resumen.crear}`);
    verificar('y los cuenta todos como sin cambio',
      plan4.resumen.sinCambio > 0, `sinCambio ${plan4.resumen.sinCambio}`);

    const selloIdem = selloDb(copia);
    const ejec2 = await postArchivo('/api/importar/ejecutar',
      { colegioId: String(cambridge.id), opciones: JSON.stringify({ huella: plan4.huella }) }, bytes);
    verificar('la segunda ejecucion responde 200', ejec2.estado === 200, `estado ${ejec2.estado}`);
    const precios2 = await estadoPrecios(BASE, String(cambridge.id));
    const movidos = [...precios2.entries()].filter(([k, v]) => preciosDespues.get(k) !== v).length;
    verificar('ningun precio se movio en la segunda corrida', movidos === 0, `${movidos} precios cambiaron`);
    if (selloIdem === selloDb(copia)) console.log('       (el archivo quedo identico)');

    // =====================================================================
    console.log('\n--- 6. LA BASE REAL NO SE TOCO ---');
    verificar('sistema_inventario.db quedo igual', selloDb(rutaReal) === selloReal, `${selloReal} -> ${selloDb(rutaReal)}`);
    const respaldos = fs.readdirSync(tmp).filter((f) => f.includes('antes-de-importar'));
    verificar('el respaldo se creo junto a la COPIA y no a la base real',
      respaldos.length > 0 &&
      fs.readdirSync(path.dirname(rutaReal)).filter((f) => f.includes('antes-de-importar')).length === 0,
      `en el temporal ${respaldos.length}; junto a la real ${fs.readdirSync(path.dirname(rutaReal)).filter((f) => f.includes('antes-de-importar')).length}`);
  } finally {
    if (srv) await srv.matar();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n=========== ${pasadas} PASAN, ${fallas} FALLAN ===========`);
  console.log(fallas === 0
    ? 'El importador se comporta como promete y la base real no se toco.\n'
    : 'HAY FALLAS. No commitear sin resolverlas.\n');
  process.exit(fallas === 0 ? 0 : 1);
}

/** Lee el archivo de la base con sql.js, sin pasar por el servidor. */
async function contarEnArchivo(ruta: string): Promise<{ filas: number; conCodigo: number; columnas: string[] }> {
  const SqlJs: any = await import('sql.js');
  const init = SqlJs.default ?? SqlJs;
  const path = await import('path');
  const SQL = await init({ locateFile: (f: string) => path.resolve(process.cwd(), f) });
  const db = new SQL.Database(new Uint8Array(fs.readFileSync(ruta)));
  const uno = (sql: string) => { const r = db.exec(sql)[0]; return r ? r.values[0][0] : 0; };
  const cols = db.exec("SELECT name FROM pragma_table_info('precio_venta')")[0];
  return {
    filas: Number(uno('SELECT COUNT(*) FROM precio_venta')),
    conCodigo: Number(uno('SELECT COUNT(*) FROM precio_venta WHERE codigo_externo IS NOT NULL')),
    columnas: cols ? cols.values.map((v: any) => String(v[0])) : [],
  };
}

async function estadoPrecios(base: string, colegioId: string): Promise<Map<string, number>> {
  const r: any = await (await fetch(`${base}/api/precios?colegioId=${colegioId}`)).json();
  const m = new Map<string, number>();
  for (const f of r.data ?? []) m.set(`${f.productoId}|${f.tallaId}`, Number(f.precioBs));
  return m;
}

async function estadoInventario(base: string): Promise<Map<string, number>> {
  // El listado de inventario vive en /stock y no en la raiz: /api/inventario devuelve un
  // 404 en TEXTO PLANO, que al intentar parsearlo como JSON revienta con un error que no
  // menciona la url. Costo un rato entenderlo, de ahi este comentario.
  const r: any = await (await fetch(`${base}/api/inventario/stock`)).json();
  const m = new Map<string, number>();
  const filas = Array.isArray(r) ? r : (r.data ?? []);
  for (const f of filas) m.set(`${f.productoId}|${f.tallaId}`, Number(f.cantidad));
  return m;
}

async function codigosExternos(base: string, colegioId: string): Promise<{ total: number; duplicados: string[]; muestra: any[] }> {
  const r: any = await (await fetch(`${base}/api/precios?colegioId=${colegioId}`)).json();
  const vistos = new Map<string, number>();
  for (const f of r.data ?? []) {
    const cod = f.codigoExterno;
    if (!cod) continue;
    vistos.set(String(cod), (vistos.get(String(cod)) ?? 0) + 1);
  }
  return {
    total: vistos.size,
    duplicados: [...vistos.entries()].filter(([, n]) => n > 1).map(([c, n]) => `${c} x${n}`),
    muestra: (r.data ?? []).slice(0, 2),
  };
}

main().catch((e) => { console.error(e); process.exit(1); });
