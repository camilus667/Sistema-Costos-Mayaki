import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc } from 'drizzle-orm';
import {
  tallas, preciosVenta, pesoMateriaPrima, manoObra, inventario, preciosAdquisicion,
  colegioTallas,
} from '../database/schema';
// El codigo se canoniza al crear: `2` y `02` son la misma talla.
import { codigoTallaCanonico } from '../services/tallas';

const api = new Hono();

// Esquema de creación de talla
const crearTallaSchema = z.object({
  // FASE 5: colegioId pasa de obligatorio a opcional y nullable.
  //
  // La talla dejo de ser del colegio: es un vocabulario de codigos de industria y
  // las 16 filas del catalogo tienen colegio_id NULL. Exigirlo aca obligaba a
  // asignarle un colegio a cada talla nueva, y una talla con colegio queda fuera
  // del vocabulario comun: solo la ve ese colegio. Se deja la puerta abierta a una
  // talla exclusiva por si algun dia hace falta, pero el default es compartida.
  colegioId: z.string().nullable().optional(),
  codigo: z.string().min(1).max(50),
  nombre: z.string().min(1).max(255),
  orden: z.number().int().default(1),
});

// GET /api/tallas - Listar tallas
//
// NO filtra por colegio, y es a proposito. Las tallas son el vocabulario compartido
// de la empresa (FASE 5), asi que devolver todas es lo correcto. Si alguna vez se
// agrega una talla exclusiva de un colegio, el filtro que corresponde aca es
// `= colegio OR IS NULL`, nunca `= colegio` a secas: con `eq` puro esta pantalla
// perderia las 16 compartidas. Ese error ya ocurrio en GET /api/telas.
api.get('/', async (c) => {
  const db = (c as any).db;
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  return c.json({
    success: true,
    data: allTallas,
  });
});

// GET /api/tallas/:id - Obtener talla por ID
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [talla] = await db
    .select()
    .from(tallas)
    .where(eq(tallas.id, id))
    .limit(1);

  if (!talla) {
    return c.json({ success: false, error: 'Talla no encontrada' }, 404);
  }

  return c.json({
    success: true,
    data: talla,
  });
});

// POST /api/tallas - Crear talla
//
// TRES GUARDAS, y ninguna es decorativa:
//
//   1. EL CODIGO SE CANONIZA. `2` y `02` son la misma talla, y guardar las dos crea una columna
//      duplicada en cada matriz que despues hay que limpiar a mano.
//   2. NO SE DUPLICA. Con dos tallas del mismo codigo, `buscarTallaPorCodigo` devuelve la primera
//      y los precios de la otra se vuelven inalcanzables.
//   3. EL ORDEN CORRE A LAS POSTERIORES. `orden` define la secuencia de columnas de las matrices:
//      una talla 03 insertada al final aparece despues de 50/4XL, que para leer una curva de
//      tallas es inservible. Es la misma logica que `altaTalla.ts`, ahora tambien por la ruta.
api.post('/', zValidator('json', crearTallaSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  const codigo = codigoTallaCanonico(body.codigo);
  if (!codigo) {
    return c.json({ success: false, error: 'El codigo de la talla no puede estar vacio.' }, 400);
  }

  const existentes = await db.select().from(tallas);
  const yaEsta = existentes.find((t: any) => codigoTallaCanonico(t.codigo) === codigo);
  if (yaEsta) {
    return c.json({
      success: false,
      error: `La talla ${codigo} ya existe (guardada como "${yaEsta.codigo}"). No se duplica.`,
    }, 409);
  }

  const orden = Number.isFinite(Number(body.orden)) && Number(body.orden) > 0
    ? Math.trunc(Number(body.orden))
    : existentes.length + 1;

  // Se corren las posteriores ANTES de insertar, para que no queden dos tallas con el mismo orden.
  for (const t of existentes) {
    if (Number(t.orden) >= orden) {
      await db.update(tallas).set({ orden: Number(t.orden) + 1 }).where(eq(tallas.id, t.id));
    }
  }

  // Explicito: sin colegio, la talla es compartida. Dejarlo implicito funcionaria
  // igual (Drizzle omite la columna y la base pone NULL), pero escrito se lee.
  const [newTalla] = await db
    .insert(tallas)
    .values({
      ...body,
      codigo,
      nombre: String(body.nombre ?? '').trim() || `Talla ${codigo}`,
      orden,
      colegioId: body.colegioId || null,
    })
    .returning();

  return c.json({
    success: true,
    data: newTalla,
    corridas: existentes.filter((t: any) => Number(t.orden) >= orden).length,
    message: `Talla ${codigo} creada en la posicion ${orden}.`,
  }, 201);
});

// PUT /api/tallas/:id - Actualizar talla
api.put('/:id', zValidator('json', crearTallaSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [updatedTalla] = await db
    .update(tallas)
    .set(body)
    .where(eq(tallas.id, id))
    .returning();

  if (!updatedTalla) {
    return c.json({ success: false, error: 'Talla no encontrada' }, 404);
  }

  return c.json({
    success: true,
    data: updatedTalla,
    message: 'Talla actualizada exitosamente',
  });
});

// DELETE /api/tallas/:id - Eliminar talla
//
// SE NIEGA SI LA TALLA TIENE DATOS, y esto no es precaucion generica: sin esta guarda, borrar una
// talla dejaba 448 filas de peso, 448 de mano de obra, 297 precios y 448 de inventario apuntando a
// una talla que ya no existe. Son huerfanas invisibles: no aparecen en ninguna pantalla porque
// todas filtran por talla, siguen ocupando lugar, y este proyecto ya tuvo que limpiar huerfanas a
// mano una vez.
//
// El mensaje dice QUE la retiene y CUANTO, para que se pueda decidir. Un "no se puede eliminar" sin
// motivo obliga a adivinar.
//
// PARA DEJAR DE USAR UNA TALLA en un colegio no hay que borrarla: se destilda en Configuracion ->
// Tallas, que escribe en `colegio_talla` y no toca ningun dato.
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [talla] = await db.select().from(tallas).where(eq(tallas.id, id)).limit(1);
  if (!talla) {
    return c.json({ success: false, error: 'Talla no encontrada' }, 404);
  }

  const cuenta = async (tabla: any, campo: any) =>
    (await db.select({ id: campo }).from(tabla).where(eq(campo, id))).length;

  const retenciones: Array<{ que: string; filas: number }> = [
    { que: 'precios de venta', filas: await cuenta(preciosVenta, preciosVenta.tallaId) },
    { que: 'pesos de materia prima', filas: await cuenta(pesoMateriaPrima, pesoMateriaPrima.tallaId) },
    { que: 'tarifas de mano de obra', filas: await cuenta(manoObra, manoObra.tallaId) },
    { que: 'filas de inventario', filas: await cuenta(inventario, inventario.tallaId) },
    { que: 'precios de adquisicion', filas: await cuenta(preciosAdquisicion, preciosAdquisicion.tallaId) },
  ].filter((r) => r.filas > 0);

  if (retenciones.length) {
    return c.json({
      success: false,
      error:
        `No se puede eliminar la talla ${talla.codigo}: tiene datos cargados ` +
        `(${retenciones.map((r) => `${r.filas} ${r.que}`).join(', ')}). ` +
        `Para dejar de usarla en un colegio, destildala en Configuracion -> Tallas: eso no borra nada.`,
      retenciones,
    }, 409);
  }

  // Sin datos propios, las filas de activacion por colegio si se limpian: no son datos del negocio,
  // son la configuracion de una talla que deja de existir.
  await db.delete(colegioTallas).where(eq(colegioTallas.tallaId, id));
  await db.delete(tallas).where(eq(tallas.id, id));

  // SE CIERRA EL HUECO que deja la fila borrada. Sin esto, borrar la talla que estaba en la
  // posicion 2 dejaba la curva en `1, 3, 4, 5...`, y agregar y borrar unas cuantas veces la iba
  // llenando de agujeros. El orden sigue ordenando igual con huecos, pero deja de significar "la
  // enesima talla de la curva", que es lo que el campo de posicion de la pantalla le promete al
  // usuario. Es el mismo criterio que la referencia `CC-01`: la posicion no tiene huecos.
  const quedan = await db.select().from(tallas).orderBy(asc(tallas.orden));
  let n = 1;
  for (const t of quedan) {
    if (Number(t.orden) !== n) {
      await db.update(tallas).set({ orden: n }).where(eq(tallas.id, t.id));
    }
    n++;
  }

  return c.json({
    success: true,
    renumeradas: quedan.length,
    message: `Talla ${talla.codigo} eliminada.`,
  });
});

export default api;
