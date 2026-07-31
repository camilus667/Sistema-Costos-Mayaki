import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { getDb } from '../../api/src/database/sqljs.ts';
import posRoutes from './routes/pos';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = new Hono();

// Inicializar BD
getDb();

// Servir styles.css del sistema principal
app.get('/styles.css', (c) => {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.resolve(__dirname, '../../api/src/public/styles.css');
    if (fs.existsSync(cssPath)) {
      return c.body(fs.readFileSync(cssPath, 'utf-8'), 200, { 'Content-Type': 'text/css' });
    }
  } catch (e) {}
  return c.text('/* styles fallback */', 200, { 'Content-Type': 'text/css' });
});

// Montar API del POS
app.route('/api/pos', posRoutes);

// Servir frontend Vanilla POS
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(__dirname, 'public');
  app.use('/*', serveStatic({ root: publicDir }));
} catch (e) {
  app.use('/*', serveStatic({ root: './src/public' }));
}

export default app;

