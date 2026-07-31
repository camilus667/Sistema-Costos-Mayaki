import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './database/schema';
import { authMiddleware } from './middleware/auth';
import colegioRoutes from './routes/colegio';
import usuarioRoutes from './routes/usuario';
import productoRoutes from './routes/producto';
import tallaRoutes from './routes/talla';
import telaRoutes from './routes/tela';
import accesorioRoutes from './routes/accesorio';
import detalleAccesorioRoutes from './routes/detalleAccesorio';
import copiaPrendaRoutes from './routes/copiaPrenda';
import calculoRoutes from './routes/calculo';
import inventarioRoutes from './routes/inventario';
import precioRoutes from './routes/precio';
import exportRoutes from './routes/export';
import costeoRoutes from './routes/costeo';
import snapshotRoutes from './routes/snapshots';
import importarRoutes from './routes/importar';
import dashboardHtml from './dashboard.html';

export interface Env {
  DB: D1Database;
  JWT_SECRET?: string;
}

const app = new Hono<{ Bindings: Env }>();

// Middlewares globales
app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// Inyección de D1 Database para Cloudflare Workers
app.use('*', async (c, next) => {
  if (c.env && c.env.DB) {
    (c as any).db = drizzle(c.env.DB, { schema });
    (c as any).schema = schema;
  }
  await next();
});

// Dashboard HTML en la raíz
app.get('/', (c) => c.html(dashboardHtml));
app.get('/dashboard', (c) => c.html(dashboardHtml));

// Health check
app.get('/health', (c) => c.json({
  status: 'ok',
  environment: 'Cloudflare Workers',
  timestamp: new Date().toISOString()
}));

// API resumen dashboard
app.get('/api/dashboard-resumen', async (c) => {
  const db = (c as any).db;
  if (!db) {
    return c.json({
      colegio: 'CAMBRIDGE',
      anio: '2026',
      admin: 'admin@cambridge.edu',
      tallas: 16,
      productos: 27,
      telas: 12,
      accesorios: 38,
      pesos: 864,
      precios: 281,
      inventario: 432,
    });
  }

  try {
    const colegio = (await db.select().from(schema.colegios).limit(1))[0];
    const anio = (await db.select().from(schema.aniosEscolares).limit(1))[0];
    const admin = (await db.select().from(schema.usuarios).limit(1))[0];
    const tallas = await db.select().from(schema.tallas);
    const productos = await db.select().from(schema.productos);
    const telas = await db.select().from(schema.telas);
    const accesorios = await db.select().from(schema.accesorios);
    const manoObra = await db.select().from(schema.manoObra);
    const pesos = await db.select().from(schema.pesoMateriaPrima);
    const precios = await db.select().from(schema.preciosVenta);
    const inventario = await db.select().from(schema.inventario);

    return c.json({
      colegio: colegio?.nombre || 'CAMBRIDGE',
      anio: anio?.anio || '2026',
      admin: admin?.email || 'admin@cambridge.edu',
      tallas: tallas.length,
      productos: productos.length,
      telas: telas.length,
      accesorios: accesorios.length,
      manoObra: manoObra.length,
      pesos: pesos.length,
      precios: precios.length,
      inventario: inventario.length,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Rutas de autenticación
const authGroup = new Hono();
authGroup.post('/login', async (c) => {
  return c.json({ message: 'Endpoint de login - autenticado', token: 'mock-jwt-token' });
});
app.route('/api/auth', authGroup);

// Middleware auth opcional/desarrollo
app.use('/api/*', authMiddleware);

// Rutas del API
app.route('/api/colegios', colegioRoutes);
app.route('/api/usuarios', usuarioRoutes);
app.route('/api/productos', productoRoutes);
app.route('/api/productos', detalleAccesorioRoutes);
// Copiar los datos de costeo de una prenda de referencia: factor, tela, pesos, mano de
// obra y receta. Tercer router en el mismo prefijo, patron que este proyecto ya usa.
app.route('/api/productos', copiaPrendaRoutes);
app.route('/api/tallas', tallaRoutes);
app.route('/api/telas', telaRoutes);
app.route('/api/accesorios', accesorioRoutes);
app.route('/api/calculo', calculoRoutes);
app.route('/api/inventario', inventarioRoutes);
app.route('/api/precios', precioRoutes);
app.route('/api/export', exportRoutes);
// Costeo unificado, el mismo que en server.ts. Ojo: inputRoutes NO esta montado
// en este archivo, asi que /api/inputs/desglose-inteligente-producto no existe en
// el deploy de Workers. Deriva preexistente entre los dos entrypoints, sin
// resolver todavia.
app.route('/api/costeo', costeoRoutes);
app.route('/api/snapshots', snapshotRoutes);
app.route('/api/importar', importarRoutes);

export default app;
