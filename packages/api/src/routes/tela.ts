import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, or, isNull } from 'drizzle-orm';
import { telas } from '../database/schema';

const api = new Hono();

const crearTelaSchema = z.object({
  // FASE 5: colegioId es opcional Y nullable. NULL significa "tela de la empresa",
  // que es el caso normal: 11 de las 12 telas del catalogo son compartidas y solo
  // el Casimir Escoces (el tartan) pertenece a un colegio.
  colegioId: z.string().nullable().optional(),
  descripcion: z.string().min(1),
  anchoMts: z.number().positive(),
  unid: z.string().optional().default('kilo'),
  densidadGm2: z.number().positive(),
  precioCompra: z.number().positive(),
});

// GET /api/telas - Listar telas
api.get('/', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let query = db.select().from(telas);
  if (colegioId && colegioId !== 'all') {
    // FASE 5: `= colegio OR IS NULL`, no `= colegio`. Este filtro se quedo corto
    // cuando la migracion puso NULL en las telas compartidas: con `eq` a secas,
    // pedir las telas de un colegio devolvia UNA SOLA — el tartan — y escondia las
    // once genericas. La reja de paridad no lo detecto porque compara el motor de
    // costeo, y este endpoint no pasa por el motor.
    query = query.where(or(eq(telas.colegioId, colegioId), isNull(telas.colegioId)));
  }

  const allTelas = await query.orderBy(asc(telas.orden), asc(telas.descripcion));

  return c.json({
    success: true,
    data: allTelas,
  });
});

// GET /api/telas/:id
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [tela] = await db
    .select()
    .from(telas)
    .where(eq(telas.id, id))
    .limit(1);

  if (!tela) {
    return c.json({ success: false, error: 'Tela no encontrada' }, 404);
  }

  return c.json({
    success: true,
    data: tela,
  });
});

// POST /api/telas
api.post('/', zValidator('json', crearTelaSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  const anchoMts = body.anchoMts;
  const unid = body.unid || 'kilo';
  const densidadGm2 = body.densidadGm2;
  const precioCompra = body.precioCompra;

  const pesoMtLineal = anchoMts * densidadGm2;
  const rendimiento = pesoMtLineal > 0 ? 1000 / pesoMtLineal : 1;
  const precioBsKg = unid === 'metro' ? precioCompra * rendimiento : precioCompra;
  const precioBsG = precioBsKg / 1000;

  const insertData = {
    ...body,
    // FASE 5: si no viene colegio, la tela es de la empresa -> NULL.
    //
    // Antes esto ponia el literal 'default-colegio', que no es el id de ningun
    // colegio existente. Esa tela quedaba invisible para todos: no la veia el
    // colegio real (su colegio_id no coincide) ni el filtro de compartidas (no es
    // NULL), y de paso violaba la foreign key contra colegio.id. Se creaba bien,
    // devolvia 201, y despues no aparecia en ninguna pantalla.
    colegioId: body.colegioId || null,
    rendimiento: parseFloat(rendimiento.toFixed(4)),
    pesoMtLineal: parseFloat(pesoMtLineal.toFixed(2)),
    precioBsKg: parseFloat(precioBsKg.toFixed(4)),
    precioBsG: parseFloat(precioBsG.toFixed(4)),
    precioUnitario: parseFloat(precioBsG.toFixed(4)),
  };

  const [newTela] = await db.insert(telas).values(insertData).returning();

  return c.json({
    success: true,
    data: newTela,
    message: 'Tela creada exitosamente',
  }, 201);
});

// PUT /api/telas/:id - Edición en vivo: Solo Ancho, Unid, Densidad y Precio Compra son editables.
// Rendimiento, Peso/mt lineal, Precio Bs/Kg y Precio Bs/g son calculados automáticamente.
api.put('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();

  const [existing] = await db.select().from(telas).where(eq(telas.id, id)).limit(1);
  if (!existing) {
    return c.json({ success: false, error: 'Tela no encontrada' }, 404);
  }

  const anchoMts = body.anchoMts !== undefined ? Number(body.anchoMts) : existing.anchoMts;
  const unid = body.unid !== undefined ? String(body.unid).toLowerCase() : existing.unid;
  const densidadGm2 = body.densidadGm2 !== undefined ? Number(body.densidadGm2) : existing.densidadGm2;
  const precioCompra = body.precioCompra !== undefined ? Number(body.precioCompra) : existing.precioCompra;

  // Fórmulas exactas del Excel:
  const pesoMtLineal = (anchoMts || 1.5) * (densidadGm2 || 200);
  const rendimiento = pesoMtLineal > 0 ? 1000 / pesoMtLineal : (existing.rendimiento || 1);
  const precioBsKg = unid === 'metro' ? precioCompra * rendimiento : precioCompra;
  const precioBsG = precioBsKg / 1000;

  const updateValues = {
    descripcion: body.descripcion || existing.descripcion,
    anchoMts: parseFloat(anchoMts.toFixed(2)),
    unid: unid,
    densidadGm2: parseFloat(densidadGm2.toFixed(2)),
    pesoMtLineal: parseFloat(pesoMtLineal.toFixed(2)),
    rendimiento: parseFloat(rendimiento.toFixed(4)),
    precioCompra: parseFloat(precioCompra.toFixed(2)),
    precioBsKg: parseFloat(precioBsKg.toFixed(4)),
    precioBsG: parseFloat(precioBsG.toFixed(4)),
    precioUnitario: parseFloat(precioBsG.toFixed(4)),
  };

  const [updatedTela] = await db
    .update(telas)
    .set(updateValues)
    .where(eq(telas.id, id))
    .returning();

  return c.json({
    success: true,
    data: updatedTela,
    message: 'Tela actualizada y fórmulas recalculadas automáticamente',
  });
});

// DELETE /api/telas/:id
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [deletedTela] = await db
    .delete(telas)
    .where(eq(telas.id, id))
    .returning();

  if (!deletedTela) {
    return c.json({ success: false, error: 'Tela no encontrada' }, 404);
  }

  return c.json({
    success: true,
    message: 'Tela eliminada exitosamente',
  });
});

export default api;
