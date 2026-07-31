import { describe, it, expect } from 'vitest';
import {
  posicionesDeColegios,
  compararPrendas,
  ordenarPrendas,
  paginar,
  leerPaginacion,
  esCriterioValido,
  TAMANOS_PAGINA,
  TAMANO_PAGINA_DEFECTO,
  type PrendaOrdenable,
} from './ordenPrendas';

/**
 * TESTS DEL ORDEN Y DE LA PAGINACION.
 *
 * Los casos salen de la base real, no de ejemplos inventados. El defecto que reporto el
 * usuario, medido antes de tocar nada:
 *
 *   Col. Cambridge     creado 2026-07-27 20:02:01     items 1..27, orden 1..27
 *   Internacional SM   creado 2026-07-29 11:43:01     item 28, orden 1
 *
 *   /api/calculo/matriz-consolidada  ->  1, 28, 2, 3, 4, ...
 *
 * Los dos `orden = 1` empataban y el desempate por item ponia 1 antes que 28.
 */

// Los dos colegios reales, con sus fechas reales.
const CAMBRIDGE = { id: 'c-cam', nombre: 'Col. Cambridge', creadoEn: '2026-07-27 20:02:01' };
const INTL = { id: 'c-intl', nombre: 'Internacional SM', creadoEn: '2026-07-29 11:43:01' };

const p = (o: Partial<PrendaOrdenable> & { colegioId: string; itemNumero: number }): PrendaOrdenable => ({
  orden: o.orden ?? o.itemNumero,
  descripcion: o.descripcion ?? 'X',
  precio: o.precio,
  ...o,
});

describe('posicion de los colegios', () => {
  it('sin orden explicito manda la FECHA DE CREACION', () => {
    // Es lo que pidio el usuario: "que se organice por el orden en que se agregaron los
    // colegios". Y significa que la columna orden puede nacer vacia sin cambiar nada.
    const pos = posicionesDeColegios([INTL, CAMBRIDGE]);
    expect(pos.get('c-cam')).toBe(0);
    expect(pos.get('c-intl')).toBe(1);
  });

  it('con orden explicito manda el orden, no la fecha', () => {
    // Es lo que va a escribir el arrastrar y soltar.
    const pos = posicionesDeColegios([
      { ...CAMBRIDGE, orden: 2 },
      { ...INTL, orden: 1 },
    ]);
    expect(pos.get('c-intl')).toBe(0);
    expect(pos.get('c-cam')).toBe(1);
  });

  it('un colegio sin orden va despues de los que si lo tienen', () => {
    const pos = posicionesDeColegios([CAMBRIDGE, { ...INTL, orden: 1 }]);
    expect(pos.get('c-intl')).toBe(0);
    expect(pos.get('c-cam')).toBe(1);
  });

  it('el orden es ESTABLE con fechas iguales', () => {
    // Sin el desempate por nombre, dos colegios creados en el mismo segundo podrian
    // intercambiarse entre dos cargas de la pantalla, y eso hace dudar de si algo se guardo.
    const a = { id: 'x', nombre: 'Zeta', creadoEn: '2026-01-01 00:00:00' };
    const b = { id: 'y', nombre: 'Alfa', creadoEn: '2026-01-01 00:00:00' };
    expect(posicionesDeColegios([a, b]).get('y')).toBe(0);
    expect(posicionesDeColegios([b, a]).get('y')).toBe(0);
  });
});

describe('el defecto que reporto el usuario', () => {
  it('el item 28 de otro colegio ya NO se mete entre el 1 y el 2', () => {
    // EL CASO EXACTO de la captura. Los dos tienen orden = 1 y antes empataban.
    const pos = posicionesDeColegios([CAMBRIDGE, INTL]);
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, orden: 1, descripcion: 'Pantalón de vestir' }),
      p({ colegioId: INTL.id, itemNumero: 28, orden: 1, descripcion: 'Camisa Formal' }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, orden: 2, descripcion: 'Camisa manga corta' }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 3, orden: 3, descripcion: 'Camisa manga larga' }),
    ];
    const r = ordenarPrendas(filas, 'defecto', pos).map((x) => x.itemNumero);
    expect(r).toEqual([1, 2, 3, 28]);
  });

  it('las prendas de un colegio quedan TODAS juntas', () => {
    const pos = posicionesDeColegios([CAMBRIDGE, INTL]);
    const filas = [
      p({ colegioId: INTL.id, itemNumero: 5, orden: 2 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, orden: 1 }),
      p({ colegioId: INTL.id, itemNumero: 9, orden: 1 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, orden: 2 }),
    ];
    const r = ordenarPrendas(filas, 'defecto', pos).map((x) => x.colegioId);
    // Sin intercalar: los dos de Cambridge, despues los dos de Internacional.
    expect(r).toEqual([CAMBRIDGE.id, CAMBRIDGE.id, INTL.id, INTL.id]);
  });

  it('respeta el orden de Prendas y Recetas dentro de cada colegio', () => {
    const pos = posicionesDeColegios([CAMBRIDGE]);
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 3, orden: 1 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, orden: 2 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, orden: 3 }),
    ];
    // Manda `orden`, no `itemNumero`: es lo que el usuario configura en esa pantalla.
    expect(ordenarPrendas(filas, 'defecto', pos).map((x) => x.itemNumero)).toEqual([3, 1, 2]);
  });

  it('una prenda sin orden cae en su itemNumero y no se va al principio', () => {
    // La columna admite NULL y tiene default 0: sin este respaldo, una prenda creada por un
    // camino que no setee orden quedaria primera en su colegio sin ninguna razon.
    const pos = posicionesDeColegios([CAMBRIDGE]);
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 5, orden: null }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, orden: 1 }),
    ];
    expect(ordenarPrendas(filas, 'defecto', pos).map((x) => x.itemNumero)).toEqual([1, 5]);
  });

  it('una prenda huerfana va al final en vez de romper el orden', () => {
    const pos = posicionesDeColegios([CAMBRIDGE]);
    const filas = [
      p({ colegioId: 'colegio-que-no-existe', itemNumero: 1 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 9 }),
    ];
    expect(ordenarPrendas(filas, 'defecto', pos).map((x) => x.itemNumero)).toEqual([9, 1]);
  });
});

describe('criterios alternativos', () => {
  const pos = posicionesDeColegios([CAMBRIDGE, INTL]);

  it('por precio ordena DENTRO de cada colegio por defecto', () => {
    // La resolucion de la tension que planteo el usuario: no mezclar colegios Y poder
    // ordenar por precio. Agrupado es el default.
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, precio: 300 }),
      p({ colegioId: INTL.id, itemNumero: 2, precio: 50 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 3, precio: 100 }),
      p({ colegioId: INTL.id, itemNumero: 4, precio: 900 }),
    ];
    const r = ordenarPrendas(filas, 'precio-asc', pos);
    expect(r.map((x) => x.colegioId)).toEqual([CAMBRIDGE.id, CAMBRIDGE.id, INTL.id, INTL.id]);
    expect(r.map((x) => x.precio)).toEqual([100, 300, 50, 900]);
  });

  it('y compara entre colegios cuando se pide explicitamente', () => {
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, precio: 300 }),
      p({ colegioId: INTL.id, itemNumero: 2, precio: 50 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 3, precio: 100 }),
      p({ colegioId: INTL.id, itemNumero: 4, precio: 900 }),
    ];
    const r = ordenarPrendas(filas, 'precio-asc', pos, { agruparPorColegio: false });
    expect(r.map((x) => x.precio)).toEqual([50, 100, 300, 900]);
  });

  it('una fila SIN precio va al final en las DOS direcciones', () => {
    // Tratarla como cero la pondria primera al ordenar de menor a mayor y haria parecer que
    // es la mas barata. La ausencia de un dato no es un dato.
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, precio: null }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, precio: 200 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 3, precio: 100 }),
    ];
    expect(ordenarPrendas(filas, 'precio-asc', pos).map((x) => x.itemNumero)).toEqual([3, 2, 1]);
    expect(ordenarPrendas(filas, 'precio-desc', pos).map((x) => x.itemNumero)).toEqual([2, 3, 1]);
  });

  it('por nombre no distingue acentos, y eso importa cuando es la UNICA diferencia', () => {
    // "Pantalón" y "Pantalon" tienen que quedar JUNTOS y en su orden de item: el POS escribe
    // una forma y el sistema la otra, y es la razon por la que el importador normaliza.
    //
    // La primera version de este test usaba "Pantalon con elastico" contra "Pantalón de
    // vestir", que se deciden por la 'c' contra la 'd' ANTES de llegar al acento: pasaba
    // igual sin sensitivity 'base', o sea que no probaba nada. Estos dos difieren SOLO en el
    // acento, asi que con base empatan y decide el item; sin base, el acentuado se separa.
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 5, orden: 5, descripcion: 'Pantalon' }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, orden: 2, descripcion: 'Pantalón' }),
    ];
    expect(ordenarPrendas(filas, 'nombre-asc', pos).map((x) => x.itemNumero)).toEqual([2, 5]);

    // Y el caso alfabetico normal sigue andando.
    const otras = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1, descripcion: 'Pantalón de vestir' }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, descripcion: 'Bermuda' }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 3, descripcion: 'Pantalon con elastico' }),
    ];
    expect(ordenarPrendas(otras, 'nombre-asc', pos).map((x) => x.descripcion))
      .toEqual(['Bermuda', 'Pantalon con elastico', 'Pantalón de vestir']);
  });

  it('el orden por nombre tambien agrupa por colegio', () => {
    const filas = [
      p({ colegioId: INTL.id, itemNumero: 1, descripcion: 'Aaa' }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, descripcion: 'Zzz' }),
    ];
    expect(ordenarPrendas(filas, 'nombre-asc', pos).map((x) => x.descripcion)).toEqual(['Zzz', 'Aaa']);
  });

  it('el desempate hace ESTABLE cualquier criterio', () => {
    // Dos prendas del mismo precio no pueden intercambiarse entre dos cargas.
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 7, orden: 7, precio: 100 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 2, orden: 2, precio: 100 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 5, orden: 5, precio: 100 }),
    ];
    const a = ordenarPrendas(filas, 'precio-asc', pos).map((x) => x.itemNumero);
    const b = ordenarPrendas([...filas].reverse(), 'precio-asc', pos).map((x) => x.itemNumero);
    expect(a).toEqual([2, 5, 7]);
    expect(b).toEqual(a);
  });

  it('no muta la lista recibida', () => {
    const filas = [
      p({ colegioId: CAMBRIDGE.id, itemNumero: 9 }),
      p({ colegioId: CAMBRIDGE.id, itemNumero: 1 }),
    ];
    const copia = filas.map((x) => x.itemNumero);
    ordenarPrendas(filas, 'defecto', pos);
    expect(filas.map((x) => x.itemNumero)).toEqual(copia);
  });
});

describe('paginacion', () => {
  const n = (k: number) => Array.from({ length: k }, (_, i) => i + 1);

  it('recorta la pagina pedida y declara el total', () => {
    const r = paginar(n(448), 2, 50);
    expect(r.filas[0]).toBe(51);
    expect(r.filas).toHaveLength(50);
    expect(r).toMatchObject({ total: 448, pagina: 2, porPagina: 50, paginas: 9 });
  });

  it('los cuatro tamaños que pidio el usuario', () => {
    expect([...TAMANOS_PAGINA]).toEqual([10, 20, 50, 100]);
    for (const t of TAMANOS_PAGINA) expect(paginar(n(448), 1, t).filas).toHaveLength(t);
  });

  it('porPagina en 0 devuelve TODO, que es lo que necesita el PDF', () => {
    // Un reporte para un banco que imprime 20 de 2400 filas sin decirlo es la clase de
    // error silencioso que este sistema ya pago varias veces.
    const r = paginar(n(2400), 1, 0);
    expect(r.filas).toHaveLength(2400);
    expect(r).toMatchObject({ total: 2400, paginas: 1, porPagina: 0 });
  });

  it('una pagina fuera de rango se ACOTA a la ultima, no devuelve vacio', () => {
    // Pasa de verdad: estas en la pagina 20 y cambias a un colegio con menos filas. Una
    // tabla vacia ahi se lee como "no hay datos".
    const r = paginar(n(30), 99, 10);
    expect(r.pagina).toBe(3);
    expect(r.filas).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it('la ultima pagina puede venir incompleta', () => {
    const r = paginar(n(448), 9, 50);
    expect(r.filas).toHaveLength(48);
  });

  it('una lista vacia no explota', () => {
    expect(paginar([], 1, 50)).toMatchObject({ total: 0, paginas: 1, pagina: 1 });
  });

  it('la suma de todas las paginas es el total, sin perder ni repetir filas', () => {
    // La propiedad que de verdad importa: paginar no puede hacer desaparecer una prenda.
    const todas = n(448);
    const vistas: number[] = [];
    for (let pag = 1; pag <= 9; pag++) vistas.push(...paginar(todas, pag, 50).filas);
    expect(vistas).toEqual(todas);
  });
});

describe('lectura de los parametros', () => {
  it('acepta solo los tamaños ofrecidos', () => {
    // Un porPagina=100000 por la url convertiria la paginacion en un adorno.
    expect(leerPaginacion({ porPagina: '100000' }).porPagina).toBe(TAMANO_PAGINA_DEFECTO);
    expect(leerPaginacion({ porPagina: '20' }).porPagina).toBe(20);
    expect(leerPaginacion({ porPagina: 'abc' }).porPagina).toBe(TAMANO_PAGINA_DEFECTO);
  });

  it('sin parametros usa el default de 50', () => {
    expect(leerPaginacion({})).toEqual({ pagina: 1, porPagina: 50 });
  });

  it('todo=true y porPagina=0 significan sin paginar', () => {
    expect(leerPaginacion({ todo: 'true' }).porPagina).toBe(0);
    expect(leerPaginacion({ porPagina: '0' }).porPagina).toBe(0);
  });

  it('una pagina invalida cae en la primera', () => {
    expect(leerPaginacion({ pagina: '-3' }).pagina).toBe(1);
    expect(leerPaginacion({ pagina: 'x' }).pagina).toBe(1);
  });

  it('valida el criterio en vez de confiar en la url', () => {
    expect(esCriterioValido('precio-asc')).toBe(true);
    expect(esCriterioValido('defecto')).toBe(true);
    expect(esCriterioValido('drop table')).toBe(false);
    expect(esCriterioValido(undefined)).toBe(false);
  });
});
