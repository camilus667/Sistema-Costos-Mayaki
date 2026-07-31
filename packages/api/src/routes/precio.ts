/**
 * Precios de venta — /api/precios
 *
 * FASE 6. NINGUNO de los siete endpoints acotaba por colegio, y no por descuido: las tablas
 * precio_venta e historico_precio NO TIENEN colegio_id. Son tablas derivadas, y la unica
 * forma de acotarlas es pasando por producto, que si lo tiene.
 *
 * Con un colegio cargado eso era invisible. Con dos, GET /api/precios sin parametros
 * devuelve los 297 precios de TODOS los colegios, y /exportar/costos hace un volcado
 * completo —que es el peor lugar posible para una fuga, porque el resultado SALE del
 * sistema: se manda por mail, se abre en Excel, se comparte.
 *
 * EL JOIN TIENE UN FILO, y es la razon de los avisos de abajo. Para acotar por colegio hace
 * falta innerJoin a producto. Pero un innerJoin DESCARTA en silencio toda fila cuyo
 * producto no exista, y hasta este commit DELETE /api/productos/:id borraba la prenda y
 * dejaba vivos sus precios. O sea que el arreglo del aislamiento podia esconder el daño del
 * otro bug. Por eso cada listado compara el total con y sin join, y si difieren lo DICE en
 * vez de devolver menos filas sin explicacion. Un numero mas chico y silencioso es la clase
 * de cosa que hizo invisibles la mitad de los defectos de este sistema.
 *
 * ALCANCE: colegioId es OPCIONAL y sin el se ve toda la empresa, por la regla que fijo el
 * usuario para esta fase. Lo que cambia es que ahora se PUEDE acotar, y que la respuesta
 * declara su alcance.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { preciosVenta, historicoPrecios, productos, tallas } from '../database/schema';
import { desc, eq, and, isNull, sql, type SQL } from 'drizzle-orm';
import { saveDbToDisk } from '../database/sqljs';
import {
  normalizarCodigoPos,
  buscarDuenoDeCodigo,
} from '../services/codigoPos';

const api = new Hono();

const crearPrecioSchema = z.object({
  productoId: z.string(),
  tallaId: z.string(),
  precioBs: z.number().positive(),
  vigenteDesde: z.string().optional(),
});

/**
 * El codigo del POS de UNA combinacion prenda+talla.
 *
 * Se identifica por prenda y talla, NO por el id del precio, y a proposito: asi se piensa el dato
 * —"el codigo de la camisa en la talla 8"— y asi viene el export del POS. Quien corrige a mano no
 * tiene por que saber que el codigo vive en la tabla de precios.
 *
 * `codigoPos` acepta `null` porque BORRAR un codigo es una operacion legitima: un codigo mal
 * emparejado tiene que poder sacarse, no solo reemplazarse.
 */
const codigoPosSchema = z.object({
  productoId: z.string().min(1),
  tallaId: z.string().min(1),
  codigoPos: z.string().nullable().optional(),
});

/**
 * NOTA SOBRE EL ORDEN DE LAS RUTAS
 *
 * Las rutas de un solo segmento como /historico van ANTES de /:id. Hono resuelve
 * en orden de registro, asi que con /:id declarado primero, una peticion a
 * /api/precios/historico entraba por /:id con id = "historico" y respondia
 * 404 "Precio no encontrado". El endpoint de historico era inalcanzable.
 *
 * NOTA SOBRE LOS FILTROS
 *
 * Las condiciones se acumulan en un arreglo y se aplican con un solo and(...).
 * Antes se hacia `query = query.where(...)` una vez por filtro, y en Drizzle cada
 * llamada a .where() REEMPLAZA la anterior en lugar de combinarse: filtrar por
 * producto y talla a la vez solo aplicaba el ultimo, devolviendo los precios de
 * esa talla para TODOS los productos.
 *
 * Y el filtro de vigencia usaba eq(vigenteHasta, null), que en SQL se traduce a
 * `vigente_hasta = NULL`. Comparar con NULL usando = nunca es verdadero, ni
 * cuando el valor es nulo, asi que ?vigente=true devolvia cero filas siempre.
 * Lo correcto es isNull().
 */

const alcanceDe = (colegioId?: string) =>
  colegioId && colegioId !== 'all'
    ? { tipo: 'colegio' as const, colegioId }
    : { tipo: 'empresa' as const, descripcion: 'TODA LA EMPRESA' };

const esAcotado = (colegioId?: string) => !!colegioId && colegioId !== 'all';

/** Cuenta las filas de una tabla derivada cuyo producto ya no existe. */
async function contarHuerfanas(db: any, tabla: any): Promise<number> {
  const [total] = await db.select({ n: sql<number>`count(*)` }).from(tabla);
  const [conPadre] = await db
    .select({ n: sql<number>`count(*)` })
    .from(tabla)
    .innerJoin(productos, eq(tabla.productoId, productos.id));
  return (Number(total?.n) || 0) - (Number(conPadre?.n) || 0);
}

function avisoHuerfanas(n: number, tabla: string): string[] {
  if (n <= 0) return [];
  return [
    `${n} fila(s) de ${tabla} apuntan a una prenda que ya no existe y NO aparecen en este ` +
    `listado, porque acotar por colegio exige pasar por producto. No es un filtro: es daño ` +
    `previo. Se detectan con: pnpm tsx src/scripts/diagnosticoColegios.ts`,
  ];
}

// ---------------------------------------------------------------------------------------
// GET /api/precios/historico  — antes de /:id, ver nota de arriba
// ---------------------------------------------------------------------------------------
api.get('/historico', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId, colegioId } = c.req.query();

  const condiciones: SQL[] = [];
  if (productoId) condiciones.push(eq(historicoPrecios.productoId, productoId));
  if (tallaId) condiciones.push(eq(historicoPrecios.tallaId, tallaId));
  if (esAcotado(colegioId)) condiciones.push(eq(productos.colegioId, colegioId));

  // historico_precio no tiene colegio_id: se acota pasando por producto.
  const historial = await db
    .select({
      id: historicoPrecios.id,
      productoId: historicoPrecios.productoId,
      tallaId: historicoPrecios.tallaId,
      precioAnterior: historicoPrecios.precioAnterior,
      precioNuevo: historicoPrecios.precioNuevo,
      cambioPor: historicoPrecios.cambioPor,
      cambiadoPor: historicoPrecios.cambiadoPor,
      cambiadoEn: historicoPrecios.cambiadoEn,
      colegioId: productos.colegioId,
      itemNumero: productos.itemNumero,
      descripcion: productos.descripcion,
    })
    .from(historicoPrecios)
    .innerJoin(productos, eq(historicoPrecios.productoId, productos.id))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(historicoPrecios.cambiadoEn))
    .limit(100);

  const avisos: string[] = [];

  // UNA LISTA VACIA ACA NO SIGNIFICA "no hubo cambios de precio". Significa que NADA escribe
  // esta tabla. Lo verifique de las dos formas: buscando insert/update sobre historicoPrecios
  // en todo el codigo —no hay ninguno— y contando filas en la base real, que tiene 0.
  //
  // Y hay una razon estructural, no un olvido: historico_precio.cambiado_por es NOT NULL y
  // referencia usuario.id, asi que registrar un cambio exige saber QUIEN lo hizo. El control
  // por usuario esta deliberadamente diferido —"lo vemos cuando haya usuarios de verdad"— y
  // atribuir cada cambio al unico usuario que existe seria inventar un dato de auditoria.
  //
  // Se dice en vez de devolver [] en silencio. Un cero que grita es mejor que un cero que
  // parece un dato, y esa distincion es la que hizo visible la mitad de los bugs de hoy.
  const [tot] = await db.select({ n: sql<number>`count(*)` }).from(historicoPrecios);
  if ((Number(tot?.n) || 0) === 0) {
    avisos.push(
      'La tabla historico_precio esta VACIA y ningun endpoint la escribe todavia, asi que ' +
      'esta lista vacia no significa que no hubo cambios de precio: significa que no se ' +
      'estan registrando. Registrarlos exige un usuario al que atribuir el cambio ' +
      '(historico_precio.cambiado_por es NOT NULL), y el manejo de usuarios esta diferido.'
    );
  } else {
    avisos.push(...avisoHuerfanas(await contarHuerfanas(db, historicoPrecios), 'historico_precio'));
  }

  return c.json({ success: true, data: historial, alcance: alcanceDe(colegioId), avisos });
});

// ---------------------------------------------------------------------------------------
// GET /api/precios/exportar/costos
// ---------------------------------------------------------------------------------------
api.get('/exportar/costos', async (c) => {
  const db = (c as any).db;
  const { productoId, colegioId } = c.req.query();

  const condiciones: SQL[] = [];
  if (productoId) condiciones.push(eq(preciosVenta.productoId, productoId));
  if (esAcotado(colegioId)) condiciones.push(eq(productos.colegioId, colegioId));

  // Una exportacion sin el numero de item y la descripcion obliga a cruzarla a mano contra
  // otra planilla. El join hace falta igual para acotar por colegio, asi que se aprovecha.
  const precios = await db
    .select({
      precioId: preciosVenta.id,
      productoId: preciosVenta.productoId,
      tallaId: preciosVenta.tallaId,
      precioBs: preciosVenta.precioBs,
      vigenteDesde: preciosVenta.vigenteDesde,
      vigenteHasta: preciosVenta.vigenteHasta,
      colegioId: productos.colegioId,
      itemNumero: productos.itemNumero,
      descripcion: productos.descripcion,
    })
    .from(preciosVenta)
    .innerJoin(productos, eq(preciosVenta.productoId, productos.id))
    .where(condiciones.length ? and(...condiciones) : undefined);

  return c.json({
    success: true,
    data: precios,
    alcance: alcanceDe(colegioId),
    avisos: avisoHuerfanas(await contarHuerfanas(db, preciosVenta), 'precio_venta'),
    message: 'Exportación de costos exitosa',
  });
});

// ---------------------------------------------------------------------------------------
// GET /api/precios
// ---------------------------------------------------------------------------------------
api.get('/', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId, vigente, colegioId } = c.req.query();

  const condiciones: SQL[] = [];
  if (productoId) condiciones.push(eq(preciosVenta.productoId, productoId));
  if (tallaId) condiciones.push(eq(preciosVenta.tallaId, tallaId));
  // Vigente = sin fecha de cierre. isNull, no eq(..., null).
  if (vigente === 'true') condiciones.push(isNull(preciosVenta.vigenteHasta));
  if (esAcotado(colegioId)) condiciones.push(eq(productos.colegioId, colegioId));

  const precios = await db
    .select({
      id: preciosVenta.id,
      productoId: preciosVenta.productoId,
      tallaId: preciosVenta.tallaId,
      precioBs: preciosVenta.precioBs,
      vigenteDesde: preciosVenta.vigenteDesde,
      vigenteHasta: preciosVenta.vigenteHasta,
      // El codigo del POS viaja con el precio, que es donde vive. Sin el en el listado no
      // hay forma de comprobar que una importacion lo escribio, ni de que la pantalla lo
      // muestre despues.
      codigoExterno: preciosVenta.codigoExterno,
      colegioId: productos.colegioId,
      itemNumero: productos.itemNumero,
    })
    .from(preciosVenta)
    .innerJoin(productos, eq(preciosVenta.productoId, productos.id))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(preciosVenta.vigenteDesde));

  return c.json({
    success: true,
    data: precios,
    alcance: alcanceDe(colegioId),
    avisos: avisoHuerfanas(await contarHuerfanas(db, preciosVenta), 'precio_venta'),
  });
});

// ---------------------------------------------------------------------------------------
// GET /api/precios/:id
// ---------------------------------------------------------------------------------------
api.get('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const colegioId = c.req.query('colegioId');

  const [precio] = await db
    .select({
      id: preciosVenta.id,
      productoId: preciosVenta.productoId,
      tallaId: preciosVenta.tallaId,
      precioBs: preciosVenta.precioBs,
      vigenteDesde: preciosVenta.vigenteDesde,
      vigenteHasta: preciosVenta.vigenteHasta,
      colegioId: productos.colegioId,
    })
    .from(preciosVenta)
    .innerJoin(productos, eq(preciosVenta.productoId, productos.id))
    .where(eq(preciosVenta.id, id))
    .limit(1);

  if (!precio) {
    return c.json({ success: false, message: 'Precio no encontrado' }, 404);
  }

  if (esAcotado(colegioId) && precio.colegioId !== colegioId) {
    return c.json({
      success: false,
      message: `El precio ${id} no pertenece a una prenda del colegio ${colegioId}.`,
    }, 404);
  }

  return c.json({ success: true, data: precio });
});

// ---------------------------------------------------------------------------------------
// POST /api/precios
// ---------------------------------------------------------------------------------------
api.post('/', zValidator('json', crearPrecioSchema), async (c) => {
  const db = (c as any).db;
  const body: any = c.req.valid('json');

  // SE VALIDA QUE LA PRENDA Y LA TALLA EXISTAN. Sin esto un productoId cualquiera crea un
  // precio HUERFANO: la fila entra, ninguna pantalla la muestra porque todas pasan por
  // producto, y los totales sin filtro la suman. Es el mismo defecto que la prenda con
  // colegio_id = "all", una tabla mas abajo.
  //
  // Y de nuevo: las foreign keys de SQLite estan APAGADAS por defecto. El `.references()`
  // del schema documenta la intencion pero no la hace cumplir en tiempo de ejecucion.
  const [prenda] = await db
    .select({ id: productos.id, colegioId: productos.colegioId, descripcion: productos.descripcion })
    .from(productos)
    .where(eq(productos.id, body.productoId))
    .limit(1);

  if (!prenda) {
    return c.json({
      success: false,
      error:
        `No existe la prenda "${body.productoId}". El precio quedaria huerfano: invisible en ` +
        `toda pantalla que pase por producto y sumado en los totales sin filtro.`,
    }, 404);
  }

  const [talla] = await db.select({ id: tallas.id }).from(tallas).where(eq(tallas.id, body.tallaId)).limit(1);
  if (!talla) {
    return c.json({
      success: false,
      error: `No existe la talla "${body.tallaId}".`,
    }, 404);
  }

  // Cierra la vigencia del precio anterior de esa prenda y talla.
  // Se limita a los que estan abiertos (vigente_hasta nulo): sin esa condicion
  // se reescribia la fecha de cierre de precios ya cerrados, corrompiendo el
  // historico de vigencias.
  const cerrados = await db
    .update(preciosVenta)
    .set({ vigenteHasta: new Date().toISOString() })
    .where(and(
      eq(preciosVenta.productoId, body.productoId),
      eq(preciosVenta.tallaId, body.tallaId),
      isNull(preciosVenta.vigenteHasta)
    ))
    .returning();

  const [newPrecio] = await db.insert(preciosVenta).values({
    productoId: body.productoId,
    tallaId: body.tallaId,
    precioBs: body.precioBs,
    vigenteDesde: body.vigenteDesde || new Date().toISOString(),
  }).returning();

  saveDbToDisk();

  const avisos: string[] = [];
  if (cerrados.length > 0) {
    // Se dice cuando un precio reemplaza a otro, y de cuanto a cuanto. Reemplazar un precio
    // sin decirlo es como se pierde la nocion de que un numero cambio.
    const previo = cerrados[cerrados.length - 1];
    avisos.push(
      `Se cerro la vigencia del precio anterior de esta prenda y talla: ${previo.precioBs} Bs ` +
      `-> ${body.precioBs} Bs. El cambio NO queda registrado en historico_precio, porque esa ` +
      `tabla exige un usuario al que atribuirlo y el manejo de usuarios esta diferido.`
    );
  }

  return c.json({
    success: true,
    data: newPrecio,
    preciosCerrados: cerrados.length,
    avisos,
    message: 'Precio creado exitosamente',
  }, 201);
});

// ---------------------------------------------------------------------------------------
// PUT /api/precios/:id
// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------
// PUT /api/precios/codigo-pos
//
// VA ANTES DE /:id. Hono resuelve por orden de registro, asi que con `/:id` declarado primero
// esta peticion entraria por ahi con id = "codigo-pos" y responderia 404 "Precio no encontrado".
// Es la misma trampa que hizo inalcanzable /api/precios/historico, y la que ya dio un Internal
// Server Error en PUT /api/colegios/orden.
//
// POR QUE EXISTE. Hasta aca el codigo del POS lo escribia UNICAMENTE el importador. No habia
// ninguna forma de corregir uno a mano, y el emparejamiento manual es justamente lo que el usuario
// dijo que iba a hacer. Validar la unicidad sin poder escribir el codigo era validar algo que
// nadie podia hacer.
// ---------------------------------------------------------------------------------------
api.put('/codigo-pos', zValidator('json', codigoPosSchema), async (c) => {
  const db = (c as any).db;
  const body: any = c.req.valid('json');
  const codigo = normalizarCodigoPos(body.codigoPos);

  // --- la prenda y la talla, para poder hablar de ellas por nombre en los mensajes
  const [prenda] = await db
    .select({ id: productos.id, descripcion: productos.descripcion, colegioId: productos.colegioId })
    .from(productos)
    .where(eq(productos.id, body.productoId))
    .limit(1);
  if (!prenda) {
    return c.json({ success: false, error: `No existe la prenda "${body.productoId}".` }, 404);
  }
  const [talla] = await db
    .select({ id: tallas.id, codigo: tallas.codigo })
    .from(tallas)
    .where(eq(tallas.id, body.tallaId))
    .limit(1);
  if (!talla) {
    return c.json({ success: false, error: `No existe la talla "${body.tallaId}".` }, 404);
  }

  // --- la fila donde el codigo vive
  //
  // EL CODIGO VIVE CON EL PRECIO, y no todas las combinaciones tienen precio: medido, 297 de las
  // 448 filas de inventario lo tienen. En las otras 151 el codigo NO TIENE DONDE VIVIR.
  //
  // Se NIEGA en vez de crear la fila de precio para alojarlo. `precio_venta` es la fuente de verdad
  // de si la prenda se ofrece en esa talla —regla del 29-jul-2026—, asi que una fila inventada la
  // volveria "ofrecida" y le prorratearia costos fijos a una combinacion que no existe. Guardar un
  // codigo no puede tener el efecto secundario de poner una prenda en venta.
  const filasCombo = await db
    .select({
      id: preciosVenta.id,
      codigoExterno: preciosVenta.codigoExterno,
      vigenteDesde: preciosVenta.vigenteDesde,
      vigenteHasta: preciosVenta.vigenteHasta,
    })
    .from(preciosVenta)
    .where(and(eq(preciosVenta.productoId, body.productoId), eq(preciosVenta.tallaId, body.tallaId)));

  if (filasCombo.length === 0) {
    return c.json({
      success: false,
      error:
        `"${prenda.descripcion}" no tiene precio cargado en la talla ${talla.codigo}, y el codigo ` +
        `del POS se guarda junto al precio. Cargale el precio de venta a esa talla y despues ` +
        `volve a poner el codigo. No se crea la fila de precio sola: eso pondria la prenda en ` +
        `venta en una talla que hoy no se ofrece.`,
    }, 409);
  }

  // La VIGENTE es la que manda; si no hubiera, la mas reciente. Hoy no hay historicos —0 filas con
  // vigente_hasta— pero elegir explicitamente evita que el dia que los haya se escriba el codigo en
  // un precio ya cerrado.
  const objetivo =
    filasCombo.find((f: any) => f.vigenteHasta === null || f.vigenteHasta === undefined) ||
    [...filasCombo].sort((a: any, b: any) =>
      String(b.vigenteDesde ?? '').localeCompare(String(a.vigenteDesde ?? '')))[0];

  // --- el duplicado, ANTES de escribir
  //
  // La base ya tiene un indice unico parcial y cumple. Pero su error es `UNIQUE constraint failed:
  // precio_venta.codigo_externo`: dice que hay choque y no dice contra que. Con 766 combinaciones,
  // "esta repetido" sin decir donde manda a buscar a mano. Aca se responde con la prenda y la talla
  // que ya lo tienen.
  if (codigo) {
    const conCodigo = await db
      .select({
        precioId: preciosVenta.id,
        productoId: preciosVenta.productoId,
        tallaId: preciosVenta.tallaId,
        codigo: preciosVenta.codigoExterno,
      })
      .from(preciosVenta)
      .where(sql`${preciosVenta.codigoExterno} IS NOT NULL`);

    const dueno = buscarDuenoDeCodigo(
      codigo,
      conCodigo.map((f: any) => ({
        productoId: String(f.productoId),
        tallaId: String(f.tallaId),
        precioId: String(f.precioId),
        codigo: String(f.codigo),
      })),
      { productoId: body.productoId, tallaId: body.tallaId },
    );

    if (dueno) {
      const [otraPrenda] = await db
        .select({ descripcion: productos.descripcion })
        .from(productos)
        .where(eq(productos.id, dueno.productoId))
        .limit(1);
      const [otraTalla] = await db
        .select({ codigo: tallas.codigo })
        .from(tallas)
        .where(eq(tallas.id, dueno.tallaId))
        .limit(1);

      return c.json({
        success: false,
        error:
          `El codigo "${codigo}" ya lo tiene "${otraPrenda?.descripcion ?? dueno.productoId}" en la ` +
          `talla ${otraTalla?.codigo ?? dueno.tallaId}. En el POS un codigo identifica UNA prenda en ` +
          `UNA talla, asi que repetirlo haria que dos filas del sistema reclamen el mismo producto ` +
          `del punto de venta. Sacalo de ahi primero si el que corresponde es este.`,
        conflicto: {
          productoId: dueno.productoId,
          tallaId: dueno.tallaId,
          prenda: otraPrenda?.descripcion ?? null,
          talla: otraTalla?.codigo ?? null,
        },
      }, 409);
    }
  }

  const anterior = objetivo.codigoExterno ?? null;
  await db
    .update(preciosVenta)
    .set({ codigoExterno: codigo })
    .where(eq(preciosVenta.id, objetivo.id));
  saveDbToDisk();

  return c.json({
    success: true,
    data: {
      precioId: objetivo.id,
      productoId: body.productoId,
      tallaId: body.tallaId,
      codigoPos: codigo,
      anterior,
    },
    // Se dice si el valor cambio o no. Guardar sin cambio responde exito igual —no es un error—
    // pero la pantalla no tiene que anunciar un cambio que no ocurrio.
    cambio: anterior !== codigo,
    message: codigo
      ? `Codigo "${codigo}" guardado en "${prenda.descripcion}" talla ${talla.codigo}.`
      : `Codigo borrado de "${prenda.descripcion}" talla ${talla.codigo}.`,
  });
});

api.put('/:id', zValidator('json', crearPrecioSchema.partial()), async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body: any = c.req.valid('json');
  const colegioId = c.req.query('colegioId');

  const [existing] = await db
    .select({
      id: preciosVenta.id,
      precioBs: preciosVenta.precioBs,
      colegioId: productos.colegioId,
    })
    .from(preciosVenta)
    .innerJoin(productos, eq(preciosVenta.productoId, productos.id))
    .where(eq(preciosVenta.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ success: false, message: 'Precio no encontrado' }, 404);
  }

  if (esAcotado(colegioId) && existing.colegioId !== colegioId) {
    return c.json({
      success: false,
      message: `El precio ${id} no pertenece a una prenda del colegio ${colegioId}, asi que no se puede modificar desde ahi.`,
    }, 404);
  }

  const datosActualizados: any = {};

  if (body.precioBs !== undefined) datosActualizados.precioBs = body.precioBs;
  if (body.vigenteDesde !== undefined) datosActualizados.vigenteDesde = body.vigenteDesde;

  // Un PUT sin ningun campo reconocido dejaria la fila igual y responderia OK. Es la
  // familia de defecto que aparecio cinco veces hoy: responder exito sobre cero trabajo.
  if (Object.keys(datosActualizados).length === 0) {
    return c.json({
      success: false,
      message: 'No se mando ningun campo modificable. Los aceptados son precioBs y vigenteDesde.',
    }, 400);
  }

  const [updatedPrecio] = await db
    .update(preciosVenta)
    .set(datosActualizados)
    .where(eq(preciosVenta.id, id))
    .returning();

  saveDbToDisk();

  const avisos: string[] = [];
  if (body.precioBs !== undefined && body.precioBs !== existing.precioBs) {
    avisos.push(
      `Precio modificado de ${existing.precioBs} a ${body.precioBs} Bs. El cambio NO queda ` +
      `registrado en historico_precio: esa tabla exige un usuario al que atribuirlo y el ` +
      `manejo de usuarios esta diferido.`
    );
  }

  return c.json({ success: true, data: updatedPrecio, avisos, message: 'Precio actualizado exitosamente' });
});

// ---------------------------------------------------------------------------------------
// DELETE /api/precios/:id
// ---------------------------------------------------------------------------------------
api.delete('/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const colegioId = c.req.query('colegioId');

  // ANTES: `await db.delete(...)` y devolver success SIEMPRE, incluso borrando cero filas.
  // Un id inexistente respondia "Precio eliminado exitosamente". Es la misma familia que el
  // PUT de la matriz de accesorios que respondia OK sin tocar la base.
  const [existing] = await db
    .select({ id: preciosVenta.id, colegioId: productos.colegioId })
    .from(preciosVenta)
    .innerJoin(productos, eq(preciosVenta.productoId, productos.id))
    .where(eq(preciosVenta.id, id))
    .limit(1);

  if (!existing) {
    return c.json({ success: false, message: 'Precio no encontrado' }, 404);
  }

  if (esAcotado(colegioId) && existing.colegioId !== colegioId) {
    return c.json({
      success: false,
      message: `El precio ${id} no pertenece a una prenda del colegio ${colegioId}, asi que no se puede borrar desde ahi.`,
    }, 404);
  }

  await db.delete(preciosVenta).where(eq(preciosVenta.id, id));

  // Faltaba: sin esto el borrado se perdia al reiniciar, porque con sql.js las
  // escrituras viven en memoria hasta que se exporta la base.
  saveDbToDisk();

  return c.json({ success: true, message: 'Precio eliminado exitosamente' });
});

export default api;
