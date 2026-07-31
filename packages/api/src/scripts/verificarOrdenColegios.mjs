/**
 * VERIFICA EL ORDEN DE LOS COLEGIOS: el endpoint, y despues el arrastre en un Chrome real.
 *
 * Lo que importa probar, y por que:
 *
 *   el endpoint RECHAZA lo que no puede guardar   ids repetidos y ids que no existen. Guardar
 *                                                 una lista mal armada dejaria un colegio con
 *                                                 dos posiciones y otro sin ninguna.
 *   la ruta /orden no la come PUT /:id            Hono resuelve por orden de registro. Con
 *                                                 /:id primero, "orden" se toma como un id.
 *   el orden guardado CAMBIA la matriz            es lo unico que hace que esta pantalla sirva
 *   el arrastre en el navegador reordena          y el boton de guardar se prende solo si hubo
 *                                                 un cambio de verdad
 *   se vuelve a LEER despues de guardar           la pantalla muestra lo que quedo, no lo que
 *                                                 se pidio
 *
 * TRABAJA SOBRE UNA COPIA y lo comprueba al final.
 *
 * Uso:
 *   CHROME_PATH=/ruta/a/chrome node src/scripts/verificarOrdenColegios.mjs
 */

import fs from 'fs';
import path from 'path';
import { levantarServidor, copiarBase, opcion } from './servidorDePrueba.mjs';

// puppeteer-core no es dependencia del proyecto: es una herramienta de verificacion.
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  console.error('Falta puppeteer-core. Instalarlo EN EL PROYECTO, no global:');
  console.error('    pnpm add -D -w puppeteer-core');
  console.error('Y un Chrome ya instalado, con su ruta en CHROME_PATH.');
  process.exit(1);
}

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const API = process.cwd();
const PUERTO = Number(opcion('puerto') || 3581);

let pasa = 0, falla = 0;
const v = (n, ok, d = '') => { if (ok) { pasa++; console.log(`  PASA   ${n}`); } else { falla++; console.log(`  FALLA  ${n}\n           ${d}`); } };

const { tmp, copia } = copiarBase(API);
const selloReal = fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs;
const srv = await levantarServidor({ dirApi: API, dbPath: copia, puerto: PUERTO });
const BASE = srv.base;

const put = async (cuerpo) => {
  const r = await fetch(BASE + '/api/colegios/orden', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  });
  return { estado: r.status, json: await r.json() };
};

const ordenDeLaMatriz = async () => {
  const j = await (await fetch(`${BASE}/api/calculo/matriz-consolidada?todo=true`)).json();
  return j.data.map((f) => f.colegioNombre);
};

let browser;
try {
  const cols = (await (await fetch(BASE + '/api/colegios')).json());
  const lista = (cols.data || cols).map((c) => ({ id: String(c.id), nombre: String(c.nombre) }));
  v('la copia tiene al menos dos colegios', lista.length >= 2, `${lista.length} colegios`);

  console.log('\n--- EL ENDPOINT RECHAZA LO QUE NO PUEDE GUARDAR ---');
  v('sin cuerpo, 400', (await put({})).estado === 400);
  v('con lista vacia, 400', (await put({ orden: [] })).estado === 400);

  const dup = await put({ orden: [lista[0].id, lista[0].id] });
  v('con ids repetidos, 400', dup.estado === 400, `estado ${dup.estado}`);
  v('y dice cual se repitio', String(dup.json.error || '').includes(lista[0].id), String(dup.json.error).slice(0, 120));

  const inex = await put({ orden: [lista[0].id, 'id-que-no-existe'] });
  v('con un id inexistente, 404', inex.estado === 404, `estado ${inex.estado}`);
  v('y declara que NO guardo nada', /No se guardo nada/.test(String(inex.json.error)), String(inex.json.error).slice(0, 120));

  console.log('\n--- LA RUTA NO LA COME PUT /:id ---');
  // Con `PUT /:id` registrado antes, "orden" se toma como un id de colegio y el pedido termina
  // en el handler de actualizar datos. Medido: daba Internal Server Error.
  const ok = await put({ orden: lista.map((c) => c.id) });
  v('PUT /api/colegios/orden llega a su handler', ok.estado === 200, `estado ${ok.estado}: ${JSON.stringify(ok.json).slice(0, 120)}`);
  v('y devuelve la secuencia con sus posiciones',
    Array.isArray(ok.json.orden) && ok.json.orden[0].orden === 1, JSON.stringify(ok.json.orden));

  console.log('\n--- EL ORDEN GUARDADO CAMBIA LA MATRIZ ---');
  const antes = await ordenDeLaMatriz();
  const invertido = [...lista].reverse().map((c) => c.id);
  const r = await put({ orden: invertido });
  v('se puede invertir el orden', r.estado === 200);
  const despues = await ordenDeLaMatriz();
  v('la matriz cambio de orden', antes[0] !== despues[0],
    `antes empezaba con ${antes[0]}, ahora con ${despues[0]}`);
  v('y no perdio ni gano filas', antes.length === despues.length, `${antes.length} -> ${despues.length}`);
  v('los colegios siguen agrupados, no intercalados',
    despues.filter((n, i) => i > 0 && n !== despues[i - 1]).length === lista.length - 1,
    `cambios de colegio: ${despues.filter((n, i) => i > 0 && n !== despues[i - 1]).length}`);

  // Se deja el orden original antes de mirar la pantalla.
  await put({ orden: lista.map((c) => c.id) });

  console.log('\n--- EL ARRASTRE, EN EL NAVEGADOR ---');
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 1000 });
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => typeof switchAdminTab === 'function', { timeout: 60000 });
  await new Promise((res) => setTimeout(res, 3000));
  await page.evaluate(() => switchTab('admin-colegio'));
  await new Promise((res) => setTimeout(res, 900));
  await page.evaluate(() => switchAdminTab('colegios'));
  await new Promise((res) => setTimeout(res, 2200));

  const leer = () => page.evaluate(() => ({
    filas: [...document.querySelectorAll('#orden-colegios-lista [data-id]')].map((el) => ({
      id: el.dataset.id, nombre: el.querySelector('strong')?.textContent,
    })),
    btnDeshabilitado: document.getElementById('btn-guardar-orden-colegios')?.disabled,
    estado: document.getElementById('orden-colegios-estado')?.textContent || '',
  }));

  let t = await leer();
  v('la lista de colegios se dibuja', t.filas.length === lista.length, JSON.stringify(t.filas));
  v('el boton de guardar arranca DESHABILITADO', t.btnDeshabilitado === true,
    'un arrastre exploratorio no puede empezar habilitado');

  // Se simula el arrastre llamando a los mismos manejadores que usa el navegador. Arrastrar de
  // verdad con el raton en headless es notoriamente inestable, y lo que importa verificar es la
  // logica de reordenar y guardar, no el motor de drag del navegador.
  const primero = t.filas[0].id, ultimo = t.filas[t.filas.length - 1].id;
  await page.evaluate((desde, hasta) => {
    const el = (id) => document.querySelector(`#orden-colegios-lista [data-id="${id}"]`);
    ordenColDragStart({ currentTarget: el(desde), dataTransfer: { setData() {} } });
    ordenColDragOver({ preventDefault() {}, currentTarget: el(hasta) });
    ordenColDragEnd();
  }, primero, ultimo);
  await new Promise((res) => setTimeout(res, 700));

  t = await leer();
  v('arrastrar reordena la lista a la vista', t.filas[0].id === ultimo,
    `primero ahora: ${t.filas[0].nombre}`);
  v('y el boton se HABILITA porque hubo un cambio', t.btnDeshabilitado === false, `disabled=${t.btnDeshabilitado}`);
  v('y lo dice', /sin guardar/i.test(t.estado), t.estado);

  await page.click('#btn-guardar-orden-colegios');
  await new Promise((res) => setTimeout(res, 3500));
  t = await leer();
  v('al guardar lo confirma', /guardado/i.test(t.estado), t.estado);
  v('y el boton vuelve a deshabilitarse: ya no hay cambios', t.btnDeshabilitado === true, `disabled=${t.btnDeshabilitado}`);
  v('la lista quedo en el orden nuevo despues de RELEER', t.filas[0].id === ultimo,
    `primero: ${t.filas[0].nombre}`);

  const enBase = await (await fetch(BASE + '/api/colegios')).json();
  const guardado = (enBase.data || enBase).find((c) => String(c.id) === ultimo);
  v('la base guardo orden = 1 para el que quedo primero', Number(guardado?.orden) === 1,
    `orden guardado: ${guardado?.orden}`);

  const matriz = await ordenDeLaMatriz();
  v('y la matriz respeta ese orden', matriz[0] === guardado.nombre,
    `la matriz empieza con ${matriz[0]}, esperado ${guardado.nombre}`);

  console.log('\n--- SIN ERRORES Y SIN TOCAR LA BASE REAL ---');
  v('la consola no tiro errores', errores.length === 0, errores.slice(0, 2).join(' | '));
  v('sistema_inventario.db no se modifico',
    fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs === selloReal);
} finally {
  if (browser) await browser.close();
  await srv.matar();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=========== ${pasa} PASAN, ${falla} FALLAN ===========\n`);
process.exit(falla === 0 ? 0 : 1);
