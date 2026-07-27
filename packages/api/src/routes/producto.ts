import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { productos } from '../database/schema';

const api = new Hono();

const crearProductoSchema = z.object({
  colegioId: z.string().min(1),
  anioId: z.string().optional().nullable(),
  itemNumero: z.number().int(),
  descripcion: z.string().min(1),
  factorComplejidad: z.number().int().default(1),
  costoFijo: z.number().default(0),
  planchadoExtra: z.number().default(0),
  colocacionBotones: z.number().default(0),
  operacionesExtra: z.number().default(0),
});

// GET /api/productos - Listar productos (filtrado opcional por colegioId)
api.get('/', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');
  
  let query = db.select().from(productos);
  if (colegioId && colegioId !== 'all') {
    query = query.where(eq(productos.colegioId, colegioId));
  }
  
  const allProductos = await query.orderBy(asc(productos.itemNumero));
  
  return c.json({
    success: true,
    data: allProductos,
  });
});

// GET /api/productos/:id
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [producto] = await db
    .select()
    .from(productos)
    .where(eq(productos.id, id))
    .limit(1);
  
  if (!producto) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    data: producto,
  });
});

// POST /api/productos
api.post('/', zValidator('json', crearProductoSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  const [newProducto] = await db.insert(productos).values(body).returning();
  
  return c.json({
    success: true,
    data: newProducto,
    message: 'Producto creado exitosamente',
  }, 201);
});

// PUT /api/productos/:id
api.put('/:id', zValidator('json', crearProductoSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');
  
  const [updatedProducto] = await db
    .update(productos)
    .set(body)
    .where(eq(productos.id, id))
    .returning();
  
  if (!updatedProducto) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    data: updatedProducto,
    message: 'Producto actualizado exitosamente',
  });
});

// DELETE /api/productos/:id
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [deletedProducto] = await db
    .delete(productos)
    .where(eq(productos.id, id))
    .returning();
  
  if (!deletedProducto) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    message: 'Producto eliminado exitosamente',
  });
});

export default api;
