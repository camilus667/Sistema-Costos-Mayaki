import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { tallas } from '../database/schema';

const api = new Hono();

// Esquema de creación de talla
const crearTallaSchema = z.object({
  colegioId: z.string().min(1),
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(255),
  orden: z.number().int().default(1),
});

// GET /api/tallas - Listar tallas
api.get('/', async (c) => {
  const db = (c as any).db;
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.nombre));
  
  return c.json({
    success: true,
    data: allTallas,
  });
});

// GET /api/tallas/:id - Obtener talla por ID
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [talla] = await db
    .select()
    .from(tallas)
    .where(eq(tallas.id, id))
    .limit(1);
  
  if (!talla) {
    return c.json({ success: false, error: 'Talla no encontrada' }, 404);
  }
  
  return c.json({
    success: true,
    data: talla,
  });
});

// POST /api/tallas - Crear talla
api.post('/', zValidator('json', crearTallaSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  const [newTalla] = await db.insert(tallas).values(body).returning();
  
  return c.json({
    success: true,
    data: newTalla,
    message: 'Talla creada exitosamente',
  }, 201);
});

// PUT /api/tallas/:id - Actualizar talla
api.put('/:id', zValidator('json', crearTallaSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');
  
  const [updatedTalla] = await db
    .update(tallas)
    .set(body)
    .where(eq(tallas.id, id))
    .returning();
  
  if (!updatedTalla) {
    return c.json({ success: false, error: 'Talla no encontrada' }, 404);
  }
  
  return c.json({
    success: true,
    data: updatedTalla,
    message: 'Talla actualizada exitosamente',
  });
});

// DELETE /api/tallas/:id - Eliminar talla
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [deletedTalla] = await db
    .delete(tallas)
    .where(eq(tallas.id, id))
    .returning();
  
  if (!deletedTalla) {
    return c.json({ success: false, error: 'Talla no encontrada' }, 404);
  }
  
  return c.json({
    success: true,
    message: 'Talla eliminada exitosamente',
  });
});

export default api;
