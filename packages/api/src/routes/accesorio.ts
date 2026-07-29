import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, asc, or, isNull } from 'drizzle-orm';
import { accesorios } from '../database/schema';
import { usosEnOtrosColegios } from '../services/resolucion.service';

const api = new Hono();

// Esquema de creación de accesorio
const crearAccesorioSchema = z.object({
  // FASE 5: colegioId pasa de obligatorio a opcional y nullable, cuarto archivo
  // con este mismo arreglo despues de tela.ts, talla.ts y colegio.ts.
  //
  // NULL significa "insumo de la empresa", que es el caso normal: 27 de los 38
  // accesorios del catalogo son compartidos (botones, cierres, elastico, hilo) y
  // solo 11 llevan la identidad de un colegio —los bordados, las serigrafias, los
  // vinilos, el cuello y la botamanga. Exigirlo aca hacia que todo accesorio nuevo
  // creado por API naciera del colegio, o sea FUERA del catalogo compartido: solo
  // lo veia ese colegio, sin ningun error visible.
  colegioId: z.string().nullable().optional(),
  descripcion: z.string().min(1),
  codigo: z.string().optional(),
  unidadCompra: z.string().min(1),
  cantidadXUd: z.number().positive(),
  costoUdCompra: z.number().positive(),
  // costoUnitario es DERIVADO: costoUdCompra / cantidadXUd. Se acepta si viene, para
  // no romper a quien ya lo manda, pero es opcional y el servidor lo calcula.
  //
  // Antes era obligatorio, y eso empujaba a cada pantalla a calcularlo por su cuenta
  // antes de poder crear un insumo. Esa es la forma en que la formula de costeo llego
  // a estar en cuatro lugares con dos copias mal: un campo derivado que el cliente
  // tiene que completar es una invitacion a duplicar la cuenta.
  costoUnitario: z.number().positive().optional(),
});

// GET /api/accesorios - Listar accesorios
//
// FASE 6: acepta colegioId opcional. Antes no filtraba en absoluto, asi que con dos
// colegios cargados devolvia tambien los 11 insumos exclusivos del otro colegio.
// El filtro es `= colegio OR IS NULL` para no esconder los 27 compartidos, y
// colegioId=all sigue devolviendo todo para quien lo pida explicitamente.
api.get('/', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let query = db.select().from(accesorios);
  if (colegioId && colegioId !== 'all') {
    query = query.where(or(eq(accesorios.colegioId, colegioId), isNull(accesorios.colegioId)));
  }

  const allAccesorios = await query.orderBy(asc(accesorios.descripcion));

  return c.json({
    success: true,
    data: allAccesorios,
  });
});

// GET /api/accesorios/:id - Obtener accesorio por ID
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [accesorio] = await db
    .select()
    .from(accesorios)
    .where(eq(accesorios.id, id))
    .limit(1);

  if (!accesorio) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }

  return c.json({
    success: true,
    data: accesorio,
  });
});

// POST /api/accesorios - Crear accesorio
api.post('/', zValidator('json', crearAccesorioSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  // Explicito: sin colegio, el accesorio es del catalogo de la empresa.
  // Y el costo unitario se deriva si no vino, en un solo lugar.
  const cantidadXUd = body.cantidadXUd;
  const costoUnitario = body.costoUnitario ?? (cantidadXUd > 0 ? body.costoUdCompra / cantidadXUd : 0);

  const [newAccesorio] = await db
    .insert(accesorios)
    .values({
      ...body,
      colegioId: body.colegioId || null,
      costoUnitario: Math.round(costoUnitario * 10000) / 10000,
    })
    .returning();

  return c.json({
    success: true,
    data: newAccesorio,
    message: 'Accesorio creado exitosamente',
  }, 201);
});

// PUT /api/accesorios/:id - Actualizar accesorio
//
// RE-DERIVA costoUnitario. Antes hacia `.set(body)` a secas, asi que editar el costo
// de la unidad de compra o la cantidad por unidad dejaba costoUnitario con el valor
// VIEJO — y costoUnitario es el que multiplica la cantidad de uso en el costeo de cada
// prenda. O sea que corregir el precio de un boton en la pantalla no cambiaba el costo
// de ninguna prenda, y nada avisaba.
//
// Es el mismo defecto del campo derivado que se corrigio en el POST, sobre el otro
// camino. Vale la pena decirlo asi: un campo derivado que se guarda tiene que
// recalcularse en TODA escritura, no solo en la primera. Si se recalcula en una sola,
// el sistema queda con una via por la que el dato se desincroniza en silencio.
api.put('/:id', zValidator('json', crearAccesorioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [existente] = await db.select().from(accesorios).where(eq(accesorios.id, id)).limit(1);
  if (!existente) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }

  // CAMBIO DE AMBITO. Solo se chequea cuando el ambito se ANGOSTA: pasar a exclusivo de
  // un colegio, o de un colegio a otro. Ampliarlo —volverlo de la empresa— siempre es
  // seguro, porque nadie pierde acceso.
  const ambitoNuevo = body.colegioId === undefined ? undefined : (body.colegioId || null);
  if (ambitoNuevo && ambitoNuevo !== existente.colegioId) {
    const usos = await usosEnOtrosColegios(db, 'accesorio', id, ambitoNuevo);
    if (usos.length > 0) {
      const detalle = usos.map((u: any) => `item ${u.itemNumero} ${u.descripcion}`).join(', ');
      return c.json({
        success: false,
        error:
          `No se puede volver este insumo exclusivo de un colegio: lo usan ${usos.length} ` +
          `prenda(s) de otro colegio (${detalle}). Si se hiciera exclusivo, el motor ` +
          `seguiria cobrandolo en esas prendas pero la pantalla dejaria de ofrecerlo, y el ` +
          `dato quedaria vivo e invisible. Primero hay que quitarlo de esas recetas.`,
        usos,
      }, 409);
    }
  }

  // Los dos insumos de la division, tomando lo que llego y cayendo a lo guardado.
  const cantidadXUd = body.cantidadXUd ?? Number(existente.cantidadXUd) ?? 1;
  const costoUdCompra = body.costoUdCompra ?? Number(existente.costoUdCompra) ?? 0;

  // Si el cliente manda costoUnitario explicito se respeta; si no, se deriva.
  const costoUnitario = body.costoUnitario ?? (cantidadXUd > 0 ? costoUdCompra / cantidadXUd : 0);

  const [updatedAccesorio] = await db
    .update(accesorios)
    .set({
      ...body,
      costoUnitario: Math.round(costoUnitario * 10000) / 10000,
    })
    .where(eq(accesorios.id, id))
    .returning();

  return c.json({
    success: true,
    data: updatedAccesorio,
    message: 'Accesorio actualizado exitosamente',
  });
});

// DELETE /api/accesorios/:id - Eliminar accesorio
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');

  const [deletedAccesorio] = await db
    .delete(accesorios)
    .where(eq(accesorios.id, id))
    .returning();

  if (!deletedAccesorio) {
    return c.json({ success: false, error: 'Accesorio no encontrado' }, 404);
  }

  return c.json({
    success: true,
    message: 'Accesorio eliminado exitosamente',
  });
});

export default api;
