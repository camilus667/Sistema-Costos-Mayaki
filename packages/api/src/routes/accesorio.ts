import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { accesorios } from '../database/schema';

const api = new Hono();

// Esquema de creación de accesorio
const crearAccesorioSchema = z.object({
  colegioId: z.string().min(1),
  descripcion: z.string().min(1),
  codigo: z.string().optional(),
  unidadCompra: z.string().min(1),
  cantidadXUd: z.number().positive(),
  costoUdCompra: z.number().positive(),
  costoUnitario: z.number().positive(),
});

// GET /api/accesorios - Listar accesorios
api.get('/', async (c) => {
  const db = (c as any).db;
  const allAccesorios = await db
    .select()
    .from(accesorios)
    .orderBy(asc(accesorios.descripcion));
  
  return c.json({
    success: true,
    data: allAccesorios,
  });
});

// GET /api/accesorios/:id - Obtener accesorio por ID
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [accesorio] = await db
    .select()
    .from(accesorios)
    .where(eq(accesorios.id, id))
    .limit(1);
  
  if (!accesorio) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    data: accesorio,
  });
});

// POST /api/accesorios - Crear accesorio
api.post('/', zValidator('json', crearAccesorioSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  const [newAccesorio] = await db.insert(accesorios).values(body).returning();
  
  return c.json({
    success: true,
    data: newAccesorio,
    message: 'Accesorio creado exitosamente',
  }, 201);
});

// PUT /api/accesorios/:id - Actualizar accesorio
api.put('/:id', zValidator('json', crearAccesorioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');
  
  const [updatedAccesorio] = await db
    .update(accesorios)
    .set(body)
    .where(eq(accesorios.id, id))
    .returning();
  
  if (!updatedAccesorio) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    data: updatedAccesorio,
    message: 'Accesorio actualizado exitosamente',
  });
});

// DELETE /api/accesorios/:id - Eliminar accesorio
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [deletedAccesorio] = await db
    .delete(accesorios)
    .where(eq(accesorios.id, id))
    .returning();
  
  if (!deletedAccesorio) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    message: 'Accesorio eliminado exitosamente',
  });
});

export default api;
