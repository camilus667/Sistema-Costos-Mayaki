/**
 * CAPTURA UNA LINEA BASE DE LO QUE EL SISTEMA DEVUELVE, PARA PODER PROBAR QUE NO SE ROMPIO.
 *
 * Para que sirve. Antes de un cambio grande se corre con `--guardar` y deja un archivo con
 * la respuesta de cada endpoint importante. Despues del cambio se corre con `--comparar` y
 * dice, campo por campo, que se movio.
 *
 * POR QUE HACE FALTA. "No rompi nada" es una afirmacion que se hace de memoria y casi
 * nunca se mide. Los tests cubren funciones; los reportes cubren la impresion; los arneses
 * de navegador cubren pantallas concretas. Lo que faltaba es una foto ANCHA: si un cambio
 * al arranque, al orden o a la paginacion mueve un total del resumen o pierde una fila de
 * un listado, esto lo dice sin que haya que sospecharlo primero.
 *
 * NO TOCA LA BASE: levanta el servidor contra una COPIA en un temporal y compara respuestas.
 * Y aborta si el puerto ya esta ocupado, para no medir la instancia equivocada —un error que
 * ya pagamos dos veces en este proyecto.
 *
 * Lo que compara y por que:
 *
 *   los TOTALES del resumen        un cambio de orden o de paginacion no puede mover una suma
 *   la CANTIDAD de filas           es como se detecta un truncamiento silencioso
 *   el ORDEN de los identificadores  para ver exactamente que se reordeno
 *   los precios y costos por celda   el numero que le importa al usuario
 *
 * Uso:
 *   pnpm tsx src/scripts/lineaBase.ts --guardar
 *   pnpm tsx src/scripts/lineaBase.ts --comparar
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';

const opcion = (n: string): string | undefined => {
  const i = process.argv.indexOf('--' + n);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
};

const GUARDAR = process.argv.includes('--guardar');
const COMPARAR = process.argv.includes('--comparar');
const PUERTO = Number(opcion('puerto') || 3401);
const BASE = `http://127.0.0.1:${PUERTO}`;
const ARCHIVO = path.resolve(process.cwd(), opcion('salida') || 'linea-base.json');

/** Los endpoints de la foto. Cada uno con como resumirlo, para que el diff sea legible. */
interface Sonda {
  nombre: string;
  url: (ctx: Ctx) => string;
  resumir: (j: any) => any;
}

interface Ctx { colegios: { id: string; nombre: string }[] }

const filasDe = (j: any): any[] => (Array.isArray(j) ? j : (j?.data ?? []));

const SONDAS: Sonda[] = [
  {
    nombre: 'colegios',
    url: () => '/api/colegios',
    resumir: (j) => ({ n: filasDe(j).length, nombres: filasDe(j).map((c: any) => c.nombre) }),
  },
  {
    nombre: 'productos (todos)',
    url: () => '/api/productos',
    resumir: (j) => ({
      n: filasDe(j).length,
      // El orden importa: es justamente lo que este trabajo cambia. Se guarda la secuencia.
      items: filasDe(j).map((p: any) => `${p.itemNumero}`),
      descripciones: filasDe(j).map((p: any) => p.descripcion),
    }),
  },
  {
    nombre: 'precios (todos)',
    url: () => '/api/precios',
    resumir: (j) => ({
      n: filasDe(j).length,
      // Suma de precios: un solo numero que cambia si se perdio o duplico una fila.
      suma: Number(filasDe(j).reduce((a: number, x: any) => a + Number(x.precioBs || 0), 0).toFixed(2)),
      conCodigo: filasDe(j).filter((x: any) => x.codigoExterno).length,
    }),
  },
  {
    nombre: 'inventario stock',
    url: () => '/api/inventario/stock',
    resumir: (j) => ({
      n: filasDe(j).length,
      unidades: filasDe(j).reduce((a: number, x: any) => a + Number(x.cantidad || 0), 0),
    }),
  },
  {
    nombre: 'resumen empresa',
    url: () => '/api/dashboard-resumen',
    resumir: (j) => resumirDashboard(j),
  },
  {
    nombre: 'resumen colegio 1',
    url: (c) => `/api/dashboard-resumen?colegioId=${c.colegios[0]?.id ?? ''}`,
    resumir: (j) => resumirDashboard(j),
  },
  {
    nombre: 'resumen colegio 2',
    url: (c) => `/api/dashboard-resumen?colegioId=${c.colegios[1]?.id ?? ''}`,
    resumir: (j) => resumirDashboard(j),
  },
  {
    nombre: 'matrices empresa',
    url: () => '/api/calculo/matriz-consolidada',
    resumir: (j) => resumirMatriz(j),
  },
  {
    nombre: 'matrices colegio 1',
    url: (c) => `/api/calculo/matriz-consolidada?colegioId=${c.colegios[0]?.id ?? ''}`,
    resumir: (j) => resumirMatriz(j),
  },
  {
    nombre: 'tallas',
    url: () => '/api/tallas',
    resumir: (j) => ({ n: filasDe(j).length, codigos: filasDe(j).map((t: any) => t.codigo) }),
  },
];

function resumirDashboard(j: any): any {
  const d = j?.data ?? j ?? {};
  // Se toman solo numeros y conteos: son los que no pueden moverse por un cambio de orden.
  const salida: Record<string, any> = {};
  for (const [k, v] of Object.entries(d)) {
    if (typeof v === 'number') salida[k] = Number(v.toFixed(2));
    else if (Array.isArray(v)) salida[k + '.n'] = v.length;
    else if (v && typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v as any)) {
        if (typeof v2 === 'number') salida[`${k}.${k2}`] = Number(v2.toFixed(2));
      }
    }
  }
  return salida;
}

function resumirMatriz(j: any): any {
  const filas = j?.data ?? [];
  let celdas = 0;
  let suma = 0;
  for (const f of filas) {
    const t = f?.tallas ?? {};
    for (const k of Object.keys(t)) {
      const c = t[k];
      if (c && typeof c === 'object') {
        for (const v of Object.values(c)) if (typeof v === 'number') { celdas++; suma += v; }
      }
    }
  }
  return {
    n: filas.length,
    items: filas.map((f: any) => String(f.itemNumero ?? f.item ?? '')),
    celdas,
    suma: Number(suma.toFixed(2)),
  };
}

async function esperar(intentos = 60): Promise<boolean> {
  for (let i = 0; i < intentos; i++) {
    try { if ((await fetch(BASE + '/health')).ok) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function tomarFoto(): Promise<Record<string, any>> {
  const rutaReal = path.resolve(process.cwd(), 'sistema_inventario.db');
  if (!fs.existsSync(rutaReal)) { console.error(`No existe la base en ${rutaReal}.`); process.exit(1); }

  // El puerto tiene que estar libre. Medir la instancia equivocada ya nos costo dos veces.
  try {
    if ((await fetch(BASE + '/health')).ok) {
      console.error(`\nHay algo respondiendo en ${BASE}. Se aborta para no medir otra instancia.`);
      console.error(`Cerrar ese proceso, o correr con otro puerto:  --puerto 3402`);
      process.exit(1);
    }
  } catch (e) { /* libre, que es lo que se busca */ }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linea-base-'));
  const copia = path.join(tmp, 'sistema_inventario.db');
  fs.copyFileSync(rutaReal, copia);

  let srv: ChildProcess | null = null;
  const foto: Record<string, any> = {};
  try {
    srv = spawn('npx', ['tsx', 'src/server.ts'], {
      env: { ...process.env, SISTEMA_DB_PATH: copia, PORT: String(PUERTO) },
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    srv.stdout?.on('data', (d) => { log += String(d); });
    srv.stderr?.on('data', (d) => { log += String(d); });

    if (!(await esperar())) { console.error('El servidor no levanto:\n' + log.slice(-1500)); process.exit(1); }
    if (srv.exitCode !== null || log.includes('EADDRINUSE')) {
      console.error('El servidor propio murio y hay otro contestando:\n' + log.slice(-1200));
      process.exit(1);
    }

    const cj: any = await (await fetch(BASE + '/api/colegios')).json();
    const ctx: Ctx = { colegios: filasDe(cj).map((c: any) => ({ id: String(c.id), nombre: String(c.nombre) })) };

    for (const s of SONDAS) {
      const url = s.url(ctx);
      try {
        const r = await fetch(BASE + url);
        const j: any = await r.json();
        foto[s.nombre] = { estado: r.status, ...s.resumir(j) };
      } catch (e) {
        foto[s.nombre] = { error: String(e).slice(0, 200) };
      }
    }

    // El arranque NO debe escribir el archivo. Se mide aca porque es parte de la foto.
    const selloTrasArranque = fs.statSync(copia).size + ':' + huella(fs.readFileSync(copia));
    foto['_arranque'] = { escribioAlArrancar: log.includes('Base de datos guardada en disco') };
    foto['_selloDb'] = selloTrasArranque;
    foto['_abrioExcel'] = log.includes('CAMBRIDGE.xlsx');
  } finally {
    if (srv) { try { srv.kill('SIGKILL'); } catch (e) {} }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
  return foto;
}

function huella(b: Buffer): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

/** Compara dos fotos y devuelve las diferencias, en texto legible. */
function diferencias(antes: any, ahora: any): string[] {
  const difs: string[] = [];
  const claves = new Set([...Object.keys(antes), ...Object.keys(ahora)]);
  for (const k of claves) {
    const a = antes[k], b = ahora[k];
    if (a === undefined) { difs.push(`+ ${k}: sonda NUEVA`); continue; }
    if (b === undefined) { difs.push(`- ${k}: sonda que DESAPARECIO`); continue; }
    if (typeof a !== 'object' || typeof b !== 'object') {
      if (String(a) !== String(b)) difs.push(`~ ${k}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
      continue;
    }
    const sub = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k2 of sub) {
      const av = (a as any)[k2], bv = (b as any)[k2];
      const as = JSON.stringify(av), bs = JSON.stringify(bv);
      if (as === bs) continue;
      if (Array.isArray(av) && Array.isArray(bv)) {
        // Para listas se dice si cambio el CONTENIDO o solo el ORDEN. La distincion es la
        // que importa: reordenar es el objetivo de este trabajo, perder filas no.
        const mismoConjunto = av.length === bv.length &&
          [...av].sort().join('|') === [...bv].sort().join('|');
        difs.push(mismoConjunto
          ? `~ ${k}.${k2}: MISMO CONTENIDO, ORDEN DISTINTO\n      antes: ${as.slice(0, 200)}\n      ahora: ${bs.slice(0, 200)}`
          : `~ ${k}.${k2}: CONTENIDO DISTINTO (${av.length} -> ${bv.length} elementos)\n      antes: ${as.slice(0, 200)}\n      ahora: ${bs.slice(0, 200)}`);
      } else {
        difs.push(`~ ${k}.${k2}: ${as} -> ${bs}`);
      }
    }
  }
  return difs;
}

async function main() {
  if (!GUARDAR && !COMPARAR) {
    console.error('Usar --guardar para tomar la foto, o --comparar para verificar contra la guardada.');
    process.exit(1);
  }

  const foto = await tomarFoto();

  if (GUARDAR) {
    fs.writeFileSync(ARCHIVO, JSON.stringify(foto, null, 2));
    console.log(`\nLinea base guardada en ${ARCHIVO}`);
    console.log(`  sondas: ${Object.keys(foto).filter((k) => !k.startsWith('_')).length}`);
    console.log(`  el arranque escribe el archivo de la base: ${foto['_arranque']?.escribioAlArrancar ? 'SI  <-- no deberia' : 'no'}`);
    console.log(`  el arranque abre CAMBRIDGE.xlsx          : ${foto['_abrioExcel'] ? 'SI  <-- no deberia' : 'no'}`);
    for (const [k, v] of Object.entries(foto)) {
      if (k.startsWith('_')) continue;
      console.log(`  ${k.padEnd(22)} ${JSON.stringify(v).slice(0, 120)}`);
    }
    return;
  }

  if (!fs.existsSync(ARCHIVO)) {
    console.error(`No existe ${ARCHIVO}. Correr primero con --guardar.`);
    process.exit(1);
  }
  const antes = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
  const difs = diferencias(antes, foto);

  console.log(`\n=== COMPARACION CONTRA LA LINEA BASE ===`);
  if (difs.length === 0) {
    console.log('  SIN DIFERENCIAS. Nada de lo medido cambio.\n');
  } else {
    console.log(`  ${difs.length} diferencia(s):\n`);
    difs.forEach((d) => console.log('  ' + d));
    console.log('');
  }
  console.log(`  el arranque escribe el archivo: ${foto['_arranque']?.escribioAlArrancar ? 'SI' : 'no'}`);
  console.log(`  el arranque abre el Excel     : ${foto['_abrioExcel'] ? 'SI' : 'no'}\n`);
}

// SALIDA EXPLICITA. Sin esto el proceso queda colgado para siempre DESPUES de haber hecho
// todo el trabajo: los pipes de stdout/stderr del servidor levantado con spawn mantienen
// vivo el event loop aunque al hijo ya se le haya mandado SIGKILL. La primera version
// escribio la foto correctamente y nunca devolvio el prompt, que es la clase de falla que
// parece un cuelgue y no lo es.
main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
