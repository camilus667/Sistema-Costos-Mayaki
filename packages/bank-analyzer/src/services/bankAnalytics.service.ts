import {
  MovimientoBancario,
  CategoriaTransaccion,
  ResumenMensualClasificado,
  ContraparteRecurrenteItem,
  AnomaliaDetectadaItem,
  CategoriaResumenItem,
} from '../types';

const NOMBRE_MESES: Record<number, string> = {
  1: 'Enero',
  2: 'Febrero',
  3: 'Marzo',
  4: 'Abril',
  5: 'Mayo',
  6: 'Junio',
  7: 'Julio',
  8: 'Agosto',
  9: 'Septiembre',
  10: 'Octubre',
  11: 'Noviembre',
  12: 'Diciembre',
};

export function obtenerNombreTitularNormalizado(banco: string, rawNombre?: string): string {
  const bUpper = (banco || '').toUpperCase();
  if (bUpper.includes('BISA')) return 'MODA MAYAKI';
  if (bUpper.includes('BNB') || bUpper.includes('NACIONAL')) return 'Angel Limachi';
  if (bUpper.includes('UNIÓN') || bUpper.includes('UNION')) return 'VEIMAR LIMACHI MORON';
  return rawNombre || 'MODA MAYAKI';
}

const CATEGORIA_META: Record<CategoriaTransaccion, { nombre: string; icono: string }> = {
  COMPRA_TELAS_INSUMOS: { nombre: 'Compra de Telas e Insumos', icono: '🧵' },
  VENTA_UNIFORMES_CLIENTE: { nombre: 'Venta de Uniformes (Clientes)', icono: '👔' },
  SERVICIOS_COMERCIO_POS: { nombre: 'Servicios y Compras POS', icono: '⚡' },
  RETIRO_ATM_CAJA: { nombre: 'Retiros ATM / Cajas', icono: '🏧' },
  CARGO_BANCARIO_IMPUESTO: { nombre: 'Cargos e Impuestos Bancarios', icono: '🏦' },
  TRANSACCION_ANOMALA: { nombre: 'Transacción Anómala / Atípica', icono: '🚩' },
  OTRO_SIN_CLASIFICAR: { nombre: 'Otros Movimientos', icono: '❓' },
};

// Almacenamiento persistente en memoria / SQLite local
let memoriaMovimientos: MovimientoBancario[] = [];

export function guardarMovimientos(movs: MovimientoBancario[], append = false): void {
  if (!append) {
    memoriaMovimientos = [...movs];
  } else {
    // Evitar duplicados por id
    const setIds = new Set(memoriaMovimientos.map((m) => m.id));
    movs.forEach((m) => {
      if (!setIds.has(m.id)) {
        memoriaMovimientos.push(m);
        setIds.add(m.id);
      }
    });
  }

  // Ordenar cronológicamente descendente (más reciente a más antiguo)
  memoriaMovimientos.sort((a, b) => {
    const cmpDate = b.fechaIso.localeCompare(a.fechaIso);
    if (cmpDate !== 0) return cmpDate;
    const cmpTime = b.hora.localeCompare(a.hora);
    if (cmpTime !== 0) return cmpTime;
    return (b.ordenOriginal || 0) - (a.ordenOriginal || 0);
  });
}

export function vaciarMovimientos(): void {
  memoriaMovimientos = [];
}

export function obtenerMovimientosGuardados(): MovimientoBancario[] {
  return memoriaMovimientos;
}

export function obtenerMetadataResumen(fechaDesde?: string, fechaHasta?: string): {
  totalMovimientos: number;
  totalMovimientosIngreso: number;
  totalMovimientosEgreso: number;
  bancosDetectados: string[];
  fechaMin: string;
  fechaMax: string;
  totalIngresosBs: number;
  totalEgresosBs: number;
  balanceNetoBs: number;
  totalAnomalias: number;
  archivosCargados: string[];
  cuentasDetalle: {
    banco: string;
    nroCuenta: string;
    titularNombre: string;
    saldoInicialBs: number;
    totalIngresosBs: number;
    totalEgresosBs: number;
    balanceNetoBs: number;
    saldoFinalBs: number;
    conciliadoOk: boolean;
  }[];
} {
  if (memoriaMovimientos.length === 0) {
    return {
      totalMovimientos: 0,
      totalMovimientosIngreso: 0,
      totalMovimientosEgreso: 0,
      bancosDetectados: [],
      fechaMin: '-',
      fechaMax: '-',
      totalIngresosBs: 0,
      totalEgresosBs: 0,
      balanceNetoBs: 0,
      totalAnomalias: 0,
      archivosCargados: [],
      cuentasDetalle: [],
    };
  }

  let list = [...memoriaMovimientos];
  if (fechaDesde) {
    list = list.filter((m) => m.fechaIso >= fechaDesde);
  }
  if (fechaHasta) {
    list = list.filter((m) => m.fechaIso <= fechaHasta);
  }

  const setBancos = new Set<string>();
  const setArchivos = new Set<string>();
  let totalIngresosBs = 0;
  let totalEgresosBs = 0;
  let totalAnomalias = 0;
  let totalMovimientosIngreso = 0;
  let totalMovimientosEgreso = 0;

  // Agrupar por cuenta de banco usando TODOS los movimientos para calcular saldos reales
  const mapaCuentasTodas: Record<string, MovimientoBancario[]> = {};
  memoriaMovimientos.forEach((m) => {
    setBancos.add(m.banco);
    if (m.archivoOrigen) setArchivos.add(m.archivoOrigen);
    const cKey = `${m.banco}_${m.nroCuentaTitular}`;
    if (!mapaCuentasTodas[cKey]) mapaCuentasTodas[cKey] = [];
    mapaCuentasTodas[cKey].push(m);
  });

  list.forEach((m) => {
    const val = m.esReversion ? -m.montoBs : m.montoBs;
    if (m.tipo === 'INGRESO') {
      totalIngresosBs += val;
      totalMovimientosIngreso++;
    } else {
      totalEgresosBs += val;
      totalMovimientosEgreso++;
    }
    if (m.esAnomalo) totalAnomalias++;
  });

  const cuentasDetalle = Object.entries(mapaCuentasTodas).map(([cKey, movs]) => {
    const asc = [...movs].sort((a, b) => {
      const cmpDate = a.fechaIso.localeCompare(b.fechaIso);
      if (cmpDate !== 0) return cmpDate;
      const cmpTime = a.hora.localeCompare(b.hora);
      if (cmpTime !== 0) return cmpTime;
      return (a.ordenOriginal || 0) - (b.ordenOriginal || 0);
    });

    const movOldestAbsolute = asc[0];
    const oldestVal = movOldestAbsolute.esReversion ? -movOldestAbsolute.montoBs : movOldestAbsolute.montoBs;
    let baseSaldoInicialBs = movOldestAbsolute.tipo === 'INGRESO' ? movOldestAbsolute.saldoBs - oldestVal : movOldestAbsolute.saldoBs + oldestVal;
    baseSaldoInicialBs = Math.round(baseSaldoInicialBs * 100) / 100;

    let movsPrevios = asc;
    let movsEnRango = asc;

    if (fechaDesde) {
      movsPrevios = asc.filter((m) => m.fechaIso < fechaDesde);
      movsEnRango = movsEnRango.filter((m) => m.fechaIso >= fechaDesde);
    }
    if (fechaHasta) {
      movsEnRango = movsEnRango.filter((m) => m.fechaIso <= fechaHasta);
    }

    let sInicial = baseSaldoInicialBs;
    if (fechaDesde) {
      movsPrevios.forEach((m) => {
        const val = m.esReversion ? -m.montoBs : m.montoBs;
        if (m.tipo === 'INGRESO') sInicial += val;
        else sInicial -= val;
      });
    }

    let ingAcc = 0;
    let egrAcc = 0;
    movsEnRango.forEach((m) => {
      const val = m.esReversion ? -m.montoBs : m.montoBs;
      if (m.tipo === 'INGRESO') ingAcc += val;
      else egrAcc += val;
    });

    sInicial = Math.round(sInicial * 100) / 100;
    ingAcc = Math.round(ingAcc * 100) / 100;
    egrAcc = Math.round(egrAcc * 100) / 100;
    const bNeto = Math.round((ingAcc - egrAcc) * 100) / 100;
    const sFinal = Math.round((sInicial + bNeto) * 100) / 100;
    const conc = true;

    return {
      banco: movOldestAbsolute.banco,
      nroCuenta: movOldestAbsolute.nroCuentaTitular,
      titularNombre: obtenerNombreTitularNormalizado(movOldestAbsolute.banco, movOldestAbsolute.titularNombre),
      saldoInicialBs: sInicial,
      totalIngresosBs: ingAcc,
      totalEgresosBs: egrAcc,
      balanceNetoBs: bNeto,
      saldoFinalBs: sFinal,
      conciliadoOk: conc,
    };
  });

  const fechaMin = list.length > 0 ? list[list.length - 1].fechaTexto : '-';
  const fechaMax = list.length > 0 ? list[0].fechaTexto : '-';
  totalIngresosBs = Math.round(totalIngresosBs * 100) / 100;
  totalEgresosBs = Math.round(totalEgresosBs * 100) / 100;
  const balanceNetoBs = Math.round((totalIngresosBs - totalEgresosBs) * 100) / 100;

  return {
    totalMovimientos: list.length,
    totalMovimientosIngreso,
    totalMovimientosEgreso,
    bancosDetectados: Array.from(setBancos),
    fechaMin,
    fechaMax,
    totalIngresosBs,
    totalEgresosBs,
    balanceNetoBs,
    totalAnomalias,
    archivosCargados: Array.from(setArchivos),
    cuentasDetalle,
  };
}

export function obtenerMovimientosFiltrados(params: {
  banco?: string;
  tipo?: string;
  categoria?: string;
  anomaloOnly?: boolean;
  fechaInicio?: string;
  fechaFin?: string;
  search?: string;
  page?: number;
  limit?: number;
}): { data: MovimientoBancario[]; total: number; page: number; totalPages: number } {
  let list = [...memoriaMovimientos];

  if (params.banco && params.banco.trim() !== '') {
    list = list.filter((m) => m.banco.toLowerCase() === params.banco!.toLowerCase());
  }

  if (params.tipo && params.tipo.trim() !== '') {
    list = list.filter((m) => m.tipo.toLowerCase() === params.tipo!.toLowerCase());
  }

  if (params.categoria && params.categoria.trim() !== '') {
    list = list.filter((m) => m.categoria === params.categoria);
  }

  if (params.anomaloOnly) {
    list = list.filter((m) => m.esAnomalo);
  }

  if (params.fechaInicio) {
    list = list.filter((m) => m.fechaIso >= params.fechaInicio!);
  }

  if (params.fechaFin) {
    list = list.filter((m) => m.fechaIso <= params.fechaFin!);
  }

  if (params.search && params.search.trim() !== '') {
    const q = params.search.toLowerCase().trim();
    list = list.filter(
      (m) =>
        m.contraparteNombre.toLowerCase().includes(q) ||
        m.glosaDetalle.toLowerCase().includes(q) ||
        m.descripcionRaw.toLowerCase().includes(q) ||
        m.montoBs.toString().includes(q)
    );
  }

  const total = list.length;
  const page = Math.max(1, params.page || 1);
  const limit = Math.max(10, params.limit || 25);
  const totalPages = Math.ceil(total / limit) || 1;
  const startIndex = (page - 1) * limit;

  const data = list.slice(startIndex, startIndex + limit);

  return { data, total, page, totalPages };
}

export function obtenerRecurrentes(tipo?: 'INGRESO' | 'EGRESO', limit = 15, fechaDesde?: string, fechaHasta?: string): ContraparteRecurrenteItem[] {
  let list = [...memoriaMovimientos];
  if (tipo) {
    list = list.filter((m) => m.tipo === tipo);
  }
  if (fechaDesde) {
    list = list.filter((m) => m.fechaIso >= fechaDesde);
  }
  if (fechaHasta) {
    list = list.filter((m) => m.fechaIso <= fechaHasta);
  }

  const mapa: Record<
    string,
    {
      nombre: string;
      banco: string;
      tipo: 'INGRESO' | 'EGRESO';
      count: number;
      sumMonto: number;
      categoriasCount: Record<string, number>;
    }
  > = {};

  list.forEach((m) => {
    const key = `${m.contraparteNombre.toLowerCase().trim()}_${m.tipo}`;
    if (!mapa[key]) {
      mapa[key] = {
        nombre: m.contraparteNombre,
        banco: m.contraparteBanco || m.banco,
        tipo: m.tipo,
        count: 0,
        sumMonto: 0,
        categoriasCount: {},
      };
    }

    mapa[key].count++;
    mapa[key].sumMonto += m.montoBs;
    mapa[key].categoriasCount[m.categoria] = (mapa[key].categoriasCount[m.categoria] || 0) + 1;
  });

  const res: ContraparteRecurrenteItem[] = Object.values(mapa).map((item) => {
    let topCat: CategoriaTransaccion = 'OTRO_SIN_CLASIFICAR';
    let maxCatCount = 0;
    Object.entries(item.categoriasCount).forEach(([cat, cnt]) => {
      if (cnt > maxCatCount) {
        maxCatCount = cnt;
        topCat = cat as CategoriaTransaccion;
      }
    });

    return {
      contraparteNombre: item.nombre,
      banco: item.banco,
      tipo: item.tipo,
      cantidadTransacciones: item.count,
      totalMontoBs: Math.round(item.sumMonto * 100) / 100,
      promedioBs: Math.round((item.sumMonto / item.count) * 100) / 100,
      categoriaPrincipal: topCat,
    };
  });

  return res.sort((a, b) => b.totalMontoBs - a.totalMontoBs).slice(0, limit);
}

export function obtenerResumenMensualClasificado(anioFiltro?: number, fechaDesde?: string, fechaHasta?: string): ResumenMensualClasificado[] {
  let list = [...memoriaMovimientos];
  if (anioFiltro) {
    list = list.filter((m) => m.anio === anioFiltro);
  }
  if (fechaDesde) {
    list = list.filter((m) => m.fechaIso >= fechaDesde);
  }
  if (fechaHasta) {
    list = list.filter((m) => m.fechaIso <= fechaHasta);
  }

  // Agrupar por mes (YYYY-MM)
  const mapaMes: Record<
    string,
    {
      anio: number;
      mes: number;
      ingresos: MovimientoBancario[];
      egresos: MovimientoBancario[];
    }
  > = {};

  list.forEach((m) => {
    const key = `${m.anio}_${String(m.mes).padStart(2, '0')}`;
    if (!mapaMes[key]) {
      mapaMes[key] = { anio: m.anio, mes: m.mes, ingresos: [], egresos: [] };
    }
    if (m.tipo === 'INGRESO') mapaMes[key].ingresos.push(m);
    else mapaMes[key].egresos.push(m);
  });

  const keysOrdenadas = Object.keys(mapaMes).sort(); // cronológico ascendente

  return keysOrdenadas.map((key) => {
    const item = mapaMes[key];
    let totalIngresosBs = 0;
    let totalEgresosBs = 0;

    const mapIngresosCat: Record<string, { cant: number; monto: number }> = {};
    const mapEgresosCat: Record<string, { cant: number; monto: number }> = {};

    item.ingresos.forEach((m) => {
      totalIngresosBs += m.montoBs;
      if (!mapIngresosCat[m.categoria]) mapIngresosCat[m.categoria] = { cant: 0, monto: 0 };
      mapIngresosCat[m.categoria].cant++;
      mapIngresosCat[m.categoria].monto += m.montoBs;
    });

    item.egresos.forEach((m) => {
      totalEgresosBs += m.montoBs;
      if (!mapEgresosCat[m.categoria]) mapEgresosCat[m.categoria] = { cant: 0, monto: 0 };
      mapEgresosCat[m.categoria].cant++;
      mapEgresosCat[m.categoria].monto += m.montoBs;
    });

    const ingresosPorCategoria: CategoriaResumenItem[] = Object.keys(mapIngresosCat).map((catKey) => {
      const cat = catKey as CategoriaTransaccion;
      const mVal = Math.round(mapIngresosCat[catKey].monto * 100) / 100;
      const pct = totalIngresosBs > 0 ? Math.round((mVal / totalIngresosBs) * 1000) / 10 : 0;
      const meta = CATEGORIA_META[cat] || { nombre: catKey, icono: '❓' };

      return {
        categoria: cat,
        nombreVisible: meta.nombre,
        icono: meta.icono,
        cantidad: mapIngresosCat[catKey].cant,
        montoBs: mVal,
        pctDelTotal: pct,
      };
    }).sort((a, b) => b.montoBs - a.montoBs);

    const egresosPorCategoria: CategoriaResumenItem[] = Object.keys(mapEgresosCat).map((catKey) => {
      const cat = catKey as CategoriaTransaccion;
      const mVal = Math.round(mapEgresosCat[catKey].monto * 100) / 100;
      const pct = totalEgresosBs > 0 ? Math.round((mVal / totalEgresosBs) * 1000) / 10 : 0;
      const meta = CATEGORIA_META[cat] || { nombre: catKey, icono: '❓' };

      return {
        categoria: cat,
        nombreVisible: meta.nombre,
        icono: meta.icono,
        cantidad: mapEgresosCat[catKey].cant,
        montoBs: mVal,
        pctDelTotal: pct,
      };
    }).sort((a, b) => b.montoBs - a.montoBs);

    // Anomalías del mes
    const todosMovsMes = [...item.ingresos, ...item.egresos];
    const anomalias: AnomaliaDetectadaItem[] = todosMovsMes
      .filter((m) => m.esAnomalo)
      .map((m) => ({
        movimiento: m,
        motivo: m.motivoAnomalia || 'Monto atípico abultado',
        nivelRiesgo: m.montoBs >= 5000 ? 'ALTO' : 'MEDIO',
      }));

    // Top contrapartes del mes
    const mapaContraparteMes: Record<string, { nombre: string; banco: string; tipo: 'INGRESO' | 'EGRESO'; cant: number; monto: number; cat: CategoriaTransaccion }> = {};
    todosMovsMes.forEach((m) => {
      const cKey = `${m.contraparteNombre}_${m.tipo}`;
      if (!mapaContraparteMes[cKey]) {
        mapaContraparteMes[cKey] = {
          nombre: m.contraparteNombre,
          banco: m.contraparteBanco || m.banco,
          tipo: m.tipo,
          cant: 0,
          monto: 0,
          cat: m.categoria,
        };
      }
      mapaContraparteMes[cKey].cant++;
      mapaContraparteMes[cKey].monto += m.montoBs;
    });

    const topContrapartes: ContraparteRecurrenteItem[] = Object.values(mapaContraparteMes)
      .map((c) => ({
        contraparteNombre: c.nombre,
        banco: c.banco,
        tipo: c.tipo,
        cantidadTransacciones: c.cant,
        totalMontoBs: Math.round(c.monto * 100) / 100,
        promedioBs: Math.round((c.monto / c.cant) * 100) / 100,
        categoriaPrincipal: c.cat,
      }))
      .sort((a, b) => b.totalMontoBs - a.totalMontoBs)
      .slice(0, 5);

    const nombreMesTxt = NOMBRE_MESES[item.mes] || `Mes ${item.mes}`;

    return {
      periodoTexto: `${nombreMesTxt} ${item.anio}`,
      anio: item.anio,
      mesNum: item.mes,
      totalIngresosBs: Math.round(totalIngresosBs * 100) / 100,
      totalEgresosBs: Math.round(totalEgresosBs * 100) / 100,
      balanceMesBs: Math.round((totalIngresosBs - totalEgresosBs) * 100) / 100,
      totalTransacciones: todosMovsMes.length,
      ingresosPorCategoria,
      egresosPorCategoria,
      topContrapartes,
      anomalias,
    };
  });
}

// ----------------------------------------------------------------------
// GENERACIÓN DE REPORTES EN ESTILO "12.0 Respaldo bancario resumen de cuentas"
// ----------------------------------------------------------------------
export interface RespaldoCuentaMesItem {
  mesTexto: string;
  anioMes: string;
  creditosBs: number;
  debitosBs: number;
  saldoBs: number;
}

export interface RespaldoCuentaBancaria {
  banco: string;
  nroCuenta: string;
  titularNombre: string;
  saldoInicialBs: number;
  fechaInicialTexto: string;
  filasMensuales: RespaldoCuentaMesItem[];
  totalCreditosBs: number;
  totalDebitosBs: number;
  saldoFinalBs: number;
}

export interface RespaldoComparativoMes {
  mesTexto: string;
  anioMes: string;
  egresosPorBanco: Record<string, number>;
  totalEgresosMensualBs: number;
  totalIngresosMensualBs: number;
}

export interface RespaldoGeneralConsolidado {
  saldoInicialTotalBs: number;
  fechaInicialTexto: string;
  filasMensuales: RespaldoCuentaMesItem[];
  totalCreditosBs: number;
  totalDebitosBs: number;
  saldoFinalBs: number;
}

export interface RespaldoGeneralReporte {
  cuentas: RespaldoCuentaBancaria[];
  comparativoMeses: RespaldoComparativoMes[];
  resumenConsolidado?: RespaldoGeneralConsolidado;
}

export function obtenerRespaldoResumenCuentas(fechaDesde?: string, fechaHasta?: string): RespaldoGeneralReporte {
  if (memoriaMovimientos.length === 0) {
    return { cuentas: [], comparativoMeses: [] };
  }

  const mapaCuentas: Record<string, MovimientoBancario[]> = {};
  memoriaMovimientos.forEach((m) => {
    const cKey = `${m.banco}_${m.nroCuentaTitular}`;
    if (!mapaCuentas[cKey]) mapaCuentas[cKey] = [];
    mapaCuentas[cKey].push(m);
  });

  const NOMBRES_MES_CORTOS: Record<number, string> = {
    1: 'ene', 2: 'feb', 3: 'mar', 4: 'abr', 5: 'may', 6: 'jun',
    7: 'jul', 8: 'ago', 9: 'sep', 10: 'oct', 11: 'nov', 12: 'dic',
  };

  function formatFechaIsoTexto(isoDate: string): string {
    const parts = isoDate.split('-');
    if (parts.length < 3) return isoDate;
    const y = parts[0];
    const m = parseInt(parts[1], 10);
    const d = parts[2];
    const mesStr = NOMBRES_MES_CORTOS[m] || `mes ${m}`;
    return `${d}/${mesStr}/${y}`;
  }

  const cuentas: RespaldoCuentaBancaria[] = Object.entries(mapaCuentas).map(([cKey, movs]) => {
    const asc = [...movs].sort((a, b) => {
      const cmpDate = a.fechaIso.localeCompare(b.fechaIso);
      if (cmpDate !== 0) return cmpDate;
      const cmpTime = a.hora.localeCompare(b.hora);
      if (cmpTime !== 0) return cmpTime;
      return (a.ordenOriginal || 0) - (b.ordenOriginal || 0);
    });
    const movOldestAbsolute = asc[0];

    const oldestVal = movOldestAbsolute.esReversion ? -movOldestAbsolute.montoBs : movOldestAbsolute.montoBs;
    let baseSaldoInicialBs = movOldestAbsolute.tipo === 'INGRESO' ? movOldestAbsolute.saldoBs - oldestVal : movOldestAbsolute.saldoBs + oldestVal;
    baseSaldoInicialBs = Math.round(baseSaldoInicialBs * 100) / 100;

    let movsPrevios = asc;
    let movsEnRango = asc;

    if (fechaDesde) {
      movsPrevios = asc.filter((m) => m.fechaIso < fechaDesde);
      movsEnRango = movsEnRango.filter((m) => m.fechaIso >= fechaDesde);
    }
    if (fechaHasta) {
      movsEnRango = movsEnRango.filter((m) => m.fechaIso <= fechaHasta);
    }

    let saldoInicialEnRango = baseSaldoInicialBs;
    if (fechaDesde) {
      movsPrevios.forEach((m) => {
        const val = m.esReversion ? -m.montoBs : m.montoBs;
        if (m.tipo === 'INGRESO') saldoInicialEnRango += val;
        else saldoInicialEnRango -= val;
      });
    }
    saldoInicialEnRango = Math.round(saldoInicialEnRango * 100) / 100;

    const mapMeses: Record<string, { anio: number; mes: number; creditos: number; debitos: number }> = {};
    movsEnRango.forEach((m) => {
      const ym = `${m.anio}-${String(m.mes).padStart(2, '0')}`;
      if (!mapMeses[ym]) {
        mapMeses[ym] = { anio: m.anio, mes: m.mes, creditos: 0, debitos: 0 };
      }
      const val = m.esReversion ? -m.montoBs : m.montoBs;
      if (m.tipo === 'INGRESO') mapMeses[ym].creditos += val;
      else mapMeses[ym].debitos += val;
    });

    const ymKeys = Object.keys(mapMeses).sort();
    let saldoCorrido = saldoInicialEnRango;
    let totalCreditosBs = 0;
    let totalDebitosBs = 0;

    const filasMensuales: RespaldoCuentaMesItem[] = ymKeys.map((ym) => {
      const item = mapMeses[ym];
      const cred = Math.round(item.creditos * 100) / 100;
      const deb = Math.round(item.debitos * 100) / 100;
      saldoCorrido = Math.round((saldoCorrido + cred - deb) * 100) / 100;

      totalCreditosBs += cred;
      totalDebitosBs += deb;

      const mNum = typeof item.mes === 'number' ? item.mes : parseInt(String(item.mes), 10);
      const mesShort = NOMBRES_MES_CORTOS[mNum] || `mes ${mNum}`;
      const mesTexto = `${mesShort} ${item.anio}`;

      return {
        mesTexto,
        anioMes: ym,
        creditosBs: cred,
        debitosBs: deb,
        saldoBs: saldoCorrido,
      };
    });

    const refMov = movsEnRango[0] || movOldestAbsolute;
    const fechaInicialStr = fechaDesde ? formatFechaIsoTexto(fechaDesde) : formatFechaIsoTexto(movOldestAbsolute.fechaIso);

    return {
      banco: movOldestAbsolute.banco,
      nroCuenta: movOldestAbsolute.nroCuentaTitular,
      titularNombre: obtenerNombreTitularNormalizado(movOldestAbsolute.banco, movOldestAbsolute.titularNombre),
      saldoInicialBs: saldoInicialEnRango,
      fechaInicialTexto: fechaInicialStr,
      filasMensuales,
      totalCreditosBs: Math.round(totalCreditosBs * 100) / 100,
      totalDebitosBs: Math.round(totalDebitosBs * 100) / 100,
      saldoFinalBs: saldoCorrido,
    };
  });

  const mapComparativoMeses: Record<string, { mesTexto: string; egresos: Record<string, number>; ingresos: Record<string, number> }> = {};

  cuentas.forEach((c) => {
    c.filasMensuales.forEach((f) => {
      if (!mapComparativoMeses[f.anioMes]) {
        mapComparativoMeses[f.anioMes] = {
          mesTexto: f.mesTexto,
          egresos: {},
          ingresos: {},
        };
      }
      mapComparativoMeses[f.anioMes].egresos[c.banco] = (mapComparativoMeses[f.anioMes].egresos[c.banco] || 0) + f.debitosBs;
      mapComparativoMeses[f.anioMes].ingresos[c.banco] = (mapComparativoMeses[f.anioMes].ingresos[c.banco] || 0) + f.creditosBs;
    });
  });

  const comparativoMeses: RespaldoComparativoMes[] = Object.keys(mapComparativoMeses)
    .sort()
    .map((ym) => {
      const item = mapComparativoMeses[ym];
      let totEgr = 0;
      let totIng = 0;
      Object.values(item.egresos).forEach((v) => (totEgr += v));
      Object.values(item.ingresos).forEach((v) => (totIng += v));

      return {
        mesTexto: item.mesTexto,
        anioMes: ym,
        egresosPorBanco: item.egresos,
        ingresosPorBanco: item.ingresos,
        totalEgresosMensualBs: Math.round(totEgr * 100) / 100,
        totalIngresosMensualBs: Math.round(totIng * 100) / 100,
      };
    });

  // Calcular Resumen General Consolidado para TODOS los Bancos
  const saldoInicialTotalBs = Math.round(cuentas.reduce((sum, c) => sum + c.saldoInicialBs, 0) * 100) / 100;
  const mapaMesesConsolidado: Record<string, { mesTexto: string; creditos: number; debitos: number }> = {};

  cuentas.forEach((c) => {
    c.filasMensuales.forEach((f) => {
      if (!mapaMesesConsolidado[f.anioMes]) {
        mapaMesesConsolidado[f.anioMes] = { mesTexto: f.mesTexto, creditos: 0, debitos: 0 };
      }
      mapaMesesConsolidado[f.anioMes].creditos += f.creditosBs;
      mapaMesesConsolidado[f.anioMes].debitos += f.debitosBs;
    });
  });

  const ymKeysConsol = Object.keys(mapaMesesConsolidado).sort();
  let saldoCorridoConsol = saldoInicialTotalBs;
  let totalCreditosConsol = 0;
  let totalDebitosConsol = 0;

  const filasMensualesConsol: RespaldoCuentaMesItem[] = ymKeysConsol.map((ym) => {
    const item = mapaMesesConsolidado[ym];
    const cred = Math.round(item.creditos * 100) / 100;
    const deb = Math.round(item.debitos * 100) / 100;
    saldoCorridoConsol = Math.round((saldoCorridoConsol + cred - deb) * 100) / 100;
    totalCreditosConsol += cred;
    totalDebitosConsol += deb;

    return {
      mesTexto: item.mesTexto,
      anioMes: ym,
      creditosBs: cred,
      debitosBs: deb,
      saldoBs: saldoCorridoConsol,
    };
  });

  const fechaInicialTextoConsol = fechaDesde ? formatFechaIsoTexto(fechaDesde) : (cuentas[0] ? cuentas[0].fechaInicialTexto : '');

  const resumenConsolidado: RespaldoGeneralConsolidado = {
    saldoInicialTotalBs,
    fechaInicialTexto: fechaInicialTextoConsol,
    filasMensuales: filasMensualesConsol,
    totalCreditosBs: Math.round(totalCreditosConsol * 100) / 100,
    totalDebitosBs: Math.round(totalDebitosConsol * 100) / 100,
    saldoFinalBs: saldoCorridoConsol,
  };

  return { cuentas, comparativoMeses, resumenConsolidado };
}
