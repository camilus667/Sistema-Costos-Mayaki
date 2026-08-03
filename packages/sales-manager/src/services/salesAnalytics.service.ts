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

export async function obtenerResumenColegios(
  colegioFiltro?: string,
  anioFiltro?: number
): Promise<VentaResumenColegio[]> {
  const db = await getDb();
  let todas: any[] = db.select().from(posVentas).all();

  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    todas = todas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
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
  anioFiltro?: number
): Promise<VentaResumenPeriodo[]> {
  const db = await getDb();
  let ventas: any[] = db.select().from(posVentas).all();

  if (colegioFiltro && colegioFiltro.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioFiltro);
    ventas = ventas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
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
  trimestre?: string
): Promise<DetallePrendaVenta[]> {
  const db = await getDb();
  let ventas: any[] = db.select().from(posVentas).all();

  if (colegioGrupo && colegioGrupo.trim() !== '') {
    const targetNorm = normalizarColegioNombre(colegioGrupo);
    ventas = ventas.filter((v) => {
      const cgNorm = normalizarColegioNombre(v.colegioGrupo || '');
      return cgNorm.includes(targetNorm) || targetNorm.includes(cgNorm);
    });
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
