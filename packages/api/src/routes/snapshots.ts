/**
 * Endpoints para Instantáneas (Snapshots) e Histórico de Precios
 * /api/snapshots
 */
import { Hono } from 'hono';
import { eq, desc, isNull } from 'drizzle-orm';
import {
  costoSnapshots,
  productos,
  telas,
  accesorios,
  manoObra,
  costosIndirectos,
  pesoMateriaPrima,
  preciosAdquisicion,
  preciosVenta,
  colegios,
  tallas
} from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

// GET /api/snapshots - Lista todas las instantáneas guardadas
api.get('/', async (c) => {
  const db = (c as any).db;
  try {
    const list = await db
      .select({
        id: costoSnapshots.id,
        nombre: costoSnapshots.nombre,
        descripcion: costoSnapshots.descripcion,
        colegioId: costoSnapshots.colegioId,
        creadoPor: costoSnapshots.creadoPor,
        creadoEn: costoSnapshots.creadoEn
      })
      .from(costoSnapshots)
      .orderBy(desc(costoSnapshots.creadoEn));

    return c.json({ success: true, data: list });
  } catch (e) {
    console.error('Error al listar snapshots:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// GET /api/snapshots/:id - Detalle completo de una instantánea
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  try {
    const [snap] = await db
      .select()
      .from(costoSnapshots)
      .where(eq(costoSnapshots.id, id))
      .limit(1);

    if (!snap) {
      return c.json({ success: false, error: 'Instantánea no encontrada' }, 404);
    }

    let parsedData = {};
    try {
      parsedData = JSON.parse(snap.datosJson);
    } catch (e) {}

    return c.json({
      success: true,
      data: {
        ...snap,
        datos: parsedData
      }
    });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// POST /api/snapshots - Guarda una instantánea completa con todos los inputs actuales
api.post('/', async (c) => {
  const db = (c as any).db;
  try {
    const body = await c.req.json();
    const { nombre, descripcion, colegioId } = body;

    if (!nombre || !nombre.trim()) {
      return c.json({ success: false, error: 'El nombre de la instantánea es obligatorio' }, 400);
    }

    // Respaldo completo de todas las tablas de inputs y precios
    const [
      prods,
      telasList,
      accesorioList,
      manoObraList,
      indirectosList,
      pesosList,
      adquisicionList,
      ventaList
    ] = await Promise.all([
      db.select().from(productos),
      db.select().from(telas),
      db.select().from(accesorios),
      db.select().from(manoObra),
      db.select().from(costosIndirectos),
      db.select().from(pesoMateriaPrima),
      db.select().from(preciosAdquisicion).where(isNull(preciosAdquisicion.vigenteHasta)),
      db.select().from(preciosVenta).where(isNull(preciosVenta.vigenteHasta))
    ]);

    const datosObj = {
      timestamp: new Date().toISOString(),
      productos: prods,
      telas: telasList,
      accesorios: accesorioList,
      manoObra: manoObraList,
      costosIndirectos: indirectosList,
      pesoMateriaPrima: pesosList,
      preciosAdquisicion: adquisicionList,
      preciosVenta: ventaList
    };

    const idHex = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
    await db.insert(costoSnapshots).values({
      id: idHex,
      nombre: nombre.trim(),
      descripcion: descripcion ? descripcion.trim() : null,
      colegioId: colegioId || null,
      datosJson: JSON.stringify(datosObj),
      creadoPor: 'Usuario'
    });

    saveDbToDisk();
    return c.json({ success: true, message: 'Instantánea de costos guardada exitosamente', id: idHex });
  } catch (e) {
    console.error('Error al guardar snapshot:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// DELETE /api/snapshots/:id - Elimina una instantánea
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  try {
    await db.delete(costoSnapshots).where(eq(costoSnapshots.id, id));
    saveDbToDisk();
    return c.json({ success: true, message: 'Instantánea eliminada' });
  } catch (e) {
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// POST /api/snapshots/comparar - Matriz comparativa entre instantánea vs estado actual
api.post('/comparar', async (c) => {
  const db = (c as any).db;
  try {
    const body = await c.req.json();
    const { snapshotId, colegioId } = body;

    let prodQuery = db.select().from(productos);
    if (colegioId && colegioId !== 'all') {
      prodQuery = db.select().from(productos).where(eq(productos.colegioId, colegioId));
    }
    const prods = await prodQuery;
    const colegiosList = await db.select().from(colegios);
    const colegiosMap = new Map(colegiosList.map((col: any) => [col.id, col.nombre]));

    let snapDatos: any = null;
    if (snapshotId && snapshotId !== 'actual') {
      const [snap] = await db.select().from(costoSnapshots).where(eq(costoSnapshots.id, snapshotId)).limit(1);
      if (snap) {
        try { snapDatos = JSON.parse(snap.datosJson); } catch (e) {}
      }
    }

    // Mapas de precios snapshot (o actual)
    const snapTelasMap = new Map<string, number>();
    if (snapDatos && snapDatos.telas) {
      snapDatos.telas.forEach((t: any) => snapTelasMap.set(t.id, t.precioBsG || t.precioUnitario || 0));
    }

    const snapAccMap = new Map<string, number>();
    if (snapDatos && snapDatos.accesorios) {
      snapDatos.accesorios.forEach((a: any) => snapAccMap.set(a.id, a.costoUnitario || 0));
    }

    const snapAdqMap = new Map<string, number>();
    if (snapDatos && snapDatos.preciosAdquisicion) {
      snapDatos.preciosAdquisicion.forEach((pa: any) => snapAdqMap.set(`${pa.productoId}_${pa.tallaId}`, pa.precioBs));
    }

    // Datos actuales en DB
    const [telasAct, accAct, adqAct] = await Promise.all([
      db.select().from(telas),
      db.select().from(accesorios),
      db.select().from(preciosAdquisicion).where(isNull(preciosAdquisicion.vigenteHasta))
    ]);

    const actTelasMap = new Map<string, number>();
    telasAct.forEach((t: any) => actTelasMap.set(t.id, t.precioBsG || t.precioUnitario || 0));

    const actAccMap = new Map<string, number>();
    accAct.forEach((a: any) => actAccMap.set(a.id, a.costoUnitario || 0));

    const actAdqMap = new Map<string, number>();
    adqAct.forEach((pa: any) => actAdqMap.set(`${pa.productoId}_${pa.tallaId}`, pa.precioBs));

    const comparativa = prods.map((p: any) => {
      const colegioNombre = colegiosMap.get(p.colegioId) || 'Empresa';

      let precioTelaAnt = 0;
      let precioTelaNue = 0;

      if (p.modoCosteo === 'adquirido') {
        let sumAnt = 0, sumNue = 0, count = 0;
        snapAdqMap.forEach((v, k) => {
          if (k.startsWith(p.id + '_')) { sumAnt += v; count++; }
        });
        actAdqMap.forEach((v, k) => {
          if (k.startsWith(p.id + '_')) { sumNue += v; }
        });
        precioTelaAnt = count > 0 ? sumAnt / count : 0;
        precioTelaNue = count > 0 ? sumNue / count : 0;
      } else if (p.telaId) {
        precioTelaAnt = (snapDatos ? snapTelasMap.get(p.telaId) : actTelasMap.get(p.telaId)) || 0;
        precioTelaNue = actTelasMap.get(p.telaId) || 0;
      }

      const costoAnt = precioTelaAnt > 0 ? precioTelaAnt : 0;
      const costoNue = precioTelaNue > 0 ? precioTelaNue : 0;

      const difBs = costoNue - costoAnt;
      const varPct = costoAnt > 0 ? (difBs / costoAnt) * 100 : 0;

      return {
        productoId: p.id,
        itemNumero: p.itemNumero,
        descripcion: p.descripcion,
        colegioNombre,
        modoCosteo: p.modoCosteo,
        costoAnteriorBs: Math.round(costoAnt * 100) / 100,
        costoNuevoBs: Math.round(costoNue * 100) / 100,
        diferenciaBs: Math.round(difBs * 100) / 100,
        variacionPct: Math.round(varPct * 10) / 10
      };
    });

    return c.json({ success: true, comparativa });
  } catch (e) {
    console.error('Error al comparar snapshots:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

export default api;
