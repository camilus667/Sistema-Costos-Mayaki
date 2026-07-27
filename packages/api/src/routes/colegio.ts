import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import { colegios, productos, telas, tallas, pesoMateriaPrima, inventario } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';

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

// GET /api/colegios/:id/config - Obtener toda la configuración del colegio
api.get('/:id/config', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [col] = await db.select().from(colegios).where(eq(colegios.id, id)).limit(1);
  if (!col) return c.json({ success: false, error: 'Colegio no encontrado' }, 404);

  const prods = await db.select().from(productos).where(eq(productos.colegioId, id)).orderBy(asc(productos.orden), asc(productos.itemNumero));
  const tList = await db.select().from(telas).where(eq(telas.colegioId, id)).orderBy(asc(telas.descripcion));
  const taList = await db.select().from(tallas).where(eq(tallas.colegioId, id)).orderBy(asc(tallas.orden));

  return c.json({
    success: true,
    colegio: col,
    productos: prods,
    telas: tList,
    tallas: taList,
  });
});

// PUT /api/colegios/:id/config-prendas - Guardar reordenamiento y configuración de prendas
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

// POST /api/colegios/:id/prendas - Dar de alta nueva prenda
api.post('/:id/prendas', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.param('id');
  const body = await c.req.json();

  const existingProds = await db.select().from(productos).where(eq(productos.colegioId, colegioId));
  const nextItemNum = body.itemNumero || (existingProds.length + 1);
  const nextOrden = body.orden || nextItemNum;

  const [newProd] = await db.insert(productos).values({
    colegioId,
    itemNumero: nextItemNum,
    orden: nextOrden,
    descripcion: body.descripcion || 'Nueva Prenda',
    telaId: body.telaId || null,
    factorComplejidad: body.factorComplejidad || 1,
    activo: true,
  }).returning();

  const allTallas = await db.select().from(tallas).where(eq(tallas.colegioId, colegioId));
  for (const t of allTallas) {
    await db.insert(pesoMateriaPrima).values({
      productoId: newProd.id,
      tallaId: t.id,
      pesoExactoGramos: 0,
      pesoGramos: 0,
      mermaPorcentaje: 8,
      pesoConMerma: 0,
    });
    await db.insert(inventario).values({
      productoId: newProd.id,
      tallaId: t.id,
      cantidad: 0,
      costoUnitario: 0,
      costoTotal: 0,
    });
  }

  saveDbToDisk();

  return c.json({ success: true, data: newProd, message: 'Prenda creada exitosamente' });
});

// PUT /api/colegios/:id/tallas-config - Activar/desactivar tallas del colegio
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
