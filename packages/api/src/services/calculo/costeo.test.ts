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

const r2 = (n: number) => Math.round(n * 100) / 100;

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

describe('calcularCostoTotal — el IVA ya no toca el costo', () => {
  it('el costo neto es la suma de sus componentes, sin importar la tasa', () => {
    const r = calcularCostoTotal({
      pesoConMermaGramos: 378,
      precioBsG: SACO.precioBsG,
      costoAccesorios: 23.52,
      costoManoObra: 100,
      costoFijo: 1.1933,
      tasaIva: 0.13,
    });
    // 45,93 + 23,52 + 100 + 1,1933, redondeado una sola vez al final.
    expect(r.costoUnitarioNeto).toBe(170.64);
    expect(r.costoUnitarioNeto).toBe(
      calcularCostoTotal({
        pesoConMermaGramos: 378,
        precioBsG: SACO.precioBsG,
        costoAccesorios: 23.52,
        costoManoObra: 100,
        costoFijo: 1.1933,
        tasaIva: 0,
      }).costoUnitarioNeto
    );
  });

  it('la tasa solo mueve el lado del precio', () => {
    const base = { costoManoObra: 100, precioVenta: 200, impuestosActivos: true };
    const sin = calcularCostoTotal({ ...base, tasaIva: 0 });
    const con = calcularCostoTotal({ ...base, tasaIva: 0.13 });
    expect(sin.costoUnitarioNeto).toBe(con.costoUnitarioNeto);
    expect(sin.ingresoNetoConFactura).toBe(200);
    expect(con.ingresoNetoConFactura).toBe(174); // 200 x 0,87
  });

  it('pasar 13 en vez de 0,13 produce un disparate detectable', () => {
    // No es el comportamiento deseado: se fija para documentar por que la
    // conversion tiene que ser explicita, y por que el zod de /calcular pone
    // tope 1 en tasaIva.
    const r = calcularCostoTotal({
      costoManoObra: 100,
      precioVenta: 100,
      impuestosActivos: true,
      tasaIva: 13,
    });
    expect(r.ingresoNetoConFactura).toBeLessThan(0);
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

describe('calcularCostoTotal — utilidad por canal', () => {
  it('utilidad sobre el ingreso cobrado, con el costo neto', () => {
    // Sin impuestos activos el ingreso con factura es el precio de lista.
    const r = calcularCostoTotal({ costoManoObra: 100, precioVenta: 150 });
    expect(r.costoUnitarioNeto).toBe(100);
    expect(r.ingresoNetoConFactura).toBe(150);
    expect(r.utilidadConFactura).toBe(50);
    expect(r.margenConFactura).toBe(33.33);
  });

  it('sin precio de venta devuelve null, no cero', () => {
    // Cero significaria "margen cero", que es una afirmacion distinta de "no se
    // sabe el precio".
    const r = calcularCostoTotal({ costoManoObra: 100 });
    expect(r.utilidadConFactura).toBeNull();
    expect(r.margenConFactura).toBeNull();
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
      impuestosActivos: false,
      descuentoSinFactura: 0.1,
      volumenAnualProduccion: 21600,
      porcentajeAbsorcionIndirectos: 100,
    },
    tasaIvaFraccion: 0.13,
    totalIndirectosMensual: 21480,
    poolIndirectoAnual: 21480 * 12,
    volumenAnual: 21600,
    factorPromedio: 2,
    // 257.760 / (21.600 x 2) = 5,9667 Bs por punto de factor
    tasaPorPuntoFactor: (21480 * 12) / (21600 * 2),
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

  it('FASE 4: el indirecto va en su propio campo, no disfrazado de costo fijo', () => {
    // Antes el pool de indirectos se colaba por la via de costoFijo y
    // costoIndirectoUnitario quedaba en undefined, lo que hacia parecer que el
    // sistema no prorrateaba indirectos cuando en realidad los prorrateaba mal.
    const { inputs } = ensamblarInputs(ctxDePrueba(), PROD, TALLA);
    expect(inputs.costoFijo).toBe(0);
    expect(inputs.factorComplejidad).toBe(3);
    // tasaPorPuntoFactor 5,9667 x factor 3
    expect(inputs.costoIndirectoUnitario).toBeCloseTo(17.9, 1);
  });

  it('FASE 4: el indirecto es proporcional al factorComplejidad', () => {
    const ctx = ctxDePrueba();
    const f1 = ensamblarInputs(ctx, { ...PROD, factorComplejidad: 1 }, TALLA);
    const f3 = ensamblarInputs(ctx, { ...PROD, factorComplejidad: 3 }, TALLA);
    expect(f3.inputs.costoIndirectoUnitario! / f1.inputs.costoIndirectoUnitario!).toBeCloseTo(3, 5);
  });

  it('FASE 4: el porcentaje de absorcion reproduce el modelo viejo', () => {
    // El usuario pidio mantener el costo por prenda del modelo viejo. No se puede
    // con el factor: los factores son invariantes de escala, multiplicarlos todos
    // por k deja el producto igual, asi que deciden el REPARTO y nunca el total.
    // La palanca legitima es el porcentaje de absorcion, que es exactamente lo que
    // era el \`* 10\`: absorber factorPromedio/10 del pool.
    const completo = ctxDePrueba();
    const parcial = ctxDePrueba({
      // 50% de absorcion sobre el mismo pool y volumen
      tasaPorPuntoFactor: ((21480 * 12) * 0.5) / (21600 * 2),
    });
    const a = ensamblarInputs(completo, PROD, TALLA);
    const b = ensamblarInputs(parcial, PROD, TALLA);
    expect(b.inputs.costoIndirectoUnitario).toBeCloseTo(a.inputs.costoIndirectoUnitario! / 2, 4);
  });

  it('FASE 4: escalar TODOS los factores no cambia lo absorbido', () => {
    // La propiedad que hace imposible replicar el modelo viejo tocando factores.
    // Se fija porque es contraintuitiva: parece que subir el factor deberia subir
    // el indirecto, y no lo hace si sube en todo el catalogo.
    const base = ctxDePrueba({ factorPromedio: 2, tasaPorPuntoFactor: (21480 * 12) / (21600 * 2) });
    const escalado = ctxDePrueba({ factorPromedio: 20, tasaPorPuntoFactor: (21480 * 12) / (21600 * 20) });
    const a = ensamblarInputs(base, { ...PROD, factorComplejidad: 3 }, TALLA);
    const b = ensamblarInputs(escalado, { ...PROD, factorComplejidad: 30 }, TALLA);
    expect(b.inputs.costoIndirectoUnitario).toBeCloseTo(a.inputs.costoIndirectoUnitario!, 4);
  });

  it('FASE 4: la tasa NO depende del alcance de la consulta', () => {
    // Bug real detectado por el arnes: el factor promedio se calculaba sobre la
    // lista FILTRADA de productos, asi que al costear una prenda sola el promedio
    // era su propio factor, el factor se cancelaba, y toda prenda absorbia 11,93
    // en vez de su parte proporcional. Costear una prenda sola daba distinto que
    // costearla dentro del lote. La tasa es propiedad del negocio, no de la query.
    const ctx = ctxDePrueba();
    const solo = ensamblarInputs(ctx, { ...PROD, factorComplejidad: 1 }, TALLA);
    // Con factorPromedio 2 y tasa 5,9667, una prenda de factor 1 absorbe 5,97.
    // Si la tasa dependiera del alcance, absorberia 11,93.
    expect(solo.inputs.costoIndirectoUnitario).toBeCloseTo(5.9667, 3);
    expect(solo.inputs.costoIndirectoUnitario).not.toBeCloseTo(11.9333, 3);
  });

  it('FASE 4: una prenda con el factor promedio absorbe el pool por unidad', () => {
    // La normalizacion es lo que hace que la asignacion SUME el pool. Una prenda
    // con factor igual al promedio tiene que absorber exactamente
    // poolAnual / volumenAnual. Sin normalizar, el modelo viejo absorbia
    // factor/10 de eso: con factores de 1 a 3, entre el 10% y el 30%.
    const ctx = ctxDePrueba();
    const { inputs } = ensamblarInputs(ctx, { ...PROD, factorComplejidad: ctx.factorPromedio }, TALLA);
    expect(inputs.costoIndirectoUnitario).toBeCloseTo(ctx.poolIndirectoAnual / ctx.volumenAnual, 4);
    expect(inputs.costoIndirectoUnitario).toBeCloseTo(11.9333, 3);
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

// ---------------------------------------------------------------------------
// FASE 3 — impuestos y canal de venta
// ---------------------------------------------------------------------------

/** Caso de numeros redondos: costo 50, precio de lista 100, IVA 13%, descuento 10%. */
const CANAL: CalculoInputs = {
  costoManoObra: 50,
  precioVenta: 100,
  tasaIva: 0.13,
  descuentoSinFactura: 0.1,
};

describe('Fase 3 — el costo neto no lleva IVA', () => {
  it('costoUnitarioNeto es la suma de los componentes, sin IVA encima', () => {
    const r = calcularCostoTotal(CANAL);
    expect(r.costoUnitarioNeto).toBe(50);
    // Y coincide con la suma explicita de sus partes: no hay nada oculto.
    expect(r.costoUnitarioNeto).toBe(
      r2(r.costoBruto + r.costoFijosVariable + r.costoIndirecto)
    );
  });

  it('el modelo viejo sobreestimaba el costo un 13%', () => {
    // El IVA de compras es credito fiscal recuperable en el regimen general
    // boliviano. Meterlo al costo lo infla y subestima el margen, lo que puede
    // llevar a rechazar negocio rentable o a sobre-preciar.
    const r = calcularCostoTotal(CANAL);
    const costoViejo = r.costoUnitarioNeto * 1.13; // lo que devolvia costoTotal
    expect(costoViejo).toBeCloseTo(56.5, 2);
    expect(costoViejo - r.costoUnitarioNeto).toBeCloseTo(6.5, 2);
  });

  it('los campos del modelo viejo ya no existen', () => {
    // Impide que vuelvan por la ventana. Eran dos representaciones del mismo
    // numero mas un error: la misma patologia que la auditoria marco en la tabla
    // de telas, con cuatro representaciones del mismo precio.
    const r = calcularCostoTotal(CANAL) as any;
    expect(r.costoTotal).toBeUndefined();
    expect(r.iva).toBeUndefined();
    expect(r.costoAntesImpuestos).toBeUndefined();
    expect(r.utilidadNeta).toBeUndefined();
    expect(r.margenPorcentaje).toBeUndefined();
  });
});

describe('Fase 3 — ingreso neto por canal', () => {
  it('con el check apagado, el ingreso con factura es el precio de lista', () => {
    // Default OFF, decidido con el usuario el 28-jul-2026.
    const r = calcularCostoTotal({ ...CANAL, impuestosActivos: false });
    expect(r.ingresoNetoConFactura).toBe(100);
  });

  it('con el check prendido, el IVA va POR DENTRO: de 100 quedan 87, no 88,50', () => {
    // El 13% boliviano se calcula sobre el precio bruto, no se le suma. Dividir
    // por 1,13 daria 88,50 y sobreestimaria el ingreso en 1,50 por cada 100.
    const r = calcularCostoTotal({ ...CANAL, impuestosActivos: true });
    expect(r.ingresoNetoConFactura).toBe(87);
    expect(r.ingresoNetoConFactura).not.toBe(88.5);
  });

  it('el descuento sin factura se aplica aunque el check este apagado', () => {
    // Es un descuento de precio, no un impuesto: si no facturas resignas ese 10%
    // de ingreso igual, independientemente de como se modelen los impuestos.
    expect(calcularCostoTotal({ ...CANAL, impuestosActivos: false }).ingresoNetoSinFactura).toBe(90);
    expect(calcularCostoTotal({ ...CANAL, impuestosActivos: true }).ingresoNetoSinFactura).toBe(90);
  });

  it('sin factura entra MAS plata que con factura, por 3 Bs sobre 100', () => {
    // Y esa es la trampa: la comparacion parece favorecer no facturar, pero
    // ignora el credito fiscal de las compras, que solo se aprovecha contra el
    // debito fiscal de las ventas facturadas. El descuento del 10% esta calibrado
    // casi al punto de indiferencia.
    const r = calcularCostoTotal({ ...CANAL, impuestosActivos: true });
    expect(r.ingresoNetoSinFactura! - r.ingresoNetoConFactura!).toBe(3);
  });

  it('los margenes se miden sobre el ingreso cobrado, no sobre el precio de lista', () => {
    const r = calcularCostoTotal({ ...CANAL, impuestosActivos: true });
    // (87 - 50) / 87 y (90 - 50) / 90
    expect(r.margenConFactura).toBe(42.53);
    expect(r.margenSinFactura).toBe(44.44);
  });

  it('el margen que reportaba el modelo viejo caia ENTRE los dos reales', () => {
    // Los dos errores se compensaban parcialmente: el motor inflaba el costo con
    // IVA (subestimaba el margen) y a la vez no neteaba el precio (lo
    // sobreestimaba). Por eso nada parecia roto. Este test fija la magnitud de ese
    // enmascaramiento, que es el argumento de negocio de toda la Fase 3.
    const r = calcularCostoTotal({ ...CANAL, impuestosActivos: true });
    const margenViejo = 43.5; // (100 - 50 x 1,13) / 100 x 100
    expect(margenViejo).toBeGreaterThan(r.margenConFactura!);
    expect(margenViejo).toBeLessThan(r.margenSinFactura!);
  });

  it('la utilidad por canal usa el costo neto, no el inflado', () => {
    const r = calcularCostoTotal({ ...CANAL, impuestosActivos: true });
    expect(r.utilidadConFactura).toBe(37); // 87 - 50
    expect(r.utilidadSinFactura).toBe(40); // 90 - 50
  });

  it('sin precio de venta, los cuatro campos de canal son null', () => {
    const r = calcularCostoTotal({ costoManoObra: 50, impuestosActivos: true });
    expect(r.ingresoNetoConFactura).toBeNull();
    expect(r.ingresoNetoSinFactura).toBeNull();
    expect(r.margenConFactura).toBeNull();
    expect(r.margenSinFactura).toBeNull();
  });
});

describe('Fase 3 — defaults de configuracion', () => {
  it('impuestos apagados y descuento 0,10 cuando la base no responde', () => {
    // getSystemConfig atrapa el error de la consulta y devuelve los defaults, asi
    // que un db que falla sirve para verificarlos sin base.
    const dbRoto = { select: () => { throw new Error('sin base'); } };
    return import('../configService').then(async (m) => {
      const cfg = await m.getSystemConfig(dbRoto);
      expect(cfg.impuestosActivos).toBe(false);
      expect(cfg.descuentoSinFactura).toBe(0.1);
      expect(cfg.tasaIva).toBe(13);
    });
  });
});
