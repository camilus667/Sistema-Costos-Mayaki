import { Decimal } from 'decimal.js';
import { IVA_RATE } from '@sistema-uniformes/shared';

export interface CalculoInputs {
  pesoGramos: number; // Peso exacto o con merma según flag
  mermaPorcentaje: number;
  precioTelaUnitario?: number;
  rendimientoTela?: number;
  precioBsG?: number; // Precio Bs / gramo exacto de la tela
  costoAccesorios: number;
  costoManoObra: number;
  factorComplejidad?: number;
  costoFijo: number; // Incluye fijosXprenda (planchados, botones)
  costoIndirectoMensual?: number;
  produccionTotalMes?: number;
  precioVenta?: number | null;
}

export interface CalculoResultado {
  pesoConMerma: number;
  costoTela: number;
  costoAccesorios: number;
  costoManoObra: number;
  costoBruto: number;
  costoFijosVariable: number;
  costoIndirecto: number;
  costoAntesImpuestos: number;
  iva: number;
  costoTotal: number;
  utilidadNeta: number | null;
  margenPorcentaje: number | null;
}

/**
 * Motor de Cálculo Exacto del Excel CAMBRIDGE.xlsx:
 * 
 * 1. pesoConMerma = pesoGramos * (1 + mermaPorcentaje / 100)
 * 2. costoTela = pesoConMerma * precioBsG
 * 3. costoBruto = costoTela + costoAccesorios + costoManoObra
 * 4. costoAntesImpuestos = costoBruto + costoFijo
 * 5. costoTotal = costoAntesImpuestos * 1.13
 * 6. utilidadNeta = precioVenta - costoTotal
 * 7. margenPorcentaje = (utilidadNeta / precioVenta) * 100
 */
export function calcularCostoTotal(inputs: CalculoInputs): CalculoResultado {
  const mermaPct = inputs.mermaPorcentaje ?? 8;
  const pesoConMerma = inputs.pesoGramos * (1 + mermaPct / 100);

  // Costo de Tela exacto usando precio por gramo de la hoja Tela (celda J)
  let costoTela = 0;
  if (inputs.precioBsG && inputs.precioBsG > 0) {
    costoTela = pesoConMerma * inputs.precioBsG;
  } else if (inputs.precioTelaUnitario && inputs.rendimientoTela && inputs.rendimientoTela > 0) {
    costoTela = (pesoConMerma / (inputs.rendimientoTela * 1000)) * inputs.precioTelaUnitario;
  }

  const costoAccesorios = inputs.costoAccesorios || 0;
  const costoManoObra = inputs.costoManoObra || 0;

  // Costo Bruto = Tela + Accesorios + Mano Obra
  const costoBruto = costoTela + costoAccesorios + costoManoObra;

  // Costos FijosVariables de la prenda (fijosXprenda)
  const factor = inputs.factorComplejidad || 1;
  const costoFijosVariable = (inputs.costoFijo || 0) * factor;

  // Costos Indirectos prorrateados
  const costoIndirecto = (inputs.produccionTotalMes && inputs.produccionTotalMes > 0 && inputs.costoIndirectoMensual)
    ? inputs.costoIndirectoMensual / inputs.produccionTotalMes
    : 0;

  // Costo antes de impuestos
  const costoAntesImpuestos = costoBruto + costoFijosVariable + costoIndirecto;

  // 13% IVA (Impuesto)
  const iva = costoAntesImpuestos * (IVA_RATE || 0.13);

  // Costo Total
  const costoTotal = costoAntesImpuestos + iva;

  // Utilidad Neta & Margen
  let utilidadNeta: number | null = null;
  let margenPorcentaje: number | null = null;

  if (inputs.precioVenta !== null && inputs.precioVenta !== undefined && inputs.precioVenta > 0) {
    utilidadNeta = inputs.precioVenta - costoTotal;
    margenPorcentaje = (utilidadNeta / inputs.precioVenta) * 100;
  }

  return {
    pesoConMerma: parseFloat(pesoConMerma.toFixed(2)),
    costoTela: parseFloat(costoTela.toFixed(2)),
    costoAccesorios: parseFloat(costoAccesorios.toFixed(2)),
    costoManoObra: parseFloat(costoManoObra.toFixed(2)),
    costoBruto: parseFloat(costoBruto.toFixed(2)),
    costoFijosVariable: parseFloat(costoFijosVariable.toFixed(2)),
    costoIndirecto: parseFloat(costoIndirecto.toFixed(2)),
    costoAntesImpuestos: parseFloat(costoAntesImpuestos.toFixed(2)),
    iva: parseFloat(iva.toFixed(2)),
    costoTotal: parseFloat(costoTotal.toFixed(2)),
    utilidadNeta: utilidadNeta !== null ? parseFloat(utilidadNeta.toFixed(2)) : null,
    margenPorcentaje: margenPorcentaje !== null ? parseFloat(margenPorcentaje.toFixed(2)) : null,
  };
}

export function calcularCostoAccesorios(detalleAccesorios: Array<{
  cantidadUso: number;
  costoUnitario: number;
}>): number {
  return detalleAccesorios.reduce((total, acc) => total + (acc.cantidadUso * acc.costoUnitario), 0);
}
