import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, or, isNull } from 'drizzle-orm';
import { colegios, productos, telas, tallas, pesoMateriaPrima, inventario } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

const crearColegioSchema = z.object({
  nombre: z.string().min(1).max(255),
  direccion: z.string().max(500).optional(),
  nit: z.string().max(50).optional(),
  telefono: z.string().max(50).optional(),
});

api.get('/', async (c) => {
  const db = (c as any).db;
  const allColegios = await db.select().from(colegios).orderBy(asc(colegios.nombre));
  return c.json({ success: true, data: allColegios });
});

api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const [colegio] = await db.select().from(colegios).where(eq(colegios.id, id)).limit(1);
  if (!colegio) return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  return c.json({ success: true, data: colegio });
});

api.post('/', zValidator('json', crearColegioSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');
  const [newColegio] = await db.insert(colegios).values(body).returning();
  return c.json({ success: true, data: newColegio, message: 'Colegio creado exitosamente' }, 201);
});

api.put('/:id', zValidator('json', crearColegioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const [updatedColegio] = await db.update(colegios).set(body).where(eq(colegios.id, id)).returning();
  if (!updatedColegio) return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  return c.json({ success: true, data: updatedColegio, message: 'Colegio actualizado exitosamente' });
});

api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const [deletedColegio] = await db.delete(colegios).where(eq(colegios.id, id)).returning();
  if (!deletedColegio) return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  return c.json({ success: true, message: 'Colegio eliminado exitosamente' });
});

api.patch('/:id/toggle', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const [colegio] = await db.select().from(colegios).where(eq(colegios.id, id)).limit(1);
  if (!colegio) return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  const [updatedColegio] = await db.update(colegios).set({ activo: !colegio.activo }).where(eq(colegios.id, id)).returning();
  return c.json({ success: true, data: updatedColegio });
});

api.get('/:id/config', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const [col] = await db.select().from(colegios).where(eq(colegios.id, id)).limit(1);
  if (!col) return c.json({ success: false, error: 'Colegio no encontrado' }, 404);
  const prods = await db.select().from(productos).where(eq(productos.colegioId, id)).orderBy(asc(productos.orden), asc(productos.itemNumero));
  // FASE 5, tercera vez que aparece este patron: `= colegio OR IS NULL`, nunca
  // `= colegio` a secas. Con las telas y tallas compartidas (colegio_id NULL) el
  // filtro viejo devolvia 1 tela de 12 y CERO tallas de 16, asi que la pantalla de
  // Configuracion mostraba la lista de tallas vacia y el selector de tela de cada
  // prenda ofrecia una sola opcion: el tartan, la unica que conservo colegio. Las
  // prendas nunca perdieron su tela_id — el <select> no encontraba la opcion y el
  // navegador mostraba la primera, que dice "Tasa Promedio Catalogo".
  const tList = await db.select().from(telas).where(or(eq(telas.colegioId, id), isNull(telas.colegioId))).orderBy(asc(telas.orden), asc(telas.descripcion));
  const taList = await db.select().from(tallas).where(or(eq(tallas.colegioId, id), isNull(tallas.colegioId))).orderBy(asc(tallas.orden));
  return c.json({ success: true, colegio: col, productos: prods, telas: tList, tallas: taList });
});

api.put('/:id/config-telas', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json();
  if (Array.isArray(body.telas)) {
    for (const t of body.telas) {
      if (!t.id) continue;
      const updateData: any = {};
      if (t.orden !== undefined) updateData.orden = t.orden;
      if (t.descripcion !== undefined) updateData.descripcion = t.descripcion;
      if (t.precioCompra !== undefined) updateData.precioCompra = t.precioCompra;
      if (t.activo !== undefined) updateData.activo = t.activo;
      await db.update(telas).set(updateData).where(eq(telas.id, t.id));
    }
    saveDbToDisk();
  }
  return c.json({ success: true, message: 'Configuración de telas guardada exitosamente' });
});

api.put('/:id/config-prendas', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json();
  if (Array.isArray(body.prendas)) {
    for (const p of body.prendas) {
      if (!p.id) continue;
      const updateData: any = {};
      if (p.orden !== undefined) updateData.orden = p.orden;
      if (p.itemNumero !== undefined) updateData.itemNumero = p.itemNumero;
      if (p.descripcion !== undefined) updateData.descripcion = p.descripcion;
      if (p.telaId !== undefined) updateData.telaId = p.telaId;
      if (p.factorComplejidad !== undefined) updateData.factorComplejidad = p.factorComplejidad;
      if (p.activo !== undefined) updateData.activo = p.activo;
      await db.update(productos).set(updateData).where(eq(productos.id, p.id));
    }
    saveDbToDisk();
  }
  return c.json({ success: true, message: 'Configuración de prendas guardada exitosamente' });
});

api.post('/:id/prendas', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.param('id');
  const body = await c.req.json();
  const existingProds = await db.select().from(productos).where(eq(productos.colegioId, colegioId));
  const nextItemNum = body.itemNumero || (existingProds.length + 1);
  const nextOrden = body.orden || nextItemNum;
  const [newProd] = await db.insert(productos).values({
    colegioId, itemNumero: nextItemNum, orden: nextOrden,
    descripcion: body.descripcion || 'Nueva Prenda',
    telaId: body.telaId || null, factorComplejidad: body.factorComplejidad || 1, activo: true,
  }).returning();
  // Este era el peor de los tres: no rompia una pantalla, rompia los DATOS. Con las
  // tallas compartidas devolvia cero filas, asi que toda prenda creada desde la
  // pantalla de Configuracion nacia SIN NINGUNA TALLA — sin filas de peso ni de
  // inventario— y no habia forma de costearla ni de venderla.
  const allTallas = await db.select().from(tallas).where(or(eq(tallas.colegioId, colegioId), isNull(tallas.colegioId)));
  for (const t of allTallas) {
    await db.insert(pesoMateriaPrima).values({ productoId: newProd.id, tallaId: t.id, pesoExactoGramos: 0, pesoGramos: 0, mermaPorcentaje: 8, pesoConMerma: 0 });
    await db.insert(inventario).values({ productoId: newProd.id, tallaId: t.id, cantidad: 0, costoUnitario: 0, costoTotal: 0 });
  }
  saveDbToDisk();
  return c.json({ success: true, data: newProd, message: 'Prenda creada exitosamente' });
});

api.put('/:id/tallas-config', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json();
  if (Array.isArray(body.tallas)) {
    for (const t of body.tallas) {
      if (!t.id) continue;
      const updateData: any = {};
      if (t.activo !== undefined) updateData.activo = t.activo;
      if (t.orden !== undefined) updateData.orden = t.orden;
      await db.update(tallas).set(updateData).where(eq(tallas.id, t.id));
    }
    saveDbToDisk();
  }
  return c.json({ success: true, message: 'Configuración de tallas guardada exitosamente' });
});

export default api;
