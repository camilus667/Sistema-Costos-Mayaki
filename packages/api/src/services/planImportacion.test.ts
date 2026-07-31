import { describe, it, expect } from 'vitest';
import {
  planificarCambios,
  huellaDePlan,
  UMBRAL_SALTO_PRECIO,
  CONFIANZA_SIN_CANDIDATO,
  type EstadoActual,
} from './planImportacion.service';
import type { FilaResuelta } from './importarPos.service';

/**
 * TESTS DEL PLAN DE CAMBIOS.
 *
 * Los valores esperados salen de haber MEDIDO el archivo real contra la base real, no de
 * ejemplos inventados. Sobre las 463 filas que hoy tienen colegio destino:
 *
 *   precio IGUAL al actual     19
 *   precio CAMBIA             429
 *   precio NUEVO, no habia     15
 *   cambian 40% o mas         126   el mayor +150%: un pantalon de 140 a 350
 *
 * Y las 463 filas son 50 decisiones: 36 en Cambridge y 14 en Internacional SM.
 */

const fr = (o: Partial<FilaResuelta> & { fila: number; nombre: string; precio: number }): FilaResuelta => ({
  origen: {
    fila: o.fila,
    categoria: 'C Cambridge',
    nombreProducto: o.nombre,
    variante: 'Talla 10',
    codigo: `${o.fila}-cc`,
    precioPos: o.precio,
    cantidad: 7,
  },
  estado: o.estado ?? 'ok',
  productoId: o.productoId ?? 'p1',
  productoDescripcion: o.productoDescripcion ?? 'Pantalon de vestir',
  // `in` y no `??`: con `??`, pasar `tallaId: undefined` para armar una fila SIN talla volvia a
  // caer en 't1', asi que la fila tenia talla igual y ningun test podia expresar el caso. Lo
  // descubrieron los tests de grupo parcial, que contaban 3 filas con talla donde habia 2.
  tallaId: 'tallaId' in o ? o.tallaId : 't1',
  tallaCodigo: 'tallaCodigo' in o ? o.tallaCodigo : '10',
  tallaAsignadaPorDefecto: o.tallaAsignadaPorDefecto,
  tallaCodigoFaltante: o.tallaCodigoFaltante,
  confianza: o.confianza ?? 1,
  candidatos: [],
  ...(o.motivo ? { motivo: o.motivo } : {}),
});

const vacio = (): EstadoActual => ({ precios: new Map(), codigos: new Map(), inventario: new Map() });

const base = (resueltas: FilaResuelta[], actual: EstadoActual = vacio()) =>
  planificarCambios({
    colegioId: 'c1',
    colegioNombre: 'Col. Cambridge',
    categoriaEsperada: 'C Cambridge',
    resueltas,
    actual,
    filasPorCategoria: new Map([['C Cambridge', resueltas.length]]),
    categoriasConColegio: new Set(['C Cambridge']),
  });

describe('accion sobre el precio', () => {
  it('sin precio previo es CREAR, y no inventa un delta', () => {
    const p = base([fr({ fila: 2, nombre: 'Pantalón, CC', precio: 230 })]);
    const f = p.grupos[0].filas[0];
    expect(f.accionPrecio).toBe('crear');
    expect(f.precioActual).toBeNull();
    // Un delta contra "no habia precio" no significa nada. Tiene que ser null y no 0:
    // un 0 en la pantalla se lee como "no cambia", que es lo contrario de la verdad.
    expect(f.delta).toBeNull();
    expect(f.saltoExtremo).toBe(false);
  });

  it('el mismo precio es SIN CAMBIO, con media centavo de tolerancia', () => {
    const actual = vacio();
    actual.precios.set('p1|t1', 230.001);
    const f = base([fr({ fila: 2, nombre: 'Pantalón, CC', precio: 230 })], actual).grupos[0].filas[0];
    // Los precios vienen del POS como texto: el redondeo de coma flotante no puede
    // contar como un cambio, o 429 filas pasarian a ser 448 por ruido.
    expect(f.accionPrecio).toBe('sin-cambio');
    expect(f.delta).toBeCloseTo(0, 5);
  });

  it('un precio distinto es ACTUALIZAR y calcula el delta contra el actual', () => {
    const actual = vacio();
    actual.precios.set('p1|t1', 140);
    const f = base([fr({ fila: 2, nombre: 'Pantalón, CC', precio: 350 })], actual).grupos[0].filas[0];
    expect(f.accionPrecio).toBe('actualizar');
    // El caso real mas grande del archivo: Pantalon 3XL de Intl SM, 140 -> 350.
    expect(f.delta).toBeCloseTo(1.5, 5);
    expect(f.saltoExtremo).toBe(true);
  });

  it('un precio actual en cero no produce un delta infinito', () => {
    // Dividir por cero daria Infinity y la pantalla mostraria un porcentaje absurdo.
    const actual = vacio();
    actual.precios.set('p1|t1', 0);
    const f = base([fr({ fila: 2, nombre: 'Pantalón, CC', precio: 230 })], actual).grupos[0].filas[0];
    expect(f.accionPrecio).toBe('actualizar');
    expect(f.delta).toBeNull();
    expect(Number.isFinite(f.precioPos)).toBe(true);
  });

  it('marca el salto justo en el umbral y no el de abajo', () => {
    const actual = vacio();
    actual.precios.set('p1|t1', 100);
    const justo = base([fr({ fila: 2, nombre: 'A, CC', precio: 100 * (1 + UMBRAL_SALTO_PRECIO) })], actual);
    const debajo = base([fr({ fila: 2, nombre: 'A, CC', precio: 139 })], actual);
    expect(justo.grupos[0].filas[0].saltoExtremo).toBe(true);
    expect(debajo.grupos[0].filas[0].saltoExtremo).toBe(false);
  });

  it('una BAJA de precio tambien es un salto extremo', () => {
    // El valor absoluto importa: que el POS cobre la mitad de lo que dice el sistema es
    // igual de grave que el doble, y en el archivo real hay una razon minima de 0.19x.
    const actual = vacio();
    actual.precios.set('p1|t1', 500);
    const f = base([fr({ fila: 2, nombre: 'A, CC', precio: 95 })], actual).grupos[0].filas[0];
    expect(f.delta).toBeCloseTo(-0.81, 2);
    expect(f.saltoExtremo).toBe(true);
  });
});

describe('agrupado por prenda', () => {
  it('las filas de un mismo nombre son UNA decision', () => {
    // Medido: 297 filas de Cambridge son 36 decisiones, 8 filas por decision. Agrupar es
    // lo que hace revisable la importacion.
    const filas = [10, 12, 14, 16].map((i) =>
      fr({ fila: i, nombre: 'Pantalón de Dama, Intl SM', precio: 200, tallaId: 't' + i, tallaCodigo: String(i) })
    );
    const p = base(filas);
    expect(p.grupos).toHaveLength(1);
    expect(p.grupos[0].resumen.filas).toBe(4);
    expect(p.resumen.decisiones).toBe(1);
    expect(p.resumen.filasDelColegio).toBe(4);
  });

  it('el estado del grupo es el PEOR de sus filas', () => {
    // Un grupo con una fila sin talla no es "ok": esconderlo detras de tres filas verdes
    // es exactamente como se pierde una talla en una importacion.
    const p = base([
      fr({ fila: 2, nombre: 'Pantalón, CC', precio: 200 }),
      fr({ fila: 3, nombre: 'Pantalón, CC', precio: 200, estado: 'sin-talla', tallaId: undefined, tallaCodigo: undefined }),
    ]);
    expect(p.grupos[0].estado).toBe('sin-talla');
  });

  it('el grupo cuenta CUANTAS filas tienen talla, no solo que alguna no tiene', () => {
    // MEDIDO en la base de prueba: desactivando dos tallas, 22 grupos quedaban en `sin-talla` con
    // 268 filas descartadas, y 225 de esas filas TENIAN talla. Diecisiete de los 22 emparejaban el
    // nombre al 100%. `estado` solo no alcanza para decidir: hace falta el conteo.
    const p = base([
      fr({ fila: 2, nombre: 'Pantalón, CC', precio: 200 }),
      fr({ fila: 3, nombre: 'Pantalón, CC', precio: 200 }),
      fr({ fila: 4, nombre: 'Pantalón, CC', precio: 200, estado: 'sin-talla',
           tallaId: undefined, tallaCodigo: undefined, tallaCodigoFaltante: '2' }),
    ]);
    expect(p.grupos[0].resumen.filas).toBe(3);
    expect(p.grupos[0].filasConTalla).toBe(2);
  });

  it('nombra las tallas que faltan, sin repetirlas', () => {
    // Son las mismas dos o tres tallas repetidas en veinte prendas: listar catorce veces la 02
    // obligaria a leer catorce lineas para descubrir que el arreglo es activar una talla.
    const p = base([
      fr({ fila: 2, nombre: 'A, CC', precio: 1, estado: 'sin-talla', tallaId: undefined, tallaCodigoFaltante: '4' }),
      fr({ fila: 3, nombre: 'A, CC', precio: 1, estado: 'sin-talla', tallaId: undefined, tallaCodigoFaltante: '2' }),
      fr({ fila: 4, nombre: 'A, CC', precio: 1, estado: 'sin-talla', tallaId: undefined, tallaCodigoFaltante: '2' }),
      fr({ fila: 5, nombre: 'A, CC', precio: 1 }),
    ]);
    expect(p.grupos[0].tallasFaltantes).toEqual(['2', '4']);
    expect(p.grupos[0].filasConTalla).toBe(1);
  });

  it('un grupo con TODAS las tallas resueltas no tiene faltantes', () => {
    const p = base([
      fr({ fila: 2, nombre: 'A, CC', precio: 1 }),
      fr({ fila: 3, nombre: 'A, CC', precio: 1 }),
    ]);
    expect(p.grupos[0].filasConTalla).toBe(2);
    expect(p.grupos[0].tallasFaltantes).toEqual([]);
  });

  it('un grupo sin NINGUNA talla se distingue de uno parcial', () => {
    // Es la unica diferencia que decide si el grupo se saltea o se importa a medias.
    const p = base([
      fr({ fila: 2, nombre: 'A, CC', precio: 1, estado: 'sin-talla', tallaId: undefined, tallaCodigoFaltante: '2' }),
      fr({ fila: 3, nombre: 'A, CC', precio: 1, estado: 'sin-talla', tallaId: undefined, tallaCodigoFaltante: '4' }),
    ]);
    expect(p.grupos[0].filasConTalla).toBe(0);
  });

  it('sin-producto gana a revisar, porque pide otra decision', () => {
    const p = base([
      fr({ fila: 2, nombre: 'A, CC', precio: 1, estado: 'revisar', confianza: 0.5 }),
      fr({ fila: 3, nombre: 'B, CC', precio: 1, estado: 'sin-producto', productoId: undefined, productoDescripcion: undefined, confianza: 0 }),
    ]);
    // Los que exigen atencion van primero, y sin-producto es mas grave que revisar.
    expect(p.grupos[0].estado).toBe('sin-producto');
    expect(p.grupos[0].puedeCrearPrenda).toBe(true);
    expect(p.grupos[1].puedeCrearPrenda).toBe(false);
  });

  it('un parecido muy malo equivale a no haber encontrado nada, y se puede crear', () => {
    // EL DEFECTO QUE ESTO ARREGLA. resolverFilas marca `sin-producto` solo cuando ninguna
    // prenda da algun parecido, y como la similitud devuelve algo mayor que cero para casi
    // cualquier par de textos, ese estado no aparece nunca. Medido sobre el archivo real: de
    // los 11 grupos de Cambridge que no resuelven, los 11 son `revisar`. La opcion de crear
    // las prendas faltantes estaba muerta porque no habia grupo al que aplicarse.
    //
    // Casos reales, con su confianza medida:
    //   10%  Riñonera  -> Pantalón para dama     la prenda no existe
    //   13%  Lanyard   -> Calza larga            la prenda no existe
    //   58%  Pantalón de Varon -> Pantalón de vestir   ESTO si es una decision
    const inexistente = base([
      fr({ fila: 2, nombre: 'Riñonera, CC', precio: 50, estado: 'revisar', confianza: 0.10,
           productoDescripcion: 'Pantalón para dama' }),
    ]);
    expect(inexistente.grupos[0].puedeCrearPrenda).toBe(true);
    expect(inexistente.resumen.prendasPorCrear).toBe(1);

    const decisionReal = base([
      fr({ fila: 2, nombre: 'Pantalón de Varon, CC', precio: 230, estado: 'revisar', confianza: 0.58,
           productoDescripcion: 'Pantalón de vestir' }),
    ]);
    // A 58% hay una pregunta de verdad: podrian ser la misma prenda. Ofrecer crearla
    // invitaria a duplicar una prenda que si existe, y quedaria el costo en una y el precio
    // en la otra.
    expect(decisionReal.grupos[0].puedeCrearPrenda).toBe(false);
    expect(decisionReal.resumen.prendasPorCrear).toBe(0);
  });

  it('el umbral se mide contra la MEJOR confianza del grupo, no contra la peor', () => {
    // Si una sola talla emparejo bien, la prenda existe: crear otra la duplicaria.
    const p = base([
      fr({ fila: 2, nombre: 'Polo, CC', precio: 1, estado: 'revisar', confianza: 0.05 }),
      fr({ fila: 3, nombre: 'Polo, CC', precio: 1, estado: 'revisar', confianza: CONFIANZA_SIN_CANDIDATO + 0.2 }),
    ]);
    expect(p.grupos[0].puedeCrearPrenda).toBe(false);
  });

  it('ordena los grupos sanos por el salto mas grande, no por nombre', () => {
    const actual = vacio();
    actual.precios.set('p1|ta', 100);
    actual.precios.set('p1|tb', 100);
    const p = base(
      [
        fr({ fila: 2, nombre: 'Aaa tranquila, CC', precio: 105, tallaId: 'ta' }),
        fr({ fila: 3, nombre: 'Zzz peligrosa, CC', precio: 300, tallaId: 'tb' }),
      ],
      actual
    );
    // Ordenar por nombre repartiria el riesgo por toda la lista y obligaria a leerla toda.
    expect(p.grupos[0].nombrePos).toBe('Zzz peligrosa, CC');
    expect(p.grupos[0].resumen.deltaMaximo).toBeCloseTo(2, 5);
  });

  it('no fusiona dos nombres del POS que caen en la misma prenda', () => {
    // Que dos nombres distintos apunten a la misma prenda es un problema que hay que VER,
    // no una coincidencia que convenga esconder fusionando los grupos.
    const p = base([
      fr({ fila: 2, nombre: 'Pantalón de Varón, CC', precio: 200, productoId: 'p1' }),
      fr({ fila: 3, nombre: 'Pantalón de Dama, CC', precio: 200, productoId: 'p1' }),
    ]);
    expect(p.grupos).toHaveLength(2);
    expect(p.grupos.every((g) => g.productoId === 'p1')).toBe(true);
  });
});

describe('codigo del POS e inventario', () => {
  it('detecta que el codigo es nuevo cuando la fila no tenia ninguno', () => {
    // Las 297 filas que ya existen tienen codigo_externo en NULL: la primera importacion
    // los escribe todos.
    const f = base([fr({ fila: 2, nombre: 'A, CC', precio: 1 })]).grupos[0].filas[0];
    expect(f.codigoActual).toBeNull();
    expect(f.codigoPos).toBe('2-cc');
    expect(f.codigoCambia).toBe(true);
  });

  it('no marca cambio si el codigo guardado ya es el mismo', () => {
    const actual = vacio();
    actual.codigos.set('p1|t1', '2-cc');
    const f = base([fr({ fila: 2, nombre: 'A, CC', precio: 1 })], actual).grupos[0].filas[0];
    expect(f.codigoCambia).toBe(false);
  });

  it('compara la cantidad de inventario contra la que hay', () => {
    const actual = vacio();
    actual.inventario.set('p1|t1', 7);
    const igual = base([fr({ fila: 2, nombre: 'A, CC', precio: 1 })], actual).grupos[0].filas[0];
    expect(igual.cantidadActual).toBe(7);
    expect(igual.cantidadCambia).toBe(false);

    actual.inventario.set('p1|t1', 3);
    const distinta = base([fr({ fila: 2, nombre: 'A, CC', precio: 1 })], actual).grupos[0].filas[0];
    expect(distinta.cantidadCambia).toBe(true);
  });
});

describe('categorias sin colegio en el sistema', () => {
  it('las reporta con su conteo en vez de descartarlas en silencio', () => {
    // EL CASO REAL: el sistema tiene dos colegios y el archivo trae cinco, asi que 269 de
    // 732 filas no tienen a donde ir. Descartarlas calladas seria dejar creer que se
    // importo todo.
    const p = planificarCambios({
      colegioId: 'c1',
      colegioNombre: 'Col. Cambridge',
      categoriaEsperada: 'C Cambridge',
      resueltas: [fr({ fila: 2, nombre: 'A, CC', precio: 1 })],
      actual: vacio(),
      filasPorCategoria: new Map([
        ['C Cambridge', 297],
        ['C Intl. San Marcos', 166],
        ['C Edad de Oro', 126],
        ['C Infantil San Marcos', 95],
        ['C Saint Jude', 48],
      ]),
      categoriasConColegio: new Set(['C Cambridge', 'C Intl. San Marcos']),
    });
    // Cada una viaja con el nombre y la ABREVIATURA sugeridos, que es lo que permite crear el
    // colegio desde el importador con un clic. La abreviatura sale del sufijo que el POS ya usa en
    // sus codigos: si fuera otra, el colegio nuevo no encontraria ninguna de sus filas.
    expect(p.categoriasSinColegio).toEqual([
      { categoria: 'C Edad de Oro', filas: 126, nombreSugerido: 'C Edad de Oro', abreviaturaSugerida: 'EO' },
      { categoria: 'C Infantil San Marcos', filas: 95, nombreSugerido: 'C Infantil San Marcos', abreviaturaSugerida: 'INFSM' },
      { categoria: 'C Saint Jude', filas: 48, nombreSugerido: 'C Saint Jude', abreviaturaSugerida: 'JS' },
    ]);
    // 126 + 95 + 48 = 269, el numero medido.
    expect(p.avisos.some((a) => a.includes('269'))).toBe(true);
  });

  it('sin categorias huerfanas no inventa el aviso', () => {
    const p = base([fr({ fila: 2, nombre: 'A, CC', precio: 1 })]);
    expect(p.categoriasSinColegio).toEqual([]);
    expect(p.avisos.some((a) => a.includes('no tienen colegio'))).toBe(false);
  });
});

describe('huella del plan', () => {
  it('el mismo contenido da la misma huella', () => {
    const f = [fr({ fila: 2, nombre: 'A, CC', precio: 230 })];
    expect(huellaDePlan('c1', f)).toBe(huellaDePlan('c1', f));
  });

  it('el ORDEN de las filas no cambia la huella', () => {
    // La resolucion no garantiza un orden estable, y si el orden moviera la huella la
    // ejecucion se negaria a correr un plan que en realidad es el mismo.
    const a = fr({ fila: 2, nombre: 'A, CC', precio: 230 });
    const b = fr({ fila: 3, nombre: 'B, CC', precio: 120 });
    expect(huellaDePlan('c1', [a, b])).toBe(huellaDePlan('c1', [b, a]));
  });

  it('un PRECIO distinto cambia la huella', () => {
    // Esto es lo que la huella tiene que atrapar: revisar una planilla y confirmar otra.
    const a = [fr({ fila: 2, nombre: 'A, CC', precio: 230 })];
    const b = [fr({ fila: 2, nombre: 'A, CC', precio: 231 })];
    expect(huellaDePlan('c1', a)).not.toBe(huellaDePlan('c1', b));
  });

  it('otro COLEGIO cambia la huella con las mismas filas', () => {
    const f = [fr({ fila: 2, nombre: 'A, CC', precio: 230 })];
    expect(huellaDePlan('c1', f)).not.toBe(huellaDePlan('c2', f));
  });

  it('un EMPAREJAMIENTO distinto cambia la huella', () => {
    // Si el usuario corrige a mano a que prenda va un grupo, el plan ya no es el mismo y
    // la ejecucion tiene que exigir la huella nueva.
    const a = [fr({ fila: 2, nombre: 'A, CC', precio: 230, productoId: 'p1' })];
    const b = [fr({ fila: 2, nombre: 'A, CC', precio: 230, productoId: 'p9' })];
    expect(huellaDePlan('c1', a)).not.toBe(huellaDePlan('c1', b));
  });

  it('no se confunde por concatenacion, en CADA frontera entre campos', () => {
    // Sin separador, codigo "1" + precio "23" y codigo "12" + precio "3" darian la misma
    // secuencia de caracteres y por lo tanto la misma huella. Es el error clasico de una
    // huella hecha a mano.
    //
    // Se prueba cada frontera POR SEPARADO y no una sola vez. La primera version de este
    // test movia codigo y precio a la vez, asi que solo defendia esa unica frontera:
    // quitando el separador entre fila y codigo, o entre cantidad y producto, el test
    // seguia pasando. Un test que cubre una frontera de cinco da una falsa sensacion de
    // cobertura, que es peor que no tenerlo.
    const conCampos = (campos: { fila?: number; codigo?: string; precio?: number; cantidad?: number; prod?: string; talla?: string }) => {
      const f = fr({ fila: campos.fila ?? 2, nombre: 'A, CC', precio: campos.precio ?? 100 });
      f.origen.codigo = campos.codigo ?? 'x';
      f.origen.cantidad = campos.cantidad ?? 5;
      f.productoId = campos.prod ?? 'p1';
      f.tallaId = campos.talla ?? 't1';
      return huellaDePlan('c1', [f]);
    };

    // fila | codigo
    expect(conCampos({ fila: 2, codigo: '11' })).not.toBe(conCampos({ fila: 21, codigo: '1' }));
    // codigo | precio
    expect(conCampos({ codigo: '1', precio: 23 })).not.toBe(conCampos({ codigo: '12', precio: 3 }));
    // precio | cantidad
    expect(conCampos({ precio: 1, cantidad: 23 })).not.toBe(conCampos({ precio: 12, cantidad: 3 }));
    // cantidad | producto
    expect(conCampos({ cantidad: 1, prod: '23' })).not.toBe(conCampos({ cantidad: 12, prod: '3' }));
    // producto | talla
    expect(conCampos({ prod: 'a', talla: 'bc' })).not.toBe(conCampos({ prod: 'ab', talla: 'c' }));
  });
});

describe('resumen del plan', () => {
  it('cuenta crear, actualizar y sin cambio solo entre las importables', () => {
    // Una fila que exige revision no se va a escribir, asi que contarla como "actualizar"
    // prometeria un cambio que no va a ocurrir.
    const actual = vacio();
    actual.precios.set('p1|ta', 100);
    actual.precios.set('p1|tb', 200);
    actual.precios.set('p1|td', 500);  // la fila en revision seria un "actualizar"
    actual.precios.set('p1|te', 400);  // y esta un "sin-cambio"
    const p = base(
      [
        fr({ fila: 2, nombre: 'A, CC', precio: 150, tallaId: 'ta' }),                       // actualizar
        fr({ fila: 3, nombre: 'B, CC', precio: 200, tallaId: 'tb' }),                       // sin cambio
        fr({ fila: 4, nombre: 'C, CC', precio: 300, tallaId: 'tc' }),                       // crear
        // Las tres que exigen revision tienen, a proposito, una accion de cada tipo:
        // actualizar, sin-cambio y crear. Si el resumen no filtrara por estado, los tres
        // conteos subirian, no uno. La primera version de este test ponia una sola fila
        // en revision y sin precio previo —o sea un "crear"— asi que no protegia los
        // otros dos conteos.
        fr({ fila: 5, nombre: 'D, CC', precio: 999, tallaId: 'td', estado: 'revisar', confianza: 0.5 }),
        fr({ fila: 6, nombre: 'E, CC', precio: 400, tallaId: 'te', estado: 'revisar', confianza: 0.5 }),
        fr({ fila: 7, nombre: 'F, CC', precio: 300, tallaId: 'tf', estado: 'sin-producto', productoId: undefined, confianza: 0 }),
      ],
      actual
    );
    expect(p.resumen).toMatchObject({
      filasDelColegio: 6,
      decisiones: 6,
      importables: 3,
      exigenRevision: 3,
      actualizar: 1,
      sinCambio: 1,
      crear: 1,
    });
  });

  it('cuenta las filas que fueron a la talla por defecto', () => {
    // Son los genericos sin variante —Riñonera, Gorra, Lanyard— que van a la talla 14.
    // Que el resumen los cuente importa porque la 14 es un casillero, no una talla real.
    const p = base([
      fr({ fila: 2, nombre: 'Riñonera, CC', precio: 50, tallaCodigo: '14', tallaAsignadaPorDefecto: true }),
      fr({ fila: 3, nombre: 'Gorra, CC', precio: 40, tallaCodigo: '14', tallaAsignadaPorDefecto: true }),
      fr({ fila: 4, nombre: 'Pantalón, CC', precio: 200 }),
    ]);
    expect(p.resumen.tallaPorDefecto).toBe(2);
  });

  it('avisa de los saltos extremos con su conteo', () => {
    const actual = vacio();
    actual.precios.set('p1|ta', 100);
    const p = base([fr({ fila: 2, nombre: 'A, CC', precio: 300, tallaId: 'ta' })], actual);
    expect(p.resumen.saltosExtremos).toBe(1);
    expect(p.avisos.some((a) => a.includes('40%'))).toBe(true);
  });

  it('las filas de otro colegio no entran al plan', () => {
    // Se importa un colegio por corrida: las de otra categoria no son parte de este plan
    // ni deben inflar sus conteos.
    const p = base([
      fr({ fila: 2, nombre: 'A, CC', precio: 1 }),
      fr({ fila: 3, nombre: 'B, EO', precio: 1, estado: 'otro-colegio', productoId: undefined, tallaId: undefined }),
    ]);
    expect(p.resumen.filasDelColegio).toBe(1);
    expect(p.grupos).toHaveLength(1);
  });
});
