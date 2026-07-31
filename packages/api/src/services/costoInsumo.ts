/**
 * EL COSTO DE UN INSUMO SE CALCULA. No se guarda calculado.
 *
 * Hasta ahora dos de estos numeros no salian de la base: salian de la tabla auxiliar de la hoja
 * `Acc` de CAMBRIDGE.xlsx, que el servidor parseaba en cada pedido. Ese archivo se va, y con el
 * la ultima dependencia del sistema con un Excel.
 *
 * LAS DOS FORMULAS
 *
 *   costoUnitario = costoUdCompra / cantidadXud
 *   costoUso      = costoUnitario * unidadesPorPrenda
 *
 * MEDIDO contra la hoja: la primera reproduce el valor de la planilla en las 30 filas donde las
 * dos entradas son numeros, con CERO diferencias. La segunda reproduce el costo de uso exacto en
 * 34 de 38 filas; las otras 4 tienen costo unitario 0, asi que el uso tambien es 0 y el factor
 * no cambia nada.
 *
 * POR QUE `unidadesPorPrenda` ES EL INPUT, Y NO EL COSTO DE USO
 *
 * El costo de uso de la planilla NO se puede reproducir con una sola formula: 17 de 37 filas no
 * seguian `unitario x unidades`, porque el multiplicador vivia escrito a mano dentro de la
 * formula de la celda y no en ninguna columna de datos. `Entretela de Camisa` dividia por 10
 * (unidades por metro), `Vinilo para shorts` multiplicaba por 130 (un "130 cm2" escrito como
 * texto), y `Elastico Short o buzo` multiplicaba por 0,6 —un numero que no figuraba en ninguna
 * parte—.
 *
 * El dato que la planilla queria expresar en todos esos casos es el mismo: CUANTO se usa de ese
 * insumo en una prenda. Eso es un input. Guardarlo como numero recupera exactamente los valores
 * que la planilla calculaba, y de ahi en adelante el costo de uso se deriva —que es lo que
 * corresponde, porque un costo derivado guardado se desactualiza en silencio el dia que cambia
 * el precio de compra—.
 */

export interface EntradasInsumo {
  /** Lo que cuesta la unidad de compra: un rollo, un paquete, un metro. Input. */
  costoUdCompra?: number | null;
  /** Cuantas unidades trae una unidad de compra. Input. */
  cantidadXud?: number | null;
  /**
   * Costo unitario ya guardado. Es RESPALDO, no la fuente: se usa solo cuando las dos entradas
   * de arriba no alcanzan para calcularlo.
   */
  costoUnitarioGuardado?: number | null;
  /**
   * Cuanto se usa de este insumo en una prenda. Input, y puede ser fraccionario: 0,6 de un
   * elastico, 1,5 de un forro, 100 de hilo.
   */
  unidadesPorPrenda?: number | null;
  /** Cantidad de ojales si aplica. */
  ojales?: number | string | null;
}

/** Convierte a numero finito, o null. Una cadena como "130 cm2" no es un numero valido aca. */
function num(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * Costo de UNA unidad del insumo.
 */
export function costoUnitarioDeInsumo(e: EntradasInsumo): number {
  const compra = num(e?.costoUdCompra);
  const cantidad = num(e?.cantidadXud);

  if (compra !== null && compra > 0 && cantidad !== null && cantidad > 0) return compra / cantidad;

  return num(e?.costoUnitarioGuardado) ?? 0;
}

/**
 * Costo del insumo en UNA prenda.
 */
export function costoUsoDeInsumo(e: EntradasInsumo): number {
  const unitario = costoUnitarioDeInsumo(e);
  const uds = num(e?.unidadesPorPrenda);
  const factorUds = uds !== null && uds >= 0 ? uds : 1;
  const oj = num(e?.ojales);
  const factorOjales = oj !== null && oj > 0 ? oj : 1;
  return unitario * factorUds * factorOjales;
}

/**
 * Deriva `unidadesPorPrenda` a partir de un costo de uso ya calculado, para la mudanza de los
 * datos de la planilla a la base.
 *
 * Es la operacion inversa de `costoUsoDeInsumo`, y existe una sola vez: para recuperar el
 * multiplicador que la planilla tenia escondido en la formula de cada celda.
 *
 * Con costo unitario 0 el factor es indeterminado —cualquier numero da uso 0— y se devuelve el
 * literal que la planilla declaraba, o 1. Devolver 0 seria peor: el dia que ese insumo tenga
 * precio, empezaria a costar cero sin motivo.
 */
export function derivarUnidadesPorPrenda(
  costoUso: number | null | undefined,
  costoUnitario: number | null | undefined,
  literalDeclarado?: number | null,
): number {
  const uso = num(costoUso);
  const unitario = num(costoUnitario);

  if (unitario === null || unitario === 0 || uso === null) {
    return num(literalDeclarado) ?? 1;
  }
  return uso / unitario;
}

/**
 * Saca el numero de un valor que puede venir como texto: `"130 cm2"` -> 130.
 *
 * La columna "Unidades que se usan por prenda" de la planilla mezcla numeros con cadenas que
 * llevan la unidad pegada. La unidad es un rotulo para leer, no un dato de calculo.
 */
export function numeroDeTextoConUnidad(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  const m = String(x ?? '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
