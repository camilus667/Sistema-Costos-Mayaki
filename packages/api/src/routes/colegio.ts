import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { colegios } from '../database/schema';

const api = new Hono();

// Esquema de creación de colegio
const crearColegioSchema = z.object({
  nombre: z.string().min(1).max(255),
  direccion: z.string().max(500).optional(),
  nit: z.string().max(50).optional(),
  telefono: z.string().max(50).optional(),
});

// GET /api/colegios - Listar colegios
api.get('/', async (c) => {
  const db = (c as any).db;
  const allColegios = await db.select().from(colegios).orderBy(asc(colegios.nombre));
  
  return c.json({
    success: true,
    data: allColegios,
  });
});

// GET /api/colegios/:id - Obtener colegio por ID
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [colegio] = await db
    .select()
    .from(colegios)
    .where(eq(colegios.id, id))
    .limit(1);
  
  if (!colegio) {
    return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    data: colegio,
  });
});

// POST /api/colegios - Crear colegio
api.post('/', zValidator('json', crearColegioSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  const [newColegio] = await db.insert(colegios).values(body).returning();
  
  return c.json({
    success: true,
    data: newColegio,
    message: 'Colegio creado exitosamente',
  }, 201);
});

// PUT /api/colegios/:id - Actualizar colegio
api.put('/:id', zValidator('json', crearColegioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');
  
  const [updatedColegio] = await db
    .update(colegios)
    .set(body)
    .where(eq(colegios.id, id))
    .returning();
  
  if (!updatedColegio) {
    return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    data: updatedColegio,
    message: 'Colegio actualizado exitosamente',
  });
});

// DELETE /api/colegios/:id - Eliminar colegio
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [deletedColegio] = await db
    .delete(colegios)
    .where(eq(colegios.id, id))
    .returning();
  
  if (!deletedColegio) {
    return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  }
  
  return c.json({
    success: true,
    message: 'Colegio eliminado exitosamente',
  });
});

// PATCH /api/colegios/:id/toggle - Activar/Desactivar colegio
api.patch('/:id/toggle', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  
  const [colegio] = await db
    .select()
    .from(colegios)
    .where(eq(colegios.id, id))
    .limit(1);
  
  if (!colegio) {
    return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  }
  
  const [updatedColegio] = await db
    .update(colegios)
    .set({ activo: !colegio.activo })
    .where(eq(colegios.id, id))
    .returning();
  
  return c.json({
    success: true,
    data: updatedColegio,
    message: `Colegio ${updatedColegio.activo ? 'activado' : 'desactivado'} exitosamente`,
  });
});

export default api;
