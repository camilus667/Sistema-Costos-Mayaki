import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, or, isNull } from 'drizzle-orm';
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

  // FASE 5, tercera vez que aparece este patron: `= colegio OR IS NULL`, nunca
  // `= colegio` a secas. Con las telas y tallas compartidas (colegio_id NULL) el
  // filtro viejo devolvia 1 tela de 12 y CERO tallas de 16, asi que la pantalla de
  // Configuracion mostraba la lista de tallas vacia y el selector de tela de cada
  // prenda ofrecia una sola opcion: el tartan, la unica que conservo colegio. Las
  // prendas nunca perdieron su tela_id — el <select> no encontraba la opcion
  // correspondiente y el navegador mostraba la primera.
  //
  // `productos` SI se filtra con eq: las prendas son del colegio y siguen siendolo.
  const tList = await db.select().from(telas).where(or(eq(telas.colegioId, id), isNull(telas.colegioId))).orderBy(asc(telas.orden), asc(telas.descripcion));
  const taList = await db.select().from(tallas).where(or(eq(tallas.colegioId, id), isNull(tallas.colegioId))).orderBy(asc(tallas.orden));

  return c.json({
    success: true,
    colegio: col,
    productos: prods,
    telas: tList,
    tallas: taList,
  });
});

// PUT /api/colegios/:id/config-telas - Reordenar y configurar telas del colegio
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

  // SE VALIDA QUE EL COLEGIO EXISTA, y no es una formalidad: sin esto la prenda queda
  // HUERFANA y es invisible.
  //
  // El dashboard llama a /api/colegios/<ambitoActual>/prendas. Con el ambito en 'all'
  // —que era el estado por defecto mientras el literal 'CAMBRIDGE' roto dejaba caer el
  // selector ahi— eso pegaba a /api/colegios/all/prendas y la prenda nacia con
  // colegio_id = 'all'. Ningun filtro por colegio la encuentra, pero el conteo sin filtro
  // la cuenta: de ahi que 27 + 1 diera 29.
  //
  // SQLite no lo impide solo: las foreign keys estan APAGADAS por defecto y este proyecto
  // solo las prende para el DDL de la migracion. Una FK que apunta a la nada se inserta
  // sin protestar, asi que la validacion tiene que estar aca.
  const [colegio] = await db.select().from(colegios).where(eq(colegios.id, colegioId)).limit(1);
  if (!colegio) {
    return c.json({
      success: false,
      error:
        `No existe el colegio "${colegioId}". Una prenda tiene que pertenecer a un colegio ` +
        `real: si se creara con este id quedaria huerfana, invisible en toda pantalla que ` +
        `filtre por colegio y contada en los totales sin filtro.`,
    }, 404);
  }

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

  // Este era el peor de los tres filtros: no rompia una pantalla, rompia los DATOS.
  // Con las tallas compartidas devolvia cero filas, asi que toda prenda creada desde
  // la pantalla de Configuracion nacia SIN NINGUNA TALLA —sin filas de peso ni de
  // inventario— y no habia forma de costearla ni de venderla. Con status 200.
  const allTallas = await db.select().from(tallas).where(or(eq(tallas.colegioId, colegioId), isNull(tallas.colegioId)));
  for (const t of allTallas) {
    await db.insert(pesoMateriaPrima).values({
      productoId: newProd.id,
      tallaId: t.id,
      pesoExactoGramos: 0,
      pesoGramos: 0,
      // PENDIENTE: el 8 esta hardcodeado aca, y es el cuarto lugar con ese numero
      // escrito a mano. La Fase 3 lo saco del motor a proposito, para que el default
      // viva solo en el schema de la base y en configuracion_sistema. Deberia leerse
      // de getSystemConfig.
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
