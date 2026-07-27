import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { inventarioTransacciones, inventario, productos, tallas, preciosVenta } from '../database/schema';
import { desc, eq, and, sql } from 'drizzle-orm';
import { loadExcelMatrices } from './calculo';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

const transaccionSchema = z.object({
  productoId: z.string(),
  tallaId: z.string(),
  anioId: z.string().optional(),
  tipo: z.enum(['entrada', 'salida', 'merma', 'ajuste']),
  cantidad: z.number().int().positive(),
  costoUnitario: z.number().optional(),
  motivo: z.string().optional(),
  documentoReferencia: z.string().optional(),
  realizadoPor: z.string(),
});

// GET /api/inventario/stock - Muestra SOLO los artículos con stock físico > 0
api.get('/stock', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');
  const { productoId, tallaId } = c.req.query();
  
  const allProductos = await db.select().from(productos);
  const prodMap = new Map<string, any>();
  allProductos.forEach((p: any) => prodMap.set(p.id, p));

  const allTallas = await db.select().from(tallas);
  const tallaMap = new Map<string, any>();
  allTallas.forEach((t: any) => tallaMap.set(t.id, t));

  const excelData = loadExcelMatrices();

  let query = db.select().from(inventario);
  
  if (productoId) {
    query = query.where(eq(inventario.productoId, productoId));
  }
  if (tallaId) {
    query = query.where(eq(inventario.tallaId, tallaId));
  }
  
  const stockList = await query;
  
  const enriched = stockList.map((item: any) => {
    const prod = prodMap.get(item.productoId);
    const tallaObj = tallaMap.get(item.tallaId);

    const itemNum = prod ? prod.itemNumero : 0;
    const tallaCod = tallaObj ? tallaObj.codigo : '';
    const key = `${itemNum}_${tallaCod}`;

    const precioVentaMatriz = excelData ? (excelData.precioVenta.get(key) || 0) : 0;
    const costoTotalMatriz = excelData ? (excelData.costoTotal.get(key) || 0) : 0;
    const stockMatriz = excelData ? excelData.inventarioUnidades.get(key) : null;

    const cantidadFinal = stockMatriz !== null && stockMatriz !== undefined ? stockMatriz : item.cantidad;
    const costoUnitarioFinal = costoTotalMatriz > 0 ? costoTotalMatriz : (item.costoUnitario || 0);

    const valorStock = cantidadFinal * costoUnitarioFinal;

    return {
      id: item.id,
      productoId: item.productoId,
      tallaId: item.tallaId,
      colegioId: prod ? prod.colegioId : null,
      itemNumero: itemNum,
      producto: prod ? prod.descripcion : 'Producto',
      talla: tallaCod || 'N/A',
      tallaOrden: tallaObj ? (tallaObj.orden || 99) : 99,
      tallaNombre: tallaObj ? tallaObj.nombre : 'Talla',
      cantidad: cantidadFinal,
      costoUnitario: parseFloat(costoUnitarioFinal.toFixed(2)),
      precioVenta: parseFloat(precioVentaMatriz.toFixed(2)),
      valorTotalStock: parseFloat(valorStock.toFixed(2)),
    };
  }).filter((item: any) => {
    // FILTRO REQUERIDO POR EL USUARIO: Solo ítems con stock > 0
    if (item.cantidad <= 0) return false;
    if (colegioId && colegioId !== 'all') {
      return item.colegioId === colegioId;
    }
    return true;
  }).sort((a: any, b: any) => {
    const pA = prodMap.get(a.productoId);
    const pB = prodMap.get(b.productoId);
    const ordenA = pA ? (pA.orden ?? pA.itemNumero) : a.itemNumero;
    const ordenB = pB ? (pB.orden ?? pB.itemNumero) : b.itemNumero;
    if (ordenA !== ordenB) return ordenA - ordenB;
    if (a.itemNumero !== b.itemNumero) return a.itemNumero - b.itemNumero;
    return a.tallaOrden - b.tallaOrden;
  });

  return c.json({ success: true, data: enriched });
});

// GET /api/inventario/historial
api.get('/historial', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId, usuarioId } = c.req.query();
  
  let query = db.select().from(inventarioTransacciones).orderBy(desc(inventarioTransacciones.creadoEn));
  
  if (productoId) {
    query = query.where(eq(inventarioTransacciones.productoId, productoId));
  }
  if (tallaId) {
    query = query.where(eq(inventarioTransacciones.tallaId, tallaId));
  }
  if (usuarioId) {
    query = query.where(eq(inventarioTransacciones.realizadoPor, usuarioId));
  }
  
  const historial = await query.limit(100);
  
  return c.json({ success: true, data: historial });
});

// GET /api/inventario/resumen
api.get('/resumen', async (c) => {
  const db = (c as any).db;
  
  const resumen = await db.select({
    tipo: inventarioTransacciones.tipo,
    totalCantidad: sql<number>`SUM(${inventarioTransacciones.cantidad})`,
    totalTransacciones: sql<number>`COUNT(*)`,
  }).from(inventarioTransacciones).groupBy(inventarioTransacciones.tipo);
  
  return c.json({ success: true, data: resumen });
});

// POST /api/inventario/entrada
api.post('/entrada', zValidator('json', transaccionSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  const nuevaTransaccion = await db.insert(inventarioTransacciones).values({
    productoId: body.productoId,
    tallaId: body.tallaId,
    anioId: body.anioId || null,
    tipo: 'entrada',
    cantidad: body.cantidad,
    costoUnitario: body.costoUnitario || 0,
    motivo: body.motivo,
    documentoReferencia: body.documentoReferencia,
    realizadoPor: body.realizadoPor,
  }).returning();
  
  const [existencia] = await db
    .select({ cantidad: inventario.cantidad })
    .from(inventario)
    .where(and(
      eq(inventario.productoId, body.productoId),
      eq(inventario.tallaId, body.tallaId)
    ))
    .limit(1);
  
  if (existencia) {
    await db
      .update(inventario)
      .set({
        cantidad: sql`${inventario.cantidad} + ${body.cantidad}`,
        costoUnitario: body.costoUnitario || existencia.costoUnitario || 0,
      })
      .where(and(
        eq(inventario.productoId, body.productoId),
        eq(inventario.tallaId, body.tallaId)
      ));
  } else {
    await db.insert(inventario).values({
      productoId: body.productoId,
      tallaId: body.tallaId,
      anioId: body.anioId || null,
      cantidad: body.cantidad,
      costoUnitario: body.costoUnitario || 0,
    });
  }
  
  saveDbToDisk();

  return c.json({ 
    success: true, 
    data: nuevaTransaccion[0],
    message: 'Entrada registrada exitosamente'
  }, 201);
});

// POST /api/inventario/salida
api.post('/salida', zValidator('json', transaccionSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  
  const [existencia] = await db
    .select({ cantidad: inventario.cantidad })
    .from(inventario)
    .where(and(
      eq(inventario.productoId, body.productoId),
      eq(inventario.tallaId, body.tallaId)
    ))
    .limit(1);
  
  if (!existencia || existencia.cantidad < body.cantidad) {
    return c.json({ 
      success: false, 
      message: `Stock insuficiente. Disponible: ${existencia?.cantidad || 0}`
    }, 400);
  }
  
  const nuevaTransaccion = await db.insert(inventarioTransacciones).values({
    productoId: body.productoId,
    tallaId: body.tallaId,
    anioId: body.anioId || null,
    tipo: 'salida',
    cantidad: body.cantidad,
    costoUnitario: body.costoUnitario || 0,
    motivo: body.motivo,
    documentoReferencia: body.documentoReferencia,
    realizadoPor: body.realizadoPor,
  }).returning();
  
  await db
    .update(inventario)
    .set({
      cantidad: sql`${inventario.cantidad} - ${body.cantidad}`,
    })
    .where(and(
      eq(inventario.productoId, body.productoId),
      eq(inventario.tallaId, body.tallaId)
    ));
  
  saveDbToDisk();

  return c.json({ 
    success: true, 
    data: nuevaTransaccion[0],
    message: 'Salida registrada exitosamente'
  }, 201);
});

export default api;
