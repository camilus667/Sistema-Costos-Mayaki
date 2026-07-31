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
 * SEGUNDA VUELTA. Acotar el ancho no alcanzo: "sigue demasiado ancho y deberia estar uno a lado
 * de otro". Las tres tarjetas seguian apiladas, cada una de ~1130 px y medio vacia, con ~700 px
 * de pantalla sin usar al lado. Por eso el chequeo de ancho CAMBIO de sujeto, no se relajo:
 * antes medía la SECCION, y ahora la seccion tiene que ser ancha justamente porque contiene tres
 * columnas. Lo que debe ser angosta es cada TARJETA. Medir la seccion ahora seria medir lo
 * contrario de lo que se pidio.
 *
 * Los cuatro chequeos nuevos y por que cada uno:
 *   comparten fila               es literalmente el pedido
 *   la seccion es mas BAJA       que la suma de las tarjetas; imposible si estuvieran apiladas
 *   las alturas son DISTINTAS    sin `align-items: start` una grilla estira las tres a la mas
 *                                alta, y quedan dos tarjetas con un hueco abajo
 *   a 900 px se apilan           un ancho fijo en columnas se rompe en un portatil angosto; que
 *                                vuelvan a una sola columna prueba que la grilla se adapta
 *
 * Se comprobo que discriminan forzando `display:block` en el contenedor: los cuatro fallan.
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

  // Las tres tarjetas son los hijos directos de la seccion. Se miden sus rectangulos para saber
  // si comparten fila: dos cajas comparten fila si sus rangos verticales se solapan y sus bordes
  // izquierdos son distintos. Comparar solo `top` seria fragil —un par de pixeles de diferencia
  // por el borde ya lo rompe— y comparar solo `left` no distingue una fila de una diagonal.
  const medirTarjetas = () => page.evaluate(() => {
    const sec = document.getElementById('admin-sec-colegios');
    const cajas = [...sec.children].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        titulo: (el.querySelector('h4')?.textContent || '').trim().slice(0, 28),
        left: Math.round(r.left), top: Math.round(r.top),
        ancho: Math.round(r.width), alto: Math.round(r.height),
      };
    });
    return { cajas, seccionAlto: Math.round(sec.getBoundingClientRect().height) };
  });

  const seSolapanVertical = (a, b) => a.top < b.top + b.alto && b.top < a.top + a.alto;

  console.log('--- A 1920 px, CON EL AMBITO EN TODA LA EMPRESA ---');
  let m = await medir();
  console.log(`       panel disponible ${m.panel} px, seccion ${m.seccion} px`);
  console.log(`       nombre ${m.nombre} px, NIT ${m.nit} px, fila de colegio ${m.filaColegio} px`);
  v('la fila de un colegio es angosta, no una barra de punta a punta',
    m.filaColegio > 0 && m.filaColegio < 620, `${m.filaColegio} px`);

  console.log('\n--- LAS TRES TARJETAS, UNA A LADO DE OTRA ---');
  const t3 = await medirTarjetas();
  for (const c of t3.cajas) {
    console.log(`       "${c.titulo}"  left ${c.left}  top ${c.top}  ${c.ancho}x${c.alto} px`);
  }
  v('hay tres tarjetas', t3.cajas.length === 3, `${t3.cajas.length}`);
  v('ninguna tarjeta es una banda de punta a punta',
    t3.cajas.every((c) => c.ancho < 620), t3.cajas.map((c) => `${c.titulo}=${c.ancho}px`).join(', '));
  v('las tres comparten fila: se solapan verticalmente',
    seSolapanVertical(t3.cajas[0], t3.cajas[1]) && seSolapanVertical(t3.cajas[1], t3.cajas[2]),
    t3.cajas.map((c) => `top ${c.top} alto ${c.alto}`).join(' | '));
  v('y estan en columnas distintas',
    new Set(t3.cajas.map((c) => c.left)).size === 3, t3.cajas.map((c) => c.left).join(', '));
  const sumaAltos = t3.cajas.reduce((a, c) => a + c.alto, 0);
  v('la seccion es MAS BAJA que la suma de las tarjetas: no estan apiladas',
    t3.seccionAlto < sumaAltos * 0.75, `seccion ${t3.seccionAlto} px, suma ${sumaAltos} px`);
  v('no se estiran todas a la altura de la mas alta',
    new Set(t3.cajas.map((c) => c.alto)).size > 1, t3.cajas.map((c) => c.alto).join(', '));

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
  const t3b = await medirTarjetas();
  v('con el formulario visible las tarjetas SIGUEN en fila',
    seSolapanVertical(t3b.cajas[0], t3b.cajas[1]) && seSolapanVertical(t3b.cajas[1], t3b.cajas[2]),
    t3b.cajas.map((c) => `${c.titulo}: top ${c.top} alto ${c.alto}`).join(' | '));
  v('y ninguna se pasa de 620 px', t3b.cajas.every((c) => c.ancho < 620),
    t3b.cajas.map((c) => c.ancho).join(', '));
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

  console.log('\n--- EN UNA PANTALLA ANGOSTA VUELVEN A APILARSE ---');
  // Sin esto, tres columnas fijas obligarian a desplazamiento horizontal en un portatil de 1366
  // o menos, que es peor que el apilado original.
  await page.setViewport({ width: 900, height: 1000 });
  await new Promise((r) => setTimeout(r, 900));
  const angosto = await medirTarjetas();
  console.log(`       a 900 px: ${angosto.cajas.map((c) => `left ${c.left} ancho ${c.ancho}`).join(' | ')}`);
  v('a 900 px las tarjetas se apilan en una columna',
    new Set(angosto.cajas.map((c) => c.left)).size === 1, angosto.cajas.map((c) => c.left).join(', '));
  v('y no desbordan el ancho de la ventana',
    angosto.cajas.every((c) => c.left + c.ancho <= 900), angosto.cajas.map((c) => c.left + c.ancho).join(', '));
  await page.setViewport({ width: 1920, height: 1080 });
  await new Promise((r) => setTimeout(r, 900));

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
