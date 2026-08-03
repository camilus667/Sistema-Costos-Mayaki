import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import salesRoutes from './routes/sales';

const app = new Hono();

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

// Servir archivos estáticos del frontend
app.use('/*', serveStatic({ root: './src/public' }));

export default app;
