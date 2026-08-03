import { serve } from '@hono/node-server';
import app from './app';
import fs from 'fs';
import { getDbFilePath } from '../../api/src/database/sqljs';

const PORT = 3002;

function verificarLockBD() {
  const dbPath = getDbFilePath();
  const lockFile = `${dbPath}.lock`;

  if (fs.existsSync(lockFile)) {
    try {
      const pid = fs.readFileSync(lockFile, 'utf-8').trim();
      console.warn(`\n⚠️  ADVERTENCIA: El archivo de bloqueo '${lockFile}' indica que el proceso PID ${pid} está utilizando la base de datos.`);
    } catch (e) {
      // Ignorar lectura
    }
  } else {
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

console.log(`🚀 Iniciando Servidor de Gestión y Proyección de Ventas en http://localhost:${PORT}`);
console.log(`🔗 Sales Manager UI: http://localhost:${PORT}/`);
console.log(`🔗 API Base: http://localhost:${PORT}/api/sales/`);

serve({
  fetch: app.fetch,
  port: PORT,
});
