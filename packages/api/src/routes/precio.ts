import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { preciosVenta, historicoPrecios } from '../database/schema';
import { desc, eq, and, isNull, type SQL } from 'drizzle-orm';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

const crearPrecioSchema = z.object({
  productoId: z.string(),
  tallaId: z.string(),
  precioBs: z.number().positive(),
  vigenteDesde: z.string().optional(),
});

/**
 * NOTA SOBRE EL ORDEN DE LAS RUTAS
 *
 * Las rutas de un solo segmento como /historico van ANTES de /:id. Hono resuelve
 * en orden de registro, asi que con /:id declarado primero, una peticion a
 * /api/precios/historico entraba por /:id con id = "historico" y respondia
 * 404 "Precio no encontrado". El endpoint de historico era inalcanzable.
 *
 * NOTA SOBRE LOS FILTROS
 *
 * Las condiciones se acumulan en un arreglo y se aplican con un solo and(...).
 * Antes se hacia `query = query.where(...)` una vez por filtro, y en Drizzle cada
 * llamada a .where() REEMPLAZA la anterior en lugar de combinarse: filtrar por
 * producto y talla a la vez solo aplicaba el ultimo, devolviendo los precios de
 * esa talla para TODOS los productos.
 *
 * Y el filtro de vigencia usaba eq(vigenteHasta, null), que en SQL se traduce a
 * `vigente_hasta = NULL`. Comparar con NULL usando = nunca es verdadero, ni
 * cuando el valor es nulo, asi que ?vigente=true devolvia cero filas siempre.
 * Lo correcto es isNull().
 */

// GET /api/precios/historico  — antes de /:id, ver nota de arriba
api.get('/historico', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId } = c.req.query();

  const condiciones: SQL[] = [];
  if (productoId) condiciones.push(eq(historicoPrecios.productoId, productoId));
  if (tallaId) condiciones.push(eq(historicoPrecios.tallaId, tallaId));

  const base = db.select().from(historicoPrecios);
  const historial = await (condiciones.length ? base.where(and(...condiciones)) : base)
    .orderBy(desc(historicoPrecios.cambiadoEn))
    .limit(100);

  return c.json({ success: true, data: historial });
});

// GET /api/precios/exportar/costos
api.get('/exportar/costos', async (c) => {
  const db = (c as any).db;
  const { productoId } = c.req.query();

  const condiciones: SQL[] = [];
  if (productoId) condiciones.push(eq(preciosVenta.productoId, productoId));

  const base = db.select({
    precioId: preciosVenta.id,
    productoId: preciosVenta.productoId,
    tallaId: preciosVenta.tallaId,
    precioBs: preciosVenta.precioBs,
    vigenteDesde: preciosVenta.vigenteDesde,
  }).from(preciosVenta);

  const precios = await (condiciones.length ? base.where(and(...condiciones)) : base);

  return c.json({
    success: true,
    data: precios,
    message: 'Exportación de costos exitosa',
  });
});

// GET /api/precios
api.get('/', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId, vigente } = c.req.query();

  const condiciones: SQL[] = [];
  if (productoId) condiciones.push(eq(preciosVenta.productoId, productoId));
  if (tallaId) condiciones.push(eq(preciosVenta.tallaId, tallaId));
  // Vigente = sin fecha de cierre. isNull, no eq(..., null).
  if (vigente === 'true') condiciones.push(isNull(preciosVenta.vigenteHasta));

  const base = db.select().from(preciosVenta);
  const precios = await (condiciones.length ? base.where(and(...condiciones)) : base)
    .orderBy(desc(preciosVenta.vigenteDesde));

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

  // Cierra la vigencia del precio anterior de esa prenda y talla.
  // Se limita a los que estan abiertos (vigente_hasta nulo): sin esa condicion
  // se reescribia la fecha de cierre de precios ya cerrados, corrompiendo el
  // historico de vigencias.
  await db
    .update(preciosVenta)
    .set({ vigenteHasta: new Date().toISOString() })
    .where(and(
      eq(preciosVenta.productoId, body.productoId),
      eq(preciosVenta.tallaId, body.tallaId),
      isNull(preciosVenta.vigenteHasta)
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

  // Faltaba: sin esto el borrado se perdia al reiniciar, porque con sql.js las
  // escrituras viven en memoria hasta que se exporta la base.
  saveDbToDisk();

  return c.json({ success: true, message: 'Precio eliminado exitosamente' });
});

export default api;
