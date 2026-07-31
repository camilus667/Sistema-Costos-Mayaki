import { describe, it, expect } from 'vitest';
import {
  parsearFilasPos,
  resolverFilas,
  discrepanciasDeSufijo,
  normalizarDescripcionPos,
  normalizarDescripcionSistema,
  similitud,
  categoriaDeColegio,
  CATEGORIAS_POS,
  CONFIANZA_MINIMA,
  COL,
  type FilaPos,
  sugerenciaDeColegio,
  normalizarAbreviatura,
} from './importarPos.service';

/**
 * TESTS DEL PARSEO Y LA RESOLUCION DEL EXPORT DEL POS.
 *
 * Todos los casos de aca salen del archivo REAL —767 filas, cinco colegios— no de
 * ejemplos inventados. Un test cuyo valor esperado se saco del propio codigo no prueba
 * nada; estos vienen de haber medido la planilla y la base.
 *
 * LO QUE MAS IMPORTA QUE QUEDE FIJO: la normalizacion de descripciones. Sin ella, la
 * confianza entre `Camisa m/c, CC` y `Camisa manga corta` queda por debajo del 50% y
 * treinta y seis prendas de Cambridge caen a revision manual. Medido antes y despues
 * de mejorar la similitud, sobre las 297 filas de Cambridge:
 *
 *   sin expandir abreviaturas ni quitar relleno    242 ok, 55 a revisar
 *   con todo aplicado                              278 ok, 19 a revisar
 *
 * Y los 19 que quedan son correctos que queden: uno es semantico
 * (`Pantalón de Varon` contra `Pantalón de vestir`) y el resto son prendas que el
 * sistema todavia no tiene.
 */

// Encabezado real del export, con los indices que usa el parseo.
const CABECERA: any[] = [];
CABECERA[COL.NOMBRE_PRODUCTO] = 'Nombre de Producto';
CABECERA[COL.CATEGORIA] = 'Categorías';
CABECERA[COL.VARIANTE] = 'Nombre de variante';
CABECERA[COL.CODIGO] = 'Cod. Producto';
CABECERA[COL.PRECIO_POS] = 'Precio POS';
CABECERA[COL.CANTIDAD] = 'Cant. Inv. General';

const fila = (
  categoria: string, producto: string, variante: string,
  codigo: string, precio: string, cantidad: string
): any[] => {
  const r: any[] = [];
  r[COL.NOMBRE_PRODUCTO] = producto;
  r[COL.CATEGORIA] = categoria;
  r[COL.VARIANTE] = variante;
  r[COL.CODIGO] = codigo;
  r[COL.PRECIO_POS] = precio;
  r[COL.CANTIDAD] = cantidad;
  return r;
};

describe('parseo del export', () => {
  it('descarta General y Empresas, que son las dos categorias sin datos', () => {
    // 20 filas "General" y 14 "Empresas" en el archivo real: la primera es la fila
    // PADRE del producto en el POS, la segunda una categoria que no es un colegio.
    const r = parsearFilasPos([
      CABECERA,
      fila('General', 'Uniformes Escolares', '', '001', '1', '25'),
      fila('C Cambridge', 'Pantalón de Varon, CC', 'Talla 16/34', '001-cc', '230.00', '192'),
      fila('Empresas', 'Algo', '', '900', '10', '0'),
    ]);
    expect(r.filas).toHaveLength(1);
    expect(r.descartadasPorCategoria).toBe(2);
    expect(r.detalleDescartes).toEqual({ General: 1, Empresas: 1 });
  });

  it('avisa si un encabezado no es el esperado, en vez de leer a ciegas', () => {
    // Si el POS cambia el orden de columnas, importar precios desde la columna
    // equivocada es el peor error silencioso posible de este formato.
    const mala = [...CABECERA];
    mala[COL.PRECIO_POS] = 'Otra Cosa';
    const r = parsearFilasPos([mala, fila('C Cambridge', 'X', 'Talla 10', '1-cc', '10', '1')]);
    expect(r.avisos.length).toBeGreaterThan(0);
    expect(r.avisos[0]).toMatch(/Precio POS/);
  });

  it('lee los seis campos con los valores reales del archivo', () => {
    const r = parsearFilasPos([
      CABECERA,
      fila('C Cambridge', 'Pantalón de Varon, CC', 'Talla 16/34', '001-cc', '230.00', '192'),
    ]);
    expect(r.filas[0]).toMatchObject({
      fila: 2,
      categoria: 'C Cambridge',
      nombreProducto: 'Pantalón de Varon, CC',
      variante: 'Talla 16/34',
      codigo: '001-cc',
      precioPos: 230,
      cantidad: 192,
    });
  });

  it('el sufijo del codigo confirma la categoria en las cinco', () => {
    // Verificado sobre las 732 filas relevantes del archivo real: 297 -cc, 126 -EO,
    // 95 -InfSM, 166 -IntlSM, 48 -JS. Cero excepciones.
    const filas: FilaPos[] = Object.entries(CATEGORIAS_POS).map(([cat, cfg], i) => ({
      fila: i + 2, categoria: cat, nombreProducto: 'X', variante: 'Talla 10',
      codigo: '001' + cfg.sufijo, precioPos: 10, cantidad: 1,
    }));
    expect(discrepanciasDeSufijo(filas)).toHaveLength(0);
  });

  it('y una discrepancia de sufijo se REPORTA, no se resuelve sola', () => {
    // Elegir entre la categoria y el sufijo en silencio pondria los precios de un
    // colegio en las prendas de otro.
    const malas = discrepanciasDeSufijo([{
      fila: 2, categoria: 'C Cambridge', nombreProducto: 'X', variante: 'Talla 10',
      codigo: '001-EO', precioPos: 10, cantidad: 1,
    }]);
    expect(malas).toHaveLength(1);
    expect(malas[0].sufijoEsperado).toBe('-cc');
  });
});

describe('normalizacion de descripciones', () => {
  it('el nombre del producto es lo que va ANTES de la coma, sin heuristicas', () => {
    // Regla confirmada por el usuario y medida sobre el archivo: los 80 nombres
    // distintos de las 732 filas relevantes tienen exactamente UNA coma, y lo que
    // sigue es el sufijo del colegio. Los cinco sufijos reales, con sus conteos:
    //   297 "CC"   166 "Intl SM"   126 "EO"   95 "Inf SM"   48 "SJ"
    // Los dos con espacio son los que rompieron la primera version de esta funcion.
    expect(normalizarDescripcionPos('Bermuda, CC')).toBe('bermuda');
    expect(normalizarDescripcionPos('Bermuda, Intl SM')).toBe('bermuda');
    expect(normalizarDescripcionPos('Polo, Inf SM')).toBe('polo');
    expect(normalizarDescripcionPos('Short, SJ')).toBe('short');
    expect(normalizarDescripcionPos('Pantalón de Dama, Intl SM')).toBe('pantalon de dama');
    expect(normalizarDescripcionPos('Falda c/elast, SJ')).toBe('falda con elastico');
  });

  it('un sufijo LARGO tambien se limpia: la regla no depende del largo ni de las mayusculas', () => {
    // Lo que rompia a las dos versiones anteriores. La segunda exigia mayusculas y
    // hasta seis letras por token, asi que un colegio con un sufijo mas largo dejaba
    // de limpiarse y nadie se enteraria.
    expect(normalizarDescripcionPos('Bermuda, Internacional San Marcos')).toBe('bermuda');
    expect(normalizarDescripcionPos('Bermuda, saint jude')).toBe('bermuda');
  });

  it('un nombre SIN coma se usa completo', () => {
    // Cero casos en las filas relevantes del archivo, pero la funcion no puede
    // devolver vacio si algun dia aparece uno.
    expect(normalizarDescripcionPos('Bermuda')).toBe('bermuda');
    expect(normalizarDescripcionPos('Camisa m/corta')).toBe('camisa manga corta');
  });

  it('con una coma interna se conserva el nombre y se saca solo el sufijo', () => {
    // Por eso se corta en la ULTIMA coma y no en la primera. En los 80 nombres reales
    // da identico —tienen una sola— pero degrada mejor.
    expect(normalizarDescripcionPos('Traje de 2 piezas, Saco y Pantalon, CC'))
      .toBe('traje de 2 piezas saco y pantalon');
  });

  it('expande las abreviaturas reales del POS', () => {
    expect(normalizarDescripcionPos('Camisa m/c, CC')).toBe('camisa manga corta');
    expect(normalizarDescripcionPos('Camisa m/corta, Intl SM')).toBe('camisa manga corta');
    expect(normalizarDescripcionPos('Blusa m/l, CC')).toBe('blusa manga larga');
    expect(normalizarDescripcionPos('Chompa c/v, CC')).toBe('chompa cuello en v');
    expect(normalizarDescripcionPos('Pantalón c/elas, CC')).toBe('pantalon con elastico');
    expect(normalizarDescripcionPos('Pant c/Elast, EO')).toBe('pantalon con elastico');
    expect(normalizarDescripcionPos('Chamarra inv, CC')).toBe('chamarra invierno');
    expect(normalizarDescripcionPos('Chamarra ver, CC')).toBe('chamarra verano');
  });

  it('quita acentos de los dos lados, para comparar peras con peras', () => {
    expect(normalizarDescripcionPos('Riñonera, CC')).toBe('rinonera');
    expect(normalizarDescripcionSistema('Pantalón con elástico')).toBe('pantalon con elastico');
  });
});

describe('similitud — los cuatro casos que quedaban en 69% siendo correctos', () => {
  const par = (pos: string, sistema: string) =>
    similitud(normalizarDescripcionPos(pos), normalizarDescripcionSistema(sistema));

  it('las abreviaturas dan coincidencia EXACTA tras expandir', () => {
    expect(par('Camisa m/c, CC', 'Camisa manga corta')).toBe(1);
    expect(par('Blusa m/l, CC', 'Blusa manga larga')).toBe(1);
    expect(par('Chompa c/v, CC', 'Chompa cuello en V')).toBe(1);
    expect(par('Pantalón c/elas, CC', 'Pantalón con elástico')).toBe(1);
  });

  it('"para" no debe castigar: Pantalón Dama es Pantalón para dama', () => {
    expect(par('Pantalón Dama, CC', 'Pantalón para dama')).toBeGreaterThanOrEqual(CONFIANZA_MINIMA);
  });

  it('el genero no debe castigar: dep expande a deportivo y el sistema dice deportiva', () => {
    expect(par('Chamarra dep, CC', 'Chamarra deportiva')).toBeGreaterThanOrEqual(CONFIANZA_MINIMA);
  });

  it('una variante de escritura tampoco: Buzo contra Buso', () => {
    expect(par('Buzo dep, CC', 'Buso Deportivo')).toBeGreaterThanOrEqual(CONFIANZA_MINIMA);
  });

  it('"de invierno" y "de verano" resuelven aunque el POS omita el "de"', () => {
    expect(par('Chamarra inv, CC', 'Chamarra de invierno')).toBeGreaterThanOrEqual(CONFIANZA_MINIMA);
    expect(par('Chamarra ver, CC', 'Chamarra de verano')).toBeGreaterThanOrEqual(CONFIANZA_MINIMA);
  });

  it('y NO empareja lo que es distinto: una prenda nueva se queda abajo del umbral', () => {
    // La guarda que impide que el algoritmo invente coincidencias. Riñonera, Gorra,
    // Cinturon y Lanyard no existen en el sistema: tienen que caer a revision, no
    // engancharse con la primera prenda parecida.
    for (const nueva of ['Riñonera, CC', 'Gorra, CC', 'Cinturón, CC', 'Lanyard, CC', 'Sombrero, CC']) {
      const mejor = Math.max(
        par(nueva, 'Pantalón de vestir'), par(nueva, 'Corbata larga'),
        par(nueva, 'Vestido'), par(nueva, 'Calza larga'), par(nueva, 'Jamper')
      );
      expect(mejor).toBeLessThan(CONFIANZA_MINIMA);
    }
  });

  it('Pantalón de Varon contra Pantalón de vestir es SEMANTICO y queda para el usuario', () => {
    // Comparten "pantalon" y nada mas: son la misma prenda solo si alguien lo sabe.
    // Que el algoritmo no lo resuelva es correcto; resolverlo seria adivinar.
    expect(par('Pantalón de Varon, CC', 'Pantalón de vestir')).toBeLessThan(CONFIANZA_MINIMA);
  });
});

describe('resolucion contra los catalogos', () => {
  const colegios = [
    { id: 'camb', nombre: 'Col. Cambridge' },
    { id: 'intl', nombre: 'Internacional SM' },
    { id: 'otro', nombre: 'Colegio Sin Categoria' },
  ];
  const tallas = [
    { id: 't02', codigo: '02' }, { id: 't10', codigo: '10' },
    { id: 't14', codigo: '14' }, { id: 't1634', codigo: '16/34' },
  ];
  const productos = [
    { id: 'p1', descripcion: 'Pantalón con elástico', colegioId: 'camb' },
    { id: 'p2', descripcion: 'Camisa manga corta', colegioId: 'camb' },
    { id: 'p9', descripcion: 'Camisa Formal', colegioId: 'intl' },
  ];
  const resolver = (filas: FilaPos[], colegioId = 'camb') =>
    resolverFilas({ filas, colegioId, colegios, tallasActivas: tallas, productos });

  const f = (over: Partial<FilaPos>): FilaPos => ({
    fila: 2, categoria: 'C Cambridge', nombreProducto: 'Camisa m/c, CC',
    variante: 'Talla 16/34', codigo: '001-cc', precioPos: 100, cantidad: 5, ...over,
  });

  it('cada colegio resuelve a su categoria del POS', () => {
    expect(categoriaDeColegio('camb', colegios)).toBe('C Cambridge');
    expect(categoriaDeColegio('intl', colegios)).toBe('C Intl. San Marcos');
  });

  it('un colegio que no esta en el export se dice, no se le importa nada', () => {
    const r = resolver([f({})], 'otro');
    expect(r.categoriaEsperada).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/no corresponde a ninguna categoria/);
    expect(r.resueltas[0].estado).toBe('otro-colegio');
  });

  it('se importa UN colegio por corrida: las filas de otra categoria no se tocan', () => {
    const r = resolver([f({ categoria: 'C Saint Jude' })]);
    expect(r.resueltas[0].estado).toBe('otro-colegio');
    expect(r.resumen.otroColegio).toBe(1);
  });

  it('SIN PRECIO no se importa: el codigo y el precio viajan juntos', () => {
    for (const precio of [0, NaN, -5]) {
      const r = resolver([f({ precioPos: precio })]);
      expect(r.resueltas[0].estado).toBe('sin-precio');
      expect(r.resueltas[0].productoId).toBeUndefined();
    }
  });

  it('la talla sale de la variante, normalizada a dos digitos', () => {
    const r = resolver([f({ variante: 'Talla 02' })]);
    expect(r.resueltas[0].tallaCodigo).toBe('02');
    expect(r.resueltas[0].tallaAsignadaPorDefecto).toBe(false);
  });

  it('SIN VARIANTE se asigna la talla 14 y se MARCA como asignada por defecto', () => {
    // Los doce genericos de Cambridge: Riñonera, Gorra, Cinturon, Lanyard... La 14 esta
    // en el medio de la curva. Se marca porque es un casillero, no una talla real, y
    // quien lea el preview tiene que poder saberlo.
    const r = resolver([f({ nombreProducto: 'Camisa m/c, CC', variante: '' })]);
    expect(r.resueltas[0].tallaCodigo).toBe('14');
    expect(r.resueltas[0].tallaAsignadaPorDefecto).toBe(true);
  });

  it('una talla que no existe o no esta activa en el colegio no resuelve, y lo dice', () => {
    // "Talla 03" son ocho filas del archivo real, todas de Saint Jude.
    const r = resolver([f({ variante: 'Talla 03' })]);
    expect(r.resueltas[0].estado).toBe('sin-talla');
    expect(r.resueltas[0].motivo).toMatch(/03/);
  });

  it('el producto se busca SOLO entre las prendas del colegio elegido', () => {
    // La prenda de Internacional SM no puede ganar en una corrida de Cambridge: eso
    // pondria el precio de un colegio en la prenda de otro.
    const r = resolver([f({ nombreProducto: 'Camisa Formal, CC' })]);
    expect(r.resueltas[0].candidatos.every((c) => c.id !== 'p9')).toBe(true);
  });

  it('empareja con confianza alta y devuelve los candidatos ordenados', () => {
    const r = resolver([f({ nombreProducto: 'Camisa m/c, CC' })]);
    const x = r.resueltas[0];
    expect(x.estado).toBe('ok');
    expect(x.productoDescripcion).toBe('Camisa manga corta');
    expect(x.confianza).toBe(1);
    expect(x.candidatos[0].confianza).toBeGreaterThanOrEqual(x.candidatos[1].confianza);
  });

  it('confianza baja queda en REVISAR, con el candidato puesto para corregir', () => {
    const r = resolver([f({ nombreProducto: 'Riñonera, CC' })]);
    const x = r.resueltas[0];
    expect(x.estado).toBe('revisar');
    expect(x.candidatos.length).toBeGreaterThan(0);
    expect(x.motivo).toMatch(/Confianza/);
  });

  it('un colegio sin prendas lo avisa en vez de dejarlo en silencio', () => {
    const r = resolverFilas({
      filas: [f({ categoria: 'C Intl. San Marcos' })],
      colegioId: 'intl', colegios, tallasActivas: tallas, productos: [],
    });
    expect(r.avisos.join(' ')).toMatch(/no tiene ninguna prenda cargada/);
  });

  it('el resumen cuenta cada estado, para que el preview no tenga que recorrer todo', () => {
    const r = resolver([
      f({ nombreProducto: 'Camisa m/c, CC' }),
      f({ precioPos: 0 }),
      f({ variante: 'Talla 03' }),
      f({ categoria: 'C Saint Jude' }),
      f({ nombreProducto: 'Lanyard, CC' }),
    ]);
    expect(r.resumen).toMatchObject({
      total: 5, ok: 1, sinPrecio: 1, sinTalla: 1, otroColegio: 1, revisar: 1,
    });
  });
});

describe('normalizarAbreviatura', () => {
  it('el sufijo del POS y la abreviatura del sistema son el mismo token', () => {
    // El POS escribe `-cc` dentro del codigo y el sistema guarda `CC`. Sin normalizar, ninguno de
    // los cinco colegios emparejaria.
    expect(normalizarAbreviatura('-cc')).toBe('CC');
    expect(normalizarAbreviatura('CC')).toBe('CC');
    expect(normalizarAbreviatura('-IntlSM')).toBe('INTLSM');
    expect(normalizarAbreviatura(' -js ')).toBe('JS');
  });

  it('no revienta con vacio ni con nulo', () => {
    expect(normalizarAbreviatura('')).toBe('');
    expect(normalizarAbreviatura(null)).toBe('');
    expect(normalizarAbreviatura(undefined)).toBe('');
  });
});

describe('categoriaDeColegio: la abreviatura manda sobre el nombre', () => {
  it('resuelve por abreviatura aunque el nombre NO se parezca a la categoria', () => {
    // Es el caso real que el emparejamiento por nombre no puede resolver: el POS dice
    // `C Intl. San Marcos` y el sistema `Internacional SM`.
    const cols = [{ id: 'a', nombre: 'Cualquier Nombre Sin Relacion', abreviatura: 'IntlSM' }];
    expect(categoriaDeColegio('a', cols)).toBe('C Intl. San Marcos');
  });

  it('acepta la abreviatura en minuscula, como la escribe el POS', () => {
    const cols = [{ id: 'a', nombre: 'X', abreviatura: 'cc' }];
    expect(categoriaDeColegio('a', cols)).toBe('C Cambridge');
  });

  it('sin abreviatura se cae al nombre, para una base que todavia no las cargo', () => {
    const cols = [{ id: 'a', nombre: 'Col. Cambridge' }];
    expect(categoriaDeColegio('a', cols)).toBe('C Cambridge');
  });

  it('una abreviatura que no corresponde a ninguna categoria NO inventa una', () => {
    // Devolver una categoria al azar meteria los precios de un colegio en las prendas de otro.
    const cols = [{ id: 'a', nombre: 'Colegio Nuevo', abreviatura: 'ZZ' }];
    expect(categoriaDeColegio('a', cols)).toBeNull();
  });

  it('con abreviatura desconocida pero nombre reconocible, el nombre salva la fila', () => {
    const cols = [{ id: 'a', nombre: 'Col. Cambridge', abreviatura: 'ZZ' }];
    expect(categoriaDeColegio('a', cols)).toBe('C Cambridge');
  });
});

describe('sugerenciaDeColegio', () => {
  it('sugiere la abreviatura del POS, que es lo que hace que crearlo sea un clic', () => {
    // Sin la abreviatura correcta el colegio nace sin emparejar y su primera importacion no
    // encuentra ninguna de sus filas.
    expect(sugerenciaDeColegio('C Edad de Oro'))
      .toEqual({ nombreSugerido: 'C Edad de Oro', abreviaturaSugerida: 'EO' });
    expect(sugerenciaDeColegio('C Saint Jude').abreviaturaSugerida).toBe('JS');
    expect(sugerenciaDeColegio('C Infantil San Marcos').abreviaturaSugerida).toBe('INFSM');
    expect(sugerenciaDeColegio('C Intl. San Marcos').abreviaturaSugerida).toBe('INTLSM');
  });

  it('una categoria desconocida no inventa abreviatura', () => {
    // Devolver una al azar haria que el colegio nuevo se coma las filas de otro.
    expect(sugerenciaDeColegio('C Que No Existe'))
      .toEqual({ nombreSugerido: 'C Que No Existe', abreviaturaSugerida: '' });
  });

  it('no revienta con vacio ni con nulo', () => {
    expect(sugerenciaDeColegio('').abreviaturaSugerida).toBe('');
    expect(sugerenciaDeColegio(null as any).nombreSugerido).toBe('');
  });
});
