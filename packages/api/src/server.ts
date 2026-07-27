/**
 * Servidor local de desarrollo
 * Usa sql.js para database en memoria alimentado desde CAMBRIDGE.xlsx
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, schema } from './database/sqljs';
import colegioRoutes from './routes/colegio';
import usuarioRoutes from './routes/usuario';
import productoRoutes from './routes/producto';
import tallaRoutes from './routes/talla';
import telaRoutes from './routes/tela';
import accesorioRoutes from './routes/accesorio';
import calculoRoutes, { loadExcelMatrices } from './routes/calculo';
import inventarioRoutes from './routes/inventario';
import precioRoutes from './routes/precio';
import exportRoutes from './routes/export';
import inputRoutes from './routes/inputs';
import { asc, eq } from 'drizzle-orm';

const app = new Hono();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dashboardHtmlPath = path.join(__dirname, 'dashboard.html');

const getDashboardHtml = async () => {
  const fs = await import('fs/promises');
  return await fs.readFile(dashboardHtmlPath, 'utf8');
};

// Servir CSS centralizado
const stylesCssPath = path.join(__dirname, 'public', 'styles.css');
app.get('/styles.css', async (c) => {
  try {
    const fs = await import('fs/promises');
    const css = await fs.readFile(stylesCssPath, 'utf8');
    c.header('Content-Type', 'text/css');
    return c.body(css);
  } catch (err) {
    return c.text('/* Error al cargar styles.css */', 404);
  }
});

// Dashboard HTML en la raíz y /dashboard
app.get('/', async (c) => {
  try {
    const html = await getDashboardHtml();
    return c.html(html);
  } catch (err) {
    return c.text('Error al cargar dashboard HTML: ' + String(err), 500);
  }
});

app.get('/dashboard', async (c) => {
  try {
    const html = await getDashboardHtml();
    return c.html(html);
  } catch (err) {
    return c.text('Error al cargar dashboard HTML: ' + String(err), 500);
  }
});

// Middlewares
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

// Health check
app.get('/health', async (c) => {
  try {
    await getDb();
    return c.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(), 
      database: 'sql-js-local',
      excel: 'CAMBRIDGE.xlsx cargado'
    });
  } catch (error) {
    return c.json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      error: String(error)
    }, 500);
  }
});

// Database init middleware - inyecta DB en el context
app.use('/api/*', async (c, next) => {
  const db = await getDb();
  (c as any).db = db;
  (c as any).schema = schema;
  return next();
});

// API resumen dashboard avanzado con KPIs financieros completos de prendas, precios y costos
app.get('/api/dashboard-resumen', async (c) => {
  const db = await getDb();
  const colegioId = c.req.query('colegioId');

  const colegio = (await db.select().from(schema.colegios).limit(1))[0];
  const anio = (await db.select().from(schema.aniosEscolares).limit(1))[0];
  const admin = (await db.select().from(schema.usuarios).limit(1))[0];
  const tallas = await db.select().from(schema.tallas).orderBy(asc(schema.tallas.orden));
  
  let prodQuery = db.select().from(schema.productos);
  if (colegioId && colegioId !== 'all') prodQuery = prodQuery.where(eq(schema.productos.colegioId, colegioId));
  const productos = await prodQuery.orderBy(asc(schema.productos.itemNumero));

  const telas = await db.select().from(schema.telas);
  const accesorios = await db.select().from(schema.accesorios);

  const excelData = loadExcelMatrices();

  let totalStockUnidades = 0;
  let totalValorCostoBs = 0;
  let totalValorVentaBs = 0;

  const resumenPrendas = productos.map((p: any) => {
    let prodStock = 0;
    let prodCostoBs = 0;
    let prodVentaBs = 0;

    let minCosto = Infinity;
    let maxCosto = 0;
    let minPrecio = Infinity;
    let maxPrecio = 0;

    tallas.forEach((t: any) => {
      const key = `${p.itemNumero}_${t.codigo}`;
      const inv = excelData ? (excelData.inventarioUnidades.get(key) || 0) : 0;
      const ct = excelData ? (excelData.costoTotal.get(key) || 0) : 0;
      const pv = excelData ? (excelData.precioVenta.get(key) || 0) : 0;

      if (ct > 0) {
        if (ct < minCosto) minCosto = ct;
        if (ct > maxCosto) maxCosto = ct;
      }

      if (pv > 0) {
        if (pv < minPrecio) minPrecio = pv;
        if (pv > maxPrecio) maxPrecio = pv;
      }

      prodStock += inv;
      prodCostoBs += inv * ct;
      prodVentaBs += inv * (pv > 0 ? pv : ct);
    });

    totalStockUnidades += prodStock;
    totalValorCostoBs += prodCostoBs;
    totalValorVentaBs += prodVentaBs;

    // Calcular el promedio real unitario (%Margen en Venta: (PV - CT)/PV * 100) iterando directamente el mapa de Excel
    let unitMarginList: number[] = [];
    if (excelData && excelData.costoTotal && excelData.precioVenta) {
      excelData.costoTotal.forEach((ct: number, key: string) => {
        const parts = key.split('_');
        if (parts[0] === String(p.itemNumero) && ct > 0) {
          const pv = excelData.precioVenta.get(key) || 0;
          if (pv > 0) {
            const marginOnSale = ((pv - ct) / pv) * 100;
            unitMarginList.push(marginOnSale);
          }
        }
      });
    }

    const gananciaBs = prodVentaBs - prodCostoBs;
    const margenPct = unitMarginList.length > 0
      ? (unitMarginList.reduce((a, b) => a + b, 0) / unitMarginList.length)
      : 0;

    return {
      id: p.id,
      itemNumero: p.itemNumero,
      descripcion: p.descripcion,
      stockTotal: prodStock,
      costoMin: minCosto !== Infinity ? parseFloat(minCosto.toFixed(2)) : 0,
      costoMax: maxCosto > 0 ? parseFloat(maxCosto.toFixed(2)) : 0,
      precioMin: minPrecio !== Infinity ? parseFloat(minPrecio.toFixed(2)) : 0,
      precioMax: maxPrecio > 0 ? parseFloat(maxPrecio.toFixed(2)) : 0,
      valorCostoTotalBs: parseFloat(prodCostoBs.toFixed(2)),
      valorVentaTotalBs: parseFloat(prodVentaBs.toFixed(2)),
      gananciaEstimadaBs: parseFloat(gananciaBs.toFixed(2)),
      margenPromedioPct: parseFloat(margenPct.toFixed(2)),
    };
  });

  const gananciaTotalBs = totalValorVentaBs - totalValorCostoBs;
  const margenPromedioGlobalPct = totalValorCostoBs > 0 ? (gananciaTotalBs / totalValorCostoBs) * 100 : 0;

  return c.json({
    success: true,
    colegio: colegio?.nombre || 'CAMBRIDGE',
    anio: anio?.anio || '2026',
    admin: admin?.email || 'admin@cambridge.edu',
    tallasCount: tallas.length,
    productosCount: productos.length,
    variacionesCount: productos.length * tallas.length,
    telasCount: telas.length,
    accesoriosCount: accesorios.length,
    // KPIs Financieros Clave
    totalStockUnidades,
    totalValorCostoBs: parseFloat(totalValorCostoBs.toFixed(2)),
    totalValorVentaBs: parseFloat(totalValorVentaBs.toFixed(2)),
    gananciaTotalBs: parseFloat(gananciaTotalBs.toFixed(2)),
    margenPromedioGlobalPct: parseFloat(margenPromedioGlobalPct.toFixed(2)),
    // Lista de Prendas con Resumen Financiero
    prendas: resumenPrendas,
  });
});

// Routes
app.route('/api/colegios', colegioRoutes);
app.route('/api/usuarios', usuarioRoutes);
app.route('/api/productos', productoRoutes);
app.route('/api/tallas', tallaRoutes);
app.route('/api/telas', telaRoutes);
app.route('/api/accesorios', accesorioRoutes);
app.route('/api/calculo', calculoRoutes);
app.route('/api/inventario', inventarioRoutes);
app.route('/api/precios', precioRoutes);
app.route('/api/export', exportRoutes);
app.route('/api/inputs', inputRoutes);

// Iniciar servidor si se ejecuta directamente
async function start() {
  const PORT = 3000;
  
  console.log(`🚀 Iniciando servidor local en http://localhost:${PORT}`);
  console.log('📊 Base de datos: sql.js (en memoria con datos de CAMBRIDGE.xlsx)');
  console.log(`🔗 Dashboard UI: http://localhost:${PORT}/`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 API base: http://localhost:${PORT}/api/`);
  
  await getDb();
  console.log('✅ Base de datos inicializada y poblada desde CAMBRIDGE.xlsx');
  
  const { serve } = await import('@hono/node-server');
  
  serve(
    {
      fetch: app.fetch.bind(app),
      port: PORT,
    },
    () => {
      console.log(`✅ Servidor escuchando en puerto ${PORT}`);
    }
  );
}

const meta = import.meta as any;
if (meta.main || process.argv[1]?.includes('server.ts')) {
  start().catch(console.error);
}

export default app;
