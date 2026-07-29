import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, or, isNull } from 'drizzle-orm';
import { accesorios } from '../database/schema';

const api = new Hono();

// Esquema de creación de accesorio
const crearAccesorioSchema = z.object({
  // FASE 5: colegioId pasa de obligatorio a opcional y nullable, cuarto archivo
  // con este mismo arreglo despues de tela.ts, talla.ts y colegio.ts.
  //
  // NULL significa "insumo de la empresa", que es el caso normal: 27 de los 38
  // accesorios del catalogo son compartidos (botones, cierres, elastico, hilo) y
  // solo 11 llevan la identidad de un colegio —los bordados, las serigrafias, los
  // vinilos, el cuello y la botamanga. Exigirlo aca hacia que todo accesorio nuevo
  // creado por API naciera del colegio, o sea FUERA del catalogo compartido: solo
  // lo veia ese colegio, sin ningun error visible.
  colegioId: z.string().nullable().optional(),
  descripcion: z.string().min(1),
  codigo: z.string().optional(),
  unidadCompra: z.string().min(1),
  cantidadXUd: z.number().positive(),
  costoUdCompra: z.number().positive(),
  costoUnitario: z.number().positive(),
});

// GET /api/accesorios - Listar accesorios
//
// FASE 6: acepta colegioId opcional. Antes no filtraba en absoluto, asi que con dos
// colegios cargados devolvia tambien los 11 insumos exclusivos del otro colegio.
// El filtro es `= colegio OR IS NULL` para no esconder los 27 compartidos, y
// colegioId=all sigue devolviendo todo para quien lo pida explicitamente.
api.get('/', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let query = db.select().from(accesorios);
  if (colegioId && colegioId !== 'all') {
    query = query.where(or(eq(accesorios.colegioId, colegioId), isNull(accesorios.colegioId)));
  }

  const allAccesorios = await query.orderBy(asc(accesorios.descripcion));

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

  // Explicito: sin colegio, el accesorio es del catalogo de la empresa.
  const [newAccesorio] = await db
    .insert(accesorios)
    .values({ ...body, colegioId: body.colegioId || null })
    .returning();

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
