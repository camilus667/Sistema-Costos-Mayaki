import { getDb } from '../../../api/src/database/sqljs';
import { posVentas, posProductos } from '../../../api/src/database/schema';
import { obtenerVentasPorPrendaYTalla } from './salesAnalytics.service';

export interface MapeoPrendaEquivalente {
  prendaOrigen: string;
  prendaDestino: string;
  similaridadPct: number;
  unidadesHistoricasOrigen: number;
  precioPromedioOrigen: number;
  precioEstDestino: number;
  tallasDesglose: Record<string, number>;
}

export interface ResultadoProyeccion {
  colegioOrigen: string;
  colegioDestino: string;
  periodoOrigen: string;
  periodoProyectado: string;
  factorEscalaAlumnos: number;
  factorCrecimientoPct: number;
  totalUnidadesOrigen: number;
  totalUnidadesProyectadas: number;
  totalVentaBsProyectada: number;
  mapeos: MapeoPrendaEquivalente[];
}

export function normalizarNombrePrenda(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Algoritmo de Inteligencia y Similitud entre prendas de colegios distintos */
export function buscarMejorCoincidencia(
  prendaOrigen: string,
  catalogoDestino: string[]
): { prendaDestino: string; similaridadPct: number } {
  const normOrigen = normalizarNombrePrenda(prendaOrigen);

  if (catalogoDestino.length === 0) {
    return { prendaDestino: prendaOrigen, similaridadPct: 80 };
  }

  // 1. Coincidencia exacta
  const exacta = catalogoDestino.find((d) => normalizarNombrePrenda(d) === normOrigen);
  if (exacta) return { prendaDestino: exacta, similaridadPct: 100 };

  // 2. Coincidencia por palabras clave
  const palabrasOrigen = normOrigen.split(' ').filter((w) => w.length > 2);
  let mejorMatch = catalogoDestino[0];
  let maxScore = 0;

  catalogoDestino.forEach((item) => {
    const normItem = normalizarNombrePrenda(item);
    let coincidencia = 0;
    palabrasOrigen.forEach((word) => {
      if (normItem.includes(word)) coincidencia += 1;
    });

    const score = (coincidencia / palabrasOrigen.length) * 100;
    if (score > maxScore) {
      maxScore = score;
      mejorMatch = item;
    }
  });

  if (maxScore > 0) {
    return { prendaDestino: mejorMatch, similaridadPct: Math.min(Math.round(maxScore), 95) };
  }

  return { prendaDestino: prendaOrigen, similaridadPct: 70 };
}

export async function calcularProyeccionVentas(
  colegioOrigen: string,
  colegioDestino: string,
  anio: number,
  trimestre?: string,
  factorEscalaAlumnos: number = 1.0,
  factorCrecimientoPct: number = 0.0,
  vendedorSimulado?: string
): Promise<ResultadoProyeccion> {
  const ventasOrigen = await obtenerVentasPorPrendaYTalla(colegioOrigen, anio, trimestre);

  const db = await getDb();
  const prodsDestino: any[] = db.select().from(posProductos).all();

  const normDest = colegioDestino.toLowerCase();
  const prendasDestinoDisponibles: string[] = Array.from(
    new Set<string>(
      prodsDestino
        .filter((p) => (p.grupoMatriz || '').toLowerCase().includes(normDest))
        .map((p) => p.nombreLimpio as string)
    )
  );

  const multiplicadorCrecimiento = 1 + factorCrecimientoPct / 100;
  const factorGlobal = factorEscalaAlumnos * multiplicadorCrecimiento;

  let totalUnidadesOrigen = 0;
  let totalUnidadesProyectadas = 0;
  let totalVentaBsProyectada = 0;

  const mapeos: MapeoPrendaEquivalente[] = [];

  ventasOrigen.forEach((v) => {
    totalUnidadesOrigen += v.totalUnidades;

    const { prendaDestino, similaridadPct } = buscarMejorCoincidencia(
      v.nombreLimpio,
      prendasDestinoDisponibles
    );

    const prodDestMatch = prodsDestino.find(
      (p) => (p.grupoMatriz || '').toLowerCase().includes(normDest) && p.nombreLimpio === prendaDestino
    );
    const precioEstDestino = prodDestMatch?.precioPos || v.precioPromedio || 100;

    const tallasProyectadas: Record<string, number> = {};
    let subtotalUnidadesPrenda = 0;

    Object.keys(v.desgloseTallas).forEach((talla) => {
      const cantHist = v.desgloseTallas[talla];
      const cantProyectada = Math.round(cantHist * factorGlobal * 100) / 100;
      tallasProyectadas[talla] = cantProyectada;
      subtotalUnidadesPrenda += cantProyectada;
    });

    totalUnidadesProyectadas += subtotalUnidadesPrenda;
    const subtotalVentaBs = subtotalUnidadesPrenda * precioEstDestino;
    totalVentaBsProyectada += subtotalVentaBs;

    mapeos.push({
      prendaOrigen: v.nombreLimpio,
      prendaDestino,
      similaridadPct,
      unidadesHistoricasOrigen: v.totalUnidades,
      precioPromedioOrigen: v.precioPromedio,
      precioEstDestino,
      tallasDesglose: tallasProyectadas,
    });
  });

  const periodoOrigen = trimestre ? `${anio}-${trimestre}` : `${anio}`;
  const anioProyectado = anio + 1;
  const periodoProyectado = trimestre ? `${anioProyectado}-${trimestre}` : `${anioProyectado}`;

  return {
    colegioOrigen,
    colegioDestino,
    periodoOrigen,
    periodoProyectado,
    factorEscalaAlumnos,
    factorCrecimientoPct,
    totalUnidadesOrigen: Math.round(totalUnidadesOrigen * 100) / 100,
    totalUnidadesProyectadas: Math.round(totalUnidadesProyectadas * 100) / 100,
    totalVentaBsProyectada: Math.round(totalVentaBsProyectada * 100) / 100,
    mapeos,
  };
}
