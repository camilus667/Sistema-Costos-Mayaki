import { Hono } from 'hono';
import { eq, and, asc } from 'drizzle-orm';
import { productos, tallas, pesoMateriaPrima, manoObra, telas, accesorios, detalleAccesorio, costosIndirectos } from '../database/schema';
import * as XLSX from 'xlsx';
import { findExcelPath } from '../scripts/seed';
import { saveDbToDisk } from '../database/sqljs';
import { getSystemConfig, setSystemConfig } from '../services/configService';
import { cargarContextoCosteo, ensamblarInputs } from '../services/calculo/costeoInputs.service';
import { calcularCostoTotal } from '../services/calculo/costoTotal.service';

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
  const body = await c.req.json();
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
    await setSystemConfig(db, 'descuento_sin_factura', String(body.descuentoSinFactura));
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

  return c.json({ success: true, message: 'Configuración general del sistema actualizada exitosamente' });
});

let inputsExcelCache: any = null;
const overriddenCellQtyMap = new Map<string, number>();

function loadExcelInputs() {
  if (inputsExcelCache) return inputsExcelCache;

  try {
    const excelPath = findExcelPath();
    const parseXLSX = (XLSX as any).default || XLSX;
    const workbook = parseXLSX.readFile(excelPath);

    // 1. PesoMatPrima
    const pesoSheet = workbook.Sheets['PesoMatPrima'];
    const pesoRows: any[][] = pesoSheet ? parseXLSX.utils.sheet_to_json(pesoSheet, { header: 1 }) : [];
    const tallasHeaderPeso = pesoRows[1]?.slice(2) || [];

    // 2. Acc (Accesorios por prenda + Tabla Auxiliar)
    const accSheet = workbook.Sheets['Acc'];
    const accRows: any[][] = accSheet ? parseXLSX.utils.sheet_to_json(accSheet, { header: 1 }) : [];
    const accHeaders = accRows[1]?.slice(2, 40).map(h => String(h || '').trim()).filter(Boolean) || [];

    // Cargar Tabla Auxiliar (fila 31 en adelante)
    const auxHeaderIdx = accRows.findIndex((r: any) => r && r.some((c: any) => String(c).includes('UNIDAD DE COMPRA') || String(c).includes('COSTO Unitario')));
    const tablaAuxiliarRows = auxHeaderIdx !== -1 ? accRows.slice(auxHeaderIdx + 1).filter((r: any) => r && r[0] && (typeof r[1] === 'number' || !isNaN(Number(r[1])))) : [];

    // 3. ManoDeObra
    const moSheet = workbook.Sheets['ManoDeObra'];
    const moRows: any[][] = moSheet ? parseXLSX.utils.sheet_to_json(moSheet, { header: 1 }) : [];

    // 4. fijosXprenda
    const fxpSheet = workbook.Sheets['fijosXprenda'];
    const fxpRows: any[][] = fxpSheet ? parseXLSX.utils.sheet_to_json(fxpSheet, { header: 1 }) : [];

    // 5. Fij&Var
    const fjvSheet = workbook.Sheets['Fij&Var'];
    const fjvRows: any[][] = fjvSheet ? parseXLSX.utils.sheet_to_json(fjvSheet, { header: 1 }) : [];

    inputsExcelCache = { pesoRows, tallasHeaderPeso, accRows, accHeaders, tablaAuxiliarRows, moRows, fxpRows, fjvRows };
    return inputsExcelCache;
  } catch (e) {
    console.error('Error al cargar datos fijos desde Excel:', e);
    return null;
  }
}

// GET /api/inputs/tabla-auxiliar-accesorios - Tabla Auxiliar completa de Definición y Costos de Accesorios (Hoja Acc)
api.get('/tabla-auxiliar-accesorios', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let accQuery = db.select().from(accesorios);
  if (colegioId && colegioId !== 'all') accQuery = accQuery.where(eq(accesorios.colegioId, colegioId));
  const list = await accQuery;

  const inputs = loadExcelInputs();
  const auxRows = inputs ? inputs.tablaAuxiliarRows : [];

  const auxMap = new Map<number, any>();
  auxRows.forEach((r: any) => {
    const code = Number(r[1]);
    if (code > 0) {
      const cantUd = Number(r[3]) || 1;
      const costoUd = Number(r[4]) || Number(r[5]) || 0;
      const costoUnit = Number(r[5]) || (cantUd > 0 ? costoUd / cantUd : 0);
      const costoUso = Number(r[6]) || costoUnit;

      auxMap.set(code, {
        unidadCompra: r[2] ? String(r[2]).trim() : 'unidad',
        cantidadXUd: cantUd,
        costoUdCompra: parseFloat(costoUd.toFixed(2)),
        costoUnitario: parseFloat(costoUnit.toFixed(4)),
        costoUsoPrendas: parseFloat(costoUso.toFixed(2)),
        ojales: r[7] ? Number(r[7]) : null,
        unidadesPorPrenda: r[8] ? Number(r[8]) : 1,
        unidadesPorMetro: r[9] ? Number(r[9]) : null,
        costoCm2: r[10] ? Number(r[10]) : null,
      });
    }
  });

  const data = list.map((a: any, idx: number) => {
    const codeNum = parseInt(a.codigo || '') || (idx + 1);
    const aux = auxMap.get(codeNum) || {
      unidadCompra: a.unidadCompra || 'unidad',
      cantidadXUd: a.cantidadXUd || 1,
      costoUdCompra: a.costoUdCompra || 0,
      costoUnitario: a.costoUnitario || 0,
      costoUsoPrendas: a.costoUnitario || 0,
      ojales: null,
      unidadesPorPrenda: 1,
      unidadesPorMetro: null,
      costoCm2: null,
    };

    return {
      id: a.id,
      codigo: codeNum,
      descripcion: a.descripcion,
      unidadCompra: aux.unidadCompra,
      cantidadXUd: aux.cantidadXUd,
      costoUdCompra: aux.costoUdCompra,
      costoUnitario: aux.costoUnitario,
      costoUsoPrendas: aux.costoUsoPrendas,
      ojales: aux.ojales,
      unidadesPorPrenda: aux.unidadesPorPrenda,
      unidadesPorMetro: aux.unidadesPorMetro,
      costoCm2: aux.costoCm2,
    };
  });

  return c.json({ success: true, data });
});

// PUT /api/inputs/tabla-auxiliar-accesorios/:id - Actualizar datos de un accesorio en Tabla Auxiliar
api.put('/tabla-auxiliar-accesorios/:id', async (c) => {
  const db = (c as any).db;
  const id = c.req.param('id');
  const body = await c.req.json();

  const {
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
    await db.update(accesorios)
      .set({
        unidadCompra: unidadCompra || 'unidad',
        cantidadXUd: Number(cantidadXUd) || 1,
        costoUdCompra: Number(costoUdCompra) || 0,
        costoUnitario: Number(costoUnitario) || 0,
      })
      .where(eq(accesorios.id, id));

    const inputs = loadExcelInputs();
    if (inputs && inputs.tablaAuxiliarRows) {
      const [accObj] = await db.select().from(accesorios).where(eq(accesorios.id, id)).limit(1);
      if (accObj && accObj.codigo) {
        const codeNum = parseInt(accObj.codigo);
        const row = inputs.tablaAuxiliarRows.find((r: any) => Number(r[1]) === codeNum);
        if (row) {
          if (unidadCompra !== undefined) row[2] = unidadCompra;
          if (cantidadXUd !== undefined) row[3] = Number(cantidadXUd) || 1;
          if (costoUdCompra !== undefined) row[4] = Number(costoUdCompra) || 0;
          if (costoUnitario !== undefined) row[5] = Number(costoUnitario) || 0;
          if (costoUsoPrendas !== undefined) row[6] = Number(costoUsoPrendas) || 0;
          if (ojales !== undefined) row[7] = ojales;
          if (unidadesPorPrenda !== undefined) row[8] = unidadesPorPrenda;
          if (unidadesPorMetro !== undefined) row[9] = unidadesPorMetro;
          if (costoCm2 !== undefined) row[10] = costoCm2;
        }
      }
    }

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
  const allProds = await prodQuery.orderBy(asc(productos.orden), asc(productos.itemNumero));
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  let pesos: any[] = [];
  try {
    pesos = await db.select().from(pesoMateriaPrima);
  } catch (e) {}

  const pesoMap = new Map<string, any>();
  pesos.forEach((p: any) => pesoMap.set(`${p.productoId}_${p.tallaId}`, p));

  const inputs = loadExcelInputs();
  const rows = inputs ? inputs.pesoRows : [];
  const tallasHeader = inputs ? inputs.tallasHeaderPeso : [];

  let globalMermaPct = 8;
  if (rows && rows.length > 0) {
    const mermaRow = rows.find((r: any) => r && String(r[0]).trim().toUpperCase() === 'MERMA');
    if (mermaRow && typeof mermaRow[1] === 'number') {
      globalMermaPct = Number(mermaRow[1]);
    }
  }

  const topMap = new Map<string, number>();
  const bottomMap = new Map<string, number>();

  if (rows && rows.length > 0) {
    const sinMermaHeaderIdx = rows.findIndex((r: any) => r && String(r[0]).toUpperCase().includes('ESTIMADO'));
    const topRows = rows.slice(2, sinMermaHeaderIdx !== -1 ? sinMermaHeaderIdx : 30).filter((r: any) => r && typeof r[0] === 'number');
    const bottomRows = sinMermaHeaderIdx !== -1 ? rows.slice(sinMermaHeaderIdx + 2).filter((r: any) => r && typeof r[0] === 'number') : [];

    topRows.forEach((r: any) => {
      const itemNum = Number(r[0]);
      tallasHeader.forEach((code: any, idx: number) => {
        const val = Number(r[2 + idx]) || 0;
        topMap.set(`${itemNum}_${String(code).trim()}`, val);
      });
    });

    bottomRows.forEach((r: any) => {
      const itemNum = Number(r[0]);
      tallasHeader.forEach((code: any, idx: number) => {
        const val = Number(r[2 + idx]) || 0;
        bottomMap.set(`${itemNum}_${String(code).trim()}`, val);
      });
    });
  }

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
      let exacto = dbRec ? dbRec.pesoExactoGramos : (bottomMap.get(key) || 0);
      let conMerma = dbRec ? dbRec.pesoGramos : (topMap.get(key) || 0);

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

// GET /api/inputs/accesorios-matriz - Matriz completa de los 38 accesorios por prenda
api.get('/accesorios-matriz', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let prodQuery = db.select().from(productos);
  if (colegioId && colegioId !== 'all') prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  const allProds = await prodQuery.orderBy(asc(productos.itemNumero));

  const inputs = loadExcelInputs();
  const accRows = inputs ? inputs.accRows : [];
  const accHeaders = inputs ? inputs.accHeaders : [];

  const accMap = new Map<string, number>();
  const totalAccMap = new Map<number, number>();

  if (accRows && accRows.length > 0) {
    const auxHeaderIdx = accRows.findIndex((r: any) => r && r.some((c: any) => String(c).includes('UNIDAD DE COMPRA') || String(c).includes('COSTO Unitario')));
    const matrixRows = accRows.slice(2, auxHeaderIdx !== -1 ? auxHeaderIdx : 30);

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
          if (itemNum > 0) {
            accHeaders.forEach((h: string, idx: number) => {
              const val = Number(r[2 + idx]) || 0;
              accMap.set(`${itemNum}_${h}`, val);
            });
            const total = Number(r[41]) || 0;
            totalAccMap.set(itemNum, total);
          }
        });
      }
    });
  }

  const auxInfoMap = new Map<string, any>();
  const tablaAux = inputs ? inputs.tablaAuxiliarRows : [];

  let dbAccs: any[] = [];
  try {
    dbAccs = await db.select().from(accesorios);
  } catch (e) {}

  if (dbAccs && dbAccs.length > 0) {
    dbAccs.forEach((a: any) => {
      const name = a.descripcion.trim();
      auxInfoMap.set(name, {
        unidadCompra: a.unidadCompra || 'unidad',
        cantidadXUd: a.cantidadXUd || 1,
        costoUdCompra: a.costoUdCompra || 0,
        costoUnitarioBs: a.costoUnitario || 0,
      });
    });
  }

  if (tablaAux && tablaAux.length > 0) {
    tablaAux.forEach((r: any) => {
      if (r && r[0]) {
        const name = String(r[0]).trim();
        if (!auxInfoMap.has(name)) {
          const dbMatch = dbAccs.find((a: any) => a.descripcion.trim() === name);
          const udComp = dbMatch ? dbMatch.unidadCompra : (r[2] || 'unidad');
          const cantUd = dbMatch ? dbMatch.cantidadXUd : (Number(r[3]) || 1);
          let costoUd = dbMatch ? dbMatch.costoUdCompra : (Number(r[4]) || 0);
          const costF = Number(r[5]) || (cantUd > 0 ? costoUd / cantUd : 0);
          const costG = Number(r[6]) || costF;
          const unitCost = (!isNaN(costG) && costG > 0) ? costG : ((!isNaN(costF) && costF > 0) ? costF : 0);

          if ((costoUd === 0 || isNaN(costoUd)) && unitCost > 0) {
            costoUd = unitCost * cantUd;
          }

          auxInfoMap.set(name, {
            unidadCompra: udComp,
            cantidadXUd: cantUd,
            costoUdCompra: costoUd,
            costoUnitarioBs: unitCost
          });
        }
      }
    });
  }

  const headerList = accHeaders.length > 0 ? accHeaders : (dbAccs.map((a: any) => a.descripcion.trim()));

  const accesoriosInfo = headerList.map((h: string) => {
    const info = auxInfoMap.get(h) || {};
    return {
      nombre: h,
      unidadCompra: info.unidadCompra || 'unidad',
      cantidadXUd: info.cantidadXUd || 1,
      costoUdCompra: info.costoUdCompra || 0,
      costoUnitarioBs: parseFloat((info.costoUnitarioBs || 0).toFixed(4))
    };
  });

  const data = allProds.map((prod: any) => {
    const rowObj: any = {
      productoId: prod.id,
      itemNumero: prod.itemNumero,
      descripcion: prod.descripcion,
      totalAccesoriosBs: parseFloat((totalAccMap.get(prod.itemNumero) || 0).toFixed(2)),
      accesorios: {},
      unidades: {},
      costos: {}
    };

    headerList.forEach((h: string) => {
      const key = `${prod.itemNumero}_${h}`;
      const info = auxInfoMap.get(h) || {};
      const uCost = info.costoUnitarioBs || 0;
      let qty = 0;
      if (overriddenCellQtyMap.has(key)) {
        qty = overriddenCellQtyMap.get(key)!;
      } else {
        const costBs = accMap.get(key) || 0;
        if (costBs > 0) {
          if (uCost > 0) {
            qty = parseFloat((costBs / uCost).toFixed(2));
          } else {
            qty = 1;
          }
        }
      }

      const calculatedCost = parseFloat((qty * uCost).toFixed(2));
      rowObj.accesorios[h] = calculatedCost;
      rowObj.costos[h] = calculatedCost;
      rowObj.unidades[h] = qty;
    });

    let rowSum = 0;
    Object.values(rowObj.accesorios).forEach((v: any) => rowSum += Number(v) || 0);
    rowObj.totalAccesoriosBs = parseFloat(rowSum.toFixed(2));

    return rowObj;
  });

  return c.json({
    success: true,
    accesorios: headerList,
    accesoriosInfo,
    data
  });
});

// Store cell override route
api.put('/accesorios-matriz-celda', async (c) => {
  const body = await c.req.json();
  const { itemNumero, accesorioNombre, cantidad } = body;
  if (itemNumero > 0 && accesorioNombre) {
    overriddenCellQtyMap.set(`${itemNumero}_${accesorioNombre}`, Number(cantidad) || 0);
  }
  return c.json({ success: true });
});

// GET /api/inputs/mano-de-obra - Costos de mano de obra en los 3 grupos de tallas oficiales (2-10, 12-S, M-4XL)
api.get('/mano-de-obra', async (c) => {
  const db = (c as any).db;
  const colegioId = c.req.query('colegioId');

  let prodQuery = db.select().from(productos);
  if (colegioId && colegioId !== 'all') prodQuery = prodQuery.where(eq(productos.colegioId, colegioId));
  const allProds = await prodQuery.orderBy(asc(productos.itemNumero));
  const allTallas = await db.select().from(tallas).orderBy(asc(tallas.orden));

  let moList: any[] = [];
  try {
    moList = await db.select().from(manoObra);
  } catch (e) {}

  const moDbMap = new Map<string, number>();
  moList.forEach((m: any) => moDbMap.set(`${m.productoId}_${m.tallaId}`, m.costoBs));

  const inputs = loadExcelInputs();
  const moRows = inputs ? inputs.moRows : [];
  const moExcelMap = new Map<number, { grupo1: number; grupo2: number; grupo3: number }>();

  if (moRows && moRows.length > 0) {
    moRows.slice(2).forEach((r: any) => {
      if (r && typeof r[0] === 'number') {
        const itemNum = Number(r[0]);
        moExcelMap.set(itemNum, {
          grupo1: Number(r[2]) || 0,
          grupo2: Number(r[3]) || 0,
          grupo3: Number(r[4]) || 0,
        });
      }
    });
  }

  const data = allProds.map((prod: any) => {
    const excelMo = moExcelMap.get(prod.itemNumero) || { grupo1: 0, grupo2: 0, grupo3: 0 };

    const tGroup1 = allTallas.find((t: any) => ['2', '4', '6', '8', '10'].includes(t.codigo));
    const tGroup2 = allTallas.find((t: any) => ['12', '14', '16/34', '36/XS', '38/S'].includes(t.codigo));
    const tGroup3 = allTallas.find((t: any) => ['40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL'].includes(t.codigo));

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
  const allProds = await prodQuery.orderBy(asc(productos.itemNumero));

  const sysConfig = await getSystemConfig(db);

  let indirectosList: any[] = [];
  try {
    let q = db.select().from(costosIndirectos);
    if (colegioId && colegioId !== 'all') q = q.where(eq(costosIndirectos.colegioId, colegioId));
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

    const allTallas = await db.select().from(tallas).where(eq(tallas.colegioId, prod.colegioId));

    for (const tallaObj of allTallas) {
      const code = tallaObj.codigo;
      let costoBs = Number(grupo3) || 0;
      if (['2', '4', '6', '8', '10'].includes(code)) costoBs = Number(grupo1) || 0;
      else if (['12', '14', '16/34', '36/XS', '38/S'].includes(code)) costoBs = Number(grupo2) || 0;

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

    const [tallaObj] = await db.select().from(tallas).where(and(eq(tallas.colegioId, prod.colegioId), eq(tallas.codigo, tallaCodigo))).limit(1);
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

    const ctx = await cargarContextoCosteo(db, { colegioId });
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

    return c.json({ success: true, data });
  } catch (e: any) {
    console.error('desglose-inteligente-producto:', e);
    return c.json({ success: false, error: e?.message || String(e) }, 500);
  }
});

export default api;
