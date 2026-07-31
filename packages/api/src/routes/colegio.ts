import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import { colegios, productos, telas, tallas, colegioTallas } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';
import { crearPrendaConTallas } from '../services/crearPrenda.service';
// El criterio de orden vive en UNA sola casa. Antes estaba escrito en diez consultas con
// tres versiones distintas, y ninguna mencionaba el colegio: por eso el item de un colegio
// aparecia entre los de otro.
import { ordenarPrendasDesdeBase } from '../services/ordenPrendasDb';

const api = new Hono();

// Esquema de creación de colegio
const crearColegioSchema = z.object({
  nombre: z.string().min(1).max(255),
  direccion: z.string().max(500).optional(),
  nit: z.string().max(50).optional(),
  telefono: z.string().max(50).optional(),
  /**
   * Abreviatura del colegio: la que forma `CC-01` en la columna `Prod` y la que empareja el
   * sufijo del codigo del POS al importar.
   *
   * Tope de 12 caracteres: la mas larga que usa el POS es `IntlSM` (6). Doce da margen sin que
   * alguien pegue un nombre entero y rompa el ancho de la columna, que convive con 16 columnas
   * de tallas.
   */
  abreviatura: z.string().max(12).optional(),
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
/**
 * Deja la abreviatura en MAYUSCULAS, o en null si viene vacia.
 *
 * Se hace en el servidor y no solo en la pantalla porque es lo que empareja el sufijo del codigo
 * del POS: `cc` y `CC` tienen que ser el mismo colegio, y guardar los dos crearia dos abreviaturas
 * para uno solo. Y una cadena vacia no es una abreviatura: es la ausencia de una, y `null` es como
 * se dice eso —si se guardara `''`, la columna diria que hay un valor cuando no lo hay—.
 */
function normalizarAbrev<T extends { abreviatura?: unknown }>(cuerpo: T): T {
  if (!('abreviatura' in (cuerpo as any))) return cuerpo;
  const v = String((cuerpo as any).abreviatura ?? '').trim().toUpperCase();
  return { ...cuerpo, abreviatura: v || null } as T;
}

api.post('/', zValidator('json', crearColegioSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  const [newColegio] = await db.insert(colegios).values(normalizarAbrev(body)).returning();

  return c.json({
    success: true,
    data: newColegio,
    message: 'Colegio creado exitosamente',
  }, 201);
});

// PUT /api/colegios/:id - Actualizar colegio
/**
 * PUT /api/colegios/orden — en que posicion va cada colegio cuando se ven varios juntos.
 *
 * Lo escribe el arrastrar y soltar de Perfil & Colegios. El criterio completo vive en
 * services/ordenPrendas.ts: aca solo se guardan los numeros.
 *
 * VA ANTES DE /:id A PROPOSITO, Y ESTO NO ES TEORICO: la escribi despues y lo comprobe.
 * Hono resuelve en orden de registro, asi que con `PUT /:id` primero la palabra "orden" se
 * toma como un id de colegio y el pedido termina en el handler de actualizar datos. Medido
 * antes de mover la ruta:
 *
 *   PUT /api/colegios/orden  ->  Internal Server Error
 *
 * Y el 500 fue suerte: el validador de esquema rechazo el cuerpo. Con un cuerpo que hubiera
 * pasado la validacion, el resultado habria sido un 404 —o un 200 que no hizo nada— y el
 * arrastre se veria guardado sin haberse guardado.
 *
 * Cuerpo: { orden: ["idColegio1", "idColegio2", ...] } en el orden deseado.
 */
api.put('/orden', async (c) => {
  const db = (c as any).db;

  let body: any = {};
  try { body = await c.req.json(); } catch (e) {}

  const ids = Array.isArray(body?.orden) ? body.orden.map((x: any) => String(x)) : null;
  if (!ids || ids.length === 0) {
    return c.json({
      success: false,
      error: 'Falta el cuerpo { "orden": ["id1", "id2", ...] } con los ids de colegio en el orden deseado.',
    }, 400);
  }

  // SIN DUPLICADOS. Dos veces el mismo id significa que la lista que mando la pantalla esta
  // mal armada, y guardarla dejaria un colegio con dos posiciones y otro sin ninguna. Es mejor
  // rechazarlo que resolverlo por nuestra cuenta.
  const repetidos = ids.filter((x: string, i: number) => ids.indexOf(x) !== i);
  if (repetidos.length) {
    return c.json({
      success: false,
      error: `La lista trae ids repetidos: ${[...new Set(repetidos)].join(', ')}. ` +
        `Cada colegio puede aparecer una sola vez.`,
    }, 400);
  }

  const existentes = await db.select({ id: colegios.id, nombre: colegios.nombre }).from(colegios);
  const vivos = new Map<string, string>(existentes.map((x: any) => [String(x.id), String(x.nombre)]));

  const desconocidos = ids.filter((x: string) => !vivos.has(x));
  if (desconocidos.length) {
    return c.json({
      success: false,
      error: `Estos ids no corresponden a ningun colegio: ${desconocidos.join(', ')}. No se guardo nada.`,
    }, 404);
  }

  // FALTANTES: se aceptan, y se ponen DESPUES. Pasa de verdad cuando alguien crea un colegio
  // en otra pestaña mientras esta pantalla ya tenia su lista cargada. Rechazar el guardado
  // obligaria a recargar y perder el arrastre; ponerlos al final conserva el trabajo y deja el
  // resultado predecible. Se REPORTAN para que la pantalla pueda decirlo.
  const faltantes = [...vivos.keys()].filter((x) => !ids.includes(x));
  const secuencia = [...ids, ...faltantes];

  try {
    for (let i = 0; i < secuencia.length; i++) {
      await db.update(colegios).set({ orden: i + 1 }).where(eq(colegios.id, secuencia[i]));
    }
  } catch (e: any) {
    return c.json({ success: false, error: 'No se pudo guardar el orden: ' + (e?.message || String(e)) }, 500);
  }

  const avisos: string[] = [];
  if (faltantes.length) {
    avisos.push(
      `${faltantes.length} colegio(s) no venian en la lista y se pusieron al final: ` +
      `${faltantes.map((x) => vivos.get(x)).join(', ')}. Probablemente se crearon despues de ` +
      `abrir esta pantalla.`
    );
  }

  return c.json({
    success: true,
    orden: secuencia.map((id, i) => ({ id, nombre: vivos.get(id), orden: i + 1 })),
    avisos,
  });
});

api.put('/:id', zValidator('json', crearColegioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = c.req.valid('json');

  const [updatedColegio] = await db
    .update(colegios)
    .set(normalizarAbrev(body))
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

  // Un colegio solo: el agrupado no cambia nada, pero se usa la misma funcion para que el
  // orden interno —`orden` con `item_numero` de respaldo— sea el mismo en todas las pantallas.
  const prods = await ordenarPrendasDesdeBase(db,
    await db.select().from(productos).where(eq(productos.colegioId, id)).orderBy(asc(productos.orden), asc(productos.itemNumero)));

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

  // EL `activo` QUE DEVUELVE ESTA PANTALLA ES EL DE ESTE COLEGIO, no el global.
  //
  // Antes devolvia `talla.activo`, que es un flag global sobre una fila compartida.
  // La pantalla de Configuracion de un colegio mostraba entonces el estado de TODOS,
  // y al guardar lo escribia para todos. Mostrar el estado equivocado es la mitad del
  // defecto: la otra mitad era que el PUT ignoraba el `:id`.
  //
  // SIN FILA = ACTIVA, para que una base sin configurar se vea igual que antes.
  const overrides = new Map<string, any>();
  try {
    const filas = await db.select().from(colegioTallas).where(eq(colegioTallas.colegioId, id));
    for (const f of filas) overrides.set(String(f.tallaId), f);
  } catch (e) {}

  const tallasDelColegio = taList.map((t: any) => {
    const o = overrides.get(String(t.id));
    return {
      ...t,
      // `activo` pasa a ser el efectivo para ESTE colegio: el global manda como
      // puerta de arriba, y el del colegio decide dentro.
      activo: t.activo === false ? false : (o ? o.activo !== false : true),
      activoGlobal: t.activo !== false,
      orden: o && o.orden != null ? o.orden : t.orden,
      configuradaParaEsteColegio: !!o,
    };
  });

  return c.json({
    success: true,
    colegio: col,
    productos: prods,
    telas: tList,
    tallas: tallasDelColegio,
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
      if (p.modoCosteo !== undefined) updateData.modoCosteo = p.modoCosteo;
      if (p.activo !== undefined) updateData.activo = p.activo;

      await db.update(productos).set(updateData).where(eq(productos.id, p.id));
    }
    saveDbToDisk();
  }

  return c.json({ success: true, message: 'Configuración de prendas guardada exitosamente' });
});

// POST /api/colegios/:id/prendas - Dar de alta nueva prenda
//
// LA LOGICA ESTA EN crearPrenda.service.ts, por la misma razon que el resto de este
// refactor: habia DOS endpoints que crean prendas —este y POST /api/productos— y hacian
// cosas distintas. Este validaba que el colegio existiera y creaba las filas por talla; el
// otro no hacia ninguna de las dos, asi que podia crear una prenda huerfana y sin tallas.
// Arreglar uno dejaba el otro atras, y asi es como el agujero de la huerfana sobrevivio a
// su propia correccion en eb7293d.
//
// Lo que hacia este bloque a mano vive ahora en el servicio, con dos mejoras: el item sale
// del MAXIMO + 1 y no de contar filas —contar repite un item si hubo borrados, y un item
// repetido dentro del colegio hace que el lookup por item devuelva 409— y la merma sale de
// configuracion_sistema en vez del 8 escrito a mano, que era el cuarto lugar con ese
// literal.
api.post('/:id/prendas', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.param('id');
  const body = await c.req.json();

  const r = await crearPrendaConTallas(db, {
    colegioId,
    itemNumero: body.itemNumero,
    orden: body.orden,
    descripcion: body.descripcion,
    telaId: body.telaId ?? null,
    factorComplejidad: body.factorComplejidad,
    modoCosteo: body.modoCosteo,
  });

  if (!r.ok) {
    return c.json({ success: false, error: r.error }, r.estado as any);
  }

  saveDbToDisk();

  return c.json({
    success: true,
    data: r.prenda,
    tallas: r.tallas,
    avisos: r.avisos,
    message: 'Prenda creada exitosamente',
  });
});

// PUT /api/colegios/:id/tallas-config - Activar/desactivar tallas DE ESTE colegio
//
// ESTE ENDPOINT RECIBIA EL COLEGIO EN LA RUTA Y NO LO USABA:
//
//   await db.update(tallas).set({ activo }).where(eq(tallas.id, t.id));
//
// Escribia `talla.activo`, que es un flag global, sobre filas que tienen colegio_id
// NULO y por lo tanto son COMPARTIDAS. Resultado: apagar una talla "en Cambridge" la
// apagaba tambien en Internacional SM. La URL prometia un alcance que la consulta no
// tenia, que es el mismo defecto que el proyecto ya documento en export.ts —"tres
// parametros declarados y ninguno aplicado, un endpoint que acepta un filtro y lo
// ignora, que es peor que uno que no lo acepta"—.
//
// Ahora escribe en colegio_talla, una fila por par colegio-talla. SIN FILA = ACTIVA,
// asi que solo se escribe lo que el usuario decidio y una base sin configurar sigue
// comportandose como antes.
api.put('/:id/tallas-config', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.param('id');
  const body = await c.req.json();

  // El colegio TIENE que existir. Sin esta guarda, una fila de colegio_talla con un
  // colegio inexistente seria invisible para toda pantalla que filtre y quedaria
  // apagando tallas de nadie. Es la misma huerfana que el proyecto ya limpio a mano.
  const [col] = await db.select().from(colegios).where(eq(colegios.id, colegioId)).limit(1);
  if (!col) {
    return c.json(
      {
        success: false,
        error:
          `No existe el colegio "${colegioId}". La configuracion de tallas es POR ` +
          `colegio: sin colegio real no hay a quien aplicarla.`,
      },
      404
    );
  }

  if (!Array.isArray(body.tallas)) {
    return c.json({ success: false, error: 'Se espera un arreglo "tallas".' }, 400);
  }

  const tallasValidas = new Set(
    (await db.select({ id: tallas.id }).from(tallas)).map((t: any) => String(t.id))
  );

  let escritas = 0;
  const ignoradas: string[] = [];

  for (const t of body.tallas) {
    if (!t.id) continue;
    if (!tallasValidas.has(String(t.id))) {
      ignoradas.push(String(t.id));
      continue;
    }

    const existentes = await db
      .select()
      .from(colegioTallas)
      .where(and(eq(colegioTallas.colegioId, colegioId), eq(colegioTallas.tallaId, String(t.id))))
      .limit(1);

    const datos: any = {};
    if (t.activo !== undefined) datos.activo = t.activo !== false;
    if (t.orden !== undefined) datos.orden = t.orden;
    if (Object.keys(datos).length === 0) continue;

    if (existentes.length > 0) {
      await db.update(colegioTallas).set(datos).where(eq(colegioTallas.id, existentes[0].id));
    } else {
      await db.insert(colegioTallas).values({
        colegioId,
        tallaId: String(t.id),
        activo: datos.activo !== undefined ? datos.activo : true,
        orden: datos.orden !== undefined ? datos.orden : null,
      });
    }
    escritas++;
  }

  saveDbToDisk();

  // Se devuelve CUANTAS filas se escribieron, no solo un mensaje de exito. Un
  // "guardado exitosamente" sobre cero escrituras es exactamente el patron que hizo
  // invisible la mitad de los defectos de este sistema.
  return c.json({
    success: true,
    message: `Configuración de tallas guardada para ${col.nombre}.`,
    colegio: col.nombre,
    tallasConfiguradas: escritas,
    avisos: ignoradas.length > 0
      ? [`${ignoradas.length} talla(s) del pedido no existen y se ignoraron.`]
      : [],
  });
});

export default api;
