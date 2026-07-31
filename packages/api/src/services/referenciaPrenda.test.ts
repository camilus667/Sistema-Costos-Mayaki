/**
 * Los casos salen de la base y del export del POS de verdad, no de ejemplos inventados.
 *
 * MEDIDO en `sistema_inventario.db`:
 *   Col. Cambridge      27 prendas, orden 1..27, item_numero 1..27
 *   Internacional SM     1 prenda,  orden 1,     item_numero 28
 *
 * Ese `item_numero 28` es el bug original: en la matriz salia `1, 28, 2, 3...` porque el numero
 * era GLOBAL. El caso que protege esto es que esa prenda quede `ISM-01`, no `28`.
 *
 * MEDIDO en el export del POS: los sufijos son `cc` (297 filas), `IntlSM` (166), `EO` (126),
 * `InfSM` (95), `JS` (48), mas 33 filas sin sufijo (`General`, `Empresas`) y un codigo anomalo
 * con sufijo `vUuYlnh`.
 */

import { describe, it, expect } from 'vitest';
import {
  abreviaturaPorDefecto,
  asignarAbreviaturas,
  formarReferencia,
  asignarReferencias,
  abreviaturaDeCodigoPos,
  normalizarNombreColegio,
} from './referenciaPrenda';

describe('abreviaturaPorDefecto', () => {
  it('con una sola palabra util usa tres letras', () => {
    expect(abreviaturaPorDefecto('Col. Cambridge')).toBe('CAM');
  });

  it('con varias palabras utiles usa las iniciales', () => {
    expect(abreviaturaPorDefecto('C Edad de Oro')).toBe('EO');
    expect(abreviaturaPorDefecto('Internacional SM')).toBe('ISM');
  });

  it('descarta Col, Colegio, C y las preposiciones', () => {
    // Sin descartarlas, "C Edad de Oro" daria CEDO en vez de EO.
    expect(abreviaturaPorDefecto('Colegio Edad de Oro')).toBe('EO');
    expect(abreviaturaPorDefecto('C. Edad De Oro')).toBe('EO');
  });

  it('no revienta con un nombre vacio ni con uno de puras palabras vacias', () => {
    expect(abreviaturaPorDefecto('')).toBe('XX');
    expect(abreviaturaPorDefecto('   ')).toBe('XX');
    expect(abreviaturaPorDefecto('Colegio de la')).toBe('COL');
  });

  it('ignora la puntuacion pero conserva las letras con acento', () => {
    expect(abreviaturaPorDefecto('Á B')).toBe('ÁB');
  });
});

describe('asignarAbreviaturas', () => {
  it('respeta la abreviatura cargada a mano y la deja en mayusculas', () => {
    const m = asignarAbreviaturas([{ id: 'a', nombre: 'Col. Cambridge', abreviatura: 'cc' }]);
    expect(m.get('a')).toBe('CC');
  });

  it('deriva del nombre cuando no hay abreviatura cargada', () => {
    const m = asignarAbreviaturas([
      { id: 'a', nombre: 'Col. Cambridge', abreviatura: null },
      { id: 'b', nombre: 'C Edad de Oro' },
    ]);
    expect(m.get('a')).toBe('CAM');
    expect(m.get('b')).toBe('EO');
  });

  it('trata una abreviatura de solo espacios como ausente', () => {
    const m = asignarAbreviaturas([{ id: 'a', nombre: 'C Edad de Oro', abreviatura: '   ' }]);
    expect(m.get('a')).toBe('EO');
  });

  it('DESEMPATA el choque de dos nombres que abrevian igual', () => {
    // Caso real: "Internacional SM" e "Infantil San Marcos" dan las dos ISM. Sin desempate,
    // `ISM-01` apuntaria a dos prendas distintas y dejaria de identificar.
    const m = asignarAbreviaturas([
      { id: 'a', nombre: 'Internacional SM' },
      { id: 'b', nombre: 'C Infantil San Marcos' },
    ]);
    expect(m.get('a')).toBe('ISM');
    expect(m.get('b')).toBe('ISM2');
    expect(new Set([...m.values()]).size).toBe(2);
  });

  it('desempata tambien dos abreviaturas cargadas iguales', () => {
    // La unicidad no puede depender de que nadie se equivoque al escribir.
    const m = asignarAbreviaturas([
      { id: 'a', nombre: 'Uno', abreviatura: 'CC' },
      { id: 'b', nombre: 'Dos', abreviatura: 'cc' },
    ]);
    expect(m.get('a')).toBe('CC');
    expect(m.get('b')).toBe('CC2');
  });

  it('el que ya estaba NO cambia cuando aparece uno que choca', () => {
    // Si renumerara todo, agregar un colegio le cambiaria la referencia a prendas ajenas.
    const solo = asignarAbreviaturas([{ id: 'a', nombre: 'Internacional SM' }]);
    const conDos = asignarAbreviaturas([
      { id: 'a', nombre: 'Internacional SM' },
      { id: 'b', nombre: 'C Infantil San Marcos' },
    ]);
    expect(conDos.get('a')).toBe(solo.get('a'));
  });

  it('salta filas sin id en vez de reventar', () => {
    const m = asignarAbreviaturas([
      { id: undefined as any, nombre: 'X' },
      { id: 'b', nombre: 'C Edad de Oro' },
    ]);
    expect(m.size).toBe(1);
    expect(m.get('b')).toBe('EO');
  });
});

describe('formarReferencia', () => {
  it('rellena a dos digitos', () => {
    expect(formarReferencia('CC', 1)).toBe('CC-01');
    expect(formarReferencia('CC', 9)).toBe('CC-09');
    expect(formarReferencia('CC', 27)).toBe('CC-27');
  });

  it('NO trunca cuando pasa de 99', () => {
    // `CC-20` para la prenda 120 seria una mentira, y ademas chocaria con la 20.
    expect(formarReferencia('CC', 120)).toBe('CC-120');
  });

  it('devuelve solo la abreviatura si la posicion no sirve', () => {
    expect(formarReferencia('CC', 0)).toBe('CC');
    expect(formarReferencia('CC', NaN)).toBe('CC');
    expect(formarReferencia('CC', -3)).toBe('CC');
  });

  it('normaliza la abreviatura', () => {
    expect(formarReferencia('  cc  ', 1)).toBe('CC-01');
    expect(formarReferencia('', 1)).toBe('XX-01');
  });
});

describe('asignarReferencias', () => {
  const colegios = [
    { id: 'cam', nombre: 'Col. Cambridge', abreviatura: 'CC' },
    { id: 'ism', nombre: 'Internacional SM', abreviatura: 'IntlSM' },
  ];

  it('EL BUG ORIGINAL: la prenda con item_numero 28 queda 01 en su colegio', () => {
    // Es el caso de la captura: `1, 28, 2, 3`. El numero de item era global, y por eso la unica
    // prenda de Internacional SM se veia como 28 entre las de Cambridge.
    const refs = asignarReferencias(colegios, [
      { id: 'p1', colegioId: 'cam', orden: 1, itemNumero: 1 },
      { id: 'p2', colegioId: 'cam', orden: 2, itemNumero: 2 },
      { id: 'p28', colegioId: 'ism', orden: 1, itemNumero: 28 },
    ]);
    expect(refs.get('p28')).toBe('INTLSM-01');
    expect(refs.get('p1')).toBe('CC-01');
    expect(refs.get('p2')).toBe('CC-02');
  });

  it('la posicion se cuenta DENTRO del colegio, no en la lista entera', () => {
    const refs = asignarReferencias(colegios, [
      { id: 'a', colegioId: 'cam', orden: 1 },
      { id: 'b', colegioId: 'ism', orden: 1 },
      { id: 'c', colegioId: 'cam', orden: 2 },
    ]);
    expect(refs.get('a')).toBe('CC-01');
    expect(refs.get('c')).toBe('CC-02');
    expect(refs.get('b')).toBe('INTLSM-01');
  });

  it('numera por POSICION, sin heredar los huecos de orden', () => {
    // Si se borra la prenda con orden 3, queda 1,2,4,5. El valor crudo daria 01,02,04,05.
    const refs = asignarReferencias(colegios, [
      { id: 'a', colegioId: 'cam', orden: 1 },
      { id: 'b', colegioId: 'cam', orden: 2 },
      { id: 'c', colegioId: 'cam', orden: 4 },
      { id: 'd', colegioId: 'cam', orden: 5 },
    ]);
    expect([refs.get('a'), refs.get('b'), refs.get('c'), refs.get('d')])
      .toEqual(['CC-01', 'CC-02', 'CC-03', 'CC-04']);
  });

  it('ordena por orden y NO por el orden en que vienen las filas', () => {
    const refs = asignarReferencias(colegios, [
      { id: 'tercera', colegioId: 'cam', orden: 3 },
      { id: 'primera', colegioId: 'cam', orden: 1 },
      { id: 'segunda', colegioId: 'cam', orden: 2 },
    ]);
    expect(refs.get('primera')).toBe('CC-01');
    expect(refs.get('segunda')).toBe('CC-02');
    expect(refs.get('tercera')).toBe('CC-03');
  });

  it('desempata por itemNumero cuando dos comparten orden', () => {
    const refs = asignarReferencias(colegios, [
      { id: 'mayor', colegioId: 'cam', orden: 1, itemNumero: 9 },
      { id: 'menor', colegioId: 'cam', orden: 1, itemNumero: 4 },
    ]);
    expect(refs.get('menor')).toBe('CC-01');
    expect(refs.get('mayor')).toBe('CC-02');
  });

  it('una prenda SIN orden va al final, no al principio', () => {
    const refs = asignarReferencias(colegios, [
      { id: 'sinOrden', colegioId: 'cam', orden: null },
      { id: 'conOrden', colegioId: 'cam', orden: 5 },
    ]);
    expect(refs.get('conOrden')).toBe('CC-01');
    expect(refs.get('sinOrden')).toBe('CC-02');
  });

  it('una prenda sin colegio recibe referencia de reserva, no queda sin nada', () => {
    const refs = asignarReferencias(colegios, [
      { id: 'huerfana', colegioId: null, orden: 1 },
    ]);
    expect(refs.get('huerfana')).toBe('SN-01');
  });

  it('no revienta con listas vacias ni con nulos', () => {
    expect(asignarReferencias([], []).size).toBe(0);
    expect(asignarReferencias(null as any, null as any).size).toBe(0);
  });
});

describe('abreviaturaDeCodigoPos', () => {
  it('saca el sufijo de los cinco colegios del POS', () => {
    expect(abreviaturaDeCodigoPos('001-cc')).toBe('cc');
    expect(abreviaturaDeCodigoPos('010-EO')).toBe('EO');
    expect(abreviaturaDeCodigoPos('048-JS')).toBe('JS');
    expect(abreviaturaDeCodigoPos('095-InfSM')).toBe('InfSM');
    expect(abreviaturaDeCodigoPos('166-IntlSM')).toBe('IntlSM');
  });

  it('devuelve null cuando NO hay sufijo, que es como vienen las 33 filas de servicios', () => {
    expect(abreviaturaDeCodigoPos('001')).toBeNull();
    expect(abreviaturaDeCodigoPos('004')).toBeNull();
  });

  it('distingue "sin sufijo" de "sufijo raro": el anomalo se devuelve para poder reportarlo', () => {
    // `...-vUuYlnh` existe en el export. Devolverlo permite que el importador lo muestre;
    // devolver null lo haria pasar por un servicio normal y se descartaria en silencio.
    expect(abreviaturaDeCodigoPos('021-vUuYlnh')).toBe('vUuYlnh');
  });

  it('parte por el PRIMER guion, asi un codigo torcido no empareja por accidente', () => {
    expect(abreviaturaDeCodigoPos('001-cc-x')).toBe('cc-x');
  });

  it('un guion al final es "sin sufijo", no un sufijo vacio', () => {
    expect(abreviaturaDeCodigoPos('001-')).toBeNull();
    expect(abreviaturaDeCodigoPos('001-   ')).toBeNull();
  });

  it('no revienta con vacio ni con nulo', () => {
    expect(abreviaturaDeCodigoPos('')).toBeNull();
    expect(abreviaturaDeCodigoPos(null as any)).toBeNull();
  });
});

describe('normalizarNombreColegio', () => {
  it('el espacio al final de "C Saint Jude " no cuenta', () => {
    // Medido en el export: la categoria viene con un espacio al final. Un emparejamiento
    // exacto perderia sus 48 filas.
    expect(normalizarNombreColegio('C Saint Jude ')).toBe(normalizarNombreColegio('C Saint Jude'));
  });

  it('empareja el "C Cambridge" del POS con el "Col. Cambridge" del sistema', () => {
    expect(normalizarNombreColegio('C Cambridge')).toBe(normalizarNombreColegio('Col. Cambridge'));
  });

  it('saca los tres prefijos', () => {
    const esperado = 'edad de oro';
    expect(normalizarNombreColegio('C Edad de Oro')).toBe(esperado);
    expect(normalizarNombreColegio('Col. Edad de Oro')).toBe(esperado);
    expect(normalizarNombreColegio('Colegio Edad de Oro')).toBe(esperado);
  });

  it('ignora los acentos', () => {
    expect(normalizarNombreColegio('Peñaranda')).toBe(normalizarNombreColegio('Penaranda'));
  });

  it('colapsa los espacios de mas', () => {
    expect(normalizarNombreColegio('C  Saint   Jude')).toBe('saint jude');
  });

  it('NO saca un prefijo que es parte de la palabra', () => {
    // "Colinas" empieza con "col" pero no es el prefijo "Col.": sin el \\s+ del patron,
    // quedaria "inas".
    expect(normalizarNombreColegio('Colinas del Sur')).toBe('colinas del sur');
  });

  it('DEJA CONSTANCIA: el nombre NO alcanza para resolver Internacional SM', () => {
    // El POS dice `C Intl. San Marcos` y el sistema `Internacional SM`. Normalizados siguen
    // siendo distintos, y ninguna normalizacion razonable los une sin unir tambien cosas que no
    // van juntas.
    //
    // Por eso el cruce del importador NO usa la categoria para resolver el colegio: resuelve
    // por la abreviatura del codigo, que empareja exacto en los cinco casos, y usa la categoria
    // para detectar DESACUERDOS —si dos filas con la misma categoria resuelven a colegios
    // distintos, eso es un error del POS y hay que mostrarlo—. Ese chequeo no necesita que la
    // categoria coincida con ningun nombre del sistema.
    expect(normalizarNombreColegio('C Intl. San Marcos'))
      .not.toBe(normalizarNombreColegio('Internacional SM'));
  });

  it('no revienta con vacio ni con nulo', () => {
    expect(normalizarNombreColegio('')).toBe('');
    expect(normalizarNombreColegio(null as any)).toBe('');
  });
});
