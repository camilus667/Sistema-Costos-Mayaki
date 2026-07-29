/**
 * Exportaciones — /api/export
 *
 * FASE 6. Este archivo tenia tres defectos distintos, y solo uno era la fuga de datos
 * entre colegios:
 *
 * 1. FILTROS QUE NO COMPONEN. /costos hacia esto:
 *
 *      if (productoId) query = query.where(eq(productos.id, productoId));
 *      if (colegioId)  query = query.where(eq(productos.colegioId, colegioId));
 *
 *    Dos .where() encadenados. En Drizzle el segundo reemplaza al primero, asi que
 *    pasar los dos parametros descartaba el de producto en silencio. Ahora las
 *    condiciones se juntan con and() y se aplican una sola vez.
 *
 * 2. PARAMETROS DECLARADOS Y NUNCA USADOS. /inventario destructuraba colegioId,
 *    productoId y tallaId del query y no usaba ninguno: devolvia la tabla entera. Un
 *    endpoint que acepta un filtro y lo ignora es peor que uno que no lo acepta,
 *    porque el que lo llama cree que filtro.
 *
 * 3. LA FUGA. inventario y precio_venta no tienen colegio_id propio: solo se acotan
 *    pasando por producto. Sin ese join devuelven las filas de TODOS los colegios y no
 *    hay parametro que lo evite. Con un colegio cargado eso era invisible; con dos es
 *    una fuga real, y una exportacion es justo el peor lugar para tenerla porque el
 *    resultado sale del sistema.
 *
 * Y /generar reimplementaba los tres casos con `db.select().from(tabla)` a secas,
 * ignorando su propio parametro `filtros`. Ahora los tres tipos viven en una funcion
 * cada uno y tanto los GET como el POST llaman a esas.
 *
 * ALCANCE: colegioId sigue siendo OPCIONAL, y sin el se exporta todo. Es la regla que
 * el usuario fijo para la Fase 6: dejar el alcance total disponible y agregar el filtro
 * donde no existia. Pero la respuesta ahora DECLARA el alcance que aplico, para que una
 * exportacion de toda la empresa diga que lo es en vez de parecer la de un colegio.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { productos, inventario, preciosVenta, tallas } from '../database/schema';
import { eq, and, asc } from 'drizzle-orm';

const api = new Hono();

type Filtros = {
  colegioId?: string;
  productoId?: string;
  tallaId?: string;
};

/** Normaliza: 'all' y la cadena vacia significan "sin filtrar". */
function limpiar(filtros: Filtros): Filtros {
  const ok = (v?: string) => (v && v !== 'all' ? v : undefined);
  return {
    colegioId: ok(filtros.colegioId),
    productoId: ok(filtros.productoId),
    tallaId: ok(filtros.tallaId),
  };
}

function describirAlcance(f: Filtros): string {
  const partes: string[] = [];
  partes.push(f.colegioId ? `colegio ${f.colegioId}` : 'TODA LA EMPRESA');
  if (f.productoId) partes.push(`prenda ${f.productoId}`);
  if (f.tallaId) partes.push(`talla ${f.tallaId}`);
  return partes.join(', ');
}

// ---------------------------------------------------------------- costos
async function exportarCostos(db: any, filtros: Filtros) {
  const f = limpiar(filtros);
  const cond: any[] = [];
  if (f.productoId) cond.push(eq(productos.id, f.productoId));
  if (f.colegioId) cond.push(eq(productos.colegioId, f.colegioId));

  let query = db.select().from(productos);
  // and() con una sola condicion la devuelve tal cual, asi que no hace falta ramificar.
  if (cond.length > 0) query = query.where(and(...cond));

  return await query.orderBy(asc(productos.itemNumero));
}

// ------------------------------------------------------------ inventario
async function exportarInventario(db: any, filtros: Filtros) {
  const f = limpiar(filtros);
  const cond: any[] = [];
  if (f.colegioId) cond.push(eq(productos.colegioId, f.colegioId));
  if (f.productoId) cond.push(eq(inventario.productoId, f.productoId));
  if (f.tallaId) cond.push(eq(inventario.tallaId, f.tallaId));

  // El join a producto no es solo para filtrar: una exportacion de inventario sin el
  // numero de item ni la descripcion obliga a cruzarla a mano contra otra planilla.
  let query = db
    .select({
      id: inventario.id,
      productoId: inventario.productoId,
      itemNumero: productos.itemNumero,
      descripcionPrenda: productos.descripcion,
      colegioId: productos.colegioId,
      tallaId: inventario.tallaId,
      tallaCodigo: tallas.codigo,
      cantidad: inventario.cantidad,
      costoUnitario: inventario.costoUnitario,
      costoTotal: inventario.costoTotal,
    })
    .from(inventario)
    .innerJoin(productos, eq(inventario.productoId, productos.id))
    .leftJoin(tallas, eq(inventario.tallaId, tallas.id));

  if (cond.length > 0) query = query.where(and(...cond));

  return await query.orderBy(asc(productos.itemNumero), asc(tallas.orden));
}

// ---------------------------------------------------------- rentabilidad
async function exportarRentabilidad(db: any, filtros: Filtros) {
  const f = limpiar(filtros);
  const cond: any[] = [];
  if (f.colegioId) cond.push(eq(productos.colegioId, f.colegioId));
  if (f.productoId) cond.push(eq(preciosVenta.productoId, f.productoId));
  if (f.tallaId) cond.push(eq(preciosVenta.tallaId, f.tallaId));

  let query = db
    .select({
      id: preciosVenta.id,
      productoId: preciosVenta.productoId,
      itemNumero: productos.itemNumero,
      descripcionPrenda: productos.descripcion,
      colegioId: productos.colegioId,
      tallaId: preciosVenta.tallaId,
      tallaCodigo: tallas.codigo,
      precioBs: preciosVenta.precioBs,
      vigenteDesde: preciosVenta.vigenteDesde,
      vigenteHasta: preciosVenta.vigenteHasta,
    })
    .from(preciosVenta)
    .innerJoin(productos, eq(preciosVenta.productoId, productos.id))
    .leftJoin(tallas, eq(preciosVenta.tallaId, tallas.id));

  if (cond.length > 0) query = query.where(and(...cond));

  return await query.orderBy(asc(productos.itemNumero), asc(tallas.orden));
}

// ============================================================== endpoints

// GET /api/export/costos
api.get('/costos', async (c) => {
  const db = (c as any).db;
  const { productoId, colegioId } = c.req.query();
  const filtros = { productoId, colegioId };

  const productosList = await exportarCostos(db, filtros);

  return c.json({
    success: true,
    data: {
      productos: productosList,
      fechaExportacion: new Date().toISOString(),
      formato: 'costos-detallado',
      alcance: describirAlcance(limpiar(filtros)),
    },
    message: 'Exportación de costos exitosa',
  });
});

// GET /api/export/inventario
api.get('/inventario', async (c) => {
  const db = (c as any).db;
  const { colegioId, productoId, tallaId } = c.req.query();
  const filtros = { colegioId, productoId, tallaId };

  const inventarioList = await exportarInventario(db, filtros);

  return c.json({
    success: true,
    data: {
      inventario: inventarioList,
      fechaExportacion: new Date().toISOString(),
      formato: 'inventario-completo',
      alcance: describirAlcance(limpiar(filtros)),
    },
    message: 'Exportación de inventario exitosa',
  });
});

// GET /api/export/rentabilidad
api.get('/rentabilidad', async (c) => {
  const db = (c as any).db;
  const { productoId, colegioId, tallaId } = c.req.query();
  const filtros = { productoId, colegioId, tallaId };

  const precios = await exportarRentabilidad(db, filtros);

  return c.json({
    success: true,
    data: {
      precios,
      fechaExportacion: new Date().toISOString(),
      formato: 'rentabilidad',
      alcance: describirAlcance(limpiar(filtros)),
    },
    message: 'Exportación de rentabilidad exitosa',
  });
});

// POST /api/export/generar - Generar exportación personalizada
//
// Antes cada rama del switch hacia `db.select().from(tabla)` a secas y el parametro
// `filtros` se devolvia en la respuesta sin haberse aplicado nunca. Ahora delega en las
// mismas tres funciones que usan los GET, asi que no hay dos comportamientos posibles
// para "exportar inventario".
api.post('/generar', zValidator('json', z.object({
  tipo: z.enum(['costos', 'inventario', 'rentabilidad']),
  filtros: z.object({
    colegioId: z.string().optional(),
    productoId: z.string().optional(),
    tallaId: z.string().optional(),
  }).optional(),
})), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  const filtros: Filtros = body.filtros || {};

  let data: any = null;
  switch (body.tipo) {
    case 'costos':
      data = await exportarCostos(db, filtros);
      break;
    case 'inventario':
      data = await exportarInventario(db, filtros);
      break;
    case 'rentabilidad':
      data = await exportarRentabilidad(db, filtros);
      break;
  }

  return c.json({
    success: true,
    data: {
      resultados: data,
      fechaExportacion: new Date().toISOString(),
      tipo: body.tipo,
      filtros,
      alcance: describirAlcance(limpiar(filtros)),
    },
    message: 'Exportación generada exitosamente',
  });
});

export default api;
