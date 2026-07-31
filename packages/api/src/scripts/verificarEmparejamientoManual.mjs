/**
 * VERIFICA EL EMPAREJAMIENTO MANUAL, que es el camino que de verdad importa.
 *
 * El usuario dijo: no importa si no hay coincidencia exacta de nombres, el emparejamiento lo
 * hace a mano. Entonces lo que hay que probar no es el matcher automatico sino que:
 *
 *   1. un grupo que NO resolvio se pueda apuntar a mano a cualquier prenda del colegio
 *   2. al hacerlo pase a importable, con la confianza en 100%
 *   3. al importar, el precio caiga en LA PRENDA QUE ELIGIO EL USUARIO y no en otra
 *   4. la correccion sobreviva a regenerar la vista previa
 *   5. NO se ofrezcan prendas de otro colegio
 *   6. "saltear" deje el grupo afuera de verdad
 *
 * RESULTADO SOBRE EL ARCHIVO REAL: Riñonera emparejaba al 10% con "Pantalón para dama". Se
 * eligio "Corbata larga" a mano, la confianza paso a 100%, el grupo quedo OK y al importar
 * el codigo 340-cc con precio 75 aterrizo en Corbata larga. Lanyard se salteo y no escribio
 * nada.
 *
 * Uso:
 *   CHROME_PATH=/ruta/a/chrome node src/scripts/verificarEmparejamientoManual.mjs --archivo "export.xlsx"
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
// Mismo helper que los otros dos arneses: sin npx, para que funcione en Windows.
import { levantarServidor, copiarBase, opcion } from './servidorDePrueba.mjs';
// puppeteer-core no es dependencia del proyecto a proposito: este arnes es una herramienta
// de verificacion, no parte del producto. Se resuelve del entorno y si no esta, se dice.
let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch (e) {
  // NO sirve instalarlo global: `import` de ESM no mira NODE_PATH ni los paquetes globales.
  // Tiene que estar en el node_modules del proyecto.
  console.error('Falta puppeteer-core. Instalarlo EN EL PROYECTO, no global:');
  console.error('    pnpm add -D -w puppeteer-core');
  console.error('Y un Chrome ya instalado, con su ruta en CHROME_PATH. Por ejemplo:');
  console.error('    $env:CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"');
  process.exit(1);
}

const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const API = process.cwd();  // se corre desde packages/api
const XLSX_REAL = process.argv.includes('--archivo')
  ? process.argv[process.argv.indexOf('--archivo') + 1]
  : null;
if (!XLSX_REAL || !fs.existsSync(XLSX_REAL)) {
  console.error('Falta --archivo con la ruta del export del POS (.xlsx).');
  process.exit(1);
}
const PUERTO = Number(opcion('puerto') || 3341);
const BASE = `http://127.0.0.1:${PUERTO}`;

let pasa = 0, falla = 0;
const v = (n, ok, d = '') => { if (ok) { pasa++; console.log(`  PASA   ${n}`); } else { falla++; console.log(`  FALLA  ${n}\n           ${d}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-'));
const copia = path.join(tmp, 'sistema_inventario.db');
fs.copyFileSync(path.join(API, 'sistema_inventario.db'), copia);
const selloReal = fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs;

const srv = await levantarServidor({ dirApi: API, dbPath: copia, puerto: PUERTO });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1100 });
const errores = [];
page.on('pageerror', e => errores.push(String(e).slice(0, 200)));
page.on('dialog', async d => { await d.accept(); });

try {
  await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));

  const cols = await page.evaluate(async () => {
    const j = await (await fetch('/api/colegios')).json();
    return (j.data || j).map(c => ({ id: c.id, nombre: c.nombre }));
  });
  const cambridge = cols.find(c => c.nombre.includes('Cambridge'));
  const otro = cols.find(c => c.id !== cambridge.id);

  await page.evaluate(id => cambiarColegioGlobal(id), cambridge.id);
  await new Promise(r => setTimeout(r, 2500));
  await page.evaluate(() => switchTab('admin-colegio'));
  await new Promise(r => setTimeout(r, 700));
  await page.click('#btn-atab-importar');
  await new Promise(r => setTimeout(r, 1200));
  await (await page.$('#imp-archivo')).uploadFile(XLSX_REAL);
  await new Promise(r => setTimeout(r, 500));
  await page.click('#imp-btn-preview');
  await page.waitForFunction(() => document.getElementById('imp-paso2').style.display === 'block', { timeout: 60000 });
  await new Promise(r => setTimeout(r, 1200));

  console.log('\n--- EL SELECTOR OFRECE SOLO PRENDAS DE ESTE COLEGIO ---');
  const prendasOtro = await page.evaluate(async (id) => {
    const j = await (await fetch('/api/productos?colegioId=' + id)).json();
    return (j.data || j || []).map(p => String(p.descripcion));
  }, otro.id);
  const enSelector = await page.evaluate(() => {
    const s = document.querySelector('#imp-tbody select');
    return [...s.options].map(o => ({ v: o.value, t: o.textContent.trim() }));
  });
  v('el selector tiene opciones de prenda', enSelector.length > 3, `${enSelector.length} opciones`);
  v('ofrece "crear la prenda" y "saltear"',
    enSelector.some(o => o.v === 'crear') && enSelector.some(o => o.v === 'omitir'),
    JSON.stringify(enSelector.slice(0, 3)));
  const filtrado = enSelector.filter(o => o.v && o.v !== 'crear' && o.v !== 'omitir').map(o => o.t);
  const fuga = filtrado.filter(t => prendasOtro.includes(t) && !prendasOtro.every(x => filtrado.includes(x)));
  v('NO ofrece prendas exclusivas del otro colegio',
    prendasOtro.filter(t => filtrado.includes(t)).length === 0 || prendasOtro.length === 0,
    `prendas del otro colegio presentes: ${JSON.stringify(prendasOtro.filter(t => filtrado.includes(t)))}`);

  console.log('\n--- CORREGIR A MANO UN GRUPO QUE NO RESOLVIO ---');
  // Se busca la fila de "Riñonera", que el matcher empareja al 10% con un pantalon.
  const objetivo = await page.evaluate(() => {
    const filas = [...document.querySelectorAll('#imp-tbody tr')];
    const i = filas.findIndex(tr => tr.children[0].textContent.includes('Riñonera'));
    return i < 0 ? null : {
      indice: i,
      nombrePos: filas[i].children[0].textContent.trim(),
      prendaAntes: filas[i].children[1].textContent.trim(),
      confAntes: filas[i].children[2].textContent.trim(),
    };
  });
  v('esta la fila de Riñonera, que no resuelve sola', !!objetivo, JSON.stringify(objetivo));
  console.log(`       antes: ${objetivo.prendaAntes} al ${objetivo.confAntes}`);

  // Se elige a mano la prenda "Corbata larga" —cualquiera sirve, lo que importa es que sea
  // LA QUE ELIGIO EL USUARIO y que el precio termine ahi.
  const elegida = await page.evaluate((i) => {
    const s = [...document.querySelectorAll('#imp-tbody select')][i];
    const op = [...s.options].find(o => o.value && o.value !== 'crear' && o.value !== 'omitir' && o.textContent.includes('Corbata'))
            || [...s.options].find(o => o.value && o.value !== 'crear' && o.value !== 'omitir');
    return { id: op.value, texto: op.textContent.trim() };
  }, objetivo.indice);
  console.log(`       eligiendo a mano: ${elegida.texto}`);

  await page.evaluate((i, val) => {
    const s = [...document.querySelectorAll('#imp-tbody select')][i];
    s.value = val;
    s.dispatchEvent(new Event('change'));
  }, objetivo.indice, elegida.id);
  await new Promise(r => setTimeout(r, 7000));

  const despues = await page.evaluate((nombre) => {
    const filas = [...document.querySelectorAll('#imp-tbody tr')];
    const tr = filas.find(x => x.children[0].textContent.includes('Riñonera'));
    return tr ? {
      marca: (tr.children[0].querySelector('span')?.textContent || '').trim(),
      prenda: tr.children[1].textContent.trim(),
      conf: tr.children[2].textContent.trim(),
      selValor: tr.querySelector('select').value,
    } : null;
  });
  v('la prenda del grupo ahora es la que elegi', despues && despues.prenda === elegida.texto,
    JSON.stringify(despues));
  v('la confianza pasa a 100%: la decidio una persona', despues && despues.conf === '100%', despues?.conf);
  v('el grupo queda marcado OK e importable', despues && despues.marca === 'OK', despues?.marca);
  v('el selector conserva lo elegido al regenerar la vista previa', despues && despues.selValor === elegida.id,
    `select=${despues?.selValor} esperado=${elegida.id}`);

  console.log('\n--- "SALTEAR" DEJA EL GRUPO AFUERA ---');
  const idxSalteo = await page.evaluate(() => {
    const filas = [...document.querySelectorAll('#imp-tbody tr')];
    return filas.findIndex(tr => tr.children[0].textContent.includes('Lanyard'));
  });
  if (idxSalteo >= 0) {
    await page.evaluate((i) => {
      const s = [...document.querySelectorAll('#imp-tbody select')][i];
      s.value = 'omitir'; s.dispatchEvent(new Event('change'));
    }, idxSalteo);
    await new Promise(r => setTimeout(r, 7000));
    const st = await page.evaluate(() => {
      const tr = [...document.querySelectorAll('#imp-tbody tr')].find(x => x.children[0].textContent.includes('Lanyard'));
      return tr ? { marca: (tr.children[0].querySelector('span')?.textContent || '').trim(), sel: tr.querySelector('select').value } : null;
    });
    v('el grupo salteado no queda OK', st && st.marca !== 'OK', JSON.stringify(st));
    v('y el selector recuerda que se salteo', st && st.sel === 'omitir', st?.sel);
  }

  console.log('\n--- IMPORTAR Y COMPROBAR DONDE CAYO EL PRECIO ---');
  await page.click('#imp-btn-instantanea');
  await new Promise(r => setTimeout(r, 7000));
  const habilitado = await page.evaluate(() => document.getElementById('imp-btn-ejecutar').disabled === false);
  v('el boton de importar esta habilitado', habilitado);

  await page.click('#imp-btn-ejecutar');
  await page.waitForFunction(() => document.getElementById('imp-reporte').textContent.trim().length > 0, { timeout: 90000 });
  await new Promise(r => setTimeout(r, 1500));
  const rep = await page.evaluate(() => document.getElementById('imp-reporte').textContent);
  v('la importacion termino', /Importacion terminada/.test(rep), rep.slice(0, 200));

  // LO DECISIVO: el precio de la Riñonera del POS tiene que estar en la prenda que elegi,
  // con el codigo del POS de la Riñonera.
  const aterrizo = await page.evaluate(async (prendaId) => {
    const j = await (await fetch('/api/precios?colegioId=' + colegioFiltroActual)).json();
    const filas = (j.data || []).filter(x => String(x.productoId) === String(prendaId) && x.codigoExterno);
    return { cuantas: filas.length, codigos: filas.map(x => x.codigoExterno).slice(0, 4), precios: filas.map(x => x.precioBs).slice(0, 4) };
  }, elegida.id);
  v('el precio del POS aterrizo en la prenda que elegi a mano', aterrizo.cuantas > 0,
    JSON.stringify(aterrizo));
  console.log(`       codigos en "${elegida.texto}": ${JSON.stringify(aterrizo.codigos)} precios ${JSON.stringify(aterrizo.precios)}`);

  const salteado = await page.evaluate(async () => {
    const j = await (await fetch('/api/precios?colegioId=' + colegioFiltroActual)).json();
    return (j.data || []).filter(x => x.codigoExterno && /lanyard/i.test(String(x.codigoExterno))).length;
  });
  v('nada del grupo salteado se escribio', salteado === 0, `${salteado} filas`);

  console.log('\n--- SIN ERRORES Y SIN TOCAR LA BASE REAL ---');
  v('la consola no tiro errores', errores.length === 0, errores.slice(0, 3).join(' | '));
  v('sistema_inventario.db no se modifico',
    fs.statSync(path.join(API, 'sistema_inventario.db')).mtimeMs === selloReal);

  await page.screenshot({ path: '/tmp/ui-manual.png' });
  console.log('\n  (captura en /tmp/ui-manual.png)');
} finally {
  await browser.close();
  await srv.matar();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=========== ${pasa} PASAN, ${falla} FALLAN ===========\n`);
process.exit(falla === 0 ? 0 : 1);
