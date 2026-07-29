/**
 * Asignación de accesorios a prendas — tabla `detalle_acc`
 *
 * Esta es la "receta" de cada prenda: qué accesorios lleva y en qué cantidad.
 *
 * Antes de este módulo la tabla `detalle_acc` existía en el schema pero nada la
 * escribía ni la leía: el costo de accesorios se resolvía leyendo CAMBRIDGE.xlsx
 * en memoria (hoja `Acc`, columna 41) y las ediciones vivían en un Map que se
 * perdía al reiniciar el proceso. Eso hacía imposible dar de alta un colegio
 * nuevo, porque un colegio sin hoja en ese workbook no tenía forma de existir.
 *
 * Se monta bajo /api/productos (ver server.ts), de modo que las rutas quedan:
 *   GET    /api/productos/:productoId/accesorios
 *   POST   /api/productos/:productoId/accesorios
 *   PUT    /api/productos/:productoId/accesorios/:detalleId
 *   DELETE /api/productos/:productoId/accesorios/:detalleId
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { detalleAccesorio, accesorios, productos } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

/**
 * Genera un id con el mismo formato que el default del schema
 * (`lower(hex(randomblob(16)))`): 32 caracteres hexadecimales.
 * Se genera en JS y no en SQL porque las tablas se crean con DDL literal en
 * sqljs.ts, donde la columna `id` no lleva DEFAULT.
 */
function nuevoId(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

const asignarSchema = z.object({
  accesorioId: z.string().min(1),
  cantidadUso: z.number().positive(),
});

const actualizarSchema = z.object({
  cantidadUso: z.number().positive(),
});

/**
 * Un accesorio exclusivo de un colegio no puede usarse en prendas de otro.
 * `colegioId` nulo significa catálogo general de la empresa (botones, cierres,
 * elástico, hilo) y es usable por cualquier colegio.
 *
 * Hoy `accesorio.colegio_id` es NOT NULL, así que esta validación restringe la
 * asignación al mismo colegio. Cuando la columna pase a nullable, los accesorios
 * generales quedan habilitados sin tocar esta función.
 */
function accesorioUsablePorProducto(accesorio: any, producto: any): boolean {
  if (!accesorio.colegioId) return true;
  return accesorio.colegioId === producto.colegioId;
}

// GET /api/productos/:productoId/accesorios — receta de la prenda
api.get('/:productoId/accesorios', async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');

  const [producto] = await db
    .select()
    .from(productos)
    .where(eq(productos.id, productoId))
    .limit(1);

  if (!producto) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }

  const filas = await db
    .select({
      id: detalleAccesorio.id,
      accesorioId: accesorios.id,
      descripcion: accesorios.descripcion,
      codigo: accesorios.codigo,
      unidadCompra: accesorios.unidadCompra,
      costoUnitario: accesorios.costoUnitario,
      cantidadUso: detalleAccesorio.cantidadUso,
    })
    .from(detalleAccesorio)
    .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id))
    .where(eq(detalleAccesorio.productoId, productoId))
    .orderBy(asc(accesorios.descripcion));

  const data = filas.map((f: any) => ({
    ...f,
    costoTotalBs: redondear((f.cantidadUso || 0) * (f.costoUnitario || 0)),
  }));

  return c.json({
    success: true,
    producto: {
      id: producto.id,
      itemNumero: producto.itemNumero,
      descripcion: producto.descripcion,
      colegioId: producto.colegioId,
    },
    data,
    // Se suman los componentes ya redondeados para que el subtotal cuadre
    // exactamente con lo que se muestra línea por línea.
    subtotalAccesoriosBs: redondear(
      data.reduce((t: number, f: any) => t + f.costoTotalBs, 0)
    ),
  });
});

// POST /api/productos/:productoId/accesorios — asignar un accesorio a la prenda
api.post('/:productoId/accesorios', zValidator('json', asignarSchema), async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const { accesorioId, cantidadUso } = c.req.valid('json');

  const [producto] = await db
    .select()
    .from(productos)
    .where(eq(productos.id, productoId))
    .limit(1);

  if (!producto) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }

  const [accesorio] = await db
    .select()
    .from(accesorios)
    .where(eq(accesorios.id, accesorioId))
    .limit(1);

  if (!accesorio) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }

  if (!accesorioUsablePorProducto(accesorio, producto)) {
    return c.json({
      success: false,
      error:
        'El accesorio pertenece a otro colegio. Solo los accesorios del catálogo general (sin colegio asignado) se pueden compartir entre colegios.',
    }, 409);
  }

  const [existente] = await db
    .select()
    .from(detalleAccesorio)
    .where(and(
      eq(detalleAccesorio.productoId, productoId),
      eq(detalleAccesorio.accesorioId, accesorioId)
    ))
    .limit(1);

  if (existente) {
    return c.json({
      success: false,
      error: 'Ese accesorio ya está asignado a la prenda. Usá PUT para cambiar la cantidad.',
      detalleId: existente.id,
    }, 409);
  }

  const [creado] = await db
    .insert(detalleAccesorio)
    .values({ id: nuevoId(), productoId, accesorioId, cantidadUso })
    .returning();

  saveDbToDisk();

  return c.json({
    success: true,
    data: {
      ...creado,
      descripcion: accesorio.descripcion,
      costoUnitario: accesorio.costoUnitario,
      costoTotalBs: redondear(cantidadUso * (accesorio.costoUnitario || 0)),
    },
    message: 'Accesorio asignado a la prenda',
  }, 201);
});

// PUT /api/productos/:productoId/accesorios/:detalleId — cambiar la cantidad
api.put('/:productoId/accesorios/:detalleId', zValidator('json', actualizarSchema), async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const detalleId = c.req.param('detalleId');
  const { cantidadUso } = c.req.valid('json');

  // Se valida que la línea pertenezca a esta prenda para que no se pueda editar
  // la receta de otra prenda pasando un detalleId ajeno.
  const [linea] = await db
    .select()
    .from(detalleAccesorio)
    .where(and(
      eq(detalleAccesorio.id, detalleId),
      eq(detalleAccesorio.productoId, productoId)
    ))
    .limit(1);

  if (!linea) {
    return c.json({ success: false, error: 'Asignación no encontrada para esta prenda' }, 404);
  }

  const [actualizado] = await db
    .update(detalleAccesorio)
    .set({ cantidadUso })
    .where(eq(detalleAccesorio.id, detalleId))
    .returning();

  saveDbToDisk();

  return c.json({
    success: true,
    data: actualizado,
    message: 'Cantidad actualizada',
  });
});

// DELETE /api/productos/:productoId/accesorios/:detalleId — quitar el accesorio
api.delete('/:productoId/accesorios/:detalleId', async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const detalleId = c.req.param('detalleId');

  const [linea] = await db
    .select()
    .from(detalleAccesorio)
    .where(and(
      eq(detalleAccesorio.id, detalleId),
      eq(detalleAccesorio.productoId, productoId)
    ))
    .limit(1);

  if (!linea) {
    return c.json({ success: false, error: 'Asignación no encontrada para esta prenda' }, 404);
  }

  await db.delete(detalleAccesorio).where(eq(detalleAccesorio.id, detalleId));

  saveDbToDisk();

  return c.json({ success: true, message: 'Accesorio quitado de la prenda' });
});

export default api;
