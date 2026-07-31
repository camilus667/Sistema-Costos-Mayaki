/**
 * Los casos salen de la tabla auxiliar de la hoja `Acc` de CAMBRIDGE.xlsx, medida fila por fila.
 * No son ejemplos inventados: son los numeros que el sistema venia usando.
 *
 * MEDIDO: `costoUnitario = costoUdCompra / cantidadXud` reproduce la planilla en las 30 filas
 * donde las dos entradas son numeros, con cero diferencias. `costoUso = costoUnitario x
 * unidadesPorPrenda` reproduce el costo de uso exacto en 34 de 38 filas; las otras 4 tienen
 * costo unitario 0.
 *
 * Y MEDIDO TAMBIEN: seis filas de la planilla declaran una cantidad por prenda distinta de la
 * que su costo de uso cobra. `Boton de 4 huecos para polo` declara 7 y cobra 1. Los tests de
 * `derivarUnidadesPorPrenda` fijan que la mudanza preserva lo que se COBRA, no lo que se
 * declara, porque cambiarlo alteraria los costos actuales sin que nadie lo pida.
 */

import { describe, it, expect } from 'vitest';
import {
  costoUnitarioDeInsumo,
  costoUsoDeInsumo,
  derivarUnidadesPorPrenda,
  numeroDeTextoConUnidad,
} from './costoInsumo';

describe('costoUnitarioDeInsumo', () => {
  it('divide el costo de compra por la cantidad que trae', () => {
    // "Elastico para berm. y pant.": 0,36 por metro, 1 metro por unidad de compra.
    expect(costoUnitarioDeInsumo({ costoUdCompra: 0.36, cantidadXud: 1 })).toBeCloseTo(0.36, 6);
    // "Boton de 4 huecos para polo": 2,50 el paquete de 6.
    expect(costoUnitarioDeInsumo({ costoUdCompra: 2.5, cantidadXud: 6 })).toBeCloseTo(0.4167, 4);
  });

  it('el CALCULO tiene prioridad sobre el valor guardado', () => {
    // Si el respaldo ganara, cambiar el precio de compra no movería el costo, que es justo el
    // problema de guardar un derivado.
    expect(costoUnitarioDeInsumo({
      costoUdCompra: 10, cantidadXud: 2, costoUnitarioGuardado: 999,
    })).toBe(5);
  });

  it('se cae al valor guardado cuando la cantidad no es un numero', () => {
    // Caso defensivo: si `cantidadXud` llegara como texto. En la base es NOT NULL y el "par"
    // de la planilla ya quedo como 1, asi que hoy no ocurre; el respaldo real son las 4 filas
    // con costo de compra en 0.
    expect(costoUnitarioDeInsumo({
      costoUdCompra: null, cantidadXud: 'par' as any, costoUnitarioGuardado: 3.5,
    })).toBe(3.5);
  });

  it('se cae al valor guardado si la cantidad es cero, sin dividir por cero', () => {
    expect(costoUnitarioDeInsumo({
      costoUdCompra: 10, cantidadXud: 0, costoUnitarioGuardado: 2.7,
    })).toBe(2.7);
  });

  it('da 0 y no NaN cuando no hay nada', () => {
    expect(costoUnitarioDeInsumo({})).toBe(0);
    expect(costoUnitarioDeInsumo(null as any)).toBe(0);
    expect(costoUnitarioDeInsumo({ costoUdCompra: undefined, cantidadXud: undefined })).toBe(0);
  });

  it('un costo de compra 0 NO manda: significa que no se registro', () => {
    // Este test decia lo contrario y estaba mal. Lo corrigio la medicion:
    //
    // Cuatro insumos tienen costoUdCompra en 0 y su unitario cargado a mano —Cuello 2,70; Vinilo
    // para shorts 0,035; Vinilo Calzas 0,055; Entretela Corbata 0,0015—. Tratando el 0 como un
    // costo valido, `0 / 1 = 0` le ganaba al valor real y ponia esos cuatro costos en cero.
    expect(costoUnitarioDeInsumo({
      costoUdCompra: 0, cantidadXud: 1, costoUnitarioGuardado: 2.7,
    })).toBe(2.7);
  });

  it('un insumo genuinamente gratis sigue dando 0', () => {
    // "Cinta Antideslizante": 0 de compra y 0 de unitario. No se le inventa un costo.
    expect(costoUnitarioDeInsumo({
      costoUdCompra: 0, cantidadXud: 1, costoUnitarioGuardado: 0,
    })).toBe(0);
  });

  it('los cuatro casos reales, con su valor de la planilla', () => {
    const casos: Array<[string, number]> = [
      ['Cuello', 2.7], ['Vinilo para shorts', 0.035],
      ['Vinilo Calzas', 0.055], ['Entretela Corbata', 0.0015],
    ];
    for (const [, unitario] of casos) {
      expect(costoUnitarioDeInsumo({
        costoUdCompra: 0, cantidadXud: 1, costoUnitarioGuardado: unitario,
      })).toBe(unitario);
    }
  });
});

describe('costoUsoDeInsumo', () => {
  it('multiplica por las unidades que se usan por prenda', () => {
    // "Hilo Tex 24 polyester": 0,006 la unidad, 100 por prenda -> 0,60.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 0.006, unidadesPorPrenda: 100 }))
      .toBeCloseTo(0.6, 6);
    // "Hebilla de falda": 2,80 la unidad, 2 por prenda -> 5,60.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 2.8, unidadesPorPrenda: 2 })).toBeCloseTo(5.6, 6);
  });

  it('acepta factores fraccionarios', () => {
    // "Elastico Short o buzo": 0,36 x 0,6 = 0,216. Ese 0,6 vivia dentro de la formula de la celda.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 0.36, unidadesPorPrenda: 0.6 }))
      .toBeCloseTo(0.216, 6);
    // "Entretela de Camisa": 18 / 10 = 1,80, expresado como factor 0,1.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 18, unidadesPorPrenda: 0.1 }))
      .toBeCloseTo(1.8, 6);
  });

  it('sin unidades por prenda asume 1', () => {
    // Es el caso de la mayoria: un cierre, un cuello.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 2 })).toBe(2);
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 2, unidadesPorPrenda: null })).toBe(2);
  });

  it('un factor negativo se trata como ausente, no se propaga', () => {
    // Un costo negativo bajaria el total de la prenda sin que nadie lo note.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 2, unidadesPorPrenda: -3 })).toBe(2);
  });

  it('un factor 0 SI se respeta: significa que no se usa', () => {
    // Distinto de ausente. Cero es una afirmacion, undefined es falta de dato.
    expect(costoUsoDeInsumo({ costoUnitarioGuardado: 2, unidadesPorPrenda: 0 })).toBe(0);
  });

  it('reproduce la formula completa desde las entradas de compra', () => {
    // "Boton de chamarra": 1,40 el paquete de 5 -> 0,28 la unidad, 4 por prenda -> 1,12.
    expect(costoUsoDeInsumo({
      costoUdCompra: 1.4, cantidadXud: 5, unidadesPorPrenda: 4,
    })).toBeCloseTo(1.12, 6);
  });
});

describe('derivarUnidadesPorPrenda', () => {
  it('recupera el multiplicador que la planilla tenia escondido', () => {
    expect(derivarUnidadesPorPrenda(0.216, 0.36)).toBeCloseTo(0.6, 6);
    expect(derivarUnidadesPorPrenda(1.8, 18)).toBeCloseTo(0.1, 6);
    expect(derivarUnidadesPorPrenda(4.55, 0.035)).toBeCloseTo(130, 6);
    expect(derivarUnidadesPorPrenda(0.75, 18)).toBeCloseTo(0.041667, 5);
  });

  it('ida y vuelta: el costo de uso vuelve a dar lo mismo', () => {
    // Es la propiedad que hace segura la mudanza. Si esto no cerrara, mudar cambiaria costos.
    const casos: Array<[number, number]> = [
      [0.216, 0.36], [1.8, 18], [4.55, 0.035], [0.75, 18], [1.12, 0.28], [5.6, 2.8], [0.6, 0.006],
    ];
    for (const [uso, unitario] of casos) {
      const f = derivarUnidadesPorPrenda(uso, unitario);
      expect(costoUsoDeInsumo({ costoUnitarioGuardado: unitario, unidadesPorPrenda: f }))
        .toBeCloseTo(uso, 6);
    }
  });

  it('PRESERVA LO QUE SE COBRA, no lo que la planilla declara', () => {
    // "Boton de 4 huecos para polo" declara 7 unidades pero su costo de uso cobra 1. Mudar el 7
    // multiplicaria por siete el costo de esa prenda sin que nadie lo pida. Si el 7 es lo
    // correcto, es una correccion de datos y se decide aparte.
    expect(derivarUnidadesPorPrenda(0.4167, 0.4167, 7)).toBeCloseTo(1, 3);
    // "Botamanga (par)": declara 2, cobra 1.
    expect(derivarUnidadesPorPrenda(3.5, 3.5, 2)).toBeCloseTo(1, 6);
  });

  it('con costo unitario 0 devuelve el literal declarado, no 0', () => {
    // El factor es indeterminado: cualquier numero da uso 0. Devolver 0 haria que ese insumo
    // costara cero para siempre, incluso el dia que tenga precio.
    expect(derivarUnidadesPorPrenda(0, 0, 3)).toBe(3);
    expect(derivarUnidadesPorPrenda(0, 0)).toBe(1);
  });

  it('sin costo de uso devuelve el literal, no un factor inventado', () => {
    expect(derivarUnidadesPorPrenda(null, 5, 4)).toBe(4);
    expect(derivarUnidadesPorPrenda(undefined, 5)).toBe(1);
  });
});

describe('numeroDeTextoConUnidad', () => {
  it('saca el numero de un texto con la unidad pegada', () => {
    // La columna de la planilla mezcla numeros con cadenas: "130 cm2", "60 cm2", "500 cm2".
    expect(numeroDeTextoConUnidad('130 cm2')).toBe(130);
    expect(numeroDeTextoConUnidad('60 cm2')).toBe(60);
    expect(numeroDeTextoConUnidad('500 cm2')).toBe(500);
  });

  it('deja pasar los numeros de verdad', () => {
    expect(numeroDeTextoConUnidad(7)).toBe(7);
    expect(numeroDeTextoConUnidad(1.5)).toBe(1.5);
  });

  it('acepta la coma decimal', () => {
    expect(numeroDeTextoConUnidad('0,6 metros')).toBeCloseTo(0.6, 6);
  });

  it('devuelve null cuando no hay numero, en vez de 0', () => {
    // 0 seria una afirmacion falsa: "no se usa nada". null dice "no se sabe".
    expect(numeroDeTextoConUnidad('par')).toBeNull();
    expect(numeroDeTextoConUnidad('')).toBeNull();
    expect(numeroDeTextoConUnidad(null)).toBeNull();
    expect(numeroDeTextoConUnidad(undefined)).toBeNull();
  });

  it('no confunde Infinity ni NaN con un numero', () => {
    expect(numeroDeTextoConUnidad(Infinity)).toBeNull();
    expect(numeroDeTextoConUnidad(NaN)).toBeNull();
  });
});
