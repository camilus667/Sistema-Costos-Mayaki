import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc, or, isNull } from 'drizzle-orm';
import { calcularCostoTotal } from '../services/calculo/costoTotal.service';
import { costearLote, costearPrendaTodasLasTallas } from '../services/calculo/costeoInputs.service';
import { productos, tallas, preciosVenta, inventario } from '../database/schema';
import XLSX from 'xlsx';
import { findExcelPath } from '../scripts/seed';

/** Redondeo de presentacion. El motor ya redondea; esto es para los pesos crudos. */
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

const api = new Hono();

/**
 * Simulador instantaneo: expone la superficie REAL del motor.
 *
 * El schema anterior descartaba la mitad del motor. Como zValidator borra las
 * claves que no estan declaradas, los campos faltantes no daban error: se
 * perdian en silencio y el motor calculaba con undefined.
 *
 * Lo que faltaba y ahora esta:
 *   precioBsG               el camino preferido de costo de tela, el que quedo
 *                           verificado contra el Excel. Sin el, la unica via era
 *                           precioTelaUnitario + rendimiento.
 *   pesoConMermaGramos      peso que ya trae la merma, que es lo que guarda la base
 *   pesoExactoGramos        peso limpio, al que el motor le aplica la merma
 *   precioAdquisicion       prendas semiterminadas o de reventa
 *   costoIndirectoUnitario  indirecto ya prorrateado, para poder usar un
 *                           denominador anual en vez de la produccion del mes
 *   tasaIva                 configurable, antes siempre caia en IVA_RATE
 *
 * Ademas:
 * - `pesoGramos`, `precioTelaUnitario` y `rendimientoTela` pasan a opcionales.
 *   Eran obligatorios y positivos, asi que era IMPOSIBLE simular una prenda
 *   adquirida (no lleva peso) o usar el camino de precioBsG.
 * - `factorComplejidad` deja de ser `.int()`. La columna del schema paso a real
 *   en la Fase 4, asi que 1,5 ya se persiste. SQLite tiene tipado dinamico y la
 *   afinidad INTEGER ya guardaba 1.5 como REAL, asi que no hizo falta migrar datos.
 * - Se saca el `.default(8)` de la merma. Era el tercer lugar con el 8
 *   hardcodeado, justo el que el motor elimino a proposito para que el default
 *   viva solo en el schema de la base y en configuracion_sistema. Si no viene, el
 *   motor avisa en su diagnostico.
 */
const calcularSchema = z.object({
  productoId: z.string().optional().default('demo-prod'),
  tallaId: z.string().optional().default('demo-talla'),
  colegioId: z.string().optional().default('demo-colegio'),

  // Peso. Tres formas, con la precedencia que documenta el motor.
  pesoConMermaGramos: z.number().nonnegative().optional(),
  pesoExactoGramos: z.number().nonnegative().optional(),
  pesoGramos: z.number().nonnegative().optional(),
  mermaPorcentaje: z.number().min(0).max(100).optional(),

  // Precio de la tela. Dos caminos.
  precioBsG: z.number().positive().optional(),
  precioTelaUnitario: z.number().positive().optional(),
  rendimientoTela: z.number().positive().optional(),

  // Prendas adquiridas: reemplaza al costo de tela.
  precioAdquisicion: z.number().positive().optional(),

  costoAccesorios: z.number().default(0),
  costoManoObra: z.number().default(0),
  factorComplejidad: z.number().positive().default(1),
  costoFijo: z.number().default(0),

  costoIndirectoUnitario: z.number().nonnegative().optional(),
  costoIndirectoMensual: z.number().default(0),
  produccionTotalMes: z.number().int().positive().default(1),

  precioVenta: z.number().optional().nullable(),

  // FRACCION, no porcentaje. El tope de 1 lo hace cumplir en el borde: si alguien
  // manda 13 pensando en el 13%, el motor calcularia 1300% de IVA sin lanzar
  // nada. Es la trampa de unidades de todo el refactor, y aca se ataja con un
  // mensaje que dice exactamente que hacer.
  tasaIva: z
    .number()
    .min(0)
    .max(1, {
      message:
        'tasaIva se expresa como fraccion, no como porcentaje: 0.13 para el 13%. ' +
        'Enviar 13 daria 1300% de IVA.',
    })
    .optional(),
});

// Cache global compartido en memoria para sincronía 100% entre todas las pestañas
let excelMatricesCache: any = null;

export function loadExcelMatrices() {
  if (excelMatricesCache) return excelMatricesCache;

  try {
    const excelPath = findExcelPath();
    const parseXLSX = (XLSX as any).default || XLSX;
    const workbook = parseXLSX.readFile(excelPath);

    const sheetMap: Record<string, string> = {
      costoBruto: 'CostoBruto',
      precioVenta: 'PrecioDeVenta',
      costoAntesImp: 'CostoAntesImp',
      costoTotal: 'CostoTotal',
      utilidadNeta: 'UtilidadNeta',
      margenPorcentaje: '%Ganancia',
      inventarioUnidades: 'INVENTARIO',
      costoInventario: 'CostoInventario',
    };

    const parsedSheets: Record<string, Map<string, number>> = {};

    Object.entries(sheetMap).forEach(([conceptKey, sheetName]) => {
      const sheet = workbook.Sheets[sheetName];
      const conceptMap = new Map<string, number>();

      if (sheet) {
        const rows = parseXLSX.utils.sheet_to_json(sheet, { header: 1 });
        const headerRowIdx = rows.findIndex((r: any) => r && r.some((c: any) => String(c).toUpperCase() === 'ITEM' || String(c).toUpperCase().includes('DETALLE')));
        const headerIdx = headerRowIdx !== -1 ? headerRowIdx : 0;
        const tallasHeader = rows[headerIdx]?.slice(2) || [];

        rows.slice(headerIdx + 1).forEach((row: any) => {
          if (row && row[0] !== undefined && row[0] !== null && !isNaN(Number(row[0]))) {
            const itemNum = Number(row[0]);
            if (itemNum > 0) {
              tallasHeader.forEach((tallaCode: any, idx: number) => {
                const val = row[2 + idx];
                const numVal = Number(val);
                const codeStr = String(tallaCode).trim();
                conceptMap.set(`${itemNum}_${codeStr}`, !isNaN(numVal) ? numVal : 0);
              });
            }
          }
        });
      }
      parsedSheets[conceptKey] = conceptMap;
    });

    const accSheet = workbook.Sheets['Acc'];
    const itemAccMap = new Map<number, number>();
    if (accSheet) {
      const rows = parseXLSX.utils.sheet_to_json(accSheet, { header: 1 });
      const auxHeaderIdx = rows.findIndex((r: any) => r && r.some((c: any) => String(c).includes('UNIDAD DE COMPRA') || String(c).includes('COSTO Unitario')));
      const matrixRows = rows.slice(2, auxHeaderIdx !== -1 ? auxHeaderIdx : 30);

      const parseItemNumbers = (val: any): number[] => {
        if (typeof val === 'number') return [val];
        const str = String(val).trim();
        if (str.includes('-')) {
          const parts = str.split('-').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
          if (parts.length === 2) {
            const nums = [];
            for (let i = parts[0]; i <= parts[1]; i++) nums.push(i);
            return nums;
          }
        }
        const num = parseInt(str);
        return !isNaN(num) ? [num] : [];
      };

      matrixRows.forEach((r: any) => {
        if (r && r[1] !== undefined) {
          const itemNums = parseItemNumbers(r[1]);
          itemNums.forEach((itemNum) => {
            const accVal = Number(r[41]) || 0;
            if (itemNum > 0) itemAccMap.set(itemNum, accVal);
          });
        }
      });
    }

    excelMatricesCache = { ...parsedSheets, itemAccMap };
    return excelMatricesCache;
  } catch (err) {
    console.error('Error al cargar matrices desde Excel:', err);
    return null;
  }
}

// POST /api/calculo/calcular - Simulador instantáneo
api.post('/calcular', zValidator('json', calcularSchema), async (c) => {
  const body = c.req.valid('json');
  const resultado = calcularCostoTotal(body as any);
  return c.json({ success: true, data: resultado });
});


// GET /api/calculo/matriz-consolidada - Grilla completa de prendas x tallas
//
// UNIFICADO (Fase 2). Antes esta ruta casi no calculaba: leia los totales ya
// hechos del Excel (`costoBruto`, `costoAntesImp`, `costoTotal`) y solo caia en un
// calculo propio cuando el Excel callaba. Ademas despejaba el costo de tela por
// resta y derivaba el costo fijo como `excelCa - cb`, o sea heredaba de la
// planilla un fijo por prenda que no tiene por que coincidir con el que sale del
// pool de indirectos.
//
// Consecuencia: la base de datos no era autoritativa. Editar un peso o un precio
// de tela no movia la grilla mientras el Excel tuviera un valor para esa celda.
//
// El usuario fallo el 29-jul-2026 que gana el numero nuevo (causa 2 del arnes).
// Ahora delega en el motor y el Excel deja de participar del costeo.
//
// El shape se conserva campo por campo: el dashboard lee
// `json.data[].tallas[codigo].{costoBruto,precioVenta,costoUnitarioNeto,
// ingresoNetoConFactura,ingresoNetoSinFactura,utilidadConFactura,utilidadSinFactura,
// margenConFactura,margenSinFactura,inventarioUnidades,costoInventario,
// precioInventario}` y `json.tallas[].codigo`.
//
// FASE 3: desaparecieron costoAntesImp, costoTotal, utilidadNeta y margenPorcentaje.
// El costo ya no lleva IVA y el margen se parte por canal de venta.
api.get('/matriz-consolidada', async (c) => {
  try {
    const db = (c as any).db;
    const colegioIdRaw = c.req.query('colegioId');
    const colegioId = colegioIdRaw && colegioIdRaw !== 'all' ? colegioIdRaw : undefined;

    const { ctx, filas } = await costearLote(db, { colegioId });

    // El inventario no es un concepto de costeo, se consulta aparte.
    let invList: any[] = [];
    try {
      invList = await db.select().from(inventario);
    } catch (e) {}
    const invMap = new Map<string, number>();
    invList.forEach((i: any) => invMap.set(`${i.productoId}_${i.tallaId}`, i.cantidad));

    // PRESERVADO A PROPOSITO: la lista de tallas se trae global, sin filtro de
    // colegio, igual que antes. Es la cabecera de columnas de la grilla, y
    // filtrarla cambiaria la forma de la tabla. Corresponde a la Fase 6.
    const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

    const porProducto = new Map<string, any[]>();
    for (const f of filas) {
      const arr = porProducto.get(f.meta.productoId) || [];
      arr.push(f);
      porProducto.set(f.meta.productoId, arr);
    }

    // Celda de una combinacion que no se ofrece. Se devuelve en cero, con el
    // inventario si lo hubiera, para conservar el mismo juego de claves que
    // antes: el dashboard recorre todas las tallas de la cabecera.
    const celdaVacia = () => ({
      costoBruto: 0,
      precioVenta: 0,
      costoUnitarioNeto: 0,
      ingresoNetoConFactura: 0,
      ingresoNetoSinFactura: 0,
      utilidadConFactura: 0,
      utilidadSinFactura: 0,
      margenConFactura: 0,
      margenSinFactura: 0,
      inventarioUnidades: 0,
      costoInventario: 0,
      precioInventario: 0,
      seOfrece: false,
    });

    const gridData = ctx.productos.map((prod: any) => {
      const rowObj: any = {
        productoId: prod.id,
        itemNumero: prod.itemNumero,
        descripcion: prod.descripcion,
        tallas: {},
      };

      const porTalla = new Map<string, any>();
      for (const f of porProducto.get(prod.id) || []) porTalla.set(f.meta.tallaId, f);

      for (const talla of allTallas) {
        const inv = invMap.get(`${prod.id}_${talla.id}`) ?? 0;
        const f = porTalla.get(talla.id);

        // Regla decidida: sin precio de venta vigente la prenda no se ofrece en
        // esa talla, asi que no se le prorratea costo fijo a algo que no existe.
        if (!f || !f.meta.seOfrece) {
          rowObj.tallas[talla.codigo] = { ...celdaVacia(), inventarioUnidades: inv };
          continue;
        }

        const r = f.resultado;
        const pv = f.meta.precioVentaBs ?? 0;
        rowObj.tallas[talla.codigo] = {
          costoBruto: r.costoBruto,
          precioVenta: r2(pv),
          costoUnitarioNeto: r.costoUnitarioNeto,
          ingresoNetoConFactura: r.ingresoNetoConFactura ?? 0,
          ingresoNetoSinFactura: r.ingresoNetoSinFactura ?? 0,
          utilidadConFactura: r.utilidadConFactura ?? 0,
          utilidadSinFactura: r.utilidadSinFactura ?? 0,
          margenConFactura: r.margenConFactura ?? 0,
          margenSinFactura: r.margenSinFactura ?? 0,
          inventarioUnidades: inv,
          // El inventario se valua al costo NETO. Antes se valuaba al costo con
          // IVA, asi que el valor del stock estaba inflado ~13%.
          costoInventario: r2(inv * r.costoUnitarioNeto),
          precioInventario: r2(inv * (pv > 0 ? pv : r.costoUnitarioNeto)),
          seOfrece: true,
        };
      }

      return rowObj;
    });

    return c.json({
      success: true,
      tallas: allTallas.map((t: any) => ({ id: t.id, codigo: t.codigo, orden: t.orden })),
      // Huella para el arnes de paridad: distingue esta version de la heredada.
      implementacion: 'unificada',
      data: gridData,
    });
  } catch (e: any) {
    console.error('matriz-consolidada:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

/**
 * Resuelve la prenda a partir de su numero de item, exigiendo colegio si hace falta.
 *
 * itemNumero se numera POR COLEGIO: viene de la fila del Excel de cada colegio, no
 * es un id global. Con dos colegios cargados, el item 5 identifica DOS prendas
 * distintas.
 *
 * La version anterior hacia `where(eq(itemNumero)).limit(1)` sin ORDER BY, asi que
 * devolvia la fila que la base quisiera —en la practica la del colegio cargado
 * primero— y los dos handlers que la usan ESCRIBEN. Editar el precio de una prenda
 * del colegio B le habria cambiado el precio a la prenda del colegio A, en silencio,
 * devolviendo success. Es la falla mas grave que encontro la auditoria de la Fase 6:
 * no una fuga de lectura, una escritura sobre los datos de otro cliente.
 *
 * Detalle que vale registrar: el lookup de talla que va justo debajo de estas dos
 * llamadas SI fue endurecido en la Fase 5, con `= colegio OR IS NULL`. Toque esas
 * tres lineas y no vi que la de arriba no tenia scoping de colegio en absoluto.
 *
 * Comportamiento:
 *  - con colegioId, filtra por el;
 *  - sin colegioId, si el numero identifica UNA sola prenda usa esa, que es
 *    exactamente lo que pasa hoy con un colegio, byte por byte;
 *  - sin colegioId y con varias candidatas, RECHAZA con 409. Ambiguo es ambiguo:
 *    mejor un error que escribirle el precio al cliente equivocado.
 *
 * El limit(2) es deliberado: solo hace falta distinguir "una" de "mas de una".
 */
async function resolverPrendaPorItem(db: any, itemNumero: number, colegioId?: string) {
  const cond = colegioId
    ? and(eq(productos.itemNumero, itemNumero), eq(productos.colegioId, colegioId))
    : eq(productos.itemNumero, itemNumero);

  const candidatas = await db.select().from(productos).where(cond).limit(2);

  if (candidatas.length === 0) {
    return {
      prenda: null,
      estado: 404,
      error: colegioId
        ? `No existe la prenda con item ${itemNumero} en el colegio ${colegioId}.`
        : `No existe la prenda con item ${itemNumero}.`,
    };
  }
  if (candidatas.length > 1) {
    return {
      prenda: null,
      estado: 409,
      error: `El item ${itemNumero} existe en mas de un colegio. Manda colegioId para indicar cual.`,
    };
  }
  return { prenda: candidatas[0], estado: 200, error: null };
}

/** Busca la talla por codigo dentro del vocabulario visible para esa prenda. */
async function resolverTallaPorCodigo(db: any, tallaCodigo: string, colegioIdPrenda: string) {
  const [talla] = await db
    .select()
    .from(tallas)
    .where(
      and(
        eq(tallas.codigo, tallaCodigo),
        or(eq(tallas.colegioId, colegioIdPrenda), isNull(tallas.colegioId))
      )
    )
    .limit(1);
  return talla || null;
}

// PUT /api/calculo/precio-venta - Actualizar PrecioDeVenta directamente en la matriz
//
// Acepta colegioId opcional en el cuerpo. Sin colegio se comporta igual que antes
// mientras el item sea inequivoco; con dos colegios cargados exige que se diga cual.
api.put('/precio-venta', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json(); // { itemNumero, tallaCodigo, precioBs, colegioId? }

  const { itemNumero, tallaCodigo, precioBs, colegioId } = body;

  // La base manda: primero se resuelve contra la base, y solo despues se toca el
  // cache del Excel. Al reves —como estaba— un fallo dejaba la matriz mostrando un
  // precio que nunca se guardo: el cache decia una cosa y la base otra.
  const { prenda, estado, error } = await resolverPrendaPorItem(db, itemNumero, colegioId);
  if (!prenda) return c.json({ success: false, error }, estado as any);

  const talla = await resolverTallaPorCodigo(db, tallaCodigo, prenda.colegioId);
  if (!talla) {
    return c.json({ success: false, error: `No existe la talla ${tallaCodigo} para esa prenda.` }, 404);
  }

  const nuevoPv = Number(precioBs) || 0;

  try {
    await db.delete(preciosVenta).where(and(eq(preciosVenta.productoId, prenda.id), eq(preciosVenta.tallaId, talla.id)));
    await db.insert(preciosVenta).values({
      productoId: prenda.id,
      tallaId: talla.id,
      precioBs: nuevoPv,
    });
  } catch (e: any) {
    // Antes el catch se tragaba el error y el handler devolvia success igual. Si la
    // escritura falla el usuario tiene que saberlo: la pantalla no puede mostrar
    // como guardado algo que no se guardo.
    console.error('Error actualizando DB para precioVenta:', e);
    return c.json({ success: false, error: 'No se pudo guardar el precio: ' + (e?.message || String(e)) }, 500);
  }

  // Cache heredado del Excel. Se actualiza recien ahora, con la base ya escrita.
  const key = `${itemNumero}_${tallaCodigo}`;
  const excelData = loadExcelMatrices();
  if (excelData) {
    excelData.precioVenta.set(key, nuevoPv);

    const ct = excelData.costoTotal.get(key) || 0;
    const nuevaUn = nuevoPv > 0 && ct > 0 ? nuevoPv - ct : 0;
    const nuevoMg = nuevoPv > 0 ? (nuevaUn / nuevoPv) * 100 : 0;

    excelData.utilidadNeta.set(key, nuevaUn);
    excelData.margenPorcentaje.set(key, nuevoMg);
  }

  return c.json({ success: true, message: 'Precio de venta actualizado exitosamente' });
});

// PUT /api/calculo/inventario-unidades - Actualizar INVENTARIO directamente en la matriz
//
// Mismo tratamiento que /precio-venta: colegioId opcional, la base manda, y no se
// devuelve success si la escritura no ocurrio.
api.put('/inventario-unidades', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json(); // { itemNumero, tallaCodigo, cantidad, colegioId? }

  const { itemNumero, tallaCodigo, cantidad, colegioId } = body;

  const { prenda, estado, error } = await resolverPrendaPorItem(db, itemNumero, colegioId);
  if (!prenda) return c.json({ success: false, error }, estado as any);

  const talla = await resolverTallaPorCodigo(db, tallaCodigo, prenda.colegioId);
  if (!talla) {
    return c.json({ success: false, error: `No existe la talla ${tallaCodigo} para esa prenda.` }, 404);
  }

  const cantNum = Number(cantidad) || 0;

  try {
    // .returning() para distinguir "actualice una fila" de "no habia ninguna".
    // Antes, si la prenda y la talla no tenian fila de inventario, el update no
    // afectaba nada y el handler devolvia success: el mismo defecto que tenia el
    // PUT de mano de obra.
    const filas = await db
      .update(inventario)
      .set({ cantidad: cantNum })
      .where(and(eq(inventario.productoId, prenda.id), eq(inventario.tallaId, talla.id)))
      .returning();

    if (filas.length === 0) {
      return c.json({
        success: false,
        error: `La prenda item ${itemNumero} y la talla ${tallaCodigo} no tienen fila de inventario.`,
      }, 404);
    }
  } catch (e: any) {
    console.error('Error actualizando DB para inventario:', e);
    return c.json({ success: false, error: 'No se pudo guardar el inventario: ' + (e?.message || String(e)) }, 500);
  }

  // El volcado a disco lo hace ahora el middleware de server.ts. La llamada
  // explicita a saveDbToDisk() que vivia aca era la unica de este archivo, y por eso
  // el precio de venta se guardaba solo si despues tocabas el inventario.
  const key = `${itemNumero}_${tallaCodigo}`;
  const excelData = loadExcelMatrices();
  if (excelData) {
    excelData.inventarioUnidades.set(key, cantNum);
    const ct = excelData.costoTotal.get(key) || 0;
    excelData.costoInventario.set(key, cantNum * ct);
  }

  return c.json({ success: true, message: 'Inventario actualizado exitosamente' });
});

// PUT /api/calculo/accesorio-total - Actualizar Total de Accesorios por prenda en tiempo real
api.put('/accesorio-total', async (c) => {
  const body = await c.req.json(); // { itemNumero, totalAccBs }
  const { itemNumero, totalAccBs } = body;

  const excelData = loadExcelMatrices();
  if (excelData && itemNumero > 0) {
    excelData.itemAccMap.set(Number(itemNumero), Number(totalAccBs) || 0);
  }

  return c.json({ success: true, message: 'Total de accesorios actualizado exitosamente' });
});

// GET /api/calculo/matriz-prenda/:productoId - Matriz por prenda individual
//
// UNIFICADO (Fase 2). Antes esta ruta tenia su propia copia de la formula, y en
// realidad casi no calculaba: leia los totales ya hechos del Excel y despejaba el
// costo de tela por resta, `costoTela = max(0, excelCb - costoMO - costoAcc)`.
// Donde el Excel no tenia valor, el costo de tela quedaba en 0: reportaba tela
// gratis, y no por redondeo sino por incapacidad estructural — nunca podia
// costear tela desde la base. El usuario fallo el 29-jul-2026 que gana el numero
// nuevo (causa 2 del arnes de paridad).
//
// Ahora delega en el motor. La aritmetica que habia aca no existe mas.
//
// El shape de la respuesta se conserva campo por campo, porque dashboard.html lee
// estos nombres directo. Se agregan dos campos nuevos, `seOfrece` y `diagnostico`,
// que son aditivos y no rompen a ningun consumidor.
api.get('/matriz-prenda/:productoId', async (c) => {
  try {
    const db = (c as any).db;
    const productoId = c.req.param('productoId');

    const res = await costearPrendaTodasLasTallas(db, productoId);
    if (!res) {
      return c.json({ success: false, error: 'Producto no encontrado' }, 404);
    }
    const { producto: prod, filas } = res;

    const matriz = filas.map((f) => {
      const { meta, resultado } = f;

      // Regla decidida el 29-jul-2026: `precio_venta` es la fuente de verdad de
      // si la prenda se ofrece en esa talla. Sin precio vigente no se ofrece, y
      // los costos se muestran en 0 en vez de prorratearle un costo fijo a una
      // combinacion que no existe. Reemplaza al viejo `isProduced`, que era una
      // heuristica sobre peso y componentes.
      const existe = meta.seOfrece;

      return {
        tallaId: meta.tallaId,
        tallaCodigo: meta.tallaCodigo,
        tallaNombre: meta.tallaNombre,
        pesoExacto: r2(meta.pesoExactoGramos),
        pesoConMerma: r2(resultado.pesoConMerma),
        mermaPorcentaje: meta.mermaPorcentaje ?? 8,
        costoTela: existe ? resultado.costoTela : 0,
        costoAccesorios: existe ? resultado.costoAccesorios : 0,
        costoManoObra: existe ? resultado.costoManoObra : 0,
        costoBruto: existe ? resultado.costoBruto : 0,
        costoFijosVariable: existe ? resultado.costoFijosVariable : 0,
        // FASE 4: el indirecto ya no viaja disfrazado de costo fijo. Prorrateado
        // sobre volumen ANUAL y proporcional al factorComplejidad, normalizado
        // para que lo absorbido iguale el pool.
        costoIndirecto: existe ? resultado.costoIndirecto : 0,
        costoUnitarioNeto: existe ? resultado.costoUnitarioNeto : 0,
        precioVenta: meta.precioVentaBs,
        ingresoNetoConFactura: existe ? resultado.ingresoNetoConFactura : null,
        ingresoNetoSinFactura: existe ? resultado.ingresoNetoSinFactura : null,
        utilidadConFactura: existe ? resultado.utilidadConFactura : null,
        utilidadSinFactura: existe ? resultado.utilidadSinFactura : null,
        margenConFactura: existe ? resultado.margenConFactura : null,
        margenSinFactura: existe ? resultado.margenSinFactura : null,

        // Aditivos. Lo que antes se resolvia devolviendo 0 en silencio.
        seOfrece: existe,
        diagnostico: {
          ...resultado.diagnostico,
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
      producto: {
        id: prod.id,
        itemNumero: prod.itemNumero,
        descripcion: prod.descripcion,
        factorComplejidad: prod.factorComplejidad,
        modoCosteo: prod.modoCosteo === 'adquirido' ? 'adquirido' : 'confeccion',
      },
      data: matriz,
    });
  } catch (e: any) {
    console.error('matriz-prenda:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

export default api;
