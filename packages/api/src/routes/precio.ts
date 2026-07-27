import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { preciosVenta, historicoPrecios } from '../database/schema';
import { desc, eq, and } from 'drizzle-orm';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

const crearPrecioSchema = z.object({
  productoId: z.string(),
  tallaId: z.string(),
  precioBs: z.number().positive(),
  vigenteDesde: z.string().optional(),
});

// GET /api/precios
api.get('/', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId, vigente } = c.req.query();
  
  let query = db.select().from(preciosVenta).orderBy(desc(preciosVenta.vigenteDesde));
  
  if (productoId) {
    query = query.where(eq(preciosVenta.productoId, productoId));
  }
  if (tallaId) {
    query = query.where(eq(preciosVenta.tallaId, tallaId));
  }
  if (vigente === 'true') {
    query = query.where(eq(preciosVenta.vigenteHasta, null));
  }
  
  const precios = await query;
  
  return c.json({ success: true, data: precios });
});

// GET /api/precios/:id
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const precio = await db.select().from(preciosVenta).where(eq(preciosVenta.id, id)).limit(1);
  
  if (!precio.length) {
    return c.json({ success: false, message: 'Precio no encontrado' }, 404);
  }
  
  return c.json({ success: true, data: precio[0] });
});

// POST /api/precios
api.post('/', zValidator('json', crearPrecioSchema), async (c) => {
  const db = (c as any).db;
  const body: any = c.req.valid('json');
  
  // Invalidar precios anteriores del mismo producto/talla
  await db
    .update(preciosVenta)
    .set({ vigenteHasta: new Date().toISOString() })
    .where(and(
      eq(preciosVenta.productoId, body.productoId),
      eq(preciosVenta.tallaId, body.tallaId)
    ));
  
  const [newPrecio] = await db.insert(preciosVenta).values({
    productoId: body.productoId,
    tallaId: body.tallaId,
    precioBs: body.precioBs,
    vigenteDesde: body.vigenteDesde || new Date().toISOString(),
  }).returning();
  
  saveDbToDisk();

  return c.json({ success: true, data: newPrecio, message: 'Precio creado exitosamente' }, 201);
});

// PUT /api/precios/:id
api.put('/:id', zValidator('json', crearPrecioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body: any = c.req.valid('json');
  
  const [existing] = await db.select().from(preciosVenta).where(eq(preciosVenta.id, id)).limit(1);
  
  if (!existing) {
    return c.json({ success: false, message: 'Precio no encontrado' }, 404);
  }
  
  const datosActualizados: any = {};
  
  if (body.precioBs !== undefined) datosActualizados.precioBs = body.precioBs;
  if (body.vigenteDesde !== undefined) datosActualizados.vigenteDesde = body.vigenteDesde;
  
  const [updatedPrecio] = await db
    .update(preciosVenta)
    .set(datosActualizados)
    .where(eq(preciosVenta.id, id))
    .returning();
  
  saveDbToDisk();

  return c.json({ success: true, data: updatedPrecio, message: 'Precio actualizado exitosamente' });
});

// DELETE /api/precios/:id
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  await db.delete(preciosVenta).where(eq(preciosVenta.id, id));
  
  return c.json({ success: true, message: 'Precio eliminado exitosamente' });
});

// GET /api/precios/historico
api.get('/historico', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId } = c.req.query();
  
  let query = db.select().from(historicoPrecios).orderBy(desc(historicoPrecios.cambiadoEn));
  
  if (productoId) {
    query = query.where(eq(historicoPrecios.productoId, productoId));
  }
  if (tallaId) {
    query = query.where(eq(historicoPrecios.tallaId, tallaId));
  }
  
  const historial = await query.limit(100);
  
  return c.json({ success: true, data: historial });
});

// GET /api/precios/exportar/costos
api.get('/exportar/costos', async (c) => {
  const db = (c as any).db;
  const { productoId, colegioId } = c.req.query();
  
  // Obtener precios con detalles de productos
  let query = db.select({
    precioId: preciosVenta.id,
    productoId: preciosVenta.productoId,
    tallaId: preciosVenta.tallaId,
    precioBs: preciosVenta.precioBs,
    vigenteDesde: preciosVenta.vigenteDesde,
  }).from(preciosVenta);
  
  if (productoId) {
    query = query.where(eq(preciosVenta.productoId, productoId));
  }
  
  const precios = await query;
  
  return c.json({ 
    success: true, 
    data: precios,
    message: 'Exportación de costos exitosa'
  });
});

export default api;
