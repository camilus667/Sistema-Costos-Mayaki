import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { productos, inventario, preciosVenta, tallas } from '../database/schema';
import { eq, and, asc } from 'drizzle-orm';

const api = new Hono();

// GET /api/export/costos
api.get('/costos', async (c) => {
  const db = (c as any).db;
  const { productoId, colegioId } = c.req.query();
  
  // Construir datos de exportación de costos
  let query = db.select().from(productos);
  
  if (productoId) {
    query = query.where(eq(productos.id, productoId));
  }
  if (colegioId) {
    query = query.where(eq(productos.colegioId, colegioId));
  }
  
  const productosList = await query.orderBy(asc(productos.itemNumero));
  
  return c.json({ 
    success: true, 
    data: {
      productos: productosList,
      fechaExportacion: new Date().toISOString(),
      formato: 'costos-detallado'
    },
    message: 'Exportación de costos exitosa'
  });
});

// GET /api/export/inventario
api.get('/inventario', async (c) => {
  const db = (c as any).db;
  const { colegioId, productoId, tallaId } = c.req.query();
  
  // Obtener inventario con detalles
  const inventarioList = await db.select().from(inventario);
  
  return c.json({ 
    success: true, 
    data: {
      inventario: inventarioList,
      fechaExportacion: new Date().toISOString(),
      formato: 'inventario-completo'
    },
    message: 'Exportación de inventario exitosa'
  });
});

// GET /api/export/rentabilidad
api.get('/rentabilidad', async (c) => {
  const db = (c as any).db;
  const { productoId } = c.req.query();
  
  // Obtener datos de rentabilidad (precios de venta)
  let query = db.select().from(preciosVenta);
  
  if (productoId) {
    query = query.where(eq(preciosVenta.productoId, productoId));
  }
  
  const precios = await query;
  
  return c.json({ 
    success: true, 
    data: {
      precios: precios,
      fechaExportacion: new Date().toISOString(),
      formato: 'rentabilidad'
    },
    message: 'Exportación de rentabilidad exitosa'
  });
});

// POST /api/export/generar - Generar exportación personalizada
api.post('/generar', zValidator('json', z.object({
  tipo: z.enum(['costos', 'inventario', 'rentabilidad']),
  filtros: z.record(z.any()).optional(),
})), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  let data: any = null;
  
  switch (body.tipo) {
    case 'costos':
      data = await db.select().from(productos);
      break;
    case 'inventario':
      data = await db.select().from(inventario);
      break;
    case 'rentabilidad':
      data = await db.select().from(preciosVenta);
      break;
  }
  
  return c.json({
    success: true,
    data: {
      resultados: data,
      fechaExportacion: new Date().toISOString(),
      tipo: body.tipo,
      filtros: body.filtros
    },
    message: 'Exportación generada exitosamente'
  });
});

export default api;
