import { getDb, getRawDb, saveDbToDisk } from '../../../api/src/database/sqljs';

export interface PrendaLiquidacion {
  productoId: string;
  itemNumero: number;
  descripcion: string;
  colegioGrupo: string;
  confeccionista: string;
  cantGrupo1: number; // T2-10
  cantGrupo2: number; // T12-S
  cantGrupo3: number; // TM-4XL
  rateGrupo1: number;
  rateGrupo2: number;
  rateGrupo3: number;
  unidadesTotal: number;
  montoPagarBs: number;
}

export interface TalleristaResumen {
  confeccionista: string;
  totalUnidades: number;
  montoTotalBs: number;
  prendasCount: number;
  prendas: PrendaLiquidacion[];
}

export function determinarConfeccionistaDefecto(nombrePrenda: string): string {
  const norm = (nombrePrenda || '').toLowerCase().trim();
  if (norm.includes('camisa') || norm.includes('blusa')) {
    return 'Camisero';
  }
  if (norm.includes('polera') || norm.includes('camiseta') || norm.includes('calza')) {
    return 'Polerero / Deportivo';
  }
  if (norm.includes('chamarra') || norm.includes('buzo') || norm.includes('parka') || norm.includes('saco') || norm.includes('chaleco') || norm.includes('chompa')) {
    return 'Chamarrero';
  }
  if (norm.includes('pantalon') || norm.includes('pantalón') || norm.includes('bermuda') || norm.includes('short') || norm.includes('falda') || norm.includes('jumper') || norm.includes('overol')) {
    return 'Pantalonero';
  }
  return 'Otros Confeccionistas';
}

function bandaManoObra(tallaCodigo: string): 1 | 2 | 3 {
  const norm = (tallaCodigo || '').trim().toUpperCase();
  const n = parseInt(norm, 10);
  if (!isNaN(n)) {
    if (n >= 2 && n <= 10) return 1;
    if (n >= 12 && n <= 16) return 2;
    return 3;
  }
  if (norm === 'XS' || norm === 'S' || norm === '4' || norm === '6' || norm === '8' || norm === '10') return norm === 'XS' || norm === 'S' ? 2 : 1;
  return 3;
}

export async function asegurarColumnaConfeccionista(): Promise<void> {
  await getDb();
  const raw = getRawDb();
  try {
    const res = raw.exec("PRAGMA table_info('producto')");
    if (res && res.length > 0 && res[0].values) {
      const exists = res[0].values.some((col: any) => col[1] === 'confeccionista');
      if (!exists) {
        raw.run("ALTER TABLE 'producto' ADD COLUMN 'confeccionista' TEXT");
        saveDbToDisk();
      }
    }
  } catch (e) {
    console.error('Error al asegurar columna confeccionista:', e);
  }
}

export async function actualizarConfeccionistaPrenda(productoId: string, confeccionista: string): Promise<boolean> {
  await asegurarColumnaConfeccionista();
  const raw = getRawDb();
  try {
    raw.run("UPDATE 'producto' SET 'confeccionista' = ? WHERE 'id' = ?", [confeccionista.trim(), productoId]);
    saveDbToDisk();
    return true;
  } catch (e) {
    console.error('Error actualizando confeccionista de prenda:', e);
    return false;
  }
}

export async function obtenerLiquidacionTalleristas(
  talleristaFiltro?: string,
  origenFiltro: 'total' | 'ventas' | 'stock' = 'total',
  anio: number = 2026
): Promise<{ success: boolean; data: TalleristaResumen[]; kpis: any }> {
  await asegurarColumnaConfeccionista();
  const raw = getRawDb();

  try {
    // Helper para ejecutar query y devolver array de objetos
    const queryObjs = (sql: string, params: any[] = []): any[] => {
      const res = raw.exec(sql, params);
      if (!res || res.length === 0) return [];
      const columns = res[0].columns;
      return res[0].values.map((row: any[]) => {
        const obj: any = {};
        columns.forEach((col: string, idx: number) => {
          obj[col] = row[idx];
        });
        return obj;
      });
    };

    // 1. Cargar productos y sus tipos de prenda
    const allProds = queryObjs(`
      SELECT p.id, p.item_numero, p.descripcion, p.confeccionista, p.tipo_prenda_id, c.nombre as colegio_nombre
      FROM producto p
      LEFT JOIN colegio c ON p.colegio_id = c.id
      ORDER BY p.item_numero ASC
    `);

    // 2. Cargar tarifas de mano de obra por tipo de prenda
    let allMO: any[] = [];
    try {
      allMO = queryObjs(`
        SELECT mot.tipo_prenda_id, t.codigo as talla_codigo, mot.costo_bs
        FROM mano_obra_tipo mot
        JOIN talla t ON mot.talla_id = t.id
      `);
    } catch (e) {}

    const ratesByTipo: Record<string, { r1: number; r2: number; r3: number }> = {};
    allMO.forEach((m: any) => {
      const tipoId = m.tipo_prenda_id;
      if (!ratesByTipo[tipoId]) ratesByTipo[tipoId] = { r1: 0, r2: 0, r3: 0 };
      const banda = bandaManoObra(m.talla_codigo);
      if (banda === 1 && m.costo_bs > ratesByTipo[tipoId].r1) ratesByTipo[tipoId].r1 = m.costo_bs;
      if (banda === 2 && m.costo_bs > ratesByTipo[tipoId].r2) ratesByTipo[tipoId].r2 = m.costo_bs;
      if (banda === 3 && m.costo_bs > ratesByTipo[tipoId].r3) ratesByTipo[tipoId].r3 = m.costo_bs;
    });

    // 3. Cargar ventas acumuladas POS agrupadas por prenda (limpiando nombre) y talla
    const anioNum = parseInt(String(anio), 10);
    const ventasRaw = queryObjs(`
      SELECT nombre_limpio as detalle_item, talla, SUM(cantidad) as total_unidades
      FROM pos_venta
      WHERE (? IS NULL OR anio = ?)
      GROUP BY nombre_limpio, talla
    `, [anioNum, anioNum]);

    const ventasMap: Record<string, Record<string, number>> = {}; // key: descLimpia -> talla -> cnt
    ventasRaw.forEach((v: any) => {
      const itemDesc = (v.detalle_item || '').toLowerCase().trim();
      const talla = (v.talla || '').trim().toUpperCase();
      if (!ventasMap[itemDesc]) ventasMap[itemDesc] = {};
      ventasMap[itemDesc][talla] = (ventasMap[itemDesc][talla] || 0) + (v.total_unidades || 0);
    });

    // 4. Cargar stock actual de inventario
    let stockRaw: any[] = [];
    try {
      stockRaw = queryObjs(`
        SELECT i.producto_id, t.codigo as talla_codigo, i.stock_fisico
        FROM inventario_fisico i
        JOIN talla t ON i.talla_id = t.id
        WHERE i.stock_fisico > 0
      `);
    } catch (e) {}

    const stockMap: Record<string, Record<string, number>> = {}; // key: prodId -> talla -> stock
    stockRaw.forEach((s: any) => {
      const pId = s.producto_id;
      const talla = (s.talla_codigo || '').trim().toUpperCase();
      if (!stockMap[pId]) stockMap[pId] = {};
      stockMap[pId][talla] = (stockMap[pId][talla] || 0) + (s.stock_fisico || 0);
    });

    // 5. Procesar prendas y calcular liquidación por confeccionista
    const resumenMap: Record<string, TalleristaResumen> = {};

    allProds.forEach((p: any) => {
      const conf = (p.confeccionista || determinarConfeccionistaDefecto(p.descripcion)).trim();
      if (talleristaFiltro && talleristaFiltro !== 'todos' && conf.toLowerCase() !== talleristaFiltro.toLowerCase()) {
        return;
      }

      const rates = (p.tipo_prenda_id && ratesByTipo[p.tipo_prenda_id] && ratesByTipo[p.tipo_prenda_id].r1 > 0)
        ? ratesByTipo[p.tipo_prenda_id]
        : { r1: 6.5, r2: 7.5, r3: 8.5 }; // Fallback estimado de costura

      let c1 = 0, c2 = 0, c3 = 0;

      // Sumar unidades vendidas
      const descNorm = p.descripcion.toLowerCase().trim();
      const vTallas = ventasMap[descNorm] || {};
      Object.entries(vTallas).forEach(([talla, cnt]) => {
        if (origenFiltro === 'total' || origenFiltro === 'ventas') {
          const b = bandaManoObra(talla);
          if (b === 1) c1 += cnt;
          else if (b === 2) c2 += cnt;
          else c3 += cnt;
        }
      });

      // Sumar unidades stock
      const sTallas = stockMap[p.id] || {};
      Object.entries(sTallas).forEach(([talla, stockCnt]) => {
        if (origenFiltro === 'total' || origenFiltro === 'stock') {
          const b = bandaManoObra(talla);
          if (b === 1) c1 += stockCnt;
          else if (b === 2) c2 += stockCnt;
          else c3 += stockCnt;
        }
      });

      const totalU = c1 + c2 + c3;
      const montoBs = (c1 * rates.r1) + (c2 * rates.r2) + (c3 * rates.r3);

      if (!resumenMap[conf]) {
        resumenMap[conf] = {
          confeccionista: conf,
          totalUnidades: 0,
          montoTotalBs: 0,
          prendasCount: 0,
          prendas: []
        };
      }

      resumenMap[conf].totalUnidades += totalU;
      resumenMap[conf].montoTotalBs += montoBs;
      resumenMap[conf].prendasCount += 1;
      resumenMap[conf].prendas.push({
        productoId: p.id,
        itemNumero: p.item_numero,
        descripcion: p.descripcion,
        colegioGrupo: p.colegio_nombre || 'General',
        confeccionista: conf,
        cantGrupo1: c1,
        cantGrupo2: c2,
        cantGrupo3: c3,
        rateGrupo1: rates.r1,
        rateGrupo2: rates.r2,
        rateGrupo3: rates.r3,
        unidadesTotal: totalU,
        montoPagarBs: parseFloat(montoBs.toFixed(2))
      });
    });

    const listaTalleristas = Object.values(resumenMap);
    let totalUnidadesGlobal = 0;
    let montoTotalGlobalBs = 0;
    listaTalleristas.forEach(t => {
      totalUnidadesGlobal += t.totalUnidades;
      montoTotalGlobalBs += t.montoTotalBs;
    });

    return {
      success: true,
      data: listaTalleristas,
      kpis: {
        totalUnidadesGlobal,
        montoTotalGlobalBs: parseFloat(montoTotalGlobalBs.toFixed(2)),
        totalTalleristas: listaTalleristas.length,
      }
    };
  } catch (e: any) {
    console.error('Error calculando liquidación de talleristas:', e);
    return {
      success: false,
      data: [],
      kpis: { totalUnidadesGlobal: 0, montoTotalGlobalBs: 0, totalTalleristas: 0 }
    };
  }
}
