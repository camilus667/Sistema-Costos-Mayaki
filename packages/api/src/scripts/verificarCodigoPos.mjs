/**
 * Verifica la vista "Codigo POS" con datos de verdad: importa Cambridge sobre una COPIA y
 * despues mira que la matriz muestre los codigos en la celda que les corresponde.
 *
 * Sin importar primero, todos los codigos son NULL y la vista mostraria "—" en todas las
 * celdas. Eso pasaria igual si la vista estuviera rota, asi que no probaria nada.
 *
 * TRABAJA SOBRE UNA COPIA y lo comprueba al final: importa de verdad, con transaccion y todo,
 * pero contra un temporal.
 *
 * Uso:
 *   CHROME_PATH=/ruta/a/chrome node src/scripts/verificarCodigoPos.mjs --archivo "export.xlsx"
 */
import fs from 'fs'; import os from 'os'; import path from 'path';
// puppeteer-core no es dependencia del proyecto: este arnes es una herramienta de
// verificacion, no parte del producto. Si falta, se dice como instalarlo EN EL PROYECTO —el
// `import` de ESM no mira los paquetes globales ni NODE_PATH—.
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  console.error('Falta puppeteer-core. Instalarlo EN EL PROYECTO, no global:');
  console.error('    pnpm add -D -w puppeteer-core');
  console.error('Y un Chrome ya instalado, con su ruta en CHROME_PATH. Por ejemplo:');
  console.error('    $env:CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
  process.exit(1);
}
import { levantarServidor, copiarBase, opcion } from './servidorDePrueba.mjs';

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const API = process.cwd();  // se corre desde packages/api
const XLSX = opcion('archivo');
if (!XLSX || !fs.existsSync(XLSX)) {
  console.error('Falta --archivo con la ruta del export del POS (.xlsx).');
  console.error('Hace falta porque este arnes IMPORTA de verdad —sobre una copia— antes de mirar:');
  console.error('sin codigos en la base, la vista mostraria "—" en todas las celdas y eso pasaria');
  console.error('igual si estuviera rota.');
  process.exit(1);
}
const PUERTO = Number(opcion('puerto') || 3521);

let pasa = 0, falla = 0;
const v = (n, ok, d = '') => { if (ok) { pasa++; console.log(`  PASA   ${n}`); } else { falla++; console.log(`  FALLA  ${n}\n           ${d}`); } };

const { tmp, copia } = copiarBase(API);
const selloReal = fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs;
const srv = await levantarServidor({ dirApi: API, dbPath: copia, puerto: PUERTO });
const BASE = srv.base;

let browser;
try {
  // ---- 1. importar Cambridge, para que existan codigos que mostrar
  const cols = await (await fetch(BASE + '/api/colegios')).json();
  const cam = (cols.data || cols).find((c) => String(c.nombre).includes('Cambridge'));
  await fetch(BASE + '/api/snapshots', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'antes de verificar codigos' }),
  });
  const bytes = fs.readFileSync(XLSX);
  const post = async (ruta, campos) => {
    const fd = new FormData();
    for (const [k, val] of Object.entries(campos)) fd.append(k, String(val));
    fd.append('archivo', new Blob([new Uint8Array(bytes)]), 'e.xlsx');
    const r = await fetch(BASE + ruta, { method: 'POST', body: fd });
    return { estado: r.status, json: await r.json() };
  };
  const prev = await post('/api/importar/preview', { colegioId: cam.id });
  const ej = await post('/api/importar/ejecutar', {
    colegioId: cam.id, opciones: JSON.stringify({ huella: prev.json.plan.huella }),
  });
  v('la importacion de Cambridge corrio', ej.estado === 200 && ej.json.reporte.codigosEscritos > 0,
    `estado ${ej.estado}, codigos ${ej.json?.reporte?.codigosEscritos}`);
  const codigosEsperados = ej.json.reporte.codigosEscritos;

  // ---- 2. la matriz trae los codigos en la celda
  const api = await (await fetch(`${BASE}/api/calculo/matriz-consolidada?colegioId=${cam.id}&todo=true`)).json();
  let conCodigo = 0, muestra = null;
  for (const fila of api.data) {
    for (const [talla, celda] of Object.entries(fila.tallas)) {
      if (celda && celda.codigoExterno) {
        conCodigo++;
        if (!muestra) muestra = { item: fila.itemNumero, desc: fila.descripcion, talla, cod: celda.codigoExterno };
      }
    }
  }
  v('la matriz trae codigos en las celdas', conCodigo > 0, `${conCodigo} celdas con codigo`);
  v('y son tantos como escribio la importacion', conCodigo === codigosEsperados,
    `matriz ${conCodigo}, importados ${codigosEsperados}`);
  console.log(`       muestra: item ${muestra?.item} "${muestra?.desc}" talla ${muestra?.talla} -> ${muestra?.cod}`);

  // El codigo tiene que estar en la celda de SU talla, no repetido en toda la fila: es la
  // propiedad que distingue "por prenda y talla" de "por prenda".
  const fila0 = api.data.find((f) => Object.values(f.tallas).filter((c) => c?.codigoExterno).length > 1);
  const codsDeLaFila = fila0 ? Object.values(fila0.tallas).filter((c) => c?.codigoExterno).map((c) => c.codigoExterno) : [];
  v('los codigos de una misma prenda son DISTINTOS entre tallas',
    codsDeLaFila.length > 1 && new Set(codsDeLaFila).size === codsDeLaFila.length,
    `${codsDeLaFila.length} codigos, ${new Set(codsDeLaFila).size} distintos: ${codsDeLaFila.slice(0, 5).join(', ')}`);

  // ---- 3. la pantalla
  browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errores = [];
  page.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));

  // NO se usa waitUntil 'networkidle2': esta pantalla hace muchos pedidos al cargar y nunca
  // llega a dos conexiones en reposo, asi que la navegacion expira a los 60 s con la pagina
  // ya cargada. Con 'domcontentloaded' mas una espera a que exista una funcion global se mide
  // lo mismo y no depende de que la red se calme.
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => typeof cambiarColegioGlobal === 'function', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));
  await page.evaluate((id) => cambiarColegioGlobal(id), cam.id);
  await new Promise((r) => setTimeout(r, 2200));
  await page.evaluate(() => switchTab('matriz-excel'));
  await new Promise((r) => setTimeout(r, 2500));

  const hayPestana = await page.evaluate(() =>
    [...document.querySelectorAll('.excel-tab')].some((b) => b.textContent.includes('Código POS')));
  v('la pestaña "Código POS" existe', hayPestana);

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.excel-tab')].find((x) => x.textContent.includes('Código POS'));
    b.click();
  });
  await new Promise((r) => setTimeout(r, 2500));

  const enPantalla = await page.evaluate(() => {
    const trs = [...document.querySelectorAll('#tb-consolidada-body tr')].filter((t) => t.children.length > 1);
    const celdas = trs.flatMap((tr) => [...tr.children].slice(2).map((td) => td.textContent.trim()));
    const conCod = celdas.filter((x) => x && x !== '—' && x !== '-');
    const pie = document.getElementById('tf-consolidada-foot');
    return {
      filas: trs.length,
      conCodigo: conCod.length,
      muestra: conCod.slice(0, 4),
      pieVacio: !pie || pie.innerHTML.trim() === '',
    };
  });
  v('la pantalla muestra los codigos', enPantalla.conCodigo > 0,
    `${enPantalla.conCodigo} celdas con codigo, muestra ${JSON.stringify(enPantalla.muestra)}`);
  v('los codigos tienen la forma del POS, con su sufijo',
    enPantalla.muestra.every((c) => /-(cc|EO|InfSM|IntlSM|JS)$/i.test(c)), JSON.stringify(enPantalla.muestra));
  v('el PIE no totaliza codigos, que no se suman', enPantalla.pieVacio, 'el pie tiene contenido');
  v('la pantalla ve tantos codigos como la API', enPantalla.conCodigo === conCodigo,
    `pantalla ${enPantalla.conCodigo}, api ${conCodigo}`);
  v('sin errores de consola', errores.length === 0, errores.slice(0, 2).join(' | '));
  v('la base real no se toco', fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs === selloReal);

  await page.screenshot({ path: '/tmp/ui-codigo.png' });
  console.log('\n  (captura en /tmp/ui-codigo.png)');
} finally {
  if (browser) await browser.close();
  await srv.matar();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=========== ${pasa} PASAN, ${falla} FALLAN ===========\n`);
process.exit(falla === 0 ? 0 : 1);
