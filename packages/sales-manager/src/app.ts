import { Hono } from 'hono';
import salesRoutes from './routes/sales';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const app = new Hono();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, 'public');

// Middleware de CORS
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (c.req.method === 'OPTIONS') {
    return c.body(null, 204);
  }

  await next();
});

// Rutas de API
app.route('/api/sales', salesRoutes);

// Servir index.html en la raíz '/'
app.get('/', (c) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return c.html(fs.readFileSync(indexPath, 'utf-8'));
  }
  return c.text('Error: index.html no encontrado', 404);
});

// Servir archivos estáticos del frontend
app.use('/*', async (c, next) => {
  const reqPath = c.req.path;
  if (reqPath.startsWith('/api')) {
    return next();
  }
  const fileName = reqPath.replace(/^\//, '');
  const filePath = path.join(publicDir, fileName);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.webp': 'image/webp',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    return c.body(data, 200, { 'Content-Type': contentType });
  }
  return next();
});

export default app;
