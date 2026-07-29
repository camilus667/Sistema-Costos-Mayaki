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
 *   POST   /api/productos/:productoId/accesorios/copiar-de/:origenId
 *   GET    /api/productos/:productoId/accesorios/candidatos-copia
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { detalleAccesorio, accesorios, productos, colegios, telas } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';
import { nuevoIdHex } from '../services/resolucion.service';

const api = new Hono();

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
 * FASE 5 APLICADA: `accesorio.colegio_id` ya es nullable, y 27 de los 38 accesorios
 * del catálogo tienen NULL. Esta función se escribió antes de la migración prevista
 * para ese momento y quedó correcta sin tocarla, que era la intención.
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

/**
 * GET /api/productos/:productoId/accesorios/candidatos-copia
 *
 * De que prendas conviene copiar la receta de ESTA prenda.
 *
 * POR QUE EXISTE. El selector de origen de la pantalla se llenaba con las prendas del
 * MISMO colegio. Para el caso que mas importa —una prenda recien creada en un colegio
 * nuevo— ese selector sale VACIO, porque no hay otras prendas en ese colegio todavia.
 * La funcion de copiar no servia justamente cuando mas hace falta.
 *
 * EL CRITERIO: misma tela. Dos prendas que se cortan de la misma tela suelen compartir
 * construccion —botones, entretela, etiquetas, hilo— asi que su receta es un punto de
 * partida razonable. Y el criterio cruza colegios, que es lo que el alta necesita: la
 * camisa del colegio nuevo se parece a la camisa del colegio viejo mucho mas de lo que
 * se parece a cualquier otra prenda del suyo.
 *
 * Se devuelven DOS grupos y no solo el primero. Si ninguna prenda comparte la tela
 * —o si esta prenda todavia no tiene tela asignada— quedarse solo con "misma tela"
 * reproduciria el selector vacio que se viene a arreglar.
 *
 * Y se excluyen las prendas SIN receta: copiar de una receta vacia devuelve 400, asi
 * que ofrecerla es una trampa. Es el mismo criterio que el selector de insumos, que solo
 * ofrece los que la prenda todavia no lleva.
 */
api.get('/:productoId/accesorios/candidatos-copia', async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');

  const [destino] = await db
    .select()
    .from(productos)
    .where(eq(productos.id, productoId))
    .limit(1);

  if (!destino) {
    return c.json({ success: false, error: 'Prenda no encontrada' }, 404);
  }

  const [todasLasPrendas, colegiosLista, telasLista, lineas] = await Promise.all([
    db.select().from(productos).orderBy(asc(productos.itemNumero)),
    db.select().from(colegios),
    db.select().from(telas),
    db
      .select({
        productoId: detalleAccesorio.productoId,
        cantidadUso: detalleAccesorio.cantidadUso,
        costoUnitario: accesorios.costoUnitario,
      })
      .from(detalleAccesorio)
      .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id)),
  ]);

  // El subtotal se agrega en JS y no en SQL: son un par de cientos de lineas, y una
  // suma con groupBy aca obligaria a confiar en como el driver traduce el agregado.
  const resumenPorPrenda = new Map<string, { lineas: number; subtotal: number }>();
  for (const l of lineas) {
    const actual = resumenPorPrenda.get(l.productoId) || { lineas: 0, subtotal: 0 };
    actual.lineas += 1;
    actual.subtotal += (Number(l.cantidadUso) || 0) * (Number(l.costoUnitario) || 0);
    resumenPorPrenda.set(l.productoId, actual);
  }

  const nombreColegio = new Map<string, string>();
  for (const col of colegiosLista) nombreColegio.set(col.id, String(col.nombre));

  const nombreTela = new Map<string, string>();
  for (const t of telasLista) nombreTela.set(t.id, String(t.descripcion));

  const mismaTela: any[] = [];
  const otras: any[] = [];

  for (const p of todasLasPrendas) {
    if (p.id === productoId) continue;

    const resumen = resumenPorPrenda.get(p.id);
    if (!resumen || resumen.lineas === 0) continue; // sin receta no hay nada que copiar

    const fila = {
      id: p.id,
      itemNumero: p.itemNumero,
      descripcion: p.descripcion,
      colegioId: p.colegioId,
      colegioNombre: nombreColegio.get(p.colegioId) || '?',
      esDeOtroColegio: p.colegioId !== destino.colegioId,
      telaId: p.telaId,
      telaDescripcion: p.telaId ? (nombreTela.get(p.telaId) || '?') : null,
      lineas: resumen.lineas,
      subtotalBs: redondear(resumen.subtotal),
    };

    if (destino.telaId && p.telaId === destino.telaId) mismaTela.push(fila);
    else otras.push(fila);
  }

  return c.json({
    success: true,
    prenda: {
      id: destino.id,
      itemNumero: destino.itemNumero,
      descripcion: destino.descripcion,
      colegioId: destino.colegioId,
      telaId: destino.telaId,
      telaDescripcion: destino.telaId ? (nombreTela.get(destino.telaId) || '?') : null,
    },
    mismaTela,
    otras,
    // Se dice explicito por que el primer grupo puede venir vacio, para que la pantalla
    // pueda explicarlo en vez de mostrar una lista corta sin motivo aparente.
    motivoSinMismaTela: !destino.telaId
      ? 'Esta prenda no tiene tela asignada, asi que no se puede sugerir por tela.'
      : mismaTela.length === 0
        ? 'Ninguna otra prenda con receta usa esta tela.'
        : null,
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
    .values({ id: nuevoIdHex(), productoId, accesorioId, cantidadUso })
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

/**
 * POST /api/productos/:productoId/accesorios/copiar-de/:origenId
 *
 * Copia la receta de accesorios de otra prenda. Es la operacion que hace barato
 * dar de alta un colegio nuevo: se crea la prenda, se copia la receta de la
 * prenda equivalente de otro colegio, y solo se ajusta lo distinto.
 *
 * A proposito NO es todo-o-nada. Al copiar entre colegios, los accesorios
 * exclusivos del colegio de origen (la insignia bordada, la etiqueta con logo)
 * no pueden viajar, y abortar por eso obligaria a capturar todo a mano otra vez.
 * En vez de fallar, se copia lo que corresponde y se devuelve el detalle de lo
 * omitido, para que quede explicito que hay que crear el equivalente.
 *
 * Query param opcional: ?reemplazar=true vacia la receta del destino antes de
 * copiar. Por defecto se suma a lo que ya exista.
 */
api.post('/:productoId/accesorios/copiar-de/:origenId', async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const origenId = c.req.param('origenId');
  const reemplazar = c.req.query('reemplazar') === 'true';

  if (productoId === origenId) {
    return c.json({ success: false, error: 'La prenda de origen y la de destino son la misma' }, 400);
  }

  const [destino] = await db
    .select()
    .from(productos)
    .where(eq(productos.id, productoId))
    .limit(1);

  if (!destino) {
    return c.json({ success: false, error: 'Prenda de destino no encontrada' }, 404);
  }

  const [origen] = await db
    .select()
    .from(productos)
    .where(eq(productos.id, origenId))
    .limit(1);

  if (!origen) {
    return c.json({ success: false, error: 'Prenda de origen no encontrada' }, 404);
  }

  const receta = await db
    .select({
      accesorioId: detalleAccesorio.accesorioId,
      cantidadUso: detalleAccesorio.cantidadUso,
      descripcion: accesorios.descripcion,
      colegioId: accesorios.colegioId,
      costoUnitario: accesorios.costoUnitario,
    })
    .from(detalleAccesorio)
    .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id))
    .where(eq(detalleAccesorio.productoId, origenId));

  if (receta.length === 0) {
    return c.json({
      success: false,
      error: 'La prenda de origen no tiene accesorios asignados, no hay nada que copiar',
    }, 400);
  }

  if (reemplazar) {
    await db.delete(detalleAccesorio).where(eq(detalleAccesorio.productoId, productoId));
  }

  const filasDestino = await db
    .select({ accesorioId: detalleAccesorio.accesorioId })
    .from(detalleAccesorio)
    .where(eq(detalleAccesorio.productoId, productoId));

  const yaAsignados = new Set(filasDestino.map((r: any) => r.accesorioId));

  const aInsertar: any[] = [];
  const copiados: any[] = [];
  const omitidosPorColegio: any[] = [];
  const omitidosYaExistian: any[] = [];

  for (const linea of receta) {
    if (yaAsignados.has(linea.accesorioId)) {
      omitidosYaExistian.push({ descripcion: linea.descripcion });
      continue;
    }

    if (!accesorioUsablePorProducto({ colegioId: linea.colegioId }, destino)) {
      omitidosPorColegio.push({
        descripcion: linea.descripcion,
        cantidadUso: linea.cantidadUso,
      });
      continue;
    }

    aInsertar.push({
      id: nuevoIdHex(),
      productoId,
      accesorioId: linea.accesorioId,
      cantidadUso: linea.cantidadUso,
    });

    copiados.push({
      descripcion: linea.descripcion,
      cantidadUso: linea.cantidadUso,
      costoTotalBs: redondear((linea.cantidadUso || 0) * (linea.costoUnitario || 0)),
    });
  }

  if (aInsertar.length > 0) {
    await db.insert(detalleAccesorio).values(aInsertar);
  }

  if (aInsertar.length > 0 || reemplazar) {
    saveDbToDisk();
  }

  const mensaje = omitidosPorColegio.length > 0
    ? `Se copiaron ${copiados.length} accesorios. Quedaron ${omitidosPorColegio.length} sin copiar por ser exclusivos de otro colegio: hay que crear el equivalente para este colegio y asignarlo a mano.`
    : `Se copiaron ${copiados.length} accesorios.`;

  return c.json({
    success: true,
    origen: { id: origen.id, itemNumero: origen.itemNumero, descripcion: origen.descripcion },
    destino: { id: destino.id, itemNumero: destino.itemNumero, descripcion: destino.descripcion },
    reemplazo: reemplazar,
    copiados,
    omitidosPorSerExclusivosDeOtroColegio: omitidosPorColegio,
    omitidosPorEstarYaAsignados: omitidosYaExistian,
    resumen: {
      copiados: copiados.length,
      omitidos: omitidosPorColegio.length + omitidosYaExistian.length,
      subtotalCopiadoBs: redondear(
        copiados.reduce((t: number, l: any) => t + l.costoTotalBs, 0)
      ),
    },
    mensaje,
  }, 201);
});

export default api;
