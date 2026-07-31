/**
 * MIDE EL ANCHO de Perfil & Colegios, y comprueba lo que se arreglo junto con el ancho.
 *
 * El pedido era estetico —"mira como se ve de ancho e innecesario"— pero midiendo la pantalla
 * aparecieron dos defectos que no lo eran:
 *
 *   1. Con el ambito en TODA LA EMPRESA la seccion mostraba cuatro campos VACIOS y editables.
 *      Se podia escribir y apretar Guardar, y el pedido salia a `PUT /api/colegios/all`, que
 *      devuelve 404.
 *   2. Y la pantalla no decia nada, porque el guardado era `if (json.success)` SIN else.
 *
 * De ahi que este arnes mida pixeles Y comportamiento: el ancho se arregla mirando, pero un
 * boton que no hace nada solo se detecta apretandolo.
 *
 * Uso:
 *   CHROME_PATH=/ruta/a/chrome node src/scripts/verificarPerfilColegios.mjs [puerto]
 */
import fs from 'fs'; import path from 'path';
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  console.error('Falta puppeteer-core. Instalarlo EN EL PROYECTO, no global:');
  console.error('    pnpm add -D -w puppeteer-core');
  console.error('Y un Chrome ya instalado, con su ruta en CHROME_PATH.');
  process.exit(1);
}
import { levantarServidor, copiarBase } from './servidorDePrueba.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const API = process.cwd();  // se corre desde packages/api
const PUERTO = Number(process.argv[2] || 3591);

let pasa = 0, falla = 0;
const v = (n, ok, d = '') => { if (ok) { pasa++; console.log(`  PASA   ${n}`); } else { falla++; console.log(`  FALLA  ${n}\n           ${d}`); } };

const { tmp, copia } = copiarBase(API);
const selloReal = fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs;
const srv = await levantarServidor({ dirApi: API, dbPath: copia, puerto: PUERTO });

let browser;
try {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));

  await page.goto(srv.base + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => typeof switchAdminTab === 'function', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));
  await page.evaluate(() => cambiarColegioGlobal('all'));
  await new Promise((r) => setTimeout(r, 2000));
  await page.evaluate(() => switchTab('admin-colegio'));
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => switchAdminTab('colegios'));
  await new Promise((r) => setTimeout(r, 2200));

  const medir = () => page.evaluate(() => {
    const w = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().width) : -1; };
    const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; };
    return {
      seccion: w('#admin-sec-colegios'),
      nit: w('#col-edit-nit'),
      nombre: w('#col-edit-nombre'),
      filaColegio: w('#orden-colegios-lista [data-id]'),
      avisoVisible: vis('#col-edit-sin-colegio'),
      camposVisibles: vis('#col-edit-campos'),
      btnDeshabilitado: document.getElementById('btn-guardar-datos-colegio')?.disabled,
      panel: w('.admin-body'),
    };
  });

  console.log('--- A 1920 px, CON EL AMBITO EN TODA LA EMPRESA ---');
  let m = await medir();
  console.log(`       panel disponible ${m.panel} px, seccion ${m.seccion} px`);
  console.log(`       nombre ${m.nombre} px, NIT ${m.nit} px, fila de colegio ${m.filaColegio} px`);
  v('la seccion NO ocupa todo el panel', m.seccion > 0 && m.seccion < m.panel * 0.85,
    `${m.seccion} de ${m.panel} px`);
  v('la fila de un colegio es angosta, no una barra de punta a punta',
    m.filaColegio > 0 && m.filaColegio < 620, `${m.filaColegio} px`);

  console.log('\n--- SIN COLEGIO ELEGIDO: se dice, y no se deja escribir en el aire ---');
  v('aparece el aviso', m.avisoVisible === true);
  v('los campos vacios NO se muestran', m.camposVisibles === false);
  v('y el boton de guardar esta deshabilitado', m.btnDeshabilitado === true);

  console.log('\n--- CON UN COLEGIO ELEGIDO: el formulario vuelve ---');
  const cid = await page.evaluate(async () => {
    const j = await (await fetch('/api/colegios')).json();
    return String((j.data || j)[0].id);
  });
  await page.evaluate((id) => cambiarColegioGlobal(id), cid);
  await new Promise((r) => setTimeout(r, 2200));
  await page.evaluate(() => switchAdminTab('colegios'));
  await new Promise((r) => setTimeout(r, 1500));
  m = await medir();
  v('el aviso se va', m.avisoVisible === false);
  v('los campos se muestran', m.camposVisibles === true);
  v('el boton se habilita', m.btnDeshabilitado === false);
  v('y la seccion sigue acotada', m.seccion < m.panel * 0.85, `${m.seccion} de ${m.panel} px`);
  // El ancho de los campos se mide ACA y no antes: con el ambito en empresa estan ocultos y
  // `getBoundingClientRect` da 0 para todos, asi que la comparacion pasaba o fallaba por la
  // razon equivocada. Medir un elemento oculto es medir nada.
  console.log(`       nombre ${m.nombre} px, NIT ${m.nit} px`);
  v('el NIT es mas angosto que el nombre: cada campo pide lo que necesita',
    m.nit > 0 && m.nombre > 0 && m.nit < m.nombre, `NIT ${m.nit}, nombre ${m.nombre}`);
  v('y ninguno se estira a media pantalla', m.nombre < 700, `${m.nombre} px`);

  console.log('\n--- UN FALLO SE DICE, no se traga ---');
  // Se fuerza el caso: ambito de empresa y clic en guardar.
  await page.evaluate(() => cambiarColegioGlobal('all'));
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => switchAdminTab('colegios'));
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate(() => actualizarColegioActualAdmin());
  await new Promise((r) => setTimeout(r, 900));
  const est = await page.evaluate(() => document.getElementById('col-edit-estado')?.textContent || '');
  v('guardar sin colegio lo explica en vez de no hacer nada', /Elegí un colegio/.test(est), est);

  console.log('\n--- EL TEXTO DE UN FORMULARIO VA A LA IZQUIERDA ---');
  await page.evaluate((id) => cambiarColegioGlobal(id), cid);
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => switchAdminTab('colegios'));
  await new Promise((r) => setTimeout(r, 1500));
  const alineacion = await page.evaluate(() => {
    const campos = ['#col-edit-nombre', '#col-edit-nit', '#col-edit-dir', '#col-edit-tel'];
    return campos.map((sel) => {
      const e = document.querySelector(sel);
      return { sel, align: e ? getComputedStyle(e).textAlign : null };
    });
  });
  v('los cuatro campos alinean a la izquierda, no centrados',
    alineacion.every((a) => a.align === 'left'), JSON.stringify(alineacion));

  console.log('\n--- EL AVISO NO QUEDA PEGADO ---');
  const estLimpio = await page.evaluate(() => document.getElementById('col-edit-estado')?.textContent || '');
  v('al elegir un colegio el mensaje anterior se limpia', estLimpio.trim() === '',
    `quedo: "${estLimpio}"`);

  v('sin errores de consola', errores.length === 0, errores.slice(0, 2).join(' | '));
  v('la base real no se toco',
    fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs === selloReal);

  await page.evaluate((id) => cambiarColegioGlobal(id), cid);
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(() => switchAdminTab('colegios'));
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: '/tmp/ui-perfil.png' });
  console.log('\n  (captura en /tmp/ui-perfil.png)');
} finally {
  if (browser) await browser.close();
  await srv.matar();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=========== ${pasa} PASAN, ${falla} FALLAN ===========\n`);
process.exit(falla === 0 ? 0 : 1);
