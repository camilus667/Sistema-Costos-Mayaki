import { Hono } from 'hono';
import {
  cargarContextoCosteo,
  ensamblarInputs,
  type ContextoCosteo,
  type PrendaCosteada,
} from '../services/calculo/costeoInputs.service';
import { calcularCostoTotal } from '../services/calculo/costoTotal.service';

/**
 * Costeo unificado: la unica ruta que costea llamando al motor real.
 *
 * Se monta AL LADO de las pantallas existentes, sin borrar nada. Existe para
 * poder comparar prenda por prenda contra `desglose-inteligente-producto`,
 * `matriz-consolidada` y `matriz-prenda` antes de tocarlas. Paridad primero,
 * borrado despues.
 *
 * A diferencia de esas tres, aca no hay aritmetica: el armado de inputs vive en
 * `costeoInputs.service.ts` y la formula en `costoTotal.service.ts`. Esta ruta
 * solo transporta.
 *
 * Devuelve a proposito los tres niveles — `inputs`, `resultado` y `meta` — para
 * que un descuadre se pueda diagnosticar sin adivinar: se ve que entro al motor,
 * que salio, y de que filas de la base se armo.
 */

const api = new Hono();

// ---------------------------------------------------------------------------
// Serializacion
// ---------------------------------------------------------------------------

/**
 * `lineasAccesorios` se saca de las filas y se devuelve una sola vez por prenda.
 * La receta de accesorios no depende de la talla (decision del 28-jul-2026: un
 * valor promedio unico por prenda), asi que repetirla en las 16 tallas serian
 * ~400 copias del mismo arreglo.
 */
function serializarFila(f: PrendaCosteada, incluirInputs: boolean) {
  const { lineasAccesorios, ...metaSinLineas } = f.meta;
  return {
    ...metaSinLineas,
    resultado: f.resultado,
    ...(incluirInputs ? { inputs: f.inputs } : {}),
  };
}

function cabecera(ctx: ContextoCosteo, alcanceColegioId?: string) {
  return {
    config: {
      // Se exponen las dos formas a proposito: el 13 es lo que guarda la base y
      // el 0.13 es lo que recibe el motor. Confundirlas daba 1300% de IVA.
      tasaIvaPorcentaje: ctx.sysConfig.tasaIva,
      tasaIvaFraccion: ctx.tasaIvaFraccion,
      volumenMensualProduccion: ctx.sysConfig.volumenMensualProduccion,
      mermaPorcentajeEstandar: ctx.sysConfig.mermaPorcentajeEstandar,
      totalIndirectosMensual: ctx.totalIndirectosMensual,
      tarifaPuntoComplejidad: ctx.tarifaPuntoComplejidad,
    },
    alcance: {
      colegioId: alcanceColegioId || null,
      // Honestidad sobre el aislamiento: los indirectos se suman sin filtrar por
      // colegio, igual que en los tres caminos viejos. Con un colegio es inocuo.
      // Se replica para no contaminar la paridad. Se corrige en la Fase 6.
      indirectosFiltradosPorColegio: false,
    },
    avisosGlobales: ctx.avisosGlobales,
  };
}

// ---------------------------------------------------------------------------
// GET /prenda/:productoId/talla/:tallaId
// ---------------------------------------------------------------------------

// Se registra antes que `/prenda/:productoId` por costumbre. Aca no hace falta
// porque tienen distinta cantidad de segmentos, pero en la Fase 1 una ruta
// literal quedo inalcanzable detras de un `:id` y prefiero no repetirlo.
api.get('/prenda/:productoId/talla/:tallaId', async (c) => {
  try {
    const db = (c as any).db;
    const { productoId, tallaId } = c.req.param();

    const ctx = await cargarContextoCosteo(db, { productoId });
    const producto = ctx.productos[0];
    if (!producto) {
      return c.json({ success: false, error: `No existe el producto ${productoId}.` }, 404);
    }
    const talla = ctx.tallasPorId.get(tallaId);
    if (!talla) {
      return c.json({ success: false, error: `No existe la talla ${tallaId}.` }, 404);
    }

    const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
    const resultado = calcularCostoTotal(inputs);

    return c.json({
      success: true,
      ...cabecera(ctx, producto.colegioId),
      data: { ...meta, inputs, resultado },
    });
  } catch (e: any) {
    console.error('costeo/prenda/talla:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /prenda/:productoId
// ---------------------------------------------------------------------------

api.get('/prenda/:productoId', async (c) => {
  try {
    const db = (c as any).db;
    const { productoId } = c.req.param();
    const soloOfrecidas = c.req.query('soloOfrecidas') === '1';

    const ctx = await cargarContextoCosteo(db, { productoId });
    const producto = ctx.productos[0];
    if (!producto) {
      return c.json({ success: false, error: `No existe el producto ${productoId}.` }, 404);
    }

    const lista = ctx.tallasPorColegio.get(producto.colegioId) || [];
    let filas: PrendaCosteada[] = lista.map((talla) => {
      const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
      return { meta, inputs, resultado: calcularCostoTotal(inputs) };
    });
    if (soloOfrecidas) filas = filas.filter((f) => f.meta.seOfrece);

    return c.json({
      success: true,
      ...cabecera(ctx, producto.colegioId),
      producto: {
        id: producto.id,
        itemNumero: producto.itemNumero,
        descripcion: producto.descripcion,
        modoCosteo: producto.modoCosteo === 'adquirido' ? 'adquirido' : 'confeccion',
        telaId: producto.telaId || null,
        factorComplejidad: producto.factorComplejidad,
      },
      // La receta es la misma para todas las tallas, va una sola vez.
      receta: ctx.accesoriosPorProducto.get(producto.id) || [],
      data: filas.map((f) => serializarFila(f, true)),
    });
  } catch (e: any) {
    console.error('costeo/prenda:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /matriz
// ---------------------------------------------------------------------------

/**
 * Query:
 *   colegioId=<id>       filtra las prendas. Omitirlo o 'all' devuelve todas.
 *   soloOfrecidas=1      deja solo las combinaciones con precio de venta vigente.
 *                        Sin el flag salen las 432 de la grilla completa, de las
 *                        cuales 281 se ofrecen de verdad. Util para el arnes.
 *   incluirInputs=1      agrega los inputs crudos del motor por fila. Apagado por
 *                        defecto: son 432 filas y el payload se dispara.
 */
api.get('/matriz', async (c) => {
  try {
    const db = (c as any).db;
    const colegioIdRaw = c.req.query('colegioId');
    const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;
    const soloOfrecidas = c.req.query('soloOfrecidas') === '1';
    const incluirInputs = c.req.query('incluirInputs') === '1';

    const ctx = await cargarContextoCosteo(db, { colegioId });

    const filas: PrendaCosteada[] = [];
    for (const producto of ctx.productos) {
      const lista = ctx.tallasPorColegio.get(producto.colegioId) || [];
      for (const talla of lista) {
        const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
        if (soloOfrecidas && !meta.seOfrece) continue;
        filas.push({ meta, inputs, resultado: calcularCostoTotal(inputs) });
      }
    }

    // Recetas normalizadas: una entrada por prenda, no una copia por talla.
    const recetas: Record<string, any[]> = {};
    for (const producto of ctx.productos) {
      recetas[producto.id] = ctx.accesoriosPorProducto.get(producto.id) || [];
    }

    return c.json({
      success: true,
      ...cabecera(ctx, colegioId),
      resumen: {
        productos: ctx.productos.length,
        filas: filas.length,
        seOfrecen: filas.filter((f) => f.meta.seOfrece).length,
        conFaltantes: filas.filter((f) => f.meta.faltantes.length > 0).length,
        conInconsistencias: filas.filter((f) => f.meta.inconsistencias.length > 0).length,
        sinPrecioDeTela: filas.filter((f) => f.resultado.diagnostico.sinPrecioDeTela).length,
        sinBaseDeTela: filas.filter((f) => f.resultado.diagnostico.sinBaseDeTela).length,
      },
      recetas,
      data: filas.map((f) => serializarFila(f, incluirInputs)),
    });
  } catch (e: any) {
    console.error('costeo/matriz:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /diagnostico
// ---------------------------------------------------------------------------

/**
 * Solo lo que esta mal, sin los numeros. Pensado para revisar de un vistazo si
 * el catalogo esta sano antes de confiar en cualquier costo.
 */
api.get('/diagnostico', async (c) => {
  try {
    const db = (c as any).db;
    const colegioIdRaw = c.req.query('colegioId');
    const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;

    const ctx = await cargarContextoCosteo(db, { colegioId });

    const problemas: any[] = [];
    for (const producto of ctx.productos) {
      const lista = ctx.tallasPorColegio.get(producto.colegioId) || [];
      for (const talla of lista) {
        const { inputs, meta } = ensamblarInputs(ctx, producto, talla);
        const resultado = calcularCostoTotal(inputs);

        // Una combinacion que no se ofrece y no tiene datos no es un problema:
        // es una prenda que no existe en esa talla, que es el caso de 121 de las
        // 432. Solo interesa lo que SE VENDE y no se puede costear bien.
        const relevante =
          meta.seOfrece &&
          (meta.faltantes.length > 0 ||
            meta.inconsistencias.length > 0 ||
            resultado.diagnostico.sinPrecioDeTela ||
            resultado.diagnostico.sinBaseDeTela);
        if (!relevante) continue;

        problemas.push({
          itemNumero: meta.itemNumero,
          descripcion: meta.descripcion,
          tallaCodigo: meta.tallaCodigo,
          modoCosteo: meta.modoCosteo,
          precioVentaBs: meta.precioVentaBs,
          costoUnitarioNeto: resultado.costoUnitarioNeto,
          margenConFactura: resultado.margenConFactura,
          origenCostoTela: resultado.diagnostico.origenCostoTela,
          faltantes: meta.faltantes,
          inconsistencias: meta.inconsistencias,
          advertenciasMotor: resultado.diagnostico.advertencias,
        });
      }
    }

    return c.json({
      success: true,
      ...cabecera(ctx, colegioId),
      total: problemas.length,
      data: problemas,
    });
  } catch (e: any) {
    console.error('costeo/diagnostico:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

export default api;
