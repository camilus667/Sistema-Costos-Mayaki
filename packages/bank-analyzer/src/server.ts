import { serve } from '@hono/node-server';
import app from './app';

const PORT = 3003;

console.log(`🚀 Iniciando Servidor de Análisis de Extractos Bancarios en http://localhost:${PORT}`);
console.log(`🔗 UI Panel de Extractos: http://localhost:${PORT}/`);
console.log(`🔗 API Base: http://localhost:${PORT}/api/bank/`);

serve({
  fetch: app.fetch,
  port: PORT,
});
