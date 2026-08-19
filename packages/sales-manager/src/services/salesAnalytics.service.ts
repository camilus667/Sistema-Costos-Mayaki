import { getDb } from '../../../api/src/database/sqljs';
import { posVentas } from '../../../api/src/database/schema';

export interface VentaResumenColegio {
  colegioGrupo: string;
  totalUnidades: number;
  totalVentaBs: number;
  totalFilas: number;
}

export interface VentaResumenPeriodo {
  periodo: string;
  anio: number;
  mes?: number;
  trimestre?: string;
  colegioGrupo: string;
  totalUnidades: number;
  totalVentaBs: number;
}

export interface DetallePrendaVenta {
  nombreLimpio: string;
  colegioGrupo: string;
  totalUnidades: number;
  totalVentaBs: number;
  precioPromedio: number;
  desgloseTallas: Record<string, number>;
}

export function normalizarColegioNombre(nombre: string): string {
  const norm = (nombre || '').toLowerCase().trim();
  if (!norm) return '';

  if (norm.includes('inf sm') || norm.includes('inf s marcos') || norm.includes('infantil')) {
    return 'inf s marcos';
  }
  if (norm.includes('col sm') || norm.includes('col s marcos') || norm.includes('colegio san marcos')) {
    return 'col s marcos';
  }
  if (norm.includes('intl sm') || norm.includes('intl s marcos') || norm.includes('internacional')) {
    return 'intl s marcos';
  }
  if (norm.includes('cambridge') || norm === 'cc') {
    return 'cambridge';
  }
  if (norm.includes('edad de oro') || norm === 'eo') {
    return 'edad de oro';
  }
  if (norm.includes('saint jude') || norm === 'sj' || norm === 'js') {
    return 'saint jude';
  }
  return norm;
}

export function esEstadoValido(estado?: string): boolean {
  if (!estado) return true;
  const norm = estado.toLowerCase().trim();
  return norm !== 'cancelado' && !norm.includes('cancelad') && norm !== 'anulado' && !norm.includes('anulad');
}

export async function obtenerResumenColegios(
  colegioFiltro?: string,
  anioFiltro?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<VentaResumenColegio[]> {
  const db = await getDb();
  let todas: any[] = db.select().from(posVentas).all();
  todas = todas.filter((v) => esEstadoValido(v.estado));

  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    todas = todas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
  }

  const inicioIso = normalizarFechaIso(fechaInicioStr);
  const finIso = normalizarFechaIso(fechaFinStr);

  if (inicioIso) {
    todas = todas.filter((v) => v.fechaIso && v.fechaIso >= inicioIso);
  }
  if (finIso) {
    todas = todas.filter((v) => v.fechaIso && v.fechaIso <= finIso);
  }

  if (anioFiltro) {
    const anioNum = parseInt(String(anioFiltro), 10);
    todas = todas.filter((v) => parseInt(String(v.anio), 10) === anioNum);
  }

  const mapa: Record<string, { unidades: number; monto: number; filas: number }> = {};

  todas.forEach((v) => {
    const cg = v.colegioGrupo || 'General';
    if (!mapa[cg]) mapa[cg] = { unidades: 0, monto: 0, filas: 0 };
    mapa[cg].unidades += v.cantidad || 0;
    mapa[cg].monto += v.totalCobrado || v.subtotal || 0;
    mapa[cg].filas++;
  });

  return Object.keys(mapa).map((cg) => ({
    colegioGrupo: cg,
    totalUnidades: Math.round(mapa[cg].unidades * 100) / 100,
    totalVentaBs: Math.round(mapa[cg].monto * 100) / 100,
    totalFilas: mapa[cg].filas,
  })).sort((a, b) => b.totalUnidades - a.totalUnidades);
}

export async function obtenerResumenPeriodo(
  agrupacion: 'mensual' | 'trimestral' = 'trimestral',
  colegioFiltro?: string,
  anioFiltro?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<VentaResumenPeriodo[]> {
  const db = await getDb();
  let ventas: any[] = db.select().from(posVentas).all();
  ventas = ventas.filter((v) => esEstadoValido(v.estado));

  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    ventas = ventas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
  }

  const inicioIso = normalizarFechaIso(fechaInicioStr);
  const finIso = normalizarFechaIso(fechaFinStr);

  if (inicioIso) {
    ventas = ventas.filter((v) => v.fechaIso && v.fechaIso >= inicioIso);
  }
  if (finIso) {
    ventas = ventas.filter((v) => v.fechaIso && v.fechaIso <= finIso);
  }

  if (anioFiltro) {
    ventas = ventas.filter((v) => v.anio === anioFiltro);
  }

  const mapa: Record<string, VentaResumenPeriodo> = {};

  ventas.forEach((v) => {
    const periodo = agrupacion === 'mensual'
      ? `${v.anio}-${String(v.mes).padStart(2, '0')}`
      : `${v.anio}-${v.trimestre}`;

    const key = `${periodo}_${v.colegioGrupo}`;

    if (!mapa[key]) {
      mapa[key] = {
        periodo,
        anio: v.anio,
        mes: v.mes,
        trimestre: v.trimestre,
        colegioGrupo: v.colegioGrupo,
        totalUnidades: 0,
        totalVentaBs: 0,
      };
    }

    mapa[key].totalUnidades += v.cantidad || 0;
    mapa[key].totalVentaBs += v.totalCobrado || v.subtotal || 0;
  });

  return Object.values(mapa).map((item) => ({
    ...item,
    totalUnidades: Math.round(item.totalUnidades * 100) / 100,
    totalVentaBs: Math.round(item.totalVentaBs * 100) / 100,
  })).sort((a, b) => a.periodo.localeCompare(b.periodo));
}

export async function obtenerVentasPorPrendaYTalla(
  colegioGrupo?: string,
  anio?: number,
  trimestre?: string,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<DetallePrendaVenta[]> {
  const db = await getDb();
  let ventas: any[] = db.select().from(posVentas).all();
  ventas = ventas.filter((v) => esEstadoValido(v.estado));

  if (colegioGrupo && colegioGrupo.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioGrupo);
    ventas = ventas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
  }

  const inicioIso = normalizarFechaIso(fechaInicioStr);
  const finIso = normalizarFechaIso(fechaFinStr);

  if (inicioIso) {
    ventas = ventas.filter((v) => v.fechaIso && v.fechaIso >= inicioIso);
  }
  if (finIso) {
    ventas = ventas.filter((v) => v.fechaIso && v.fechaIso <= finIso);
  }

  if (anio) {
    const anioNum = parseInt(String(anio), 10);
    ventas = ventas.filter((v) => parseInt(String(v.anio), 10) === anioNum);
  }
  if (trimestre) {
    const trimUpper = trimestre.toUpperCase();
    ventas = ventas.filter((v) => (v.trimestre || '').toUpperCase() === trimUpper);
  }

  const mapa: Record<string, { unidades: number; monto: number; colegioGrupo: string; tallas: Record<string, number> }> = {};

  ventas.forEach((v) => {
    const nombre = v.nombreLimpio || v.nombreProductoRaw || 'Sin Nombre';
    const cg = v.colegioGrupo || 'General';
    const key = `${nombre}___${cg}`;

    if (!mapa[key]) {
      mapa[key] = { unidades: 0, monto: 0, colegioGrupo: cg, tallas: {} };
    }

    mapa[key].unidades += v.cantidad || 0;
    mapa[key].monto += v.totalCobrado || v.subtotal || 0;

    const t = v.talla || 'ÚNICA';
    mapa[key].tallas[t] = (mapa[key].tallas[t] || 0) + (v.cantidad || 0);
  });

  return Object.entries(mapa).map(([key, data]) => {
    const [nombre] = key.split('___');
    return {
      nombreLimpio: nombre,
      colegioGrupo: data.colegioGrupo,
      totalUnidades: Math.round(data.unidades * 100) / 100,
      totalVentaBs: Math.round(data.monto * 100) / 100,
      precioPromedio: data.unidades > 0 ? Math.round((data.monto / data.unidades) * 100) / 100 : 0,
      desgloseTallas: data.tallas,
    };
  }).sort((a, b) => b.totalUnidades - a.totalUnidades);
}

export function normalizarFechaIso(fechaStr?: string): string | undefined {
  if (!fechaStr || !fechaStr.trim()) return undefined;
  const str = fechaStr.trim();
  // Formato DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
    const [d, m, y] = str.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }
  return undefined;
}

export async function obtenerRangoFechasVentas(
  colegioFiltro?: string,
  anioFiltro?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<{ fechaInicio: string; fechaFin: string }> {
  const db = await getDb();
  let todas: any[] = db.select().from(posVentas).all();
  todas = todas.filter((v) => esEstadoValido(v.estado));

  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    todas = todas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
  }

  const inicioIso = normalizarFechaIso(fechaInicioStr);
  const finIso = normalizarFechaIso(fechaFinStr);

  if (anioFiltro) {
    const anioNum = parseInt(String(anioFiltro), 10);
    todas = todas.filter((v) => parseInt(String(v.anio), 10) === anioNum);
  }

  if (inicioIso) {
    todas = todas.filter((v) => v.fechaIso && v.fechaIso >= inicioIso);
  }
  if (finIso) {
    todas = todas.filter((v) => v.fechaIso && v.fechaIso <= finIso);
  }

  const fmtFecha = (iso: string) => {
    const partes = (iso || '').split('-');
    if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
    return iso;
  };

  if (inicioIso || finIso) {
    const inicioFmt = inicioIso ? fmtFecha(inicioIso) : (todas.length > 0 ? fmtFecha(todas[0].fechaIso || '') : '-');
    const finFmt = finIso ? fmtFecha(finIso) : (todas.length > 0 ? fmtFecha(todas[todas.length - 1].fechaIso || '') : '-');
    return { fechaInicio: inicioFmt, fechaFin: finFmt };
  }

  if (todas.length === 0) {
    return { fechaInicio: '-', fechaFin: '-' };
  }

  let minIso = todas[0].fechaIso || '2020-01-01';
  let maxIso = todas[0].fechaIso || '2030-12-31';

  todas.forEach((v) => {
    if (v.fechaIso && v.fechaIso < minIso) minIso = v.fechaIso;
    if (v.fechaIso && v.fechaIso > maxIso) maxIso = v.fechaIso;
  });

  return {
    fechaInicio: fmtFecha(minIso),
    fechaFin: fmtFecha(maxIso),
  };
}

export async function obtenerAniosDisponibles(): Promise<number[]> {
  const db = await getDb();
  const todas: any[] = db.select().from(posVentas).all();
  const setAnios = new Set<number>();
  todas.forEach((v) => {
    if (v.anio && !isNaN(Number(v.anio))) {
      setAnios.add(parseInt(String(v.anio), 10));
    }
  });
  return Array.from(setAnios).sort((a, b) => b - a); // orden descendente
}

export interface VentaConsolidadaItem {
  id: string;
  nPedido: string;
  estado: string;
  fecha: string;
  fechaIso: string;
  usuario: string;
  cliente: string;
  nroDoc: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  totalDescuento: number;
  totalCobrado: number;
  colegioGrupo: string;
}

export async function obtenerVentasConsolidadas(
  colegioFiltro?: string,
  anioFiltro?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<VentaConsolidadaItem[]> {
  const db = await getDb();
  let todas: any[] = db.select().from(posVentas).all();
  todas = todas.filter((v) => esEstadoValido(v.estado));

  // 1. Filtrar por colegio si se especifica
  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    todas = todas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
  }

  // 2. Filtrar por rango de fechas ISO si se especifican
  const inicioIso = normalizarFechaIso(fechaInicioStr);
  const finIso = normalizarFechaIso(fechaFinStr);

  if (inicioIso) {
    todas = todas.filter((v) => v.fechaIso && v.fechaIso >= inicioIso);
  }
  if (finIso) {
    todas = todas.filter((v) => v.fechaIso && v.fechaIso <= finIso);
  }

  // 3. Filtrar por año solo si anioFiltro se proporciona
  if (anioFiltro) {
    todas = todas.filter((v) => parseInt(String(v.anio), 10) === anioFiltro);
  }

  // 3. Ordenar desde la más antigua a la más nueva (cronológico ascendente)
  todas.sort((a, b) => {
    const fA = a.fechaIso || a.fecha || '';
    const fB = b.fechaIso || b.fecha || '';
    if (fA !== fB) return fA.localeCompare(fB);
    return (parseInt(a.nPedido, 10) || 0) - (parseInt(b.nPedido, 10) || 0);
  });

  // 4. Identificar pedidos distintos en orden de aparición
  const distintosPedidos: string[] = [];
  let maxPedidoNum = 0;

  todas.forEach((v) => {
    const p = String(v.nPedido || '').trim();
    if (p && !distintosPedidos.includes(p)) {
      distintosPedidos.push(p);
    }
    const num = parseInt(p.replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > maxPedidoNum) maxPedidoNum = num;
  });

  if (maxPedidoNum === 0) maxPedidoNum = 2000 + distintosPedidos.length;

  const totalDistintos = distintosPedidos.length;
  const baseInicial = maxPedidoNum - (totalDistintos - 1);

  const mapaRenumerado: Record<string, string> = {};
  distintosPedidos.forEach((p, idx) => {
    mapaRenumerado[p] = String(baseInicial + idx);
  });

  return todas.map((v) => {
    let cliente = '';
    let nroDoc = '';
    let totalDescuento = Math.max(0, (v.subtotal || 0) - (v.totalCobrado || 0));

    if (v.datosOriginales) {
      try {
        const parsed = JSON.parse(v.datosOriginales);
        if (parsed && typeof parsed === 'object') {
          if (parsed.cliente || parsed.razonSocial) cliente = parsed.cliente || parsed.razonSocial;
          if (parsed.nroDoc || parsed.numeroDocumento) nroDoc = parsed.nroDoc || parsed.numeroDocumento;
          if (typeof parsed.totalDescuento === 'number') totalDescuento = parsed.totalDescuento;
        }
      } catch (e) {
        // Fallback
      }
    }

    const origP = String(v.nPedido || '').trim();
    const pedidoRenumerado = mapaRenumerado[origP] || origP;

    return {
      id: v.id,
      nPedido: pedidoRenumerado,
      estado: v.estado || 'Completado',
      fecha: v.fecha || '',
      fechaIso: v.fechaIso || '',
      usuario: v.usuario || '',
      cliente,
      nroDoc,
      nombreProducto: v.nombreProductoRaw || v.nombreLimpio || '',
      cantidad: v.cantidad || 0,
      precioUnitario: v.precioUnitario || 0,
      totalDescuento: Math.round(totalDescuento * 100) / 100,
      totalCobrado: v.totalCobrado || 0,
      colegioGrupo: v.colegioGrupo || '',
    };
  });
}

export interface ResumenMensualColegioGroup {
  colegioGrupo: string;
  totalUnidadesAnual: number;
  totalVentaBsAnual: number;
  meses: Array<{
    mesNum: number;
    mesNombre: string;
    unidades: number;
    montoBs: number;
  }>;
}

const NOMBRE_MESES: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

export async function obtenerResumenMensualPorColegio(
  anioFiltro?: number
): Promise<ResumenMensualColegioGroup[]> {
  const db = await getDb();
  let ventas: any[] = db.select().from(posVentas).all();
  ventas = ventas.filter((v) => esEstadoValido(v.estado));

  if (anioFiltro) {
    ventas = ventas.filter((v) => parseInt(String(v.anio), 10) === parseInt(String(anioFiltro), 10));
  }

  // Agrupar por colegio -> mes
  const mapa: Record<string, Record<number, { unidades: number; montoBs: number }>> = {};

  ventas.forEach((v) => {
    const cg = v.colegioGrupo || 'General';
    const mes = v.mes || 1;
    if (!mapa[cg]) mapa[cg] = {};
    if (!mapa[cg][mes]) mapa[cg][mes] = { unidades: 0, montoBs: 0 };
    mapa[cg][mes].unidades += v.cantidad || 0;
    mapa[cg][mes].montoBs += v.totalCobrado || v.subtotal || 0;
  });

  const colegiosOrdenados = Object.keys(mapa).sort();

  return colegiosOrdenados.map((cg) => {
    let totalUnidadesAnual = 0;
    let totalVentaBsAnual = 0;

    const mesesArr = Object.keys(mapa[cg])
      .map(Number)
      .sort((a, b) => a - b)
      .map((mesNum) => {
        const u = Math.round(mapa[cg][mesNum].unidades * 100) / 100;
        const m = Math.round(mapa[cg][mesNum].montoBs * 100) / 100;
        totalUnidadesAnual += u;
        totalVentaBsAnual += m;
        return {
          mesNum,
          mesNombre: NOMBRE_MESES[mesNum] || `Mes ${mesNum}`,
          unidades: u,
          montoBs: m,
        };
      });

    return {
      colegioGrupo: cg,
      totalUnidadesAnual: Math.round(totalUnidadesAnual * 100) / 100,
      totalVentaBsAnual: Math.round(totalVentaBsAnual * 100) / 100,
      meses: mesesArr,
    };
  });
}

export interface ResumenPorMesGroup {
  anio: number;
  mesNum: number;
  mesNombre: string;
  totalUnidadesMes: number;
  totalVentaBsMes: number;
  colegios: Array<{
    colegioGrupo: string;
    unidades: number;
    montoBs: number;
  }>;
}

export interface HistorialMensualItem {
  anio: number;
  mesNum: number;
  periodoTexto: string;
  totalVentaBs: number;
  totalUnidades: number;
  colegioLider: string;
  pctDelTotal: number;
}

function obtenerOrdenPrioridadColegio(colegio: string): number {
  const cNorm = String(colegio || '').toLowerCase().trim();
  if (cNorm.includes('cambridge')) return 1;
  if (cNorm.includes('intl')) return 2;
  if (cNorm.includes('edad')) return 3;
  if (cNorm.includes('empresa') || cNorm.includes('general')) return 4;
  if (cNorm.includes('saint') || cNorm.includes('jude')) return 5;
  if (cNorm.includes('inf')) return 6;
  if (cNorm.includes('col')) return 7;
  return 8;
}

export async function obtenerResumenPorMesDetalleColegios(
  anioFiltro?: number,
  colegioFiltro?: string,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<ResumenPorMesGroup[]> {
  const db = await getDb();
  let ventas: any[] = db.select().from(posVentas).all();
  ventas = ventas.filter((v) => esEstadoValido(v.estado));

  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    ventas = ventas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
  }

  const inicioIso = normalizarFechaIso(fechaInicioStr);
  const finIso = normalizarFechaIso(fechaFinStr);

  if (inicioIso) {
    ventas = ventas.filter((v) => v.fechaIso && v.fechaIso >= inicioIso);
  }
  if (finIso) {
    ventas = ventas.filter((v) => v.fechaIso && v.fechaIso <= finIso);
  }

  if (anioFiltro) {
    ventas = ventas.filter((v) => parseInt(String(v.anio), 10) === parseInt(String(anioFiltro), 10));
  }

  // Agrupar por (anio, mes) -> colegio
  const mapa: Record<string, { anio: number; mes: number; colegios: Record<string, { unidades: number; montoBs: number }> }> = {};

  ventas.forEach((v) => {
    const anio = parseInt(String(v.anio), 10) || 2026;
    const mes = parseInt(String(v.mes), 10) || 1;
    const key = `${anio}_${String(mes).padStart(2, '0')}`;
    const cg = v.colegioGrupo || 'Empresas y General';

    if (!mapa[key]) {
      mapa[key] = { anio, mes, colegios: {} };
    }
    if (!mapa[key].colegios[cg]) {
      mapa[key].colegios[cg] = { unidades: 0, montoBs: 0 };
    }
    mapa[key].colegios[cg].unidades += v.cantidad || 0;
    mapa[key].colegios[cg].montoBs += v.totalCobrado || v.subtotal || 0;
  });

  // Orden cronológico ascendente (más antiguo a más nuevo)
  const keysOrdenadas = Object.keys(mapa).sort();

  return keysOrdenadas.map((key) => {
    const item = mapa[key];
    let totalUnidadesMes = 0;
    let totalVentaBsMes = 0;

    const colegiosArr = Object.keys(item.colegios).map((cg) => {
      const u = Math.round(item.colegios[cg].unidades * 100) / 100;
      const m = Math.round(item.colegios[cg].montoBs * 100) / 100;
      totalUnidadesMes += u;
      totalVentaBsMes += m;
      return {
        colegioGrupo: cg,
        unidades: u,
        montoBs: m,
      };
    });

    colegiosArr.sort((a, b) => obtenerOrdenPrioridadColegio(a.colegioGrupo) - obtenerOrdenPrioridadColegio(b.colegioGrupo));

    return {
      anio: item.anio,
      mesNum: item.mes,
      mesNombre: NOMBRE_MESES[item.mes] || `Mes ${item.mes}`,
      totalUnidadesMes: Math.round(totalUnidadesMes * 100) / 100,
      totalVentaBsMes: Math.round(totalVentaBsMes * 100) / 100,
      colegios: colegiosArr,
    };
  });
}

export async function obtenerHistorialMensualIngresos(
  colegioFiltro?: string,
  anioFiltro?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): Promise<{ items: HistorialMensualItem[]; totalGeneralBs: number; totalGeneralUnidades: number }> {
  const resumenes = await obtenerResumenPorMesDetalleColegios(anioFiltro, colegioFiltro, fechaInicioStr, fechaFinStr);

  let totalGeneralBs = 0;
  let totalGeneralUnidades = 0;

  resumenes.forEach((r) => {
    totalGeneralBs += r.totalVentaBsMes;
    totalGeneralUnidades += r.totalUnidadesMes;
  });

  const items: HistorialMensualItem[] = resumenes.map((r) => {
    let colegioLiderObj = { colegioGrupo: '-', montoBs: 0, unidades: 0 };
    r.colegios.forEach((c) => {
      if (c.montoBs > colegioLiderObj.montoBs) colegioLiderObj = c;
    });

    const pct = totalGeneralBs > 0 ? Math.round((r.totalVentaBsMes / totalGeneralBs) * 1000) / 10 : 0;

    return {
      anio: r.anio,
      mesNum: r.mesNum,
      periodoTexto: `${r.mesNombre} ${r.anio}`,
      totalVentaBs: r.totalVentaBsMes,
      totalUnidades: r.totalUnidadesMes,
      colegioLider: colegioLiderObj.colegioGrupo || '-',
      pctDelTotal: pct,
    };
  });

  return {
    items,
    totalGeneralBs: Math.round(totalGeneralBs * 100) / 100,
    totalGeneralUnidades: Math.round(totalGeneralUnidades * 100) / 100,
  };
}
