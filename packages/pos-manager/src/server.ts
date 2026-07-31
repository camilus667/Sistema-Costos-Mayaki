import { serve } from '@hono/node-server';
import app from './app';
import fs from 'fs';
import path from 'path';
import { getDbFilePath } from '../../api/src/database/sqljs.ts';

const PORT = 3001;

function verificarLockBD() {
  const dbPath = getDbFilePath();
  const lockFile = `${dbPath}.lock`;

  if (fs.existsSync(lockFile)) {
    try {
      const pid = fs.readFileSync(lockFile, 'utf-8').trim();
      console.warn(`\n⚠️  ADVERTENCIA: El archivo de bloqueo '${lockFile}' indica que el proceso PID ${pid} está utilizando la base de datos.`);
      console.warn(`⚠️  Para evitar la pérdida de datos por accesos concurrentes en sql.js, utilice 'pnpm dev:all' para iniciar ambos servidores en un solo proceso.\n`);
    } catch (e) {
      // Ignorar lectura
    }
  } else {
    // Escribir nuestro lock
    try {
      fs.writeFileSync(lockFile, String(process.pid));
      process.on('exit', () => {
        try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) {}
      });
      process.on('SIGINT', () => {
        try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch (e) {}
        process.exit(0);
      });
    } catch (e) {
      // Ignorar si no hay permisos
    }
  }
}

verificarLockBD();

console.log(`🚀 Iniciando Servidor Gestor POS en http://localhost:${PORT}`);
console.log(`🔗 POS Manager UI: http://localhost:${PORT}/`);
console.log(`🔗 API Base: http://localhost:${PORT}/api/pos/`);

serve({
  fetch: app.fetch,
  port: PORT,
});
