/**
 * CRUD de prendas — /api/productos
 *
 * FASE 6. Este archivo era el ultimo de los cuatro que el inventario de la seccion C del
 * barrido marco, y resulto ser el que tenia los defectos mas graves de los cuatro, porque
 * dos de ellos no eran fugas de LECTURA sino agujeros de ESCRITURA:
 *
 * 1. POST / no validaba que el colegio existiera. El mismo agujero que creo la prenda
 *    huerfana con colegio_id = "all". Lo tape en colegio.ts y di el problema por cerrado:
 *    habia DOS endpoints que crean prendas y arregle uno. Ahora los dos delegan en
 *    crearPrenda.service.ts, que valida una sola vez para los dos.
 *
 * 2. PUT /:id aceptaba colegioId en su schema parcial, asi que podia MOVER una prenda a
 *    otro colegio —o a uno inexistente— sin validar nada. Un solo PUT podia crear una
 *    huerfana o hacer una escritura cruzada entre colegios.
 *
 * 3. DELETE /:id borraba la fila de producto y dejaba VIVOS sus precios, pesos, mano de
 *    obra, receta e inventario. Con las foreign keys apagadas SQLite no protesta, asi que
 *    el endpoint era una fabrica de filas huerfanas: exactamente las que limpiarHuerfanas.ts
 *    tuvo que borrar a mano esta mañana.
 *
 * SOBRE EL ALCANCE, que es la regla que fijo el usuario para esta fase: "dejá 'all'
 * disponible para todos por ahora y solo agregá el filtrado donde hoy no existe". Asi que
 * colegioId sigue siendo OPCIONAL en todas partes y sin el se ve toda la empresa. Lo que
 * cambia es que ahora existe la posibilidad de acotar, y que la respuesta DECLARA su
 * alcance en vez de parecer la de un colegio.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, and, sql } from 'drizzle-orm';
import {
  productos,
  colegios,
  accesorios,
  telas,
  detalleAccesorio,
  preciosVenta,
  preciosAdquisicion,
  pesoMateriaPrima,
  manoObra,
  inventario,
  inventarioTransacciones,
  historicoPrecios,
} from '../database/schema';
import { crearPrendaConTallas } from '../services/crearPrenda.service';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

/**
 * factorComplejidad es `real` en el schema y aca estaba declarado `z.number().int()`.
 * O sea que la API rechazaba un factor de 1,5 que la base acepta sin problema. El factor
 * es un multiplicador de complejidad de confeccion: no hay ninguna razon para que sea
 * entero, y de hecho la Fase 4 probo que solo importan los COCIENTES entre factores, lo
 * cual hace los decimales especialmente utiles.
 */
const crearProductoSchema = z.object({
  colegioId: z.string().min(1),
  anioId: z.string().optional().nullable(),
  itemNumero: z.number().int().optional(),
  descripcion: z.string().min(1),
  orden: z.number().int().optional(),
  telaId: z.string().optional().nullable(),
  modoCosteo: z.enum(['confeccion', 'adquirido']).optional(),
  factorComplejidad: z.number().positive().optional(),
  costoFijo: z.number().optional(),
  planchadoExtra: z.number().optional(),
  colocacionBotones: z.number().optional(),
  operacionesExtra: z.number().optional(),
  activo: z.boolean().optional(),
});

/** Cuenta filas de una tabla hija de producto. */
async function contar(db: any, tabla: any, productoId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)` })
    .from(tabla)
    .where(eq(tabla.productoId, productoId));
  return Number(r?.n) || 0;
}

/**
 * Insumos y tela de una prenda que son EXCLUSIVOS de un colegio distinto al que se le
 * quiere asignar.
 *
 * POR QUE IMPORTA. El motor de costeo resuelve accesorios y telas por ID y no mira
 * colegio, asi que despues de mover la prenda SIGUE cobrandolos con normalidad, mientras
 * el selector de la pantalla deja de ofrecerlos. El dato queda vivo e invisible, que es
 * la peor forma de inconsistencia: no da error, da un numero.
 *
 * Es el mismo problema que usosEnOtrosColegios() detecta cuando se angosta el ambito de un
 * insumo, visto desde el otro lado: ahi se mueve el insumo, aca se mueve la prenda.
 */
async function itemsQueQuedanCruzados(db: any, productoId: string, colegioNuevo: string) {
  const insumos = await db
    .select({ descripcion: accesorios.descripcion, colegioId: accesorios.colegioId })
    .from(detalleAccesorio)
    .innerJoin(accesorios, eq(detalleAccesorio.accesorioId, accesorios.id))
    .where(eq(detalleAccesorio.productoId, productoId));

  const insumosCruzados = insumos
    .filter((a: any) => a.colegioId !== null && a.colegioId !== colegioNuevo)
    .map((a: any) => a.descripcion);

  const [prenda] = await db
    .select({ telaId: productos.telaId })
    .from(productos)
    .where(eq(productos.id, productoId))
    .limit(1);

  let telaCruzada: string | null = null;
  if (prenda?.telaId) {
    const [t] = await db
      .select({ descripcion: telas.descripcion, colegioId: telas.colegioId })
      .from(telas)
      .where(eq(telas.id, prenda.telaId))
      .limit(1);
    if (t && t.colegioId !== null && t.colegioId !== colegioNuevo) telaCruzada = t.descripcion;
  }

  return { insumosCruzados, telaCruzada };
}

// ---------------------------------------------------------------------------------------
// GET /api/productos — listar, con colegioId opcional
// ---------------------------------------------------------------------------------------
api.get('/', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');
  const acotado = !!colegioId && colegioId !== 'all';

  const base = db.select().from(productos);
  const lista = await (acotado ? base.where(eq(productos.colegioId, colegioId!)) : base)
    .orderBy(asc(productos.itemNumero));

  return c.json({
    success: true,
    data: lista,
    // El alcance DECLARADO, igual que en export.ts. Un listado de toda la empresa y el de
    // un colegio se veian identicos desde afuera, y con un solo colegio cargado eran la
    // misma cosa. Con dos ya no.
    alcance: acotado ? { tipo: 'colegio', colegioId } : { tipo: 'empresa', descripcion: 'TODA LA EMPRESA' },
  });
});

// ---------------------------------------------------------------------------------------
// GET /api/productos/:id
// ---------------------------------------------------------------------------------------
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const colegioId = c.req.query('colegioId');

  const [producto] = await db.select().from(productos).where(eq(productos.id, id)).limit(1);

  if (!producto) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }

  // Si el llamador dice de que colegio pregunta, se respeta. 404 y no 403 a proposito:
  // desde el punto de vista de ese colegio la prenda no existe, y un 403 confirmaria que
  // existe en otro. El control por usuario queda para cuando haya usuarios de verdad, por
  // decision explicita del usuario.
  if (colegioId && colegioId !== 'all' && producto.colegioId !== colegioId) {
    return c.json({
      success: false,
      error: `La prenda ${id} no pertenece al colegio ${colegioId}.`,
    }, 404);
  }

  return c.json({ success: true, data: producto });
});

// ---------------------------------------------------------------------------------------
// POST /api/productos — delega en el servicio compartido
// ---------------------------------------------------------------------------------------
api.post('/', zValidator('json', crearProductoSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  const r = await crearPrendaConTallas(db, body as any);

  if (!r.ok) {
    return c.json({ success: false, error: r.error }, r.estado as any);
  }

  return c.json({
    success: true,
    data: r.prenda,
    tallas: r.tallas,
    avisos: r.avisos,
    message: 'Producto creado exitosamente',
  }, 201);
});

// ---------------------------------------------------------------------------------------
// PUT /api/productos/:id
// ---------------------------------------------------------------------------------------
api.put('/:id', zValidator('json', crearProductoSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body: any = c.req.valid('json');

  const [existente] = await db.select().from(productos).where(eq(productos.id, id)).limit(1);
  if (!existente) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }

  // Guarda de dueño, opcional y del mismo tenor que en el GET.
  const desdeColegio = c.req.query('colegioId');
  if (desdeColegio && desdeColegio !== 'all' && existente.colegioId !== desdeColegio) {
    return c.json({
      success: false,
      error: `La prenda ${id} no pertenece al colegio ${desdeColegio}, asi que no se puede modificar desde ahi.`,
    }, 404);
  }

  const avisos: string[] = [];
  const cambiaColegio = body.colegioId !== undefined && body.colegioId !== existente.colegioId;

  if (cambiaColegio) {
    // EL AGUJERO. Sin esto un PUT podia dejar la prenda apuntando a un colegio inexistente,
    // que es el mismo estado huerfano que borramos esta mañana, creado por otra puerta.
    const [destino] = await db.select().from(colegios).where(eq(colegios.id, body.colegioId)).limit(1);
    if (!destino) {
      return c.json({
        success: false,
        error:
          `No existe el colegio "${body.colegioId}". Mover la prenda ahi la dejaria huerfana: ` +
          `invisible en toda pantalla que filtre por colegio y contada en los totales sin filtro.`,
      }, 404);
    }

    // NO se rechaza el movimiento. limpiarHuerfanas.ts recomienda exactamente esta
    // operacion para reparar una prenda mal asignada, asi que bloquearla obligaria a
    // hacerlo con SQL a mano. Pero se DICE que queda cruzado, con nombre y apellido.
    const { insumosCruzados, telaCruzada } = await itemsQueQuedanCruzados(db, id, body.colegioId);
    if (insumosCruzados.length > 0) {
      avisos.push(
        `${insumosCruzados.length} insumo(s) de la receta son exclusivos de otro colegio y ` +
        `quedan CRUZADOS: ${insumosCruzados.join(', ')}. El motor los sigue cobrando porque ` +
        `resuelve por id y no mira colegio, pero el selector de la pantalla ya no los ofrece. ` +
        `Hay que volverlos de la empresa o reemplazarlos por los equivalentes del colegio nuevo.`
      );
    }
    if (telaCruzada) {
      avisos.push(
        `La tela "${telaCruzada}" es exclusiva de otro colegio y queda CRUZADA: el costo de ` +
        `material se sigue calculando con ella, pero el selector no la ofrece.`
      );
    }
  }

  // Solo los campos presentes, y solo los que existen en el schema. Se enumeran a mano en
  // vez de pasar `body` entero para que un campo nuevo del zod no llegue a la base sin que
  // alguien lo haya pensado.
  const cambios: any = {};
  for (const k of [
    'colegioId', 'anioId', 'itemNumero', 'orden', 'descripcion', 'telaId',
    'modoCosteo', 'factorComplejidad', 'costoFijo', 'planchadoExtra',
    'colocacionBotones', 'operacionesExtra', 'activo',
  ]) {
    if (body[k] !== undefined) cambios[k] = body[k];
  }

  // itemNumero es la clave de negocio de las matrices y se numera por colegio: repetirlo
  // dentro del mismo colegio hace que el lookup por item encuentre dos y devuelva 409.
  const colegioFinal = cambios.colegioId ?? existente.colegioId;
  const itemFinal = cambios.itemNumero ?? existente.itemNumero;
  if (cambios.itemNumero !== undefined || cambiaColegio) {
    const choque = await db
      .select({ id: productos.id })
      .from(productos)
      .where(and(eq(productos.colegioId, colegioFinal), eq(productos.itemNumero, itemFinal)));
    if (choque.some((p: any) => p.id !== id)) {
      return c.json({
        success: false,
        error:
          `Ese colegio ya tiene otra prenda con el item ${itemFinal}. El numero de item ` +
          `identifica a la prenda en las matrices: repetirlo hace que el lookup por item ` +
          `encuentre dos y no pueda decidir cual es.`,
      }, 409);
    }
  }

  const [actualizado] = await db.update(productos).set(cambios).where(eq(productos.id, id)).returning();
  saveDbToDisk();

  return c.json({
    success: true,
    data: actualizado,
    avisos,
    message: 'Producto actualizado exitosamente',
  });
});

// ---------------------------------------------------------------------------------------
// DELETE /api/productos/:id
// ---------------------------------------------------------------------------------------
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const forzar = c.req.query('forzar') === 'true';

  const [existente] = await db.select().from(productos).where(eq(productos.id, id)).limit(1);
  if (!existente) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }

  const desdeColegio = c.req.query('colegioId');
  if (desdeColegio && desdeColegio !== 'all' && existente.colegioId !== desdeColegio) {
    return c.json({
      success: false,
      error: `La prenda ${id} no pertenece al colegio ${desdeColegio}, asi que no se puede borrar desde ahi.`,
    }, 404);
  }

  // Que cuelga de la prenda. Se cuenta ANTES de tocar nada.
  const hijas = {
    detalle_acc: await contar(db, detalleAccesorio, id),
    precio_venta: await contar(db, preciosVenta, id),
    precio_adquisicion: await contar(db, preciosAdquisicion, id),
    peso_mat_prima: await contar(db, pesoMateriaPrima, id),
    mano_obra: await contar(db, manoObra, id),
    inventario_transaccion: await contar(db, inventarioTransacciones, id),
    inventario: await contar(db, inventario, id),
    historico_precio: await contar(db, historicoPrecios, id),
  };

  // Cuanto stock hay. Un cero no es lo mismo que la ausencia de filas: el alta crea las
  // filas de inventario en cero, asi que 16 filas con cantidad 0 significan "nunca entro
  // nada", y con cantidad > 0 significan mercaderia real en el deposito.
  const [stock] = await db
    .select({ n: sql<number>`coalesce(sum(cantidad), 0)` })
    .from(inventario)
    .where(eq(inventario.productoId, id));
  const unidades = Number(stock?.n) || 0;

  // La misma regla que limpiarHuerfanas.ts: precios, receta y stock son TRABAJO HUMANO. Si
  // estan, esto probablemente no es un descarte, y borrar es irreversible. Se dice que hay
  // y se pide que lo confirmen.
  const trabajoHumano =
    hijas.precio_venta > 0 || hijas.detalle_acc > 0 || hijas.mano_obra > 0 || unidades > 0;

  if (trabajoHumano && !forzar) {
    return c.json({
      success: false,
      error:
        `La prenda "${existente.descripcion}" (item ${existente.itemNumero}) tiene datos ` +
        `cargados y no se borra sin confirmacion explicita.`,
      tiene: { ...hijas, unidadesEnStock: unidades },
      porQue:
        `Precios, receta, mano de obra y stock son trabajo humano. Su presencia sugiere que ` +
        `esta no es una prenda de descarte. Si se borro por error no hay como recuperarla: ` +
        `las foreign keys de SQLite estan apagadas, asi que borrar la prenda dejaria vivas ` +
        `sus ${Object.values(hijas).reduce((a, b) => a + b, 0)} filas hijas, huerfanas e invisibles.`,
      queHacerEnCambio:
        `Si la prenda esta en el colegio equivocado, moverla con PUT /api/productos/${id} ` +
        `mandando el colegioId correcto. Si de verdad hay que borrarla con todo lo que ` +
        `cuelga, repetir con ?forzar=true.`,
    }, 409);
  }

  // Hijas primero, padre despues. Al reves quedan filas apuntando a la nada, y SQLite lo
  // permite en silencio porque las FK estan apagadas.
  const borradas: Record<string, number> = {};
  for (const [nombre, tabla] of [
    ['detalle_acc', detalleAccesorio],
    ['precio_venta', preciosVenta],
    ['precio_adquisicion', preciosAdquisicion],
    ['peso_mat_prima', pesoMateriaPrima],
    ['mano_obra', manoObra],
    ['inventario_transaccion', inventarioTransacciones],
    ['inventario', inventario],
    ['historico_precio', historicoPrecios],
  ] as Array<[string, any]>) {
    const n = (hijas as any)[nombre] as number;
    if (n === 0) continue;
    await db.delete(tabla).where(eq(tabla.productoId, id));
    borradas[nombre] = n;
  }

  await db.delete(productos).where(eq(productos.id, id));

  return c.json({
    success: true,
    message: `Prenda "${existente.descripcion}" eliminada junto con sus filas derivadas.`,
    filasHijasBorradas: borradas,
    totalFilasHijas: Object.values(borradas).reduce((a, b) => a + b, 0),
  });
});

export default api;
