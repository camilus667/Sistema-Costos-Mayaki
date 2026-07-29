import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { tallas } from '../database/schema';

const api = new Hono();

// Esquema de creación de talla
const crearTallaSchema = z.object({
  // FASE 5: colegioId pasa de obligatorio a opcional y nullable.
  //
  // La talla dejo de ser del colegio: es un vocabulario de codigos de industria y
  // las 16 filas del catalogo tienen colegio_id NULL. Exigirlo aca obligaba a
  // asignarle un colegio a cada talla nueva, y una talla con colegio queda fuera
  // del vocabulario comun: solo la ve ese colegio. Se deja la puerta abierta a una
  // talla exclusiva por si algun dia hace falta, pero el default es compartida.
  colegioId: z.string().nullable().optional(),
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(255),
  orden: z.number().int().default(1),
});

// GET /api/tallas - Listar tallas
//
// NO filtra por colegio, y es a proposito. Las tallas son el vocabulario compartido
// de la empresa (FASE 5), asi que devolver todas es lo correcto. Si alguna vez se
// agrega una talla exclusiva de un colegio, el filtro que corresponde aca es
// `= colegio OR IS NULL`, nunca `= colegio` a secas: con `eq` puro esta pantalla
// perderia las 16 compartidas. Ese error ya ocurrio en GET /api/telas.
api.get('/', async (c) => {
  const db = (c as any).db;
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

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

  // Explicito: sin colegio, la talla es compartida. Dejarlo implicito funcionaria
  // igual (Drizzle omite la columna y la base pone NULL), pero escrito se lee.
  const [newTalla] = await db
    .insert(tallas)
    .values({ ...body, colegioId: body.colegioId || null })
    .returning();

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
