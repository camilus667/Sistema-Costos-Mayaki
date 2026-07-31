/**
 * LEVANTA EL SERVIDOR PARA UN ARNES DE VERIFICACION, EN WINDOWS Y EN LINUX. UNA SOLA CASA.
 *
 * POR QUE EXISTE. Los tres arneses de este proyecto —lineaBase, verificarImportacion y
 * verificarEmparejamientoManual— levantaban el servidor con `spawn('npx', ['tsx', ...])`.
 * Funciona en Linux y NO en Windows:
 *
 *   Error: spawn npx ENOENT
 *     code: 'ENOENT', syscall: 'spawn npx', path: 'npx'
 *
 * En Windows `npx` es `npx.cmd`, y `spawn` sin `shell: true` no resuelve la extension. El
 * usuario lo encontro al querer verificar en su maquina, que es exactamente cuando un arnes
 * tiene que funcionar.
 *
 * POR QUE NO SE ARREGLA CON `shell: true`, que es la respuesta habitual. Con shell, el hijo
 * directo pasa a ser `cmd.exe` y el node real queda como NIETO: `proc.kill()` mata la shell
 * y deja el servidor vivo ocupando el puerto. El arnes siguiente encontraria ese puerto
 * tomado y —si no abortara— mediria la instancia equivocada. Ya pagamos dos veces ese error
 * en este proyecto; no vale la pena volver a abrirle la puerta.
 *
 * LA SOLUCION: se corre el CLI de tsx con el MISMO binario de node que ejecuta el arnes.
 * `tsx/cli` resuelve a un `.mjs`, asi que `node ese-archivo src/server.ts` es un proceso
 * hijo DIRECTO, sin shell y sin depender del PATH. Matarlo lo mata de verdad, en los dos
 * sistemas.
 *
 * Y ESTA EN UN SOLO ARCHIVO a proposito. Tres copias de un arreglo de portabilidad es la
 * forma exacta en que este repo termino con la formula de costeo en seis lugares: la
 * proxima diferencia entre sistemas se arregla aca y le llega a los tres.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';

/** Ruta al CLI de tsx, resuelta desde el paquete y no adivinada. */
function rutaTsx(desde) {
  const require = createRequire(path.join(desde, 'package.json'));
  try {
    return require.resolve('tsx/cli');
  } catch (e) {
    throw new Error(
      'No se pudo resolver tsx desde ' + desde + '. Correr `pnpm install` primero.\n' +
      'Detalle: ' + String(e)
    );
  }
}

/**
 * Copia la base a un temporal. El arnes NUNCA trabaja sobre la base real: una verificacion
 * que puede arruinar lo que verifica no sirve.
 */
export function copiarBase(dirApi) {
  const real = path.join(dirApi, 'sistema_inventario.db');
  if (!fs.existsSync(real)) {
    throw new Error('No existe la base en ' + real + '. Correr desde packages/api.');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arnes-'));
  const copia = path.join(tmp, 'sistema_inventario.db');
  fs.copyFileSync(real, copia);
  return { tmp, copia, real };
}

/** Suma de control de un archivo, para poder afirmar que no cambio. */
export function selloArchivo(ruta) {
  const b = fs.readFileSync(ruta);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return b.length + ':' + h.toString(16);
}

/**
 * Levanta el servidor contra la base indicada y espera a que responda.
 *
 * ABORTA SI EL PUERTO YA ESTA OCUPADO, antes de intentar nada. Sin esa guarda, un servidor
 * viejo con otra base en memoria contesta el /health y el arnes mide la instancia
 * equivocada, apuntando a problemas que no existen.
 */
export async function levantarServidor({ dirApi, dbPath, puerto, esperaSegundos = 60 }) {
  const base = `http://127.0.0.1:${puerto}`;

  try {
    const r = await fetch(base + '/health');
    if (r.ok) {
      throw new Error(
        `Hay algo respondiendo en ${base}. Se aborta para no medir otra instancia.\n` +
        `Cerrar ese proceso, o correr con otro puerto:  --puerto ${puerto + 10}`
      );
    }
  } catch (e) {
    // Que nadie responda es lo que se busca. Solo se relanza el error propio.
    if (String(e.message || '').includes('Se aborta')) throw e;
  }

  const proc = spawn(process.execPath, [rutaTsx(dirApi), 'src/server.ts'], {
    cwd: dirApi,
    env: { ...process.env, SISTEMA_DB_PATH: dbPath, PORT: String(puerto) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const estado = { log: '' };
  proc.stdout?.on('data', (d) => { estado.log += String(d); });
  proc.stderr?.on('data', (d) => { estado.log += String(d); });

  let vivo = false;
  for (let i = 0; i < esperaSegundos; i++) {
    try { if ((await fetch(base + '/health')).ok) { vivo = true; break; } } catch (e) {}
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!vivo) {
    try { proc.kill('SIGKILL'); } catch (e) {}
    throw new Error('El servidor no levanto. Ultimas lineas:\n' + estado.log.slice(-2000));
  }
  // Si el spawn propio murio pero algo contesta, no es el nuestro.
  if (proc.exitCode !== null || estado.log.includes('EADDRINUSE')) {
    throw new Error('El servidor propio murio y hay otro contestando:\n' + estado.log.slice(-1500));
  }

  return {
    base,
    proc,
    get log() { return estado.log; },
    async matar() {
      try { proc.kill('SIGKILL'); } catch (e) {}
      // Se le da un instante a que suelte el puerto: el arnes siguiente puede correr
      // enseguida y encontrarlo tomado.
      await new Promise((r) => setTimeout(r, 1200));
    },
  };
}

/** Lee una opcion `--nombre valor` de la linea de comandos. */
export function opcion(nombre) {
  const i = process.argv.indexOf('--' + nombre);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
}
