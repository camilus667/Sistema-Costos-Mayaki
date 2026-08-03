import { Hono } from 'hono';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import {
  tipoPrenda,
  manoObraTipo,
  productos,
  tallas,
} from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';
import { nuevoIdHex } from '../services/resolucion.service';
import { bandaManoObra } from '../services/tallas';

const api = new Hono();

// ---------------------------------------------------------------------------
// GET /api/tipos-prenda - Lista todos los tipos de prenda con sus MO
// ---------------------------------------------------------------------------
api.get('/', async (c) => {
  const db = (c as any).db;
  try {
    const tipos = await db.select().from(tipoPrenda).where(
      or(eq(tipoPrenda.activo, true), isNull(tipoPrenda.activo))
    ).orderBy(asc(tipoPrenda.nombre));

    const moRows = await db.select().from(manoObraTipo);
    const todasTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

    const moPorTipo = new Map<string, { grupo1: number; grupo2: number; grupo3: number }>();
    for (const mo of moRows) {
      const t = todasTallas.find((t: any) => t.id === mo.tallaId);
      if (!t) continue;
      const banda = bandaManoObra(t.codigo);
      const actual = moPorTipo.get(mo.tipoPrendaId) || { grupo1: 0, grupo2: 0, grupo3: 0 };
      if (banda === 1) actual.grupo1 = Number(mo.costoBs) || 0;
      else if (banda === 2) actual.grupo2 = Number(mo.costoBs) || 0;
      else actual.grupo3 = Number(mo.costoBs) || 0;
      moPorTipo.set(mo.tipoPrendaId, actual);
    }

    const todasPrendas = await db.select({ tipoPrendaId: productos.tipoPrendaId }).from(productos);
    const prendasPorTipo = new Map<string, number>();
    for (const p of todasPrendas) {
      if (p.tipoPrendaId) {
        prendasPorTipo.set(String(p.tipoPrendaId), (prendasPorTipo.get(String(p.tipoPrendaId)) || 0) + 1);
      }
    }

    const data = tipos.map((t: any) => {
      const mo = moPorTipo.get(t.id) || { grupo1: 0, grupo2: 0, grupo3: 0 };
      return {
        id: t.id,
        nombre: t.nombre,
        activo: t.activo,
        creadoEn: t.creadoEn,
        grupo1_tallas_2_10: mo.grupo1,
        grupo2_tallas_12_S: mo.grupo2,
        grupo3_tallas_M_4XL: mo.grupo3,
        prendasAsignadas: prendasPorTipo.get(t.id) || 0,
      };
    });

    return c.json({ success: true, gruposTallas: ['Tallas 2 - 10', 'Tallas 12 - S', 'Tallas M - 4XL'], data });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /api/tipos-prenda - Crear nuevo tipo
// ---------------------------------------------------------------------------
api.post('/', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json();
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return c.json({ success: false, error: 'El campo "nombre" es obligatorio.' }, 400);
  try {
    const id = nuevoIdHex();
    await db.insert(tipoPrenda).values({ id, nombre, activo: true });
    saveDbToDisk();
    return c.json({ success: true, id, nombre }, 201);
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tipos-prenda/:id - Actualizar nombre
// ---------------------------------------------------------------------------
api.put('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();
  const nombre = String(body.nombre || '').trim();
  if (!nombre) return c.json({ success: false, error: 'El campo "nombre" es obligatorio.' }, 400);
  try {
    const [tipo] = await db.select().from(tipoPrenda).where(eq(tipoPrenda.id, id)).limit(1);
    if (!tipo) return c.json({ success: false, error: 'Tipo no encontrado.' }, 404);
    await db.update(tipoPrenda).set({ nombre }).where(eq(tipoPrenda.id, id));
    saveDbToDisk();
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/tipos-prenda/:id - Eliminar solo si no tiene prendas asignadas
// ---------------------------------------------------------------------------
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  try {
    const [tipo] = await db.select().from(tipoPrenda).where(eq(tipoPrenda.id, id)).limit(1);
    if (!tipo) return c.json({ success: false, error: 'Tipo no encontrado.' }, 404);

    const asignados = await db.select({ id: productos.id }).from(productos)
      .where(eq(productos.tipoPrendaId, id)).limit(1);
    if (asignados.length > 0) {
      return c.json({
        success: false,
        error: 'No se puede eliminar: hay prendas asignadas. Reasignélas primero.',
      }, 409);
    }

    await db.delete(manoObraTipo).where(eq(manoObraTipo.tipoPrendaId, id));
    await db.delete(tipoPrenda).where(eq(tipoPrenda.id, id));
    saveDbToDisk();
    return c.json({ success: true });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/tipos-prenda/:id/mano-obra - Guardar costos MO (3 grupos)
// Body: { grupo1, grupo2, grupo3 }
// ---------------------------------------------------------------------------
api.put('/:id/mano-obra', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { grupo1, grupo2, grupo3 } = body;

  try {
    const [tipo] = await db.select().from(tipoPrenda).where(eq(tipoPrenda.id, id)).limit(1);
    if (!tipo) return c.json({ success: false, error: 'Tipo no encontrado.' }, 404);

    const todasTallas = await db.select().from(tallas)
      .where(or(eq(tallas.activo, true), isNull(tallas.activo)));

    for (const talla of todasTallas) {
      const banda = bandaManoObra(talla.codigo);
      let costoBs = Number(grupo3) || 0;
      if (banda === 1) costoBs = Number(grupo1) || 0;
      else if (banda === 2) costoBs = Number(grupo2) || 0;

      const existente = await db.select().from(manoObraTipo)
        .where(and(eq(manoObraTipo.tipoPrendaId, id), eq(manoObraTipo.tallaId, talla.id)))
        .limit(1);

      if (existente.length > 0) {
        await db.update(manoObraTipo).set({ costoBs }).where(eq(manoObraTipo.id, existente[0].id));
      } else {
        await db.insert(manoObraTipo).values({ id: nuevoIdHex(), tipoPrendaId: id, tallaId: talla.id, costoBs });
      }
    }

    saveDbToDisk();
    return c.json({ success: true, message: 'Mano de obra del tipo actualizada.' });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

export default api;
