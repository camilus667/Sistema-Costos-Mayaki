/**
 * Lo que se fija aca es UNA decision, no la consulta: que una fila sin codigo NO entre al mapa.
 *
 * Importa porque las tres pantallas que lo consumen hacen `?? null` y muestran un guion. Si una
 * cadena vacia entrara al mapa, `get` devolveria `''`, el `??` no lo atraparia —solo atrapa null y
 * undefined— y las tres pantallas mostrarian una celda en blanco. Una celda en blanco no dice si
 * esa combinacion no tiene codigo o si la pantalla se olvido de traerlo.
 */

import { describe, it, expect } from 'vitest';
import {
  claveCodigoPos,
  codigosPosDesdeBase,
  normalizarCodigoPos,
  buscarDuenoDeCodigo,
} from './codigoPos';

/** Base de mentira con la forma minima que usa el servicio: `select(...).from(...)`. */
function baseCon(filas: any[]) {
  return { select: () => ({ from: async () => filas }) };
}

describe('claveCodigoPos', () => {
  it('arma la clave con los dos ids en el mismo orden siempre', () => {
    expect(claveCodigoPos('prod1', 'talla9')).toBe('prod1_talla9');
  });

  it('no explota con ids faltantes', () => {
    // Devolver una clave rara es mejor que tirar: la busqueda simplemente no encuentra nada.
    expect(claveCodigoPos(null, undefined)).toBe('_');
  });

  it('distingue prenda de talla: no se pueden confundir los lados', () => {
    expect(claveCodigoPos('a', 'b')).not.toBe(claveCodigoPos('b', 'a'));
  });
});

describe('codigosPosDesdeBase', () => {
  it('indexa por prenda mas talla, no por prenda', async () => {
    // MEDIDO en el export del POS: `Pantalón de Varon, CC` tiene ocho codigos, uno por talla, y 70
    // de 102 productos tienen mas de uno. Un mapa por prenda perderia siete de cada ocho.
    const mapa = await codigosPosDesdeBase(baseCon([
      { productoId: 'p1', tallaId: 't1', codigoExterno: '001-cc' },
      { productoId: 'p1', tallaId: 't2', codigoExterno: '002-cc' },
      { productoId: 'p1', tallaId: 't3', codigoExterno: '003-cc' },
    ]));
    expect(mapa.size).toBe(3);
    expect(mapa.get(claveCodigoPos('p1', 't2'))).toBe('002-cc');
  });

  it('las filas SIN codigo no entran al mapa', async () => {
    const mapa = await codigosPosDesdeBase(baseCon([
      { productoId: 'p1', tallaId: 't1', codigoExterno: null },
      { productoId: 'p1', tallaId: 't2', codigoExterno: '' },
      { productoId: 'p1', tallaId: 't3', codigoExterno: '   ' },
      { productoId: 'p1', tallaId: 't4', codigoExterno: '004-cc' },
    ]));
    expect(mapa.size).toBe(1);
    // `undefined` y no `''`: es lo que hace que el `?? null` de las pantallas funcione.
    expect(mapa.get(claveCodigoPos('p1', 't1'))).toBeUndefined();
    expect(mapa.get(claveCodigoPos('p1', 't2'))).toBeUndefined();
    expect(mapa.get(claveCodigoPos('p1', 't3'))).toBeUndefined();
    expect(mapa.get(claveCodigoPos('p1', 't4'))).toBe('004-cc');
  });

  it('recorta los bordes del codigo', async () => {
    // La categoria `C Saint Jude ` del POS viene con un espacio al final; los codigos tambien
    // pueden traerlo. Un espacio invisible rompe un BUSCARV y no se ve en pantalla.
    const mapa = await codigosPosDesdeBase(baseCon([
      { productoId: 'p1', tallaId: 't1', codigoExterno: ' 619-JS ' },
    ]));
    expect(mapa.get(claveCodigoPos('p1', 't1'))).toBe('619-JS');
  });

  it('un codigo numerico se conserva como texto', async () => {
    // Si llegara como numero, `String()` lo pasa a texto y el Excel no le come los ceros.
    const mapa = await codigosPosDesdeBase(baseCon([
      { productoId: 'p1', tallaId: 't1', codigoExterno: 7 },
    ]));
    expect(mapa.get(claveCodigoPos('p1', 't1'))).toBe('7');
  });

  it('sin filas devuelve un mapa vacio, no revienta', async () => {
    const mapa = await codigosPosDesdeBase(baseCon([]));
    expect(mapa.size).toBe(0);
  });
});

describe('normalizarCodigoPos', () => {
  it('recorta los espacios', () => {
    expect(normalizarCodigoPos('  619-JS  ')).toBe('619-JS');
  });

  it('NO cambia la caja', () => {
    // MEDIDO en el export del POS: conviven `001-cc` en minuscula y `619-JS` en mayuscula. Si el
    // sistema forzara una caja, el codigo guardado dejaria de ser identico al del POS y el BUSCARV
    // contra el export no encontraria nada. Este test existe para que a nadie le parezca "prolijo"
    // agregar un toUpperCase.
    expect(normalizarCodigoPos('001-cc')).toBe('001-cc');
    expect(normalizarCodigoPos('619-JS')).toBe('619-JS');
    expect(normalizarCodigoPos('  001-CC ')).toBe('001-CC');
  });

  it('vacio significa BORRAR, no cadena vacia', () => {
    // Una fila con codigo `''` no es lo mismo que sin codigo: el indice unico parcial solo excluye
    // los NULL, asi que dos filas vacias chocarian entre si. Y las pantallas leen con `?? null`,
    // que no atrapa la cadena vacia y dejaria un hueco sin explicacion.
    expect(normalizarCodigoPos('')).toBeNull();
    expect(normalizarCodigoPos('   ')).toBeNull();
    expect(normalizarCodigoPos(null)).toBeNull();
    expect(normalizarCodigoPos(undefined)).toBeNull();
  });

  it('un codigo de un solo caracter es valido', () => {
    // No se inventa un largo minimo: el POS decide como son sus codigos, no este sistema.
    expect(normalizarCodigoPos('7')).toBe('7');
  });
});

describe('buscarDuenoDeCodigo', () => {
  const filas = [
    { productoId: 'p1', tallaId: 't1', precioId: 'pv1', codigo: '001-cc' },
    { productoId: 'p1', tallaId: 't2', precioId: 'pv2', codigo: '002-cc' },
    { productoId: 'p9', tallaId: 't1', precioId: 'pv9', codigo: '619-JS' },
  ];

  it('encuentra a quien ya tiene el codigo', () => {
    const d = buscarDuenoDeCodigo('619-JS', filas, { productoId: 'p1', tallaId: 't1' });
    expect(d).toEqual({ productoId: 'p9', tallaId: 't1', precioId: 'pv9' });
  });

  it('devuelve null cuando el codigo esta libre', () => {
    expect(buscarDuenoDeCodigo('777-xx', filas, { productoId: 'p1', tallaId: 't1' })).toBeNull();
  });

  it('la MISMA fila no es un choque', () => {
    // Reescribir un codigo con el valor que ya tenia es lo mas comun al corregir a mano: se abre la
    // celda, se mira, se guarda. Si eso diera 409, la pantalla acusaria un duplicado contra si misma.
    expect(buscarDuenoDeCodigo('001-cc', filas, { productoId: 'p1', tallaId: 't1' })).toBeNull();
  });

  it('la misma prenda en OTRA talla SI es un choque', () => {
    // Es el caso realista: ocho tallas de la misma prenda, y se pega el codigo en la fila de al lado.
    const d = buscarDuenoDeCodigo('002-cc', filas, { productoId: 'p1', tallaId: 't1' });
    expect(d).toEqual({ productoId: 'p1', tallaId: 't2', precioId: 'pv2' });
  });

  it('sin exclusion, cualquier coincidencia cuenta', () => {
    expect(buscarDuenoDeCodigo('001-cc', filas)).toEqual(
      { productoId: 'p1', tallaId: 't1', precioId: 'pv1' },
    );
  });

  it('compara el codigo EXACTO, sin normalizar de nuevo', () => {
    // La normalizacion es un paso previo y explicito. Si esta funcion tambien recortara o cambiara
    // la caja, habria dos reglas de comparacion y se desincronizarian.
    expect(buscarDuenoDeCodigo('001-CC', filas)).toBeNull();
    expect(buscarDuenoDeCodigo(' 001-cc', filas)).toBeNull();
  });
});
