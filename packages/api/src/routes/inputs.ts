import { Hono } from 'hono';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import { productos, tallas, pesoMateriaPrima, manoObra, telas, accesorios, detalleAccesorio, costosIndirectos, preciosAdquisicion } from '../database/schema';
import { saveDbToDisk } from '../database/sqljs';
import { getSystemConfig, setSystemConfig } from '../services/configService';
import { costoUnitarioDeInsumo, costoUsoDeInsumo } from '../services/costoInsumo';
import { cargarContextoCosteo, ensamblarInputs } from '../services/calculo/costeoInputs.service';
import { calcularCostoTotal } from '../services/calculo/costoTotal.service';
import { resolverPrendaPorItem, nuevoIdHex } from '../services/resolucion.service';
import {
  construirContextoFiscal,
  resolverPrecios,
  etiquetaModalidad,
} from '../services/modalidadFiscal';
import { bandaManoObra, esDeBanda } from '../services/tallas';
// El criterio de orden vive en UNA sola casa: services/ordenPrendas.ts. Los cinco sitios de
// este archivo lo escribian a mano, dos de una forma y tres de otra.
import { ordenarPrendasDesdeBase } from '../services/ordenPrendasDb';

/** Redondeo de presentacion. El motor ya redondea sus propias salidas. */
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000;

const api = new Hono();

// GET /api/inputs/configuracion - Obtener configuración general del sistema desde DB
api.get('/configuracion', async (c) => {
  const db = (c as any).db;
  const config = await getSystemConfig(db);
  return c.json({ success: true, data: config });
});

// PUT /api/inputs/configuracion - Actualizar configuración general del sistema en DB
api.put('/configuracion', async (c) => {
  const db = (c as any).db;

  // Sin este try/catch, un cuerpo malformado daba "Internal Server Error" crudo,
  // sin decir que estaba mal. Lo destapo un curl con las comillas comidas por
  // PowerShell: el 500 no distinguia entre "tu JSON esta roto" y "el servidor
  // fallo", que son dos problemas con dos soluciones distintas.
  let body: any;
  try {
    body = await c.req.json();
  } catch (e) {
    return c.json(
      {
        success: false,
        error:
          'El cuerpo de la peticion tiene que ser JSON valido. En PowerShell conviene ' +
          'Invoke-RestMethod con -Body entre comillas simples, porque curl con comillas ' +
          'escapadas se rompe.',
      },
      400
    );
  }
  const { tasaIva, volumenMensualProduccion, mermaPorcentajeEstandar, tallaDefecto } = body;

  if (tasaIva !== undefined) await setSystemConfig(db, 'tasa_iva', String(tasaIva));
  if (volumenMensualProduccion !== undefined) await setSystemConfig(db, 'volumen_mensual_produccion', String(volumenMensualProduccion));
  if (mermaPorcentajeEstandar !== undefined) await setSystemConfig(db, 'merma_porcentaje_estandar', String(mermaPorcentajeEstandar));
  if (tallaDefecto !== undefined) await setSystemConfig(db, 'talla_defecto', String(tallaDefecto));

  // FASE 3. El check de impuestos y el descuento sin factura.
  if (body.impuestosActivos !== undefined) {
    await setSystemConfig(db, 'impuestos_activos', body.impuestosActivos ? 'true' : 'false');
  }
  if (body.descuentoSinFactura !== undefined) {
    // SE NORMALIZA AL GUARDAR, no solo al leer. El campo acepta tanto 10 como
    // 0.10 porque las dos formas son razonables de tipear, pero en la base queda
    // SIEMPRE una fraccion.
    //
    // Guardar el numero crudo era un agujero real: `1 - 10` da -9, o sea un precio
    // de venta NEGATIVO nueve veces el original, a un solo tecleo de distancia. Y
    // no habria saltado a la vista, porque hoy la fila `descuento_sin_factura` ni
    // siquiera existe en configuracion_sistema —corre el default 0,1 de
    // configService— asi que el defecto estaba latente esperando a que alguien
    // abriera esta pantalla por primera vez.
    //
    // La normalizacion al leer (descuentoSinFacturaComoFraccion) se mantiene igual:
    // es la que protege a las bases que ya tengan el valor mal cargado.
    const crudo = Number(body.descuentoSinFactura);
    const fraccion = Number.isFinite(crudo) && crudo > 1 ? crudo / 100 : crudo;
    if (!Number.isFinite(fraccion) || fraccion < 0 || fraccion > 0.95) {
      return c.json(
        {
          success: false,
          error:
            `Descuento sin factura invalido (${body.descuentoSinFactura}). ` +
            'Se admite 0 a 0.95 como fraccion, o 0 a 95 como porcentaje.',
        },
        400
      );
    }
    await setSystemConfig(db, 'descuento_sin_factura', String(fraccion));
  }

  // FASE 4. El denominador anual de los indirectos.
  if (body.volumenAnualProduccion !== undefined) {
    await setSystemConfig(db, 'volumen_anual_produccion', String(body.volumenAnualProduccion));
  }
  if (body.porcentajeAbsorcionIndirectos !== undefined) {
    await setSystemConfig(
      db,
      'porcentaje_absorcion_indirectos',
      String(body.porcentajeAbsorcionIndirectos)
    );
  }

  // Se devuelve la configuracion resultante, no solo un mensaje de exito. Asi la
  // respuesta misma confirma que el valor quedo guardado, en vez de obligar a un
  // GET aparte para verificarlo.
  return c.json({
    success: true,
    message: 'Configuración general del sistema actualizada exitosamente',
    data: await getSystemConfig(db),
  });
});

let inputsExcelCache: any = null;

/**
 * Lector del Excel de inputs. Se EXPORTA para que los scripts de comparacion lean
 * el archivo exactamente igual que los endpoints. Si un script reimplementara el
 * parseo, una diferencia contra la base podria ser un bug del parser y no un dato
 * distinto, y la comparacion no serviria para decidir nada.
 */

// GET /api/inputs/tabla-auxiliar-accesorios - Tabla Auxiliar completa de Definición y Costos de Accesorios (Hoja Acc)
api.get('/tabla-auxiliar-accesorios', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let accQuery = db.select().from(accesorios);
  // FASE 5. NULL significa compartido, asi que un colegio ve SUS accesorios mas
  // los de la empresa. Sin el isNull, filtrar por colegio habria escondido los 27
  // insumos genericos y la pantalla habria perdido 27 filas.
  if (colegioId && colegioId !== 'all') {
    accQuery = accQuery.where(
      or(eq(accesorios.colegioId, colegioId), isNull(accesorios.colegioId))
    );
  }
  const list = await accQuery;

  // SE FUE LA PLANILLA. Estos nueve campos salian de la tabla auxiliar de la hoja `Acc` de
  // CAMBRIDGE.xlsx, que el servidor parseaba en CADA pedido, y el Excel le ganaba a la base:
  // `auxMap.get(codigo) || {respaldo de la base}`. Cuatro de los nueve no existian como columna,
  // asi que el respaldo los inventaba —`unidadesPorPrenda` siempre 1, `costoUsoPrendas` igual al
  // unitario—, y por eso 15 de 38 insumos habrian cambiado de valor al sacar el archivo: hasta
  // 500x de diferencia en Entretela Corbata.
  //
  // Los cuatro INPUTS se mudaron a la base con `mudarInsumosDesdeExcel.ts`. Los dos DERIVADOS se
  // calculan aca, que es donde corresponde: un costo derivado guardado se desactualiza en
  // silencio el dia que cambia el precio de compra.
  //
  // MEDIDO antes de mudar: el `costo_unitario` de la base coincide con el de la planilla en las
  // 38 filas, con cero diferencias. Por eso calcular el costo de uso reproduce exactamente los
  // numeros que el sistema venia usando.

  const data = list.map((a: any, idx: number) => {
    const codeNum = parseInt(a.codigo || '') || (idx + 1);

    const entradas = {
      costoUdCompra: a.costoUdCompra,
      cantidadXud: a.cantidadXUd,
      costoUnitarioGuardado: a.costoUnitario,
      unidadesPorPrenda: a.unidadesPorPrenda,
    };

    return {
      id: a.id,
      colegioId: a.colegioId,
      codigo: codeNum,
      descripcion: a.descripcion,
      unidadCompra: a.unidadCompra || 'unidad',
      cantidadXUd: a.cantidadXUd ?? 1,
      costoUdCompra: a.costoUdCompra ?? 0,
      // Los dos derivados. `costoUnitario` se calcula cuando las entradas alcanzan y se cae al
      // guardado cuando no —pasa en 8 de 38 filas, donde `cantidadXUd` no es un numero—.
      costoUnitario: costoUnitarioDeInsumo(entradas),
      costoUsoPrendas: costoUsoDeInsumo(entradas),
      ojales: a.ojales ?? null,
      unidadesPorPrenda: a.unidadesPorPrenda ?? 1,
      unidadesPorMetro: a.unidadesPorMetro ?? null,
      costoCm2: a.costoCm2 ?? null,
    };
  });

  data.sort((a: any, b: any) => {
    const numA = typeof a.codigo === 'number' ? a.codigo : parseInt(String(a.codigo || ''), 10);
    const numB = typeof b.codigo === 'number' ? b.codigo : parseInt(String(b.codigo || ''), 10);
    const validA = !isNaN(numA);
    const validB = !isNaN(numB);
    if (validA && validB) return numA - numB;
    if (validA) return -1;
    if (validB) return 1;
    return String(a.descripcion || '').localeCompare(String(b.descripcion || ''));
  });

  return c.json({ success: true, data });
});

// PUT /api/inputs/tabla-auxiliar-accesorios/:id - Actualizar datos de un accesorio en Tabla Auxiliar
api.put('/tabla-auxiliar-accesorios/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();

  const {
    descripcion,
    unidadCompra,
    cantidadXUd,
    costoUdCompra,
    costoUnitario,
    costoUsoPrendas,
    ojales,
    unidadesPorPrenda,
    unidadesPorMetro,
    costoCm2
  } = body;

  try {
    const setPayload: any = {
      unidadCompra: unidadCompra || 'unidad',
      cantidadXUd: Number(cantidadXUd) || 1,
      costoUdCompra: Number(costoUdCompra) || 0,
      costoUnitario: Number(costoUnitario) || 0,
    };
    if (descripcion && typeof descripcion === 'string') {
      setPayload.descripcion = descripcion.trim();
    }

    await db.update(accesorios)
      .set(setPayload)
      .where(eq(accesorios.id, id));

    // Aca vivia un bloque que copiaba los valores recien guardados al cache del Excel en memoria.
    // Nadie leia ese cache: era una escritura sin lector. Se fue con la planilla.

    return c.json({ success: true, message: 'Accesorio actualizado exitosamente' });
  } catch (e) {
    console.error('Error al actualizar accesorio en Tabla Auxiliar:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// GET /api/inputs/peso-mat-prima - Matriz exacta de pesos (Con Merma + Peso Exacto)
api.get('/peso-mat-prima', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let prodQuery = db.select().from(productos);
  if (colegioId && colegioId !== 'all') prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  const allProds = await ordenarPrendasDesdeBase(db, await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero)));
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  let pesos: any[] = [];
  try {
    pesos = await db.select().from(pesoMateriaPrima);
  } catch (e) {}

  const pesoMap = new Map<string, any>();
  pesos.forEach((p: any) => pesoMap.set(`${p.productoId}_${p.tallaId}`, p));

  // SE FUE LA PLANILLA. Aca la base YA GANABA: los pesos del Excel entraban solo cuando no habia
  // fila en `peso_mat_prima` (`dbRec ? dbRec.pesoGramos : topMap.get(key)`).
  //
  // MEDIDO: `peso_mat_prima` tiene 448 filas = 28 prendas x 16 tallas, cobertura COMPLETA. `dbRec`
  // existe siempre, asi que los mapas del Excel no se consultaban ni una vez. Y la MERMA de la
  // planilla era 8, el mismo valor que ya estaba escrito aca como defecto.
  //
  // El 8 queda como defecto de arranque y lo sobreescribe cualquier fila que traiga su merma,
  // igual que antes.
  let globalMermaPct = 8;

  // Detect DB merma global if any record has it
  pesos.forEach((p: any) => {
    if (p.mermaPorcentaje && p.mermaPorcentaje > 0) {
      globalMermaPct = p.mermaPorcentaje;
    }
  });

  const data = allProds.map((prod: any) => {
    const rowObj: any = {
      productoId: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      tallas: {}
    };

    allTallas.forEach((talla: any) => {
      const dbRec = pesoMap.get(`${prod.id}_${talla.id}`);
      const key = `${prod.itemNumero}_${talla.codigo}`;

      const recMerma = dbRec?.mermaPorcentaje || globalMermaPct;
      // let, no const: mas abajo se deriva el peso exacto a partir del peso con
      // merma cuando falta. Estaba declarado const, asi que esa rama lanzaba
      // TypeError en runtime. Se dispara con conMerma > 0 y exacto === 0, que es
      // el caso de 162 de las 432 filas de peso_mat_prima.
      // Sin respaldo del Excel: si no hay fila en la base el peso es 0, y eso es lo correcto —una
      // prenda sin peso cargado tiene que verse sin peso, no con el de una planilla vieja—. El
      // marcado de prendas sin costo (`diagnosticoCosto.ts`) es el que avisa de ese caso.
      let exacto = dbRec ? dbRec.pesoExactoGramos : 0;
      let conMerma = dbRec ? dbRec.pesoGramos : 0;

      if (exacto > 0 && (!conMerma || conMerma === 0)) {
        conMerma = parseFloat((exacto * (1 + recMerma / 100)).toFixed(2));
      } else if (conMerma > 0 && (!exacto || exacto === 0)) {
        exacto = parseFloat((conMerma / (1 + recMerma / 100)).toFixed(2));
      }

      rowObj.tallas[talla.codigo] = {
        pesoConMerma: parseFloat((conMerma || 0).toFixed(2)),
        pesoExacto: parseFloat((exacto || 0).toFixed(2)),
        mermaPorcentaje: recMerma
      };
    });

    return rowObj;
  });

  return c.json({
    success: true,
    mermaGlobalPct: globalMermaPct,
    tallas: allTallas.map((t: any) => ({ id: t.id, codigo: t.codigo })),
    data
  });
});

// GET /api/inputs/precios-adquisicion - Prendas semiterminadas/adquiridas y sus precios por talla
api.get('/precios-adquisicion', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let prodQuery = db.select().from(productos).where(eq(productos.modoCosteo, 'adquirido'));
  if (colegioId && colegioId !== 'all') {
    prodQuery = db.select().from(productos).where(and(eq(productos.modoCosteo, 'adquirido'), eq(productos.colegioId, colegioId)));
  }
  const allProds = await ordenarPrendasDesdeBase(db, await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero)));
  let tallasQuery = db.select().from(tallas);
  if (colegioId && colegioId !== 'all') {
    tallasQuery = db.select().from(tallas).where(or(eq(tallas.colegioId, colegioId), isNull(tallas.colegioId)));
  }
  const allTallas = await tallasQuery.orderBy(asc(tallas.orden));

  let precios: any[] = [];
  try {
    precios = await db.select().from(preciosAdquisicion).where(isNull(preciosAdquisicion.vigenteHasta));
  } catch (e) {}

  const preciosMap = new Map<string, number>();
  precios.forEach((p: any) => preciosMap.set(`${p.productoId}_${p.tallaId}`, p.precioBs));

  const data = allProds.map((prod: any) => {
    const rowObj: any = {
      productoId: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      colegioId: prod.colegioId,
      tallas: {}
    };

    allTallas.forEach((t: any) => {
      const precio = preciosMap.get(`${prod.id}_${t.id}`) ?? 0;
      rowObj.tallas[t.codigo] = {
        tallaId: t.id,
        precioBs: precio
      };
    });

    return rowObj;
  });

  return c.json({
    success: true,
    tallas: allTallas.map((t: any) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre })),
    data
  });
});

// PUT /api/inputs/precios-adquisicion - Actualiza o inserta un precio de adquisición por producto y talla
api.put('/precios-adquisicion', async (c) => {
  const db = (c as any).db;
  try {
    const body = await c.req.json();
    const { productoId, tallaId, precioBs } = body;

    if (!productoId || !tallaId || precioBs === undefined) {
      return c.json({ success: false, error: 'Faltan parámetros requeridos (productoId, tallaId, precioBs)' }, 400);
    }

    const numPrecio = parseFloat(precioBs) || 0;

    // Desactivar vigencia previa
    await db.update(preciosAdquisicion)
      .set({ vigenteHasta: new Date().toISOString() })
      .where(and(eq(preciosAdquisicion.productoId, productoId), eq(preciosAdquisicion.tallaId, tallaId), isNull(preciosAdquisicion.vigenteHasta)));

    // Insertar nueva vigencia
    await db.insert(preciosAdquisicion).values({
      productoId,
      tallaId,
      precioBs: numPrecio,
      conFactura: false
    });

    saveDbToDisk();
    return c.json({ success: true, message: 'Precio de adquisición actualizado exitosamente' });
  } catch (e) {
    console.error('Error al actualizar precio de adquisición:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// GET /api/inputs/accesorios-matriz - Matriz completa de los 38 accesorios por prenda
api.get('/accesorios-matriz', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');
  const filtrar = !!(colegioId && colegioId !== 'all');

  let prodQuery = db.select().from(productos);
  if (filtrar) prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  const allProds = await ordenarPrendasDesdeBase(db, await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero)));

  // Las COLUMNAS salen del catalogo de accesorios, no de los encabezados del Excel.
  //
  // Esto es el corazon del cambio. Antes era:
  //
  //   const headerList = accHeaders.length > 0 ? accHeaders : dbAccs.map(...)
  //
  // o sea que los encabezados del Excel ganaban y la base era solo el respaldo. Como
  // las cantidades tambien salian del Excel y los costos de la base, las dos fuentes
  // se unian POR NOMBRE, y un nombre que no cruzaba daba un cero silencioso: la celda
  // mostraba 0,00 y nadie avisaba.
  //
  // Pasaba de verdad: la columna del Excel se llama "Ojal Grande" y el accesorio de la
  // base "Ojal grande", con g minuscula. En los items 16, 17 y 18 la pantalla mostraba
  // 0,00 mientras el motor cobraba 1,60 Bs (2 unidades x 0,80), porque el motor lee
  // detalle_acc por id y nunca dependio del nombre.
  //
  // Ahora los nombres salen de un solo lado, asi que no hay dos grafias que puedan
  // discrepar. El bug no queda arreglado: queda inexpresable.
  let accQuery = db.select().from(accesorios);
  if (filtrar) {
    accQuery = accQuery.where(or(eq(accesorios.colegioId, colegioId), isNull(accesorios.colegioId)));
  }
  const dbAccs = await accQuery;
  dbAccs.sort((a: any, b: any) => {
    const numA = parseInt(String(a.codigo || ''), 10);
    const numB = parseInt(String(b.codigo || ''), 10);
    const validA = !isNaN(numA);
    const validB = !isNaN(numB);
    if (validA && validB) return numA - numB;
    if (validA) return -1;
    if (validB) return 1;
    return String(a.descripcion || '').localeCompare(String(b.descripcion || ''));
  });

  const headerList: string[] = dbAccs.map((a: any) => String(a.descripcion).trim());

  // Dos accesorios con la misma descripcion colapsarian en una sola columna y el
  // segundo pisaria al primero en silencio. Se avisa en vez de dejarlo pasar.
  const avisos: string[] = [];
  const vistos = new Set<string>();
  for (const h of headerList) {
    if (vistos.has(h)) avisos.push(`Hay mas de un accesorio llamado "${h}". La matriz los muestra como una sola columna.`);
    vistos.add(h);
  }

  const accesoriosInfo = dbAccs.map((a: any) => ({
    nombre: String(a.descripcion).trim(),
    unidadCompra: a.unidadCompra || 'unidad',
    cantidadXUd: Number(a.cantidadXUd) || 1,
    costoUdCompra: Number(a.costoUdCompra) || 0,
    costoUnitarioBs: r4(Number(a.costoUnitario) || 0),
  }));

  // La RECETA sale de detalle_acc, que es la que el motor de costeo usa. Antes salia
  // del Excel, con las ediciones superpuestas desde un Map de modulo que se perdia al
  // reiniciar el proceso: la pantalla y el costeo podian decir cosas distintas y de
  // hecho las decian.
  const lineas = await db
    .select({
      productoId: detalleAccesorio.productoId,
      accesorioId: detalleAccesorio.accesorioId,
      cantidadUso: detalleAccesorio.cantidadUso,
    })
    .from(detalleAccesorio);

  const nombrePorId = new Map<string, string>();
  const costoPorNombre = new Map<string, number>();
  for (const a of dbAccs) {
    const nom = String(a.descripcion).trim();
    nombrePorId.set(a.id, nom);
    costoPorNombre.set(nom, Number(a.costoUnitario) || 0);
  }

  /** productoId -> nombre de accesorio -> cantidad de uso */
  const recetaPorProd = new Map<string, Map<string, number>>();
  for (const l of lineas) {
    // Un accesorio que no esta en dbAccs es de otro colegio: su linea no se muestra.
    const nom = nombrePorId.get(l.accesorioId);
    if (!nom) continue;
    if (!recetaPorProd.has(l.productoId)) recetaPorProd.set(l.productoId, new Map());
    recetaPorProd.get(l.productoId)!.set(nom, Number(l.cantidadUso) || 0);
  }

  const data = allProds.map((prod: any) => {
    const receta = recetaPorProd.get(prod.id) || new Map<string, number>();
    const rowObj: any = {
      productoId: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      totalAccesoriosBs: 0,
      accesorios: {},
      unidades: {},
      costos: {},
    };

    let suma = 0;
    for (const h of headerList) {
      const qty = receta.get(h) || 0;
      const costo = r2(qty * (costoPorNombre.get(h) || 0));
      rowObj.accesorios[h] = costo;
      rowObj.costos[h] = costo;
      rowObj.unidades[h] = qty;
      suma += costo;
    }

    // El total es la suma de las lineas que se muestran, no el total de la columna 41
    // del Excel. Es la decision que el usuario tomo en la Fase 2: "que las lineas
    // sumen, aunque quede 0,03 off".
    rowObj.totalAccesoriosBs = r2(suma);
    return rowObj;
  });

  return c.json({
    success: true,
    accesorios: headerList,
    accesoriosInfo,
    data,
    fuente: 'detalle_acc',
    avisos,
  });
});

// PUT /api/inputs/accesorios-matriz-celda - Cambiar la cantidad de un accesorio
//
// ANTES esto no tocaba la base:
//
//   overriddenCellQtyMap.set(`${itemNumero}_${accesorioNombre}`, Number(cantidad) || 0);
//   return c.json({ success: true });
//
// Un Map de modulo, indexado por nombre, sin `db` en ninguna parte. Cambiar una
// cantidad movia el numero en pantalla, NO cambiaba el costeo, y se perdia al
// reiniciar el proceso. Devolvia success: true siempre, incluso cuando el if de
// adentro no entraba porque faltaba un campo.
//
// Es la misma familia que el precio de venta que no llegaba al disco, un paso mas
// grave: ahi el dato al menos entraba a la base en memoria. Aca nunca entraba, y el
// motor —que lee detalle_acc— no se enteraba nunca de la edicion.
//
// AHORA escribe detalle_acc, que es la tabla que el motor usa. Cantidad cero borra la
// linea en vez de guardar un cero, para no ir acumulando filas sin uso.
api.put('/accesorios-matriz-celda', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json();
  const { itemNumero, accesorioNombre, cantidad, colegioId } = body;

  if (!itemNumero || Number(itemNumero) <= 0 || !accesorioNombre) {
    return c.json({
      success: false,
      error: 'Hacen falta itemNumero (mayor a cero) y accesorioNombre.',
    }, 400);
  }

  const { prenda, estado, error } = await resolverPrendaPorItem(db, Number(itemNumero), colegioId);
  if (!prenda) return c.json({ success: false, error }, estado as any);

  // El accesorio se busca comparando descripciones ya recortadas: la base puede tener
  // espacios al final y un eq() directo los fallaria.
  const nombre = String(accesorioNombre).trim();
  const todos = await db.select().from(accesorios);
  const candidatos = todos.filter((a: any) => String(a.descripcion).trim() === nombre);

  if (candidatos.length === 0) {
    return c.json({ success: false, error: `No existe ningun accesorio llamado "${nombre}".` }, 404);
  }
  if (candidatos.length > 1) {
    return c.json({
      success: false,
      error: `Hay ${candidatos.length} accesorios llamados "${nombre}". Hay que renombrar uno para poder distinguirlos.`,
    }, 409);
  }

  const acc = candidatos[0];

  // Un accesorio exclusivo de otro colegio no se puede asignar. colegio_id nulo es
  // catalogo general de la empresa y lo puede usar cualquiera.
  if (acc.colegioId && acc.colegioId !== prenda.colegioId) {
    return c.json({
      success: false,
      error: `El accesorio "${nombre}" es exclusivo de otro colegio.`,
    }, 409);
  }

  const cant = Number(cantidad) || 0;

  const [linea] = await db
    .select()
    .from(detalleAccesorio)
    .where(and(
      eq(detalleAccesorio.productoId, prenda.id),
      eq(detalleAccesorio.accesorioId, acc.id)
    ))
    .limit(1);

  if (cant <= 0) {
    if (linea) {
      await db.delete(detalleAccesorio).where(eq(detalleAccesorio.id, linea.id));
    }
    return c.json({
      success: true,
      message: linea ? 'Accesorio quitado de la prenda' : 'La prenda ya no llevaba ese accesorio',
      cantidadUso: 0,
      costoBs: 0,
    });
  }

  if (linea) {
    await db.update(detalleAccesorio).set({ cantidadUso: cant }).where(eq(detalleAccesorio.id, linea.id));
  } else {
    await db.insert(detalleAccesorio).values({
      id: nuevoIdHex(),
      productoId: prenda.id,
      accesorioId: acc.id,
      cantidadUso: cant,
    });
  }

  // Se devuelve el costo resultante para que la pantalla no tenga que recalcularlo por
  // su cuenta: fue justo esa clase de calculo duplicado en el front la que produjo la
  // cuarta copia de la formula de costeo.
  return c.json({
    success: true,
    message: 'Cantidad guardada',
    productoId: prenda.id,
    accesorioId: acc.id,
    cantidadUso: cant,
    costoBs: r2(cant * (Number(acc.costoUnitario) || 0)),
  });
});

// GET /api/inputs/mano-de-obra - Costos de mano de obra en los 3 grupos de tallas oficiales (2-10, 12-S, M-4XL)
api.get('/mano-de-obra', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let prodQuery = db.select().from(productos);
  if (colegioId && colegioId !== 'all') prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  const allProds = await ordenarPrendasDesdeBase(db, await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero)));
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  let moList: any[] = [];
  try {
    moList = await db.select().from(manoObra);
  } catch (e) {}

  const moDbMap = new Map<string, number>();
  moList.forEach((m: any) => moDbMap.set(`${m.productoId}_${m.tallaId}`, m.costoBs));

  // SE FUE LA PLANILLA. Igual que con los pesos, la base ya ganaba: el Excel entraba solo por el
  // `?? excelMo`, y `mano_obra` tiene 448 filas con las 28 prendas cubiertas, asi que ese
  // respaldo no se usaba nunca. Sin fila en la base, el costo es 0.
  const moExcelMap = new Map<number, { grupo1: number; grupo2: number; grupo3: number }>();

  const data = allProds.map((prod: any) => {
    const excelMo = moExcelMap.get(prod.itemNumero) || { grupo1: 0, grupo2: 0, grupo3: 0 };

    // Las tres bandas salen de services/tallas.ts y la comparacion NORMALIZA el
    // codigo. Antes estaban escritas a mano aca, asi que renombrar `2` a `02` habria
    // hecho que `find` no encontrara ninguna talla del grupo 1 y la pantalla cayera
    // al valor del Excel en vez del de la base, sin avisar.
    const tGroup1 = allTallas.find((t: any) => esDeBanda(t.codigo, 1));
    const tGroup2 = allTallas.find((t: any) => esDeBanda(t.codigo, 2));
    const tGroup3 = allTallas.find((t: any) => esDeBanda(t.codigo, 3));

    const g1 = tGroup1 ? (moDbMap.get(`${prod.id}_${tGroup1.id}`) ?? excelMo.grupo1) : excelMo.grupo1;
    const g2 = tGroup2 ? (moDbMap.get(`${prod.id}_${tGroup2.id}`) ?? excelMo.grupo2) : excelMo.grupo2;
    const g3 = tGroup3 ? (moDbMap.get(`${prod.id}_${tGroup3.id}`) ?? excelMo.grupo3) : excelMo.grupo3;

    return {
      productoId: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      grupo1_tallas_2_10: g1,
      grupo2_tallas_12_S: g2,
      grupo3_tallas_M_4XL: g3,
    };
  });

  return c.json({
    success: true,
    gruposTallas: ['Tallas 2 - 10', 'Tallas 12 - S', 'Tallas M - 4XL'],
    data
  });
});

// GET /api/inputs/fijos-x-prenda - Factor de complejidad y fijos por prenda dinámicos integrados con indirectos
api.get('/fijos-x-prenda', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let prodQuery = db.select().from(productos);
  if (colegioId && colegioId !== 'all') prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  const allProds = await ordenarPrendasDesdeBase(db, await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero)));

  const sysConfig = await getSystemConfig(db);

  let indirectosList: any[] = [];
  try {
    let q = db.select().from(costosIndirectos);
    // FASE 5: costo_indirecto pierde colegio_id. El pool es de la empresa, decidido
    // el 28-jul-2026, asi que no se filtra por colegio. Era el unico lugar que lo
    // intentaba filtrar, y ni siquiera lo hacia el motor de costeo.
    indirectosList = await q;
  } catch (e) {}

  const totalIndirectosMensual = indirectosList.reduce((acc: number, curr: any) => acc + (Number(curr.montoMensual) || 0), 0);
  const prendasProducidasMes = sysConfig.volumenMensualProduccion;
  const tarifaPuntoComplejidad = (prendasProducidasMes > 0) ? (totalIndirectosMensual / (prendasProducidasMes * 10)) : 0;

  const data = allProds.map((p: any) => {
    const factor = p.factorComplejidad || 1;
    const costoFijoCalculado = parseFloat((factor * tarifaPuntoComplejidad).toFixed(4));

    return {
      id: p.id,
      itemNumero: p.itemNumero,
      descripcion: p.descripcion,
      factorComplejidad: factor,
      costoFijo: costoFijoCalculado,
      planchadoExtra: p.planchadoExtra || 0,
      colocacionBotones: p.colocacionBotones || 0,
    };
  });

  const indirectosFormatted = indirectosList.map((item: any, idx: number) => ({
    id: item.id,
    itemNumero: idx + 1,
    concepto: item.concepto,
    montoMensual: item.montoMensual,
  }));

  return c.json({
    success: true,
    tarifaPuntoComplejidad: parseFloat(tarifaPuntoComplejidad.toFixed(6)),
    totalIndirectosMensual: parseFloat(totalIndirectosMensual.toFixed(2)),
    prendasProducidasMes,
    data,
    indirectos: indirectosFormatted,
  });
});

// PUT /api/inputs/mano-de-obra/:productoId - Actualizar tarifas de Mano de Obra por prenda en tiempo real
api.put('/mano-de-obra/:productoId', async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const body = await c.req.json();
  const { grupo1, grupo2, grupo3 } = body;

  try {
    const [prod] = await db.select().from(productos).where(eq(productos.id, productoId)).limit(1);
    if (!prod) return c.json({ success: false, error: 'Producto no encontrado' }, 404);

    // FASE 5: compartidas mas las del colegio.
    const allTallas = await db
      .select()
      .from(tallas)
      .where(or(eq(tallas.colegioId, prod.colegioId), isNull(tallas.colegioId)));

    for (const tallaObj of allTallas) {
      const code = tallaObj.codigo;
      let costoBs = Number(grupo3) || 0;
      // El camino de ESCRITURA. Aca la lista a mano era mas grave que en la lectura:
      // con los codigos renombrados, la mano de obra de las tallas chicas se habria
      // guardado con el costo de las grandes. Sin error y con status 200.
      const banda = bandaManoObra(code);
      if (banda === 1) costoBs = Number(grupo1) || 0;
      else if (banda === 2) costoBs = Number(grupo2) || 0;

      await db.delete(manoObra).where(and(eq(manoObra.productoId, prod.id), eq(manoObra.tallaId, tallaObj.id)));
      await db.insert(manoObra).values({
        productoId: prod.id,
        tallaId: tallaObj.id,
        costoBs,
      });
    }
    saveDbToDisk();
    return c.json({ success: true, message: 'Tarifas de Mano de Obra actualizadas exitosamente' });
  } catch (e) {
    console.error('Error actualizando Mano de Obra:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// PUT /api/inputs/fijos-x-prenda/:id - Actualizar factor de complejidad en tiempo real
api.put('/fijos-x-prenda/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { factorComplejidad } = body;

  try {
    await db.update(productos).set({
      factorComplejidad: Number(factorComplejidad) || 1,
    }).where(eq(productos.id, id));

    saveDbToDisk();
    return c.json({ success: true, message: 'Factor de complejidad actualizado' });
  } catch (e) {
    console.error('Error actualizando fijos por prenda:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// PUT /api/inputs/fij-var/:id - Actualizar costos indirectos mensuales en tiempo real
api.put('/fij-var/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();
  const { montoMensual, concepto } = body;

  try {
    await db.update(costosIndirectos).set({
      montoMensual: Number(montoMensual) || 0,
      ...(concepto ? { concepto: String(concepto).trim() } : {})
    }).where(eq(costosIndirectos.id, id));

    saveDbToDisk();
    return c.json({ success: true, message: 'Costo indirecto actualizado' });
  } catch (e) {
    console.error('Error actualizando costo indirecto:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// PUT /api/inputs/peso-mat-prima - Actualizar peso de materia prima o porcentaje de merma en tiempo real
api.put('/peso-mat-prima', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json();
  const { productoId, tallaCodigo, pesoExacto, pesoConMerma, mermaPorcentaje, bulkMerma } = body;

  try {
    if (bulkMerma && typeof mermaPorcentaje === 'number') {
      const newMerma = Number(mermaPorcentaje) || 8;
      const allPesos = await db.select().from(pesoMateriaPrima);
      for (const rec of allPesos) {
        const pExacto = rec.pesoExactoGramos || parseFloat((rec.pesoGramos / (1 + newMerma / 100)).toFixed(2));
        const pConMerma = parseFloat((pExacto * (1 + newMerma / 100)).toFixed(2));
        await db.update(pesoMateriaPrima)
          .set({
            mermaPorcentaje: newMerma,
            pesoGramos: pConMerma,
            pesoConMerma: pConMerma,
          })
          .where(eq(pesoMateriaPrima.id, rec.id));
      }
      saveDbToDisk();
      return c.json({ success: true, message: `Merma global actualizada a ${newMerma}%` });
    }

    const [prod] = await db.select().from(productos).where(eq(productos.id, productoId)).limit(1);
    if (!prod) return c.json({ success: false, error: 'Producto no encontrado' }, 404);

    const [tallaObj] = await db.select().from(tallas).where(and(eq(tallas.codigo, tallaCodigo), or(eq(tallas.colegioId, prod.colegioId), isNull(tallas.colegioId)))).limit(1);
    if (tallaObj) {
      const mermaPct = typeof mermaPorcentaje === 'number' ? Number(mermaPorcentaje) : 8;

      let pExacto = 0;
      let pConMerma = 0;

      if (typeof pesoExacto === 'number' && pesoExacto >= 0) {
        pExacto = Number(pesoExacto);
        pConMerma = parseFloat((pExacto * (1 + mermaPct / 100)).toFixed(2));
      } else if (typeof pesoConMerma === 'number' && pesoConMerma >= 0) {
        pConMerma = Number(pesoConMerma);
        pExacto = parseFloat((pConMerma / (1 + mermaPct / 100)).toFixed(2));
      }

      await db.delete(pesoMateriaPrima).where(and(eq(pesoMateriaPrima.productoId, prod.id), eq(pesoMateriaPrima.tallaId, tallaObj.id)));
      await db.insert(pesoMateriaPrima).values({
        productoId: prod.id,
        tallaId: tallaObj.id,
        pesoExactoGramos: pExacto,
        pesoGramos: pConMerma,
        mermaPorcentaje: mermaPct,
        pesoConMerma: pConMerma,
      });
      saveDbToDisk();
    }
    return c.json({ success: true, message: 'Peso de materia prima actualizado' });
  } catch (e) {
    console.error('Error actualizando peso materia prima:', e);
    return c.json({ success: false, error: String(e) }, 500);
  }
});

// GET /api/inputs/desglose-inteligente-producto - Desglose de costos por producto+talla
//
// UNIFICADO (Fase 2). Antes este endpoint tenia su propia copia de la formula,
// distinta de la del motor en tres cosas:
//   1. Sacaba las CANTIDADES de accesorios del Excel por division inversa
//      (costoDeLaCelda / costoUnitario), en vez de leer detalle_acc.
//   2. Cuando no encontraba fila de mano de obra promediaba las tallas, y si
//      tampoco habia usaba 15,00 Bs hardcodeados.
//   3. Calculaba ivaBs y precioFinalConIvaBs por dos caminos independientes
//      (tasaIva/100 y factorIva), asi que costoAntesImpuestos + ivaBs podia no
//      dar precioFinalConIvaBs por 0,01 de redondeo.
// Y no tenia noción de modoCosteo ni de precio_adquisicion, asi que devolvia
// 7,84 Bs para la Chompa y el Chaleco donde el Excel dice hasta 147,84: un
// subcosteo de 45 a 158 Bs por prenda. El usuario fallo el 29-jul-2026 que gana
// el numero nuevo (causa 1 del arnes de paridad).
//
// Ahora delega en el motor. Los tres problemas desaparecen por construccion: los
// accesorios salen de detalle_acc, no se fabrica nada, y el IVA sale de un solo
// resultado coherente.
//
// El shape de la respuesta se conserva campo por campo, porque dashboard.html lee
// estos nombres directo. Se agregan seOfrece y diagnostico, aditivos.
//
// Query params:
//   colegioId: filtro de colegio (o 'all')
//   tallaId:   (opcional) talla para la que se costea. Si se omite, se aplica la
//              cadena de fallback de siempre, conservada tal cual.
api.get('/desglose-inteligente-producto', async (c) => {
  try {
    const db = (c as any).db;
    const colegioIdRaw = c.req.query('colegioId');
    const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;
    const tallaIdParam = c.req.query('tallaId') || null;
    const snapshotId = c.req.query('snapshotId');
    const ctx = await cargarContextoCosteo(db, { colegioId, snapshotId });

    const avisosFiscales: string[] = [];
    const fiscal = construirContextoFiscal(c, ctx, avisosFiscales);
    const sysConfig = ctx.sysConfig;

    const data = ctx.productos.map((p: any) => {
      const tallasColegio = ctx.tallasPorColegio.get(p.colegioId) || [];

      // tallasDisponibles: todas las tallas activas del colegio, con el peso real
      // si existe o null si no. El dashboard arma el selector con este arreglo.
      const tallasDisponibles = tallasColegio.map((t: any) => {
        const fila = ctx.pesoPorClave.get(`${p.id}_${t.id}`);
        const pesoVal = fila ? (fila.pesoGramos ?? fila.pesoConMerma ?? 0) : null;
        return {
          tallaId: t.id,
          codigo: t.codigo,
          nombre: t.nombre,
          orden: t.orden,
          pesoGramos: pesoVal,
          tienePesoReal: pesoVal !== null && pesoVal > 0,
        };
      });

      // Cadena de fallback de talla, conservada tal cual: el parametro, luego
      // talla_defecto de configuracion, luego '16/34' hardcodeado, luego la
      // primera con peso real, luego la primera activa.
      let sel: any = null;
      if (tallaIdParam) {
        sel = tallasDisponibles.find((t: any) => t.tallaId === tallaIdParam) || null;
      }
      if (!sel) {
        const pref = String(sysConfig.tallaDefecto || '').trim().toLowerCase();
        sel =
          tallasDisponibles.find((t: any) => String(t.codigo).trim().toLowerCase() === pref) ||
          tallasDisponibles.find((t: any) => String(t.codigo).trim() === '16/34') ||
          tallasDisponibles.find((t: any) => t.tienePesoReal) ||
          tallasDisponibles[0] ||
          null;
      }

      const tallaObj = sel ? ctx.tallasPorId.get(sel.tallaId) : null;

      // Prenda sin ninguna talla activa. Se devuelve el mismo shape en cero en
      // vez de omitir la fila, para no romper el recorrido del dashboard.
      if (!tallaObj) {
        return {
          productoId: p.id,
          itemNumero: p.itemNumero,
          descripcion: p.descripcion,
          tallasDisponibles,
          tallaActual: null,
          tela: { nombre: 'Sin tela asignada', precioBsGramo: 0, pesoGramos: 0, costoTelaBs: 0 },
          accesoriosIntervinientes: [],
          subtotalAccesoriosBs: 0,
          manoDeObra: { costoCorte: 0, costoConfeccion: 0, totalManoObraBs: 0 },
          fijosEIndirectos: {
            factorComplejidad: p.factorComplejidad || 1,
            tarifaPuntoComplejidad: r4(ctx.tarifaPuntoComplejidad),
            fijosXprenda: 0,
            indirectosXprenda: 0,
            totalFijosBs: 0,
          },
          costoDirectoTotalBs: 0,
          costoUnitarioNetoBs: 0,
          precioListaBs: null,
          precioVentaEfectivoBs: null,
          ingresoNetoEfectivoBs: null,
          margenEfectivoPct: null,
          ingresoNetoConFacturaBs: null,
          ingresoNetoSinFacturaBs: null,
          margenConFacturaPct: null,
          margenSinFacturaPct: null,
          seOfrece: false,
          diagnostico: { faltantes: ['La prenda no tiene ninguna talla activa en el colegio.'] },
        };
      }

      const { inputs, meta } = ensamblarInputs(ctx, p, tallaObj);
      const res = calcularCostoTotal(inputs);

      // El desglose tambien tiene que hablar del modo elegido, no de los dos a la
      // vez. Los campos por canal se conservan —los usa el detalle— pero ahora hay
      // un precio y un margen EFECTIVOS, que son los que la pantalla muestra.
      const { precioLista, precioVenta, ingresoNeto } = resolverPrecios(meta.precioVentaBs, fiscal);
      const margenEfectivoPct =
        ingresoNeto > 0
          ? Math.round(((ingresoNeto - res.costoUnitarioNeto) / ingresoNeto) * 10000) / 100
          : null;

      return {
        productoId: p.id,
        itemNumero: p.itemNumero,
        descripcion: p.descripcion,
        tallasDisponibles,
        tallaActual: { tallaId: sel.tallaId, codigo: sel.codigo, nombre: sel.nombre },
        tela: {
          nombre: meta.telaNombre || 'Sin tela asignada',
          precioBsGramo: meta.precioBsG ?? 0,
          pesoGramos: meta.pesoGramos,
          costoTelaBs: res.costoTela,
        },
        // Ahora salen de detalle_acc unido al catalogo. Antes la cantidad se
        // despejaba dividiendo el costo de la celda del Excel por el costo
        // unitario, y cuando el costo unitario era 0 se asumia cantidad 1: es
        // como "Ojal Grande" terminaba mostrandose en 0,00 Bs.
        accesoriosIntervinientes: meta.lineasAccesorios.map((l) => ({
          nombre: l.nombre,
          unidadCompra: l.unidadCompra,
          costoUnitarioBs: l.costoUnitarioBs,
          cantidad: l.cantidad,
          costoTotalBs: l.costoTotalBs,
        })),
        subtotalAccesoriosBs: res.costoAccesorios,
        manoDeObra: {
          // costoCorte siempre fue 0 en este endpoint. Se mantiene para no
          // cambiar el shape; la mano de obra a destajo no se desagrega.
          costoCorte: 0,
          costoConfeccion: res.costoManoObra,
          totalManoObraBs: res.costoManoObra,
        },
        fijosEIndirectos: {
          factorComplejidad: meta.factorComplejidad,
          tarifaPuntoComplejidad: r4(meta.tarifaPuntoComplejidad),
          fijosXprenda: res.costoFijosVariable,
          // Siempre fue 0 y sigue siendo 0: en el modelo vigente el pool de
          // indirectos entra por la via de los fijos, no como linea propia.
          // Se corrige en la Fase 4.
          indirectosXprenda: res.costoIndirecto,
          totalFijosBs: r2(res.costoFijosVariable + res.costoIndirecto),
        },
        costoDirectoTotalBs: res.costoBruto,
        // Fase 3: un solo costo, sin IVA. Antes habia tres campos para dos
        // conceptos — costoAntesImpuestosBs, costoTotalProduccionBs y
        // precioFinalConIvaBs — y los dos ultimos eran el mismo numero inflado.
        costoUnitarioNetoBs: res.costoUnitarioNeto,
        precioListaBs: precioLista > 0 ? r2(precioLista) : null,
        precioVentaEfectivoBs: precioVenta > 0 ? r2(precioVenta) : null,
        ingresoNetoEfectivoBs: ingresoNeto > 0 ? r2(ingresoNeto) : null,
        margenEfectivoPct,
        ingresoNetoConFacturaBs: res.ingresoNetoConFactura,
        ingresoNetoSinFacturaBs: res.ingresoNetoSinFactura,
        margenConFacturaPct: res.margenConFactura,
        margenSinFacturaPct: res.margenSinFactura,

        // Aditivos. Lo que antes se resolvia devolviendo 0 en silencio.
        seOfrece: meta.seOfrece,
        diagnostico: {
          ...res.diagnostico,
          modoCosteo: meta.modoCosteo,
          telaVinculada: meta.telaVinculada,
          tieneManoObra: meta.tieneManoObra,
          faltantes: meta.faltantes,
          inconsistencias: meta.inconsistencias,
        },
      };
    });

    return c.json({
      success: true,
      modalidad: fiscal.modalidad,
      modalidadEtiqueta: etiquetaModalidad(fiscal.modalidad),
      descuentoSinFacturaPct: parseFloat((fiscal.descuentoFraccion * 100).toFixed(2)),
      avisos: avisosFiscales,
      data,
    });
  } catch (e: any) {
    console.error('desglose-inteligente-producto:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

export default api;
