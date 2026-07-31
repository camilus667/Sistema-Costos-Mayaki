/**
 * EL ORDEN DE LAS PRENDAS. UNA SOLA CASA.
 *
 * POR QUE EXISTE ESTE ARCHIVO. El orden estaba escrito en DIEZ consultas, con TRES
 * criterios distintos, y ninguno mencionaba el colegio:
 *
 *   orden, item_numero    colegio.ts:144, inputs.ts:322, inputs.ts:430
 *   item_numero solo      detalleAccesorio.ts:147, export.ts:80/112/142,
 *                         inputs.ts:514/752/819, producto.ts:136
 *   por item, en el navegador   dashboard.html
 *
 * Medido antes de tocar nada, con el ambito en TODA LA EMPRESA:
 *
 *   /api/calculo/matriz-consolidada   items  1, 28, 2, 3, 4, ...
 *   /api/productos                    items  1, 2, 3, ..., 28
 *
 * Dos ordenes distintos sobre las mismas 28 prendas. Y el primero es el que reporto el
 * usuario: el item 28 es de Internacional SM y aparecia entre el 1 y el 2 de Cambridge.
 *
 * LA CAUSA, medida en la base: `producto.orden` se numera POR COLEGIO. Cambridge tiene
 * 1..27 y la unica prenda de Internacional SM tambien tiene `orden = 1`. Al ordenar por
 * `orden, item_numero` los dos unos EMPATAN, y el desempate por item pone 1 antes que 28.
 * No hay ningun bug de la vista: es que el criterio no sabe que existen los colegios.
 *
 * ARREGLAR LAS DIEZ CONSULTAS UNA POR UNA SERIA REPETIR EL ERROR. Es la misma historia
 * que la formula de costeo en seis lugares, que las dos definiciones de
 * cargarConfigAdminColegio, y que el filtro de tallas de la Fase 5: una regla repetida se
 * desincroniza, y el arreglo de una copia deja las otras atras. Este archivo es la casa
 * unica, igual que tallas.ts y modalidadFiscal.ts.
 *
 * SE ORDENA EN MEMORIA Y NO EN SQL, a proposito. Las diez consultas son heterogeneas: unas
 * traen solo `producto`, otras hacen join con `colegio`, `precio_venta` o `talla`. Un
 * `orderBy` compartido tendria que conocer la forma de cada consulta. Un comparador sobre
 * el resultado no: recibe filas con cuatro campos y no le importa de donde salieron. Y el
 * costo es nulo en este sistema —la base es sql.js EN MEMORIA, y son cientos de filas, no
 * millones— asi que la unica razon para hacerlo en SQL seria la eficiencia, que aca no
 * existe.
 *
 * Y ADEMAS ES LO CORRECTO PARA PAGINAR. Ordenar despues de recortar la pagina devolveria
 * filas distintas segun el orden elegido; el comparador se aplica ANTES del recorte, en un
 * solo lugar, y eso no se puede olvidar en una de las diez consultas.
 */

/** Lo minimo que una fila necesita tener para poder ordenarse. */
export interface PrendaOrdenable {
  colegioId: string | null | undefined;
  itemNumero: number | string | null | undefined;
  /** Orden dentro del colegio, el que define Prendas & Recetas. */
  orden?: number | string | null;
  descripcion?: string | null;
  /**
   * Para el orden por precio. Es OPCIONAL porque no todas las pantallas lo tienen a mano:
   * una fila sin precio se va al final en vez de contar como cero, que la pondria primera
   * y haria parecer que es la mas barata.
   */
  precio?: number | null;
}

export interface ColegioOrdenable {
  id: string;
  orden?: number | null;
  creadoEn?: string | null;
  nombre?: string | null;
}

export type CriterioOrden =
  | 'defecto'      // colegio, y dentro de cada uno el orden de Prendas & Recetas
  | 'precio-asc'
  | 'precio-desc'
  | 'nombre-asc'
  | 'nombre-desc';

export const CRITERIOS: CriterioOrden[] = ['defecto', 'precio-asc', 'precio-desc', 'nombre-asc', 'nombre-desc'];

export function esCriterioValido(x: unknown): x is CriterioOrden {
  return typeof x === 'string' && (CRITERIOS as string[]).includes(x);
}

/**
 * Posicion de cada colegio, de 0 en adelante.
 *
 * LA REGLA: manda `colegio.orden` cuando esta puesto; si no, la FECHA DE CREACION. Es lo
 * que pidio el usuario —"que se organice por defecto por el orden en que se agregaron los
 * colegios"— y ademas significa que la columna `orden` puede nacer vacia sin cambiar el
 * comportamiento de una base que ya existe, igual que la regla "sin fila = activa" de
 * `colegio_talla`.
 *
 * Un colegio SIN orden explicito va DESPUES de los que si lo tienen, y entre ellos por
 * fecha. Ese estado mezclado solo existe antes del primer guardado del arrastrar y soltar,
 * que le asigna orden a todos.
 */
export function posicionesDeColegios(colegios: ColegioOrdenable[]): Map<string, number> {
  const ordenados = [...colegios].sort((a, b) => {
    const oa = a.orden === null || a.orden === undefined ? Number.MAX_SAFE_INTEGER : Number(a.orden);
    const ob = b.orden === null || b.orden === undefined ? Number.MAX_SAFE_INTEGER : Number(b.orden);
    if (oa !== ob) return oa - ob;
    const fa = String(a.creadoEn ?? '');
    const fb = String(b.creadoEn ?? '');
    if (fa !== fb) return fa < fb ? -1 : 1;
    // Ultimo desempate por nombre para que el orden sea ESTABLE. Sin el, dos colegios
    // creados en el mismo segundo podrian intercambiarse entre dos cargas de la pantalla,
    // que es la clase de inestabilidad que hace dudar de si un cambio se guardo.
    return String(a.nombre ?? '').localeCompare(String(b.nombre ?? ''), 'es');
  });

  const m = new Map<string, number>();
  ordenados.forEach((c, i) => m.set(String(c.id), i));
  return m;
}

const num = (x: unknown, siNo = Number.MAX_SAFE_INTEGER): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : siNo;
};

/** Posicion del colegio de una fila. Sin colegio, o con uno desconocido, va al final. */
function posColegio(f: PrendaOrdenable, pos: Map<string, number>): number {
  const id = f.colegioId === null || f.colegioId === undefined ? '' : String(f.colegioId);
  if (!id || id === 'null' || id === 'all') return Number.MAX_SAFE_INTEGER;
  const p = pos.get(id);
  return p === undefined ? Number.MAX_SAFE_INTEGER : p;
}

/**
 * Orden DENTRO de un colegio: el que define Prendas & Recetas.
 *
 * `orden` con `itemNumero` de respaldo, y no `orden` a secas: la columna admite NULL y
 * tiene default 0, asi que una prenda recien creada por un camino que no lo setee quedaria
 * primera en la lista de su colegio sin ninguna razon.
 */
function ordenInterno(f: PrendaOrdenable): [number, number] {
  const item = num(f.itemNumero);
  const o = f.orden === null || f.orden === undefined ? item : num(f.orden, item);
  return [o, item];
}

export interface OpcionesOrden {
  /**
   * Si los criterios alternativos respetan los grupos de colegio. Por defecto SI.
   *
   * El usuario pidio dos cosas que se pisan: que los colegios no se mezclen, y poder
   * ordenar por precio. Ordenar por precio en toda la empresa los intercala
   * necesariamente. Con esto en `true` —el default— ordenar por precio ordena DENTRO de
   * cada colegio; en `false` se comparan entre colegios, que es un caso real cuando lo que
   * se quiere es justamente ver los precios de la empresa entera.
   *
   * El orden `defecto` SIEMPRE agrupa: es su definicion.
   */
  agruparPorColegio?: boolean;
}

/** El comparador. Es lo unico que define el orden en todo el sistema. */
export function compararPrendas(
  criterio: CriterioOrden,
  posiciones: Map<string, number>,
  opciones: OpcionesOrden = {}
): (a: PrendaOrdenable, b: PrendaOrdenable) => number {
  const agrupar = opciones.agruparPorColegio !== false;

  return (a, b) => {
    if (criterio === 'defecto' || agrupar) {
      const pa = posColegio(a, posiciones);
      const pb = posColegio(b, posiciones);
      if (pa !== pb) return pa - pb;
    }

    if (criterio === 'nombre-asc' || criterio === 'nombre-desc') {
      // localeCompare con 'es' y sin distinguir acentos: "Pantalón" y "Pantalon" tienen
      // que quedar juntos, que es lo que un humano espera de una lista alfabetica.
      const c = String(a.descripcion ?? '').localeCompare(String(b.descripcion ?? ''), 'es', { sensitivity: 'base' });
      if (c !== 0) return criterio === 'nombre-asc' ? c : -c;
    } else if (criterio === 'precio-asc' || criterio === 'precio-desc') {
      const sinA = a.precio === null || a.precio === undefined;
      const sinB = b.precio === null || b.precio === undefined;
      // UNA FILA SIN PRECIO VA AL FINAL EN LAS DOS DIRECCIONES. Tratarla como cero la
      // pondria primera al ordenar de menor a mayor y haria parecer que es la mas barata,
      // cuando lo que pasa es que no tiene precio cargado. Es la misma decision que el
      // delta nulo del importador: la ausencia de un dato no es un dato.
      if (sinA !== sinB) return sinA ? 1 : -1;
      if (!sinA && !sinB) {
        const c = Number(a.precio) - Number(b.precio);
        if (c !== 0) return criterio === 'precio-asc' ? c : -c;
      }
    }

    // DESEMPATE FINAL, siempre el mismo: el orden interno del colegio. Sirve para dos
    // cosas. Es el criterio completo cuando el orden es `defecto`, y hace ESTABLE a
    // cualquier otro: dos prendas del mismo precio o del mismo nombre no pueden
    // intercambiarse entre dos cargas de la pantalla.
    const [oa, ia] = ordenInterno(a);
    const [ob, ib] = ordenInterno(b);
    if (oa !== ob) return oa - ob;
    return ia - ib;
  };
}

/** Ordena una copia. No muta la lista recibida. */
export function ordenarPrendas<T extends PrendaOrdenable>(
  filas: T[],
  criterio: CriterioOrden,
  posiciones: Map<string, number>,
  opciones: OpcionesOrden = {}
): T[] {
  return [...filas].sort(compararPrendas(criterio, posiciones, opciones));
}

// ---------------------------------------------------------------------------
// Paginacion
// ---------------------------------------------------------------------------

/**
 * Tamaños de pagina que ofrece la pantalla. Los pidio el usuario: de 10 en 10, o 20, 50, 100.
 *
 * El default es 50. Hoy la tabla mas larga tiene 448 filas —las combinaciones prenda mas
 * talla con dos colegios— y con los cinco colegios del POS van a ser unas 2400.
 */
export const TAMANOS_PAGINA = [10, 20, 50, 100] as const;
export const TAMANO_PAGINA_DEFECTO = 50;

export interface Paginado<T> {
  filas: T[];
  total: number;
  /** Base 1, como lo ve el usuario. */
  pagina: number;
  porPagina: number;
  paginas: number;
}

/**
 * Recorta una pagina, DESPUES de ordenar.
 *
 * `porPagina` en 0 significa TODO sin paginar, y existe por una razon concreta: los
 * reportes en PDF tienen que imprimir todas las filas y no la pagina que se este viendo.
 * Un reporte que se entrega a un banco con 20 de 2400 filas, sin decirlo, es exactamente
 * la clase de error silencioso que este sistema ya pago varias veces.
 *
 * Una pagina fuera de rango se ACOTA a la ultima en vez de devolver una lista vacia: pasa
 * de verdad cuando se esta en la pagina 20 y se cambia a un colegio con menos filas, y una
 * tabla vacia ahi se lee como "no hay datos".
 */
export function paginar<T>(filas: T[], pagina: number, porPagina: number): Paginado<T> {
  const total = filas.length;

  if (!porPagina || porPagina <= 0) {
    return { filas, total, pagina: 1, porPagina: 0, paginas: 1 };
  }

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const p = Math.min(Math.max(1, Math.floor(pagina) || 1), paginas);
  const desde = (p - 1) * porPagina;

  return { filas: filas.slice(desde, desde + porPagina), total, pagina: p, porPagina, paginas };
}

/** Lee y valida los parametros de paginacion de una query string. */
export function leerPaginacion(q: Record<string, string | undefined>): { pagina: number; porPagina: number } {
  const todo = String(q.todo ?? '') === 'true' || String(q.porPagina ?? '') === '0';
  if (todo) return { pagina: 1, porPagina: 0 };

  const pp = Number(q.porPagina);
  // Solo se aceptan los tamaños ofrecidos. Un `porPagina=100000` por la url convertiria la
  // paginacion en un adorno; y un valor raro cae al default en vez de fallar.
  const porPagina = (TAMANOS_PAGINA as readonly number[]).includes(pp) ? pp : TAMANO_PAGINA_DEFECTO;
  const pagina = Math.max(1, Math.floor(Number(q.pagina)) || 1);
  return { pagina, porPagina };
}
