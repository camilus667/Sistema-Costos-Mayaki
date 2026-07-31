import { describe, it, expect } from 'vitest';
import {
  codigoTallaCanonico,
  bandaManoObra,
  esDeBanda,
  BANDAS_MANO_OBRA,
  TALLA_PRODUCTOS_SIN_VARIANTE,
  buscarTallaPorCodigo,
} from './tallas';

/**
 * TESTS DE LOS CODIGOS DE TALLA.
 *
 * Fijan la forma canonica de dos digitos y, sobre todo, fijan el defecto que el
 * renombre habria producido: las tres listas de codigos escritas a mano que agrupaban
 * la mano de obra en bandas. Con `2` renombrado a `02`, esas listas dejaban de
 * reconocer las tallas chicas y la mano de obra de las tallas MAS CHICAS se guardaba
 * con el costo de las MAS GRANDES.
 *
 * MEDIDO contra la base real antes de escribir estos tests. Sobre el Pantalon de
 * vestir, cargando 11 / 22 / 33 en las tres bandas:
 *
 *              con el modulo    con las listas a mano
 *   talla 02        11                   33
 *   talla 04        11                   33
 *   talla 06        11                   33
 *   talla 08        11                   33
 *   talla 10        11                   11   <- sobrevive: ya tenia dos digitos
 *
 * Cuatro de dieciseis tallas por prenda, por veintiocho prendas: 112 filas de mano de
 * obra con el costo equivocado, sin error y con status 200. La mano de obra es uno de
 * los tres componentes del costo unitario.
 */

describe('forma canonica del codigo de talla', () => {
  it('rellena los numericos de una cifra a dos digitos', () => {
    expect(codigoTallaCanonico('2')).toBe('02');
    expect(codigoTallaCanonico('4')).toBe('04');
    expect(codigoTallaCanonico('6')).toBe('06');
    expect(codigoTallaCanonico('8')).toBe('08');
  });

  it('no toca los que ya tienen dos digitos', () => {
    for (const c of ['10', '12', '14']) expect(codigoTallaCanonico(c)).toBe(c);
  });

  it('no toca los compuestos: rellenarlos los corromperia', () => {
    for (const c of ['16/34', '36/XS', '38/S', '40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL']) {
      expect(codigoTallaCanonico(c)).toBe(c);
    }
  });

  it('es IDEMPOTENTE, para que la migracion se pueda correr dos veces sin daño', () => {
    for (const c of ['2', '02', '10', '16/34']) {
      expect(codigoTallaCanonico(codigoTallaCanonico(c))).toBe(codigoTallaCanonico(c));
    }
  });

  it('tolera nulos, vacios y espacios sin explotar', () => {
    expect(codigoTallaCanonico(null)).toBe('');
    expect(codigoTallaCanonico(undefined)).toBe('');
    expect(codigoTallaCanonico('  ')).toBe('');
    expect(codigoTallaCanonico(' 4 ')).toBe('04');
    expect(codigoTallaCanonico(4)).toBe('04');
  });

  it('los 16 codigos reales quedan todos distintos: el renombre no colisiona', () => {
    const reales = ['2', '4', '6', '8', '10', '12', '14', '16/34', '36/XS', '38/S',
                    '40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL'];
    const canonicos = reales.map(codigoTallaCanonico);
    expect(new Set(canonicos).size).toBe(reales.length);
  });
});

describe('bandas de mano de obra — el defecto que el renombre habria causado', () => {
  it('reconoce la banda 1 con el codigo VIEJO y con el NUEVO', () => {
    // Es la propiedad central: la agrupacion no puede depender de como se escriba
    // el codigo. Con las listas a mano, la columna izquierda fallaba.
    for (const viejo of ['2', '4', '6', '8']) expect(bandaManoObra(viejo)).toBe(1);
    for (const nuevo of ['02', '04', '06', '08']) expect(bandaManoObra(nuevo)).toBe(1);
  });

  it('la talla 10 cae en la banda 1 en las dos formas', () => {
    // Sobrevivia al defecto porque ya tenia dos digitos, y por eso el defecto era
    // parcial y mas difícil de ver: cuatro tallas mal y una bien.
    expect(bandaManoObra('10')).toBe(1);
  });

  it('la banda 2 son las medianas', () => {
    for (const c of ['12', '14', '16/34', '36/XS', '38/S']) expect(bandaManoObra(c)).toBe(2);
  });

  it('la banda 3 son las grandes', () => {
    for (const c of ['40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL']) {
      expect(bandaManoObra(c)).toBe(3);
    }
  });

  it('lo desconocido cae en la banda 3, igual que el else original', () => {
    // Se preserva a proposito: cambiarlo moveria costos, y eso no es parte de este
    // trabajo.
    expect(bandaManoObra('99')).toBe(3);
    expect(bandaManoObra('')).toBe(3);
  });

  it('NINGUNA talla real cae en la banda 3 por accidente', () => {
    // La guarda que discrimina. Si la normalizacion se rompiera, las tallas chicas
    // caerian al `else` y este test lo diría — es exactamente el sintoma medido.
    const chicas = ['02', '04', '06', '08', '10'];
    for (const c of chicas) expect(bandaManoObra(c)).not.toBe(3);
  });

  it('las tres bandas cubren las 16 tallas y no se solapan', () => {
    const todas = ['02', '04', '06', '08', '10', '12', '14', '16/34', '36/XS', '38/S',
                   '40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL'];
    const plano = BANDAS_MANO_OBRA.flat();
    expect(new Set(plano).size).toBe(plano.length);
    expect([...plano].sort()).toEqual([...todas].sort());
  });

  it('esDeBanda coincide con bandaManoObra', () => {
    for (const c of ['02', '12', '40/M']) {
      expect(esDeBanda(c, bandaManoObra(c))).toBe(true);
    }
    expect(esDeBanda('02', 3)).toBe(false);
  });
});

describe('talla de los productos sin variante', () => {
  it('es la 14, que esta en el medio de la curva', () => {
    // Decidido con el usuario: la 14 evita que el costo prorrateado de un cinturon
    // salga del extremo barato o del caro de la curva.
    expect(TALLA_PRODUCTOS_SIN_VARIANTE).toBe('14');
    expect(codigoTallaCanonico(TALLA_PRODUCTOS_SIN_VARIANTE)).toBe('14');
  });

  it('cae en la banda 2, la del medio', () => {
    expect(bandaManoObra(TALLA_PRODUCTOS_SIN_VARIANTE)).toBe(2);
  });
});

describe('buscarTallaPorCodigo', () => {
  // La base guarda `2`, `4`, `6`; la pantalla y el POS escriben `02`, `04`, `06`. Esta funcion es
  // la que evita que el guardado de precios falle por esa diferencia de formato.
  const enBase = [
    { id: 't2', codigo: '2' }, { id: 't4', codigo: '4' }, { id: 't10', codigo: '10' },
    { id: 't16', codigo: '16/34' }, { id: 'txs', codigo: '36/XS' },
  ];

  it('encuentra `2` de la base cuando la pantalla manda `02`', () => {
    // Con el `WHERE codigo = ?` exacto que habia antes, esto devolvia null y el error decia
    // "No existe la talla 02" para una talla que si existe.
    expect(buscarTallaPorCodigo(enBase, '02')?.id).toBe('t2');
  });

  it('y tambien al revés: la base con `02` y la pantalla mandando `2`', () => {
    // Es el caso despues de aplicar el renombre a dos digitos. Funciona en los dos sentidos, asi
    // que el emparejamiento deja de depender de cuando se corra esa migracion.
    expect(buscarTallaPorCodigo([{ id: 'x', codigo: '02' }], '2')?.id).toBe('x');
  });

  it('los codigos que no son puro numero se comparan tal cual', () => {
    expect(buscarTallaPorCodigo(enBase, '16/34')?.id).toBe('t16');
    expect(buscarTallaPorCodigo(enBase, '36/XS')?.id).toBe('txs');
  });

  it('ignora los espacios de sobra', () => {
    expect(buscarTallaPorCodigo(enBase, '  02  ')?.id).toBe('t2');
  });

  it('un codigo que no existe devuelve null, no la primera talla', () => {
    // Devolver una talla cualquiera guardaria el precio en la talla equivocada, que es peor que
    // no guardarlo.
    expect(buscarTallaPorCodigo(enBase, '03')).toBeNull();
    expect(buscarTallaPorCodigo(enBase, '99')).toBeNull();
  });

  it('NO confunde 10 con 1: rellenar no es truncar', () => {
    expect(buscarTallaPorCodigo(enBase, '10')?.id).toBe('t10');
    expect(buscarTallaPorCodigo(enBase, '1')).toBeNull();
  });

  it('no revienta con vacio, nulo ni lista vacia', () => {
    expect(buscarTallaPorCodigo(enBase, '')).toBeNull();
    expect(buscarTallaPorCodigo(enBase, null)).toBeNull();
    expect(buscarTallaPorCodigo([], '02')).toBeNull();
    expect(buscarTallaPorCodigo(null as any, '02')).toBeNull();
  });
});
