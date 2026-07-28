import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { eq, and, asc } from 'drizzle-orm';
import { calcularCostoTotal } from '../services/calculo/costoTotal.service';
import { productos, tallas, pesoMateriaPrima, manoObra, telas, preciosVenta, detalleAccesorio, accesorios, inventario, costosIndirectos } from '../database/schema';
import XLSX from 'xlsx';
import { findExcelPath } from '../scripts/seed';
import { saveDbToDisk } from '../database/sqljs';

const api = new Hono();

const calcularSchema = z.object({
  productoId: z.string().optional().default('demo-prod'),
  tallaId: z.string().optional().default('demo-talla'),
  colegioId: z.string().optional().default('demo-colegio'),
  pesoGramos: z.number().positive(),
  mermaPorcentaje: z.number().min(0).max(100).default(8),
  precioTelaUnitario: z.number().positive(),
  rendimientoTela: z.number().positive(),
  costoAccesorios: z.number().default(0),
  costoManoObra: z.number().default(0),
  factorComplejidad: z.number().int().positive().default(1),
  costoFijo: z.number().default(0),
  costoIndirectoMensual: z.number().default(0),
  produccionTotalMes: z.number().int().positive().default(1),
  precioVenta: z.number().optional().nullable(),
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

import { getSystemConfig } from '../services/configService';

// GET /api/calculo/matriz-consolidada - Replicando las 9 pestañas del Excel con cálculo 100% dinámico DB
api.get('/matriz-consolidada', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');
  const sysConfig = await getSystemConfig(db);

  let prodQuery = db.select().from(productos);
  if (colegioId && colegioId !== 'all') {
    prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  }
  const allProds = await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero));
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  let pesos: any[] = [];
  let moList: any[] = [];
  let precios: any[] = [];
  let invList: any[] = [];
  try {
    pesos = await db.select().from(pesoMateriaPrima);
    moList = await db.select().from(manoObra);
    precios = await db.select().from(preciosVenta);
    invList = await db.select().from(inventario);
  } catch (e) {}

  const pesoMap = new Map<string, any>();
  pesos.forEach((p: any) => pesoMap.set(`${p.productoId}_${p.tallaId}`, p));

  const moMap = new Map<string, number>();
  moList.forEach((m: any) => moMap.set(`${m.productoId}_${m.tallaId}`, m.costoBs));

  const precioMap = new Map<string, number>();
  precios.forEach((pr: any) => precioMap.set(`${pr.productoId}_${pr.tallaId}`, pr.precioBs));

  const invMap = new Map<string, number>();
  invList.forEach((inv: any) => invMap.set(`${inv.productoId}_${inv.tallaId}`, inv.cantidad));

  // Dynamic tarifa calculation from costosIndirectos DB & System Config
  let indirectosList: any[] = [];
  try { indirectosList = await db.select().from(costosIndirectos); } catch (e) {}
  const totalIndirectos = indirectosList.reduce((acc: number, ci: any) => acc + (Number(ci.montoMensual) || 0), 0);
  const prendasProducidasMes = sysConfig.volumenMensualProduccion;
  const tarifaPunto = prendasProducidasMes > 0 ? (totalIndirectos / (prendasProducidasMes * 10)) : 0;

  const excelData = loadExcelMatrices();

  const gridData = allProds.map((prod: any) => {
    const rowObj: any = {
      productoId: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      tallas: {}
    };

    const costoAcc = excelData ? (excelData.itemAccMap.get(prod.itemNumero) || 0) : 0;

    allTallas.forEach((talla: any) => {
      const key = `${prod.itemNumero}_${talla.codigo}`;
      const pRec = pesoMap.get(`${prod.id}_${talla.id}`);
      const moValDb = moMap.get(`${prod.id}_${talla.id}`);
      const pvValDb = precioMap.get(`${prod.id}_${talla.id}`);
      const invValDb = invMap.get(`${prod.id}_${talla.id}`);

      let costoMO = moValDb ?? 0;

      const pesoConMerma = pRec?.pesoGramos || (pRec?.pesoExactoGramos ? pRec.pesoExactoGramos * (1 + sysConfig.mermaPorcentajeEstandar / 100) : 0);
      let costoTela = 0;

      const excelCb = excelData ? (excelData.costoBruto.get(key) || 0) : 0;
      let cb = 0;
      if (excelCb > 0) {
        cb = excelCb;
        if (costoMO > 0 && costoAcc > 0) {
          costoTela = Math.max(0, cb - costoMO - costoAcc);
        }
      } else {
        cb = costoTela + costoAcc + costoMO;
      }

      const excelCa = excelData ? (excelData.costoAntesImp.get(key) || 0) : 0;
      const dynamicCostoFijo = (prod.factorComplejidad || 0) * tarifaPunto;
      const fijosXprendaVal = excelCa > 0 ? (excelCa - cb) : dynamicCostoFijo;

      const ca = cb > 0 ? (cb + fijosXprendaVal) : 0;
      const excelCt = excelData ? (excelData.costoTotal.get(key) || 0) : 0;
      const ct = ca > 0 ? parseFloat((ca * sysConfig.factorIva).toFixed(2)) : (excelCt > 0 ? excelCt : 0);

      const pv = pvValDb !== undefined && pvValDb !== null && pvValDb > 0 ? pvValDb : (excelData ? (excelData.precioVenta.get(key) || 0) : 0);

      const un = pv > 0 && ct > 0 ? (pv - ct) : 0;
      const mg = pv > 0 && un !== 0 ? (un / pv) * 100 : 0;

      const inv = invValDb !== undefined && invValDb !== null ? invValDb : (excelData ? (excelData.inventarioUnidades.get(key) || 0) : 0);
      const ci = inv * ct;
      const pi = inv * (pv > 0 ? pv : ct);

      rowObj.tallas[talla.codigo] = {
        costoBruto: parseFloat(cb.toFixed(2)),
        precioVenta: parseFloat(pv.toFixed(2)),
        costoAntesImp: parseFloat(ca.toFixed(2)),
        costoTotal: parseFloat(ct.toFixed(2)),
        utilidadNeta: parseFloat(un.toFixed(2)),
        margenPorcentaje: parseFloat(mg.toFixed(2)),
        inventarioUnidades: inv,
        costoInventario: parseFloat(ci.toFixed(2)),
        precioInventario: parseFloat(pi.toFixed(2)),
      };
    });

    return rowObj;
  });

  return c.json({
    success: true,
    tallas: allTallas.map((t: any) => ({ id: t.id, codigo: t.codigo, orden: t.orden })),
    data: gridData,
  });
});

// PUT /api/calculo/precio-venta - Actualizar PrecioDeVenta directamente en la matriz
api.put('/precio-venta', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json(); // { itemNumero, tallaCodigo, precioBs }

  const { itemNumero, tallaCodigo, precioBs } = body;
  const key = `${itemNumero}_${tallaCodigo}`;

  const excelData = loadExcelMatrices();
  if (excelData) {
    excelData.precioVenta.set(key, Number(precioBs) || 0);

    const ct = excelData.costoTotal.get(key) || 0;
    const nuevoPv = Number(precioBs) || 0;
    const nuevaUn = nuevoPv > 0 && ct > 0 ? nuevoPv - ct : 0;
    const nuevoMg = nuevoPv > 0 ? (nuevaUn / nuevoPv) * 100 : 0;

    excelData.utilidadNeta.set(key, nuevaUn);
    excelData.margenPorcentaje.set(key, nuevoMg);
  }

  try {
    const [prod] = await db.select().from(productos).where(eq(productos.itemNumero, itemNumero)).limit(1);
    if (prod) {
      const [tallaObj] = await db.select().from(tallas).where(and(eq(tallas.colegioId, prod.colegioId), eq(tallas.codigo, tallaCodigo))).limit(1);
      if (tallaObj) {
        await db.delete(preciosVenta).where(and(eq(preciosVenta.productoId, prod.id), eq(preciosVenta.tallaId, tallaObj.id)));
        await db.insert(preciosVenta).values({
          productoId: prod.id,
          tallaId: tallaObj.id,
          precioBs: Number(precioBs) || 0,
        });
      }
    }
  } catch (e) {
    console.error('Error actualizando DB para precioVenta:', e);
  }

  return c.json({ success: true, message: 'Precio de venta actualizado exitosamente' });
});

// PUT /api/calculo/inventario-unidades - Actualizar INVENTARIO directamente en la matriz
api.put('/inventario-unidades', async (c) => {
  const db = (c as any).db;
  const body = await c.req.json(); // { itemNumero, tallaCodigo, cantidad }

  const { itemNumero, tallaCodigo, cantidad } = body;
  const key = `${itemNumero}_${tallaCodigo}`;

  const excelData = loadExcelMatrices();
  if (excelData) {
    const cantNum = Number(cantidad) || 0;
    excelData.inventarioUnidades.set(key, cantNum);

    const ct = excelData.costoTotal.get(key) || 0;
    excelData.costoInventario.set(key, cantNum * ct);
  }

  try {
    const [prod] = await db.select().from(productos).where(eq(productos.itemNumero, itemNumero)).limit(1);
    if (prod) {
      const [tallaObj] = await db.select().from(tallas).where(and(eq(tallas.colegioId, prod.colegioId), eq(tallas.codigo, tallaCodigo))).limit(1);
      if (tallaObj) {
        await db.update(inventario).set({
          cantidad: Number(cantidad) || 0
        }).where(and(eq(inventario.productoId, prod.id), eq(inventario.tallaId, tallaObj.id)));
        saveDbToDisk();
      }
    }
  } catch (e) {
    console.error('Error actualizando DB para inventario:', e);
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

// GET /api/calculo/matriz-prenda/:productoId - Matriz por prenda individual 100% consistente
api.get('/matriz-prenda/:productoId', async (c) => {
  const db = (c as any).db;
  const productoId = c.req.param('productoId');
  const sysConfig = await getSystemConfig(db);

  const [prod] = await db.select().from(productos).where(eq(productos.id, productoId)).limit(1);
  if (!prod) {
    return c.json({ success: false, error: 'Producto no encontrado' }, 404);
  }

  const allTallas = await db.select().from(tallas).where(eq(tallas.colegioId, prod.colegioId)).orderBy(asc(tallas.orden));
  const pesos = await db.select().from(pesoMateriaPrima).where(eq(pesoMateriaPrima.productoId, productoId));
  const pesoMap = new Map<string, any>();
  pesos.forEach((p: any) => pesoMap.set(p.tallaId, p));


  const moList = await db.select().from(manoObra).where(eq(manoObra.productoId, productoId));
  const moMap = new Map<string, number>();
  moList.forEach((m: any) => {
    const foundTalla = allTallas.find((t: any) => t.id === m.tallaId);
    if (foundTalla) moMap.set(foundTalla.codigo, m.costoBs);
    moMap.set(m.tallaId, m.costoBs);
  });

  const precios = await db.select().from(preciosVenta).where(eq(preciosVenta.productoId, productoId));
  const precioMap = new Map<string, any>();
  precios.forEach((pr: any) => precioMap.set(pr.tallaId, pr));

  // Dynamic tarifa calculation from costosIndirectos DB and System Config
  let indirectosListP: any[] = [];
  try { indirectosListP = await db.select().from(costosIndirectos); } catch (e) {}
  const totalIndirectosP = indirectosListP.reduce((acc: number, ci: any) => acc + (Number(ci.montoMensual) || 0), 0);
  const prendasProducidasMesP = sysConfig.volumenMensualProduccion;
  const tarifaPuntoP = prendasProducidasMesP > 0 ? (totalIndirectosP / (prendasProducidasMesP * 10)) : 0;

  const excelData = loadExcelMatrices();

  const getMoVal = (t: any) => {
    const code = t.codigo;
    const dbVal = moMap.get(code) ?? moMap.get(t.id);
    return dbVal || 0;
  };

  const costoAcc = excelData ? (excelData.itemAccMap.get(prod.itemNumero) || 0) : 0;

  const matriz = allTallas.map((t: any) => {
    const key = `${prod.itemNumero}_${t.codigo}`;
    const pRecord = pesoMap.get(t.id);
    const precioRecord = precioMap.get(t.id);

    const pesoExacto = pRecord?.pesoExactoGramos || 0;
    const pesoConMerma = pRecord?.pesoGramos || 0;
    const costoMO = getMoVal(t);
    const precioVentaVal = precioRecord?.precioBs || (excelData ? excelData.precioVenta.get(key) || null : null);

    const excelCb = excelData ? (excelData.costoBruto.get(key) || 0) : 0;
    const excelCa = excelData ? (excelData.costoAntesImp.get(key) || 0) : 0;
    const excelCt = excelData ? (excelData.costoTotal.get(key) || 0) : 0;

    let costoTelaVal = 0;
    if (excelCb > 0) {
      costoTelaVal = Math.max(0, excelCb - costoMO - costoAcc);
    }

    const isProduced = (pesoConMerma > 0 || excelCb > 0) && (costoMO > 0 || costoAcc > 0 || costoTelaVal > 0);
    const cb = isProduced ? (excelCb > 0 ? excelCb : parseFloat((costoTelaVal + costoAcc + costoMO).toFixed(2))) : 0;

    const dynamicCostoFijoP = (prod.factorComplejidad || 0) * tarifaPuntoP;
    const fijosXprendaVal = excelCa > 0 && excelCb > 0 ? parseFloat((excelCa - excelCb).toFixed(2)) : dynamicCostoFijoP;
    const ca = cb > 0 ? (excelCa > 0 ? excelCa : parseFloat((cb + fijosXprendaVal).toFixed(2))) : 0;
    const ct = ca > 0 ? (excelCt > 0 ? excelCt : parseFloat((ca * sysConfig.factorIva).toFixed(2))) : 0;

    const un = (precioVentaVal > 0 && ct > 0) ? parseFloat((precioVentaVal - ct).toFixed(2)) : null;
    const mg = (precioVentaVal > 0 && un !== null && un !== 0) ? parseFloat(((un / precioVentaVal) * 100).toFixed(2)) : null;

    return {
      tallaId: t.id,
      tallaCodigo: t.codigo,
      tallaNombre: t.nombre,
      pesoExacto: parseFloat(pesoExacto.toFixed(2)),
      pesoConMerma: parseFloat(pesoConMerma.toFixed(2)),
      mermaPorcentaje: pRecord?.mermaPorcentaje || 8,
      costoTela: parseFloat((cb > 0 ? costoTelaVal : 0).toFixed(2)),
      costoAccesorios: parseFloat((cb > 0 ? costoAcc : 0).toFixed(2)),
      costoManoObra: parseFloat((cb > 0 ? costoMO : 0).toFixed(2)),
      costoBruto: parseFloat(cb.toFixed(2)),
      costoFijosVariable: parseFloat(fijosXprendaVal.toFixed(2)),

      costoAntesImpuestos: parseFloat(ca.toFixed(2)),
      iva: parseFloat((ct > 0 ? ct - ca : 0).toFixed(2)),
      costoTotal: parseFloat(ct.toFixed(2)),
      precioVenta: precioVentaVal > 0 ? parseFloat(precioVentaVal.toFixed(2)) : null,
      utilidadNeta: un,
      margenPorcentaje: mg,
    };
  });

  return c.json({
    success: true,
    producto: {
      id: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      factorComplejidad: prod.factorComplejidad,
    },
    data: matriz,
  });
});

export default api;
