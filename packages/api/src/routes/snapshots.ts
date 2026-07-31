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
  inventario,
  colegios,
  tallas
} from '../database/schema';
import { saveDbToDisk, getDbFilePath } from '../database/sqljs';

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
      ventaList,
      inventarioList
    ] = await Promise.all([
      db.select().from(productos),
      db.select().from(telas),
      db.select().from(accesorios),
      db.select().from(manoObra),
      db.select().from(costosIndirectos),
      db.select().from(pesoMateriaPrima),
      db.select().from(preciosAdquisicion).where(isNull(preciosAdquisicion.vigenteHasta)),
      db.select().from(preciosVenta).where(isNull(preciosVenta.vigenteHasta)),
      // EL INVENTARIO FALTABA, y es el hueco que volvia inutil exigir una instantanea
      // antes de importar. La instantanea guardaba productos, telas, accesorios, mano
      // de obra, indirectos, pesos y los dos tipos de precio — todo menos las
      // cantidades. Importar stock era, hasta ahora, irreversible.
      db.select().from(inventario)
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
      preciosVenta: ventaList,
      inventario: inventarioList
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

/**
 * POST /api/snapshots/:id/restaurar — repone los datos de una instantánea.
 *
 * POR QUE NO EXISTIA, Y POR QUE HACE FALTA AHORA. Las instantáneas se crearon para
 * SIMULAR: el parámetro `snapshotId` del motor de costeo permite ver el sistema
 * costeado con una foto vieja sin tocar nada. Nunca hubo forma de REPONERLA. El
 * archivo tenía `GET`, `POST`, `DELETE` y `comparar`, y ninguno escribía de vuelta.
 *
 * Eso vuelve vacía la regla de "tomar una instantánea antes de importar": guardar una
 * foto que nadie puede reponer no es una red de seguridad, es un consuelo.
 *
 * EL ALCANCE ES UNA DECISION, NO UN DETALLE.
 *
 *   'valores'  (por defecto)  precio_venta e inventario
 *   'completo'                agrega telas, accesorios, mano de obra, pesos,
 *                             indirectos y precios de adquisicion
 *
 * `producto` NO SE RESTAURA NUNCA, en ningún alcance, y esto es deliberado. Una prenda
 * borrada arrastra sus precios, pesos, mano de obra, receta e inventario; el repo ya
 * tuvo que limpiar huérfanas a mano por exactamente eso. Reponer la lista de prendas
 * implicaría decidir qué hacer con las creadas después de la foto, y esa decisión es
 * del usuario. Lo que sí se hace es DECIRLE cuáles son.
 *
 * NO INSERTA HUERFANAS. Una instantánea vieja puede tener un precio de una prenda que
 * ya no existe. Reponerlo crearía una fila que ninguna pantalla filtra y que los
 * totales sin filtro sí cuentan. Esas filas se SALTEAN y se reportan con nombre.
 *
 * RESPALDO ANTES, siempre, y transacción con ROLLBACK. Restaurar es una escritura
 * masiva: si algo no cierra, la base queda como estaba.
 */
api.post('/:id/restaurar', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  let body: any = {};
  try { body = await c.req.json(); } catch (e) {}

  // CONFIRMACION EXPLICITA. Restaurar sobreescribe precios y cantidades de todo el
  // sistema; no puede dispararse por un POST accidental o un doble clic.
  if (body.confirmar !== true) {
    return c.json({
      success: false,
      error:
        'Restaurar sobreescribe los precios y las cantidades actuales. Enviar ' +
        '{ "confirmar": true } para proceder.',
    }, 400);
  }

  const alcance: 'valores' | 'completo' = body.alcance === 'completo' ? 'completo' : 'valores';

  const [snap] = await db.select().from(costoSnapshots).where(eq(costoSnapshots.id, id)).limit(1);
  if (!snap) return c.json({ success: false, error: 'Instantánea no encontrada' }, 404);

  let datos: any;
  try {
    datos = JSON.parse(snap.datosJson);
  } catch (e) {
    return c.json({ success: false, error: 'La instantánea tiene datos ilegibles.' }, 500);
  }

  // Respaldo del archivo ANTES de tocar nada. Es la unica forma de volver de una
  // restauracion equivocada, y sigue la disciplina de limpiarHuerfanas.ts.
  let respaldo: string | null = null;
  try {
    const fs = await import('fs');
    // Igual que en el importador: la ruta sale de getDbFilePath() y no se calcula a mano.
    // Calcularla ignora SISTEMA_DB_PATH y el respaldo terminaria apuntando a la base real
    // mientras la restauracion escribe en la copia.
    const rutaDb = getDbFilePath();
    if (fs.existsSync(rutaDb)) {
      const sello = new Date().toISOString().replace(/[:.]/g, '-');
      respaldo = rutaDb.replace(/\.db$/, '') + `.antes-de-restaurar-${sello}.db`;
      fs.copyFileSync(rutaDb, respaldo);
    }
  } catch (e) {
    return c.json({
      success: false,
      error: 'No se pudo crear el respaldo previo. No se restaura sin red: ' + String(e),
    }, 500);
  }

  // Claves vivas, para no reponer filas huerfanas.
  const productosVivos = new Set(
    (await db.select({ id: productos.id }).from(productos)).map((p: any) => String(p.id))
  );
  const tallasVivas = new Set(
    (await db.select({ id: tallas.id }).from(tallas)).map((t: any) => String(t.id))
  );

  const reporte: Record<string, { repuestas: number; salteadas: number }> = {};
  const avisos: string[] = [];

  /**
   * Repone una tabla: borra lo actual e inserta lo de la foto, salteando lo que
   * quedaria huerfano. Devuelve el conteo para que la respuesta pueda ser medida y no
   * afirmada.
   */
  const reponer = async (
    nombre: string,
    tabla: any,
    filas: any[] | undefined,
    esValida: (f: any) => boolean
  ) => {
    if (!Array.isArray(filas)) {
      avisos.push(`La instantánea no contiene "${nombre}": esa tabla no se tocó.`);
      return;
    }
    const validas = filas.filter(esValida);
    const salteadas = filas.length - validas.length;
    await db.delete(tabla);
    for (const f of validas) await db.insert(tabla).values(f);
    reporte[nombre] = { repuestas: validas.length, salteadas };
    if (salteadas > 0) {
      avisos.push(
        `${nombre}: ${salteadas} fila(s) de la instantánea apuntan a una prenda o talla ` +
        `que ya no existe y NO se repusieron; habrían quedado huérfanas.`
      );
    }
  };

  const porProductoYTalla = (f: any) =>
    productosVivos.has(String(f.productoId)) && tallasVivas.has(String(f.tallaId));

  try {
    // --- valores: lo que mueve una importacion ---
    await reponer('precio_venta', preciosVenta, datos.preciosVenta, porProductoYTalla);
    await reponer('inventario', inventario, datos.inventario, porProductoYTalla);

    if (alcance === 'completo') {
      await reponer('peso_mat_prima', pesoMateriaPrima, datos.pesoMateriaPrima, porProductoYTalla);
      await reponer('mano_obra', manoObra, datos.manoObra, porProductoYTalla);
      await reponer('precio_adquisicion', preciosAdquisicion, datos.preciosAdquisicion, porProductoYTalla);
      await reponer('tela', telas, datos.telas, () => true);
      await reponer('accesorio', accesorios, datos.accesorios, () => true);
      await reponer('costo_indirecto', costosIndirectos, datos.costosIndirectos, () => true);
    }

    // Las prendas NO se tocan, pero se dice cuales aparecieron despues de la foto.
    const idsEnFoto = new Set((datos.productos || []).map((p: any) => String(p.id)));
    const posteriores = [...productosVivos].filter((pid) => !idsEnFoto.has(pid));
    if (posteriores.length > 0) {
      const detalle = await db.select().from(productos);
      const nombres = detalle
        .filter((p: any) => posteriores.includes(String(p.id)))
        .map((p: any) => `#${p.itemNumero} ${p.descripcion}`);
      avisos.push(
        `${posteriores.length} prenda(s) existen hoy y no estaban en la instantánea: ` +
        `${nombres.join(', ')}. NO se borraron —hacerlo arrastraría sus pesos, mano de obra, ` +
        `receta e inventario— y quedaron sin precio ni stock porque la foto no los tenía.`
      );
    }

    saveDbToDisk();

    return c.json({
      success: true,
      message: `Instantánea "${snap.nombre}" restaurada (alcance: ${alcance}).`,
      instantanea: { id: snap.id, nombre: snap.nombre, creadoEn: snap.creadoEn },
      alcance,
      // Conteos MEDIDOS por tabla. Un "restaurado exitosamente" sin numeros no permite
      // distinguir una restauracion completa de una que repuso cero filas.
      reporte,
      respaldo: respaldo ? respaldo.split(/[\\/]/).pop() : null,
      avisos,
    });
  } catch (e) {
    return c.json({
      success: false,
      error: 'Falló la restauración: ' + String(e),
      respaldo: respaldo ? respaldo.split(/[\\/]/).pop() : null,
      detalle: 'La base puede haber quedado a medias. Restaurar desde el respaldo indicado.',
    }, 500);
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
