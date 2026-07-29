import { describe, it, expect } from 'vitest';
import {
  calcularCostoTotal,
  calcularCostoAccesorios,
  type CalculoInputs,
} from './costoTotal.service';
import {
  ensamblarInputs,
  tasaIvaComoFraccion,
  type ContextoCosteo,
} from './costeoInputs.service';

/**
 * PRIMER SUITE DE TESTS DEL REPO.
 *
 * El nucleo del sistema es aritmetica sobre datos de costos, o sea lo mas critico
 * y lo mas facil de testear, y no habia un solo test. `vitest` ya estaba en
 * devDependencies desde antes; nunca se uso.
 *
 * Cada numero de aca esta VERIFICADO contra CAMBRIDGE.xlsx o contra una corrida
 * real, no inventado para que el test pase. La procedencia va comentada en cada
 * caso. Un test cuyo valor esperado se saco del propio codigo no prueba nada.
 *
 * Lo que se fija:
 *   - los cuatro bugs del motor que se corrigieron en la Fase 1, para que no
 *     vuelvan sin que nadie se entere
 *   - la conversion de la tasa de IVA, que es la linea de mas riesgo del refactor
 *   - que no se fabriquen datos cuando faltan
 */

// ---------------------------------------------------------------------------
// Datos verificados
// ---------------------------------------------------------------------------

/** Item 27 Saco, talla 2. Fuente: hoja CostoBruto y corrida del arnes. */
const SACO = {
  pesoExactoGramos: 350,      // limpio, sin merma
  pesoConMermaGramos: 378,    // 350 x 1.08, lo que guarda la base
  mermaPorcentaje: 8,
  precioBsG: 0.1215,          // Casimir Italiano
  rendimiento: 1.7362,        // m/kg
  precioUnitario: 70,         // Bs por metro
  costoAccesorios: 23.52,
  costoManoObra: 100,
  costoBrutoExcel: 169.464,   // hoja CostoBruto
};

/** Receta de accesorios de la Chompa cuello en V (item 19). Suma 7,84 Bs. */
const RECETA_CHOMPA = [
  { cantidadUso: 1, costoUnitario: 5.0 },   // Bordado escudo
  { cantidadUso: 1, costoUnitario: 0.22 },  // Bolsa de polipropileno
  { cantidadUso: 1, costoUnitario: 1.4 },   // Etiqueta de marca
  { cantidadUso: 1, costoUnitario: 0.12 },  // Etiqueta de talla
  { cantidadUso: 1, costoUnitario: 0.5 },   // Etiqueta de cuidados
  { cantidadUso: 1, costoUnitario: 0.6 },   // Hilo Tex 24
];

// ---------------------------------------------------------------------------
// El motor
// ---------------------------------------------------------------------------

describe('calcularCostoTotal — costo de tela', () => {
  it('con precioBsG: 378 g x 0,1215 = 45,93', () => {
    const r = calcularCostoTotal({
      pesoConMermaGramos: SACO.pesoConMermaGramos,
      mermaPorcentaje: SACO.mermaPorcentaje,
      precioBsG: SACO.precioBsG,
    });
    expect(r.costoTela).toBe(45.93);
    expect(r.diagnostico.origenCostoTela).toBe('precioBsG');
  });

  it('con rendimiento: MULTIPLICA, no divide. 378/1000 x 1,7362 x 70 = 45,94', () => {
    // BUG CORREGIDO EN LA FASE 1. La version anterior hacia
    // peso / (rendimiento * 1000), o sea dividia por el rendimiento en vez de
    // multiplicar, y daba 15,24: subcosteaba la tela por un factor de rendimiento
    // al cuadrado. El Excel implica 45,94.
    const r = calcularCostoTotal({
      pesoConMermaGramos: SACO.pesoConMermaGramos,
      mermaPorcentaje: SACO.mermaPorcentaje,
      precioTelaUnitario: SACO.precioUnitario,
      rendimientoTela: SACO.rendimiento,
    });
    expect(r.costoTela).toBe(45.94);
    expect(r.costoTela).not.toBe(15.24); // el valor que daba el bug
    expect(r.diagnostico.origenCostoTela).toBe('rendimiento');
  });

  it('los dos caminos coinciden dentro de un centavo', () => {
    const a = calcularCostoTotal({ pesoConMermaGramos: 378, precioBsG: SACO.precioBsG });
    const b = calcularCostoTotal({
      pesoConMermaGramos: 378,
      precioTelaUnitario: SACO.precioUnitario,
      rendimientoTela: SACO.rendimiento,
    });
    expect(Math.abs(a.costoTela - b.costoTela)).toBeLessThanOrEqual(0.01);
  });

  it('reproduce el costoBruto del Excel del Saco: 169,46 contra 169,464', () => {
    const r = calcularCostoTotal({
      pesoConMermaGramos: SACO.pesoConMermaGramos,
      precioTelaUnitario: SACO.precioUnitario,
      rendimientoTela: SACO.rendimiento,
      costoAccesorios: SACO.costoAccesorios,
      costoManoObra: SACO.costoManoObra,
    });
    expect(r.costoBruto).toBe(169.46);
    expect(Math.abs(r.costoBruto - SACO.costoBrutoExcel)).toBeLessThanOrEqual(0.01);
  });
});

describe('calcularCostoTotal — merma', () => {
  it('NO aplica la merma dos veces sobre un peso que ya la trae', () => {
    // BUG CORREGIDO EN LA FASE 1. La base guarda peso_gramos = 378, que ya es
    // 350 x 1.08. El motor le volvia a aplicar el 8% y daba 408,24, inflando el
    // costo de tela de TODAS las prendas de confeccion.
    const r = calcularCostoTotal({
      pesoConMermaGramos: 378,
      mermaPorcentaje: 8,
      precioBsG: SACO.precioBsG,
    });
    expect(r.pesoConMerma).toBe(378);
    expect(r.pesoConMerma).not.toBe(408.24); // el valor que daba el bug
  });

  it('SI aplica la merma sobre el peso exacto: 350 x 1,08 = 378', () => {
    const r = calcularCostoTotal({ pesoExactoGramos: 350, mermaPorcentaje: 8 });
    expect(r.pesoConMerma).toBe(378);
  });

  it('pesoGramos por compatibilidad se interpreta con la merma ya incluida', () => {
    const r = calcularCostoTotal({ pesoGramos: 378, mermaPorcentaje: 8 });
    expect(r.pesoConMerma).toBe(378);
  });

  it('avisa si no recibe mermaPorcentaje, en vez de asumir 8 en silencio', () => {
    // El default vive en el schema y en configuracion_sistema. Tenerlo tambien
    // hardcodeado en el motor eran tres lugares que se desincronizan.
    const r = calcularCostoTotal({ pesoExactoGramos: 350 });
    expect(r.pesoConMerma).toBe(350);
    expect(r.diagnostico.advertencias.join(' ')).toContain('mermaPorcentaje');
  });
});

describe('calcularCostoTotal — IVA', () => {
  it('la tasa se recibe como FRACCION, no como porcentaje', () => {
    // Si alguien pasa 13 en vez de 0,13, el IVA sale 1300%. Es el error que casi
    // se cometio al armar el servicio de inputs.
    const r = calcularCostoTotal({ costoManoObra: 100, tasaIva: 0.13 });
    expect(r.costoAntesImpuestos).toBe(100);
    expect(r.iva).toBe(13);
    expect(r.costoTotal).toBe(113);
  });

  it('pasar 13 en vez de 0,13 produce un disparate detectable', () => {
    // No es el comportamiento deseado: se fija para documentar por que la
    // conversion tiene que ser explicita.
    const r = calcularCostoTotal({ costoManoObra: 100, tasaIva: 13 });
    expect(r.iva).toBe(1300);
  });

  it('costoAntesImpuestos + iva da exactamente costoTotal', () => {
    const r = calcularCostoTotal({
      pesoConMermaGramos: 378,
      precioBsG: SACO.precioBsG,
      costoAccesorios: 23.52,
      costoManoObra: 100,
      costoFijo: 1.1933,
      tasaIva: 0.13,
    });
    expect(r.costoAntesImpuestos + r.iva).toBeCloseTo(r.costoTotal, 2);
  });
});

describe('calcularCostoTotal — prendas adquiridas', () => {
  it('el precio de adquisicion reemplaza la tela y anula el peso', () => {
    // Item 19 Chompa talla 48/3XL: 140 de adquisicion + 7,84 de accesorios =
    // 147,84, que es lo que dice la hoja CostoBruto. Verificado en el arnes.
    const r = calcularCostoTotal({
      precioAdquisicion: 140,
      costoAccesorios: 7.84,
      pesoConMermaGramos: 0,
    });
    expect(r.costoTela).toBe(140);
    expect(r.pesoConMerma).toBe(0);
    expect(r.costoBruto).toBe(147.84);
    expect(r.diagnostico.origenCostoTela).toBe('adquisicion');
    expect(r.diagnostico.sinBaseDeTela).toBe(false);
  });

  it('Chompa talla 2: 50 + 7,84 = 57,84', () => {
    const r = calcularCostoTotal({ precioAdquisicion: 50, costoAccesorios: 7.84 });
    expect(r.costoBruto).toBe(57.84);
  });
});

describe('calcularCostoTotal — diagnostico en vez de ceros silenciosos', () => {
  it('sinPrecioDeTela cuando hay peso pero la tela no esta vinculada', () => {
    // Caso real del item 27 Saco: tela_id es NULL. Antes devolvia costo de tela 0
    // sin ninguna senal y la prenda mas cara del catalogo se costeaba con tela
    // gratis.
    const r = calcularCostoTotal({ pesoConMermaGramos: 378 });
    expect(r.costoTela).toBe(0);
    expect(r.diagnostico.sinPrecioDeTela).toBe(true);
    expect(r.diagnostico.origenCostoTela).toBe('ninguno');
    expect(r.diagnostico.advertencias.length).toBeGreaterThan(0);
  });

  it('sinBaseDeTela cuando no hay peso, y NO lanza excepcion', () => {
    // No lanza a proposito: la ausencia de peso significa dos cosas distintas en
    // los datos, "no se ofrece en esta talla" (121 casos legitimos) y "falta
    // cargar el peso". Romper romperia los casos validos.
    const r = calcularCostoTotal({ costoManoObra: 10 });
    expect(r.diagnostico.sinBaseDeTela).toBe(true);
    expect(r.costoTela).toBe(0);
  });
});

describe('calcularCostoTotal — fijos e indirectos', () => {
  it('costoFijosVariable es costoFijo x factorComplejidad', () => {
    const r = calcularCostoTotal({ costoFijo: 1.1933, factorComplejidad: 3 });
    expect(r.costoFijosVariable).toBe(3.58);
  });

  it('factorComplejidad ausente o cero se trata como 1', () => {
    expect(calcularCostoTotal({ costoFijo: 5 }).costoFijosVariable).toBe(5);
    expect(calcularCostoTotal({ costoFijo: 5, factorComplejidad: 0 }).costoFijosVariable).toBe(5);
  });

  it('el indirecto unitario tiene prioridad sobre el par mensual', () => {
    const r = calcularCostoTotal({
      costoIndirectoUnitario: 2,
      costoIndirectoMensual: 21480,
      produccionTotalMes: 1800,
    });
    expect(r.costoIndirecto).toBe(2);
  });

  it('el prorrateo mensual avisa del problema de estacionalidad', () => {
    const r = calcularCostoTotal({ costoIndirectoMensual: 21480, produccionTotalMes: 1800 });
    expect(r.costoIndirecto).toBe(11.93);
    expect(r.diagnostico.advertencias.join(' ')).toContain('mes');
  });
});

describe('calcularCostoTotal — margen', () => {
  it('utilidad y margen sobre el precio de venta', () => {
    const r = calcularCostoTotal({ costoManoObra: 100, tasaIva: 0.13, precioVenta: 150 });
    expect(r.costoTotal).toBe(113);
    expect(r.utilidadNeta).toBe(37);
    expect(r.margenPorcentaje).toBe(24.67);
  });

  it('sin precio de venta devuelve null, no cero', () => {
    // Cero significaria "margen cero", que es una afirmacion distinta de "no se
    // sabe el precio".
    const r = calcularCostoTotal({ costoManoObra: 100 });
    expect(r.utilidadNeta).toBeNull();
    expect(r.margenPorcentaje).toBeNull();
  });
});

describe('calcularCostoAccesorios', () => {
  it('la receta de la Chompa suma 7,84', () => {
    expect(calcularCostoAccesorios(RECETA_CHOMPA)).toBe(7.84);
  });

  it('el subtotal es exactamente la suma de las lineas redondeadas', () => {
    // Decision del usuario del 29-jul-2026: se redondea por linea para que el
    // desglose en pantalla sume su propio subtotal, aceptando quedar hasta 0,03
    // apartado del total de la columna 41 del Excel.
    const lineas = [
      { cantidadUso: 3, costoUnitario: 0.335 },
      { cantidadUso: 7, costoUnitario: 0.125 },
      { cantidadUso: 2, costoUnitario: 0.815 },
    ];
    const porLinea = lineas.map(
      (l) => Math.round(l.cantidadUso * l.costoUnitario * 100) / 100
    );
    const suma = Math.round(porLinea.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(calcularCostoAccesorios(lineas)).toBe(suma);
  });

  it('receta vacia da 0', () => {
    expect(calcularCostoAccesorios([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// El armado de inputs desde la base
// ---------------------------------------------------------------------------

describe('tasaIvaComoFraccion', () => {
  it('convierte el porcentaje de la base a fraccion: 13 -> 0,13', () => {
    // LA LINEA DE MAS RIESGO DEL REFACTOR. configuracion_sistema.tasa_iva guarda
    // 13 y el motor espera 0,13. Pasarlo directo da 1300% de IVA, no lanza
    // excepcion y produce numeros que parecen un problema de datos.
    expect(tasaIvaComoFraccion({ tasaIva: 13 } as any)).toBe(0.13);
  });

  it('si ya viene como fraccion la deja igual y avisa', () => {
    const avisos: string[] = [];
    expect(tasaIvaComoFraccion({ tasaIva: 0.13 } as any, avisos)).toBe(0.13);
    expect(avisos.length).toBe(1);
    expect(avisos[0]).toContain('fraccion');
  });

  it('cero se queda en cero', () => {
    expect(tasaIvaComoFraccion({ tasaIva: 0 } as any)).toBe(0);
  });
});

/** Contexto minimo armado a mano. `ensamblarInputs` es pura: no toca la base. */
function ctxDePrueba(over: Partial<ContextoCosteo> = {}): ContextoCosteo {
  return {
    sysConfig: {
      tasaIva: 13,
      factorIva: 1.13,
      volumenMensualProduccion: 1800,
      mermaPorcentajeEstandar: 8,
      tallaDefecto: '16/34',
    },
    tasaIvaFraccion: 0.13,
    totalIndirectosMensual: 21480,
    tarifaPuntoComplejidad: 1.1933,
    productos: [],
    tallasPorId: new Map(),
    tallasPorColegio: new Map(),
    telasPorId: new Map(),
    pesoPorClave: new Map(),
    manoObraPorClave: new Map(),
    accesoriosPorProducto: new Map(),
    precioVentaPorClave: new Map(),
    precioAdquisicionPorClave: new Map(),
    avisosGlobales: [],
    ...over,
  };
}

const PROD = {
  id: 'p1',
  colegioId: 'c1',
  itemNumero: 27,
  descripcion: 'Saco',
  telaId: 't1',
  modoCosteo: 'confeccion',
  factorComplejidad: 3,
  costoFijo: 0,
  planchadoExtra: 0,
  colocacionBotones: 0,
  operacionesExtra: 0,
};
const TALLA = { id: 'ta1', codigo: '2', nombre: 'Talla 2', orden: 1, colegioId: 'c1' };

describe('ensamblarInputs', () => {
  it('pasa la tasa de IVA ya convertida a fraccion', () => {
    const { inputs } = ensamblarInputs(ctxDePrueba(), PROD, TALLA);
    expect(inputs.tasaIva).toBe(0.13);
  });

  it('NO fabrica mano de obra cuando falta la fila', () => {
    // El camino viejo, sin fila, promediaba las tallas y sin ninguna usaba 15,00
    // Bs hardcodeados. Un numero inventado que parecia razonable.
    const { inputs, meta } = ensamblarInputs(ctxDePrueba(), PROD, TALLA);
    expect(inputs.costoManoObra).toBe(0);
    expect(inputs.costoManoObra).not.toBe(15);
    expect(meta.tieneManoObra).toBe(false);
    expect(meta.faltantes.join(' ')).toContain('mano de obra');
  });

  it('el fijo por prenda es la tarifa de puntos, y el factor lo multiplica el motor', () => {
    const { inputs } = ensamblarInputs(ctxDePrueba(), PROD, TALLA);
    expect(inputs.costoFijo).toBe(1.1933);
    expect(inputs.factorComplejidad).toBe(3);
    expect(inputs.costoIndirectoUnitario).toBeUndefined();
  });

  it('seOfrece sale de precio_venta, no del peso ni de la mano de obra', () => {
    // Regla decidida el 29-jul-2026: precio_venta es la fuente de verdad.
    const sin = ensamblarInputs(ctxDePrueba(), PROD, TALLA);
    expect(sin.meta.seOfrece).toBe(false);

    const con = ensamblarInputs(
      ctxDePrueba({ precioVentaPorClave: new Map([['p1_ta1', { precioBs: 250 }]]) }),
      PROD,
      TALLA
    );
    expect(con.meta.seOfrece).toBe(true);
    expect(con.inputs.precioVenta).toBe(250);
  });

  it('avisa cuando la prenda no tiene tela vinculada', () => {
    const { meta } = ensamblarInputs(ctxDePrueba(), { ...PROD, telaId: null }, TALLA);
    expect(meta.telaVinculada).toBe(false);
    expect(meta.faltantes.join(' ')).toContain('tela');
  });

  it('detecta que las dos columnas de peso se contradicen', () => {
    // peso_gramos deberia ser peso_exacto x (1 + merma/100). Si no lo es, una de
    // las dos columnas esta mal y el costo de tela sale de la que el motor elija.
    const { meta } = ensamblarInputs(
      ctxDePrueba({
        pesoPorClave: new Map([
          ['p1_ta1', { pesoGramos: 500, pesoExactoGramos: 350, mermaPorcentaje: 8 }],
        ]),
      }),
      PROD,
      TALLA
    );
    expect(meta.inconsistencias.join(' ')).toContain('contradicen');
  });

  it('expone las columnas de fijos que el modelo vigente no cuenta', () => {
    // costo_fijo, planchado_extra, colocacion_botones y operaciones_extra existen
    // en la tabla y ninguna pantalla las suma. Si traen valor, hay costo real
    // invisible. Decision de la Fase 4.
    const { meta } = ensamblarInputs(
      ctxDePrueba(),
      { ...PROD, planchadoExtra: 2.5 },
      TALLA
    );
    expect(meta.columnasFijasNoContadas.algunaConValor).toBe(true);
    expect(meta.columnasFijasNoContadas.planchadoExtra).toBe(2.5);
    expect(meta.inconsistencias.join(' ')).toContain('ninguna pantalla');
  });

  it('modo adquirido usa el precio de adquisicion y no la tela', () => {
    const { inputs, meta } = ensamblarInputs(
      ctxDePrueba({
        precioAdquisicionPorClave: new Map([['p1_ta1', { precioBs: 140 }]]),
        accesoriosPorProducto: new Map([
          [
            'p1',
            RECETA_CHOMPA.map((l, i) => ({
              accesorioId: `a${i}`,
              nombre: `acc ${i}`,
              unidadCompra: 'unidad',
              costoUnitarioBs: l.costoUnitario,
              cantidad: l.cantidadUso,
              costoTotalBs: l.costoUnitario,
              inactivo: false,
            })),
          ],
        ]),
      }),
      { ...PROD, modoCosteo: 'adquirido', itemNumero: 19 },
      TALLA
    );
    expect(inputs.precioAdquisicion).toBe(140);
    expect(meta.subtotalAccesoriosBs).toBe(7.84);

    // La cadena completa: 140 + 7,84 = 147,84, el valor de la hoja CostoBruto.
    expect(calcularCostoTotal(inputs).costoBruto).toBe(147.84);
  });

  it('modo confeccion sin precio de adquisicion no lo reclama', () => {
    const { meta } = ensamblarInputs(ctxDePrueba(), PROD, TALLA);
    expect(meta.faltantes.join(' ')).not.toContain('adquisicion');
  });

  it('modo adquirido SIN precio de adquisicion si lo reclama', () => {
    const { meta } = ensamblarInputs(
      ctxDePrueba(),
      { ...PROD, modoCosteo: 'adquirido' },
      TALLA
    );
    expect(meta.faltantes.join(' ')).toContain('adquisicion');
  });
});
