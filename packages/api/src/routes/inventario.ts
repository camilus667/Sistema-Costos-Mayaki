/**
 * Inventario — /api/inventario
 *
 * EL COSTO SALE DEL MOTOR, no del cache del Excel ni de una columna guardada.
 *
 * Este endpoint era el SEXTO consumidor de la formula de costeo, y ni la Fase 2 ni sus
 * auditorias lo tocaron. /stock hacia esto:
 *
 *   const costoTotalMatriz = excelData ? (excelData.costoTotal.get(key) || 0) : 0;
 *   const costoUnitarioFinal = costoTotalMatriz > 0 ? costoTotalMatriz : (item.costoUnitario || 0);
 *
 * con key = `${itemNumero}_${tallaCodigo}`. O sea: el costo venia de CAMBRIDGE.xlsx, y
 * si el Excel no conocia ese item —porque la prenda es de un colegio que no tiene hoja
 * en ese workbook— caia en inventario.costo_unitario, que POST /:id/prendas inicializa
 * en 0 y NADA actualiza nunca. Resultado: Costo Unit. y Valor Inv. en cero para toda
 * prenda que no viniera del Excel original.
 *
 * Lo delator es que el PRECIO si aparecia: los dos PUT de la matriz escriben en ese
 * mismo Map, asi que precio y cantidad quedaban cargados y el costo no. Una pantalla
 * mostrando la mitad de un calculo y ningun aviso de la otra mitad.
 *
 * LA LECCION, que vale mas que el arreglo: la Fase 2 declaro "una sola formula" y la
 * reja lo verifico sobre TRES bandas —matriz-consolidada, matriz-prenda y el desglose—
 * cada una con su huella `implementacion: 'unificada'`. Estas dos —este endpoint y
 * /api/dashboard-resumen en server.ts— nunca declararon huella y nunca se compararon.
 * La afirmacion era cierta para lo que se midio y falsa para lo que no se miro. Buscar
 * copias solo en routes/ dejo afuera server.ts, y buscar solo los tres endpoints
 * nombrados dejo afuera este.
 *
 * FASE 6, de paso:
 * - /stock filtraba por colegio en JavaScript DESPUES de traer la tabla entera. Ahora
 *   el alcance lo pone costearLote, que ya sabe filtrar por colegio.
 * - /historial tenia TRES .where() encadenados; en Drizzle el ultimo gana, asi que
 *   filtrar por producto y talla a la vez descartaba el primero. Ahora se componen.
 * - /historial y /resumen no acotaban por colegio: inventario_transaccion no tiene
 *   colegio_id, solo se acota pasando por producto.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { inventarioTransacciones, inventario, productos, tallas } from '../database/schema';
import { desc, eq, and, asc, sql } from 'drizzle-orm';
import XLSX from 'xlsx';
import { costearLote } from '../services/calculo/costeoInputs.service';
import { referenciasDesdeBase } from '../services/referenciaPrendaDb';
import { ordenarPrendasDesdeBase } from '../services/ordenPrendasDb';
import { codigosPosDesdeBase, claveCodigoPos } from '../services/codigoPos';
import { colegios } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';
import {
  construirContextoFiscal,
  resolverPrecios,
  etiquetaModalidad,
} from '../services/modalidadFiscal';

const api = new Hono();

const transaccionSchema = z.object({
  productoId: z.string(),
  tallaId: z.string(),
  anioId: z.string().optional(),
  tipo: z.enum(['entrada', 'salida', 'merma', 'ajuste']),
  cantidad: z.number().int().positive(),
  costoUnitario: z.number().optional(),
  motivo: z.string().optional(),
  documentoReferencia: z.string().optional(),
  realizadoPor: z.string(),
});

/** 'all' y la cadena vacia significan "sin filtrar". */
const alcance = (v?: string) => (v && v !== 'all' ? v : undefined);

/**
 * LAS FILAS DE INVENTARIO, una por prenda+talla. La comparten la pantalla y el Excel.
 *
 * Estaba escrito adentro de `/stock`. Se saco afuera porque el Excel necesita las MISMAS filas
 * con OTRO recorte: la pantalla muestra solo lo que tiene stock, y el Excel tiene que traer todo.
 * Copiarlo era garantizar que un dia el costo del Excel y el de la pantalla dejaran de coincidir,
 * que es exactamente el problema que este archivo ya tuvo con el cache del xlsx.
 *
 * `soloConStock` es la unica diferencia entre los dos usos.
 */
async function construirFilasInventario(c: any, opciones: { soloConStock: boolean }) {
  const db = (c as any).db;
  const colegioId = alcance(c.req.query('colegioId'));
  const { productoId, tallaId } = c.req.query();
  // El COSTO y el PRECIO salen del motor. Es la misma fuente que las matrices, asi que
  // el costo unitario que se ve aca es identico al de Costeo Individual para la misma
  // prenda y talla. Antes podian diferir y nada lo detectaba.
  const { filas, ctx } = await costearLote(db, { colegioId });

  const avisosFiscales: string[] = [];
  const fiscal = construirContextoFiscal(c, ctx, avisosFiscales);

  const costeoPorClave = new Map<
    string,
    { costoUnitario: number; precioVenta: number; precioLista: number; seOfrece: boolean }
  >();
  for (const f of filas) {
    // El precio del inventario tambien depende del modo fiscal. Antes era siempre
    // el de lista, asi que el interruptor no movia esta pantalla.
    const { precioLista, precioVenta } = resolverPrecios(f.meta.precioVentaBs, fiscal);
    costeoPorClave.set(`${f.meta.productoId}_${f.meta.tallaId}`, {
      costoUnitario: Number(f.resultado.costoUnitarioNeto) || 0,
      precioVenta,
      precioLista,
      seOfrece: !!f.meta.seOfrece,
    });
  }

  const cond: any[] = [];
  if (colegioId) cond.push(eq(productos.colegioId, colegioId));
  if (productoId) cond.push(eq(inventario.productoId, productoId));
  if (tallaId) cond.push(eq(inventario.tallaId, tallaId));

  // El join a producto acota por colegio EN SQL. Antes se traia la tabla entera y se
  // filtraba en JavaScript, que da el mismo resultado y trae de mas.
  let query = db
    .select({
      id: inventario.id,
      productoId: inventario.productoId,
      tallaId: inventario.tallaId,
      cantidad: inventario.cantidad,
      costoUnitarioRegistrado: inventario.costoUnitario,
      colegioId: productos.colegioId,
      itemNumero: productos.itemNumero,
      producto: productos.descripcion,
      // `orden` es el nombre que pide `PrendaOrdenable`. `ordenProducto` se conserva porque
      // la respuesta ya lo exponia.
      orden: productos.orden,
      ordenProducto: productos.orden,
      talla: tallas.codigo,
      tallaNombre: tallas.nombre,
      tallaOrden: tallas.orden,
    })
    .from(inventario)
    .innerJoin(productos, eq(inventario.productoId, productos.id))
    .leftJoin(tallas, eq(inventario.tallaId, tallas.id));

  if (cond.length > 0) query = query.where(and(...cond));

  // EL ORDEN DE LAS PRENDAS SALE DEL COMPARADOR COMPARTIDO, no de este `orderBy`.
  //
  // Con `orden, item_numero` esta pantalla ordenaba MAL, y de la misma forma que ya ordenaba mal
  // /api/dashboard-resumen: `producto.orden` se numera POR COLEGIO, asi que la unica prenda de
  // Internacional SM tiene `orden = 1` igual que la primera de Cambridge, empatan, y el desempate
  // por item la mete entre la 1 y la 2 de Cambridge. Medido en el Excel de conciliacion antes de
  // arreglarlo: CAM-01, ISM-01, CAM-02, CAM-03...
  //
  // El `orderBy` se queda SOLO para la talla: ese sí es el orden bueno —el que define el
  // arrastrar y soltar de Configuracion— y el comparador de prendas no lo toca. `sort` es estable,
  // asi que las filas de una misma prenda conservan el orden de talla que trae la consulta.
  const filasSinOrdenar = await query.orderBy(asc(tallas.orden));
  const filasInv = await ordenarPrendasDesdeBase(db, filasSinOrdenar as any, 'defecto', {
    agruparPorColegio: !colegioId,
  });

  // EL CODIGO DEL POS de cada prenda+talla, que es lo que Inventario Real muestra en su primera
  // columna. Es la unica pantalla donde el codigo cabe en una columna sin mentir: aca una fila ES
  // una prenda con su talla, y el codigo identifica exactamente esa combinacion. En una matriz
  // donde la fila es una prenda y las columnas son tallas, el codigo va en la celda.
  const codigosPos = await codigosPosDesdeBase(db);

  const data = filasInv
    .filter((i: any) => (opciones.soloConStock ? Number(i.cantidad) > 0 : true))
    .map((i: any) => {
      const costeo = costeoPorClave.get(`${i.productoId}_${i.tallaId}`);
      const costoUnitario = costeo ? costeo.costoUnitario : 0;
      const cantidad = Number(i.cantidad) || 0;

      return {
        id: i.id,
        productoId: i.productoId,
        tallaId: i.tallaId,
        colegioId: i.colegioId,
        itemNumero: i.itemNumero,
        // null cuando esa combinacion todavia no tiene codigo: la pantalla muestra un guion en vez
        // de inventar uno. Los codigos entran con la importacion del POS.
        codigoPos: codigosPos.get(claveCodigoPos(i.productoId, i.tallaId)) ?? null,
        producto: i.producto || 'Producto',
        talla: i.talla || 'N/A',
        tallaOrden: i.tallaOrden ?? 99,
        tallaNombre: i.tallaNombre || 'Talla',
        cantidad,
        costoUnitario: Math.round(costoUnitario * 100) / 100,
        precioVenta: Math.round((costeo ? costeo.precioVenta : 0) * 100) / 100,
        precioLista: Math.round((costeo ? costeo.precioLista : 0) * 100) / 100,
        valorTotalStock: Math.round(cantidad * costoUnitario * 100) / 100,
        // Se expone aparte y NO se mezcla con el de arriba. inventario.costo_unitario
        // pretende ser el costo al que se adquirio ese stock —costo historico—, que es
        // un concepto distinto del costo de fabricacion de hoy. Hoy vale 0 en todas las
        // filas porque nada lo mantiene. Mezclarlos con un `||` era lo que hacia que un
        // costo faltante se viera igual que un costo de cero.
        costoUnitarioRegistrado: Number(i.costoUnitarioRegistrado) || 0,
        // Si el motor no tiene esta combinacion, la fila lo DICE en vez de mostrar 0.
        sinCosteo: !costeo,
      };
    });

  const sinCosteo = data.filter((d: any) => d.sinCosteo).length;
  return { db, data, fiscal, avisosFiscales, sinCosteo };
}

// GET /api/inventario/stock - Muestra SOLO los artículos con stock físico > 0
api.get('/stock', async (c) => {
  const { data, fiscal, avisosFiscales, sinCosteo } =
    await construirFilasInventario(c, { soloConStock: true });

  return c.json({
    success: true,
    data,
    // Huella, como las tres bandas de la reja de paridad. Si esta pantalla vuelve a
    // leer de otro lado, este campo lo delata.
    fuenteCosto: 'motor-de-costeo',
    modalidad: fiscal.modalidad,
    modalidadEtiqueta: etiquetaModalidad(fiscal.modalidad),
    descuentoSinFacturaPct: parseFloat((fiscal.descuentoFraccion * 100).toFixed(2)),
    avisos: [
      ...avisosFiscales,
      ...(sinCosteo > 0
        ? [`${sinCosteo} fila(s) de inventario sin costeo del motor: revisar que la prenda tenga tela, peso y mano de obra cargados.`]
        : []),
    ],
  });
});

/**
 * GET /api/inventario/exportar - el Excel para CONCILIAR contra el POS.
 *
 * POR QUE NO ALCANZA LA PANTALLA. La pantalla muestra solo lo que tiene stock: son 215 de 448
 * combinaciones prenda+talla en la base de hoy. Las 233 que faltan son justo las mas sospechosas
 * para una conciliacion —una prenda que en el POS existe y aca no tiene ni stock ni codigo es
 * invisible en pantalla—. Este export trae LAS 448.
 *
 * LA COLUMNA `Estado` ES EL PUNTO. Un volcado de filas no concilia nada: hay que poder ordenar por
 * "que le falta a esta fila". `Estado` dice SIN CODIGO / SIN PRECIO / SIN COSTEO / OK, asi que
 * ordenando por esa columna salen agrupadas las filas que hay que atender. Sin ella habria que
 * mirar 448 filas a ojo para encontrar las que no tienen codigo.
 *
 * El codigo del POS va como TEXTO a proposito. `001-cc` no es un numero, y un codigo que fuera
 * todo digitos —el POS los tiene— Excel lo convertiria a numero y le comeria los ceros de la
 * izquierda: `007` quedaria `7` y el BUSCARV contra el export del POS no encontraria nada.
 *
 * Se escribe con `type: 'array'`: devuelve bytes sin depender de `Buffer`, que en Workers no
 * existe. Es el mismo criterio con el que la importacion lee el archivo.
 */
api.get('/exportar', async (c) => {
  const { db, data, fiscal } = await construirFilasInventario(c, { soloConStock: false });

  const [refs, cols] = await Promise.all([
    referenciasDesdeBase(db),
    db.select({ id: colegios.id, nombre: colegios.nombre }).from(colegios),
  ]);
  const nombreColegio = new Map<string, string>(
    cols.map((x: any) => [String(x.id), String(x.nombre)])
  );

  const encabezado = [
    'Cod. POS', 'Prod', 'Colegio', 'Prenda', 'Talla',
    'Precio Venta (Bs.)', 'Stock', 'Costo Unit. (Bs.)', 'Valor Inv. (Bs.)', 'Estado',
  ];

  const cuerpo = data.map((f: any) => {
    // El orden importa: lo que falta primero es lo que hay que resolver primero. Sin codigo no se
    // puede emparejar con el POS, y sin precio no se puede comparar el precio.
    const estado = !f.codigoPos ? 'SIN CODIGO'
      : Number(f.precioVenta) <= 0 ? 'SIN PRECIO'
      : f.sinCosteo ? 'SIN COSTEO'
      : 'OK';
    return [
      f.codigoPos ?? '',
      refs.get(String(f.productoId)) ?? '',
      nombreColegio.get(String(f.colegioId)) ?? '',
      f.producto,
      f.talla,
      f.precioVenta,
      f.cantidad,
      f.costoUnitario,
      f.valorTotalStock,
      estado,
    ];
  });

  const hoja = XLSX.utils.aoa_to_sheet([encabezado, ...cuerpo]);

  // El codigo, forzado a texto celda por celda. `aoa_to_sheet` tipa por el valor de JavaScript,
  // asi que una cadena de digitos ya entra como texto; esto lo fija tambien para el dia que el
  // codigo llegue como numero desde el POS.
  for (let fila = 1; fila <= cuerpo.length; fila++) {
    const ref = XLSX.utils.encode_cell({ r: fila, c: 0 });
    const celda = (hoja as any)[ref];
    if (celda && celda.v !== '') { celda.t = 's'; celda.v = String(celda.v); }
  }
  (hoja as any)['!cols'] = [
    { wch: 12 }, { wch: 9 }, { wch: 20 }, { wch: 34 }, { wch: 7 },
    { wch: 17 }, { wch: 7 }, { wch: 17 }, { wch: 17 }, { wch: 12 },
  ];
  (hoja as any)['!autofilter'] = { ref: XLSX.utils.encode_range(
    { s: { r: 0, c: 0 }, e: { r: cuerpo.length, c: encabezado.length - 1 } }
  ) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, 'Inventario');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const hoy = new Date().toISOString().slice(0, 10);
  const alcanceNombre = alcance(c.req.query('colegioId'))
    ? (nombreColegio.get(String(alcance(c.req.query('colegioId')))) ?? 'colegio')
    : 'todos';
  const archivo = `inventario-${alcanceNombre}-${fiscal.modalidad}-${hoy}.xlsx`
    .replace(/[^\w.-]+/g, '-');

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${archivo}"`,
      'Cache-Control': 'no-store',
    },
  });
});

// GET /api/inventario/historial
api.get('/historial', async (c) => {
  const db = (c as any).db;
  const { productoId, tallaId, usuarioId } = c.req.query();
  const colegioId = alcance(c.req.query('colegioId'));

  // Antes eran TRES .where() encadenados. En Drizzle el ultimo reemplaza a los
  // anteriores, asi que pedir historial de una prenda Y una talla descartaba la prenda.
  const cond: any[] = [];
  if (colegioId) cond.push(eq(productos.colegioId, colegioId));
  if (productoId) cond.push(eq(inventarioTransacciones.productoId, productoId));
  if (tallaId) cond.push(eq(inventarioTransacciones.tallaId, tallaId));
  if (usuarioId) cond.push(eq(inventarioTransacciones.realizadoPor, usuarioId));

  let query = db
    .select({
      id: inventarioTransacciones.id,
      productoId: inventarioTransacciones.productoId,
      tallaId: inventarioTransacciones.tallaId,
      colegioId: productos.colegioId,
      itemNumero: productos.itemNumero,
      producto: productos.descripcion,
      tipo: inventarioTransacciones.tipo,
      cantidad: inventarioTransacciones.cantidad,
      costoUnitario: inventarioTransacciones.costoUnitario,
      motivo: inventarioTransacciones.motivo,
      documentoReferencia: inventarioTransacciones.documentoReferencia,
      realizadoPor: inventarioTransacciones.realizadoPor,
      creadoEn: inventarioTransacciones.creadoEn,
    })
    .from(inventarioTransacciones)
    .innerJoin(productos, eq(inventarioTransacciones.productoId, productos.id));

  if (cond.length > 0) query = query.where(and(...cond));

  const historial = await query.orderBy(desc(inventarioTransacciones.creadoEn)).limit(100);

  return c.json({ success: true, data: historial });
});

// GET /api/inventario/resumen
api.get('/resumen', async (c) => {
  const db = (c as any).db;
  const colegioId = alcance(c.req.query('colegioId'));

  // inventario_transaccion no tiene colegio_id: se acota pasando por producto.
  let query = db
    .select({
      tipo: inventarioTransacciones.tipo,
      totalCantidad: sql<number>`SUM(${inventarioTransacciones.cantidad})`,
      totalTransacciones: sql<number>`COUNT(*)`,
    })
    .from(inventarioTransacciones)
    .innerJoin(productos, eq(inventarioTransacciones.productoId, productos.id));

  if (colegioId) query = query.where(eq(productos.colegioId, colegioId));

  const resumen = await query.groupBy(inventarioTransacciones.tipo);

  return c.json({ success: true, data: resumen, alcance: colegioId || 'TODA LA EMPRESA' });
});

// POST /api/inventario/entrada
api.post('/entrada', zValidator('json', transaccionSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  const [prenda] = await db.select().from(productos).where(eq(productos.id, body.productoId)).limit(1);
  if (!prenda) {
    return c.json({ success: false, error: `No existe la prenda ${body.productoId}.` }, 404);
  }

  const nuevaTransaccion = await db.insert(inventarioTransacciones).values({
    productoId: body.productoId,
    tallaId: body.tallaId,
    anioId: body.anioId || null,
    tipo: 'entrada',
    cantidad: body.cantidad,
    costoUnitario: body.costoUnitario || 0,
    motivo: body.motivo,
    documentoReferencia: body.documentoReferencia,
    realizadoPor: body.realizadoPor,
  }).returning();

  // El select traia SOLO { cantidad } y despues se leia existencia.costoUnitario, que
  // era undefined siempre. El `|| 0` de atras hacia el resto: toda entrada sin costo
  // explicito pisaba el costo previo con cero, y el fallback que pretendia conservarlo
  // no podia funcionar nunca.
  const [existencia] = await db
    .select()
    .from(inventario)
    .where(and(
      eq(inventario.productoId, body.productoId),
      eq(inventario.tallaId, body.tallaId)
    ))
    .limit(1);

  if (existencia) {
    await db
      .update(inventario)
      .set({
        cantidad: sql`${inventario.cantidad} + ${body.cantidad}`,
        costoUnitario: body.costoUnitario ?? existencia.costoUnitario ?? 0,
      })
      .where(and(
        eq(inventario.productoId, body.productoId),
        eq(inventario.tallaId, body.tallaId)
      ));
  } else {
    await db.insert(inventario).values({
      productoId: body.productoId,
      tallaId: body.tallaId,
      anioId: body.anioId || null,
      cantidad: body.cantidad,
      costoUnitario: body.costoUnitario || 0,
    });
  }

  saveDbToDisk();

  return c.json({
    success: true,
    data: nuevaTransaccion[0],
    message: 'Entrada registrada exitosamente',
  }, 201);
});

// POST /api/inventario/salida
api.post('/salida', zValidator('json', transaccionSchema), async (c) => {
  const db = (c as any).db;
  const body = c.req.valid('json');

  const [prenda] = await db.select().from(productos).where(eq(productos.id, body.productoId)).limit(1);
  if (!prenda) {
    return c.json({ success: false, error: `No existe la prenda ${body.productoId}.` }, 404);
  }

  const [existencia] = await db
    .select({ cantidad: inventario.cantidad })
    .from(inventario)
    .where(and(
      eq(inventario.productoId, body.productoId),
      eq(inventario.tallaId, body.tallaId)
    ))
    .limit(1);

  if (!existencia || existencia.cantidad < body.cantidad) {
    return c.json({
      success: false,
      message: `Stock insuficiente. Disponible: ${existencia?.cantidad || 0}`,
    }, 400);
  }

  const nuevaTransaccion = await db.insert(inventarioTransacciones).values({
    productoId: body.productoId,
    tallaId: body.tallaId,
    anioId: body.anioId || null,
    tipo: 'salida',
    cantidad: body.cantidad,
    costoUnitario: body.costoUnitario || 0,
    motivo: body.motivo,
    documentoReferencia: body.documentoReferencia,
    realizadoPor: body.realizadoPor,
  }).returning();

  await db
    .update(inventario)
    .set({
      cantidad: sql`${inventario.cantidad} - ${body.cantidad}`,
    })
    .where(and(
      eq(inventario.productoId, body.productoId),
      eq(inventario.tallaId, body.tallaId)
    ));

  saveDbToDisk();

  return c.json({
    success: true,
    data: nuevaTransaccion[0],
    message: 'Salida registrada exitosamente',
  }, 201);
});

export default api;
