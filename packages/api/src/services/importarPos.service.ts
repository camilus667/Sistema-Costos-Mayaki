/**
 * PARSEO Y RESOLUCION DEL EXPORT DEL SISTEMA POS.
 *
 * Este archivo NO TOCA LA BASE DE DATOS. Recibe el buffer del .xlsx y los catalogos
 * ya cargados —colegios, tallas, productos— y devuelve una resolucion fila por fila.
 * Es deliberado: asi cada regla se puede probar con los casos reales del archivo sin
 * levantar un servidor ni sembrar una base, y el endpoint queda como una capa delgada
 * que solo traduce y escribe.
 *
 * MEDIDO SOBRE EL ARCHIVO REAL (767 filas, 5 colegios):
 *
 *   filas totales                     766
 *   descartadas por categoria          34   (20 "General" + 14 "Empresas")
 *   filas relevantes                  732
 *   sin "Precio POS"                    0
 *   sin "Cod. Producto"                 0
 *   talla resuelta                    712   (las 20 restantes: 8 de "Talla 03" y
 *                                            12 sin variante)
 *
 * El sufijo del codigo confirma la categoria en las 732: 297 `-cc`, 126 `-EO`,
 * 95 `-InfSM`, 166 `-IntlSM`, 48 `-JS`. Cero excepciones. Se usa como VERIFICACION
 * cruzada, no como fuente: si el sufijo y la categoria discrepan, la fila se marca
 * para revision en vez de elegir uno de los dos en silencio.
 */

import { codigoTallaCanonico, TALLA_PRODUCTOS_SIN_VARIANTE } from './tallas';

// ---------------------------------------------------------------------------
// Columnas del export. Fijas y verificadas contra el archivo real.
// ---------------------------------------------------------------------------

/**
 * Indices de columna, base cero. La fila 0 es el encabezado.
 *
 * Se referencian por INDICE y no por nombre de encabezado a proposito: el export del
 * POS trae 38 columnas con nombres largos y con acentos, y emparejar por texto de
 * encabezado agrega un punto de falla —un acento distinto, un espacio de mas— para
 * resolver algo que en este formato es estable. El parseo VERIFICA los encabezados
 * esperados y avisa si no coinciden, en vez de leer a ciegas.
 */
export const COL = {
  NOMBRE_PRODUCTO: 2,   // C
  CATEGORIA: 4,         // E
  VARIANTE: 7,          // H
  CODIGO: 10,           // K
  PRECIO_POS: 19,       // T
  CANTIDAD: 32,         // AG
} as const;

const ENCABEZADOS_ESPERADOS: Record<number, string> = {
  [COL.NOMBRE_PRODUCTO]: 'Nombre de Producto',
  [COL.CATEGORIA]: 'Categorías',
  [COL.VARIANTE]: 'Nombre de variante',
  [COL.CODIGO]: 'Cod. Producto',
  [COL.PRECIO_POS]: 'Precio POS',
  [COL.CANTIDAD]: 'Cant. Inv. General',
};

/**
 * Categorias que NO son datos. Se descartan en silencio, sin contarlas como error.
 *
 *   General    la fila PADRE del producto en el POS. No tiene variante ni colegio.
 *   Empresas   categoria que no corresponde a ningun colegio.
 */
export const CATEGORIAS_IGNORADAS = ['General', 'Empresas'] as const;

/**
 * Mapa fijo de categoria del POS a colegio del sistema.
 *
 * La comparacion del nombre es por CONTENIDO (`incluye`), no exacta, porque el POS
 * abrevia —"C Intl. San Marcos"— y el sistema escribe el nombre completo. Se listan
 * varias agujas por categoria cuando el nombre real puede estar escrito de dos
 * maneras.
 *
 * NO SE USA DISTANCIA DE EDICION aca a proposito. Los cinco nombres son bien
 * distintos entre si y una coincidencia difusa entre colegios es el peor error posible
 * de esta importacion: meteria los precios de un colegio en las prendas de otro. Si el
 * nombre no contiene la aguja, la fila no resuelve y lo dice.
 */
export const CATEGORIAS_POS: Record<string, { sufijo: string; agujas: string[] }> = {
  'C Cambridge': { sufijo: '-cc', agujas: ['Cambridge'] },
  'C Edad de Oro': { sufijo: '-EO', agujas: ['Edad de Oro'] },
  'C Infantil San Marcos': { sufijo: '-InfSM', agujas: ['Infantil San Marcos'] },
  'C Intl. San Marcos': { sufijo: '-IntlSM', agujas: ['Intl. San Marcos', 'Internacional San Marcos', 'Internacional SM'] },
  'C Saint Jude': { sufijo: '-JS', agujas: ['Saint Jude'] },
};

// ---------------------------------------------------------------------------
// Normalizacion de descripciones
// ---------------------------------------------------------------------------

/**
 * Abreviaturas del POS y su forma larga en el sistema.
 *
 * POR QUE HACE FALTA. El POS escribe `Camisa m/c, CC` y el sistema
 * `Camisa manga corta`. Medida la distancia de edicion entre esos dos textos crudos,
 * la confianza queda por debajo del 50% y treinta y seis prendas de Cambridge caerian
 * a revision manual. Expandiendo primero, la mayoria empareja de forma exacta.
 *
 * El orden importa: las claves mas largas van antes para que `c/elast` no sea
 * consumida por `c/e`.
 */
const ABREVIATURAS: [RegExp, string][] = [
  // Las formas largas van primero para que `m/corta` no sea consumida por `m/c`.
  [/\bm\/corta\b/gi, 'manga corta'],
  [/\bm\/larga\b/gi, 'manga larga'],
  [/\bm\/c\b/gi, 'manga corta'],
  [/\bm\/l\b/gi, 'manga larga'],
  [/\bed\.?\s*fisica\b/gi, 'educacion fisica'],
  [/\bc\/redondo\b/gi, 'cuello redondo'],
  [/\bc\/elast\b/gi, 'con elastico'],
  [/\bc\/elas\b/gi, 'con elastico'],
  [/\bc\/v\b/gi, 'cuello en v'],
  [/\bdep\b/gi, 'deportivo'],
  [/\binv\b/gi, 'invierno'],
  [/\bver\b/gi, 'verano'],
  [/\bpant\b/gi, 'pantalon'],
  [/\bgde\b/gi, 'grande'],
  [/\bpeq\b/gi, 'pequeno'],
];

/** Quita acentos y pasa a minusculas, sin tocar la puntuacion util. */
function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Deja una descripcion del POS lista para comparar contra las del sistema.
 *
 * Tres pasos, en este orden:
 *   1. Quita el SUFIJO DE COLEGIO: `, CC`, `, EO`, `, InfSM`, `, IntlSM`, `, SJ`.
 *      Todas las prendas de un colegio lo llevan, asi que es ruido constante que
 *      castiga a todas las comparaciones por igual.
 *   2. Expande abreviaturas.
 *   3. Normaliza acentos, minusculas y espacios.
 *
 * EL PASO 1 CORTA EN LA COMA. Sin heuristicas, porque la planilla no las necesita:
 * el nombre del producto es lo que va ANTES de la coma y el sufijo del colegio es lo
 * que va despues. Regla confirmada por el usuario y MEDIDA sobre el archivo:
 *
 *   80 nombres distintos en las 732 filas relevantes
 *   los 80 tienen EXACTAMENTE UNA coma
 *   cero nombres sin coma
 *
 * y los cinco sufijos que aparecen son:
 *
 *   297  "CC"        166  "Intl SM"     126  "EO"
 *    95  "Inf SM"     48  "SJ"
 *
 * DOS VERSIONES ANTERIORES DE ESTA FUNCION FUERON MAS LISTAS Y PEORES. La primera
 * tomaba un solo token tras la coma, asi que "Intl SM" e "Inf SM" —que llevan espacio—
 * no se limpiaban y las 261 filas de esos colegios arrastraban "intl sm" como ruido en
 * cada comparacion; lo encontro un test. La segunda pedia que la mitad de las letras
 * estuvieran en mayuscula, para no comerse una palabra con significado. Funcionaba con
 * estos cinco sufijos, pero traia un limite de seis letras por token: el dia que un
 * colegio traiga un sufijo mas largo, deja de limpiarlo y nadie se enteraria.
 *
 * La planilla es la fuente de verdad y dice algo mas simple que las dos. Se corta en la
 * ULTIMA coma y no en la primera: en los 80 nombres reales da identico —tienen una
 * sola— y degrada mejor si algun dia un nombre trae una coma interna, porque conserva
 * el nombre y saca solo el sufijo.
 */
export function normalizarDescripcionPos(texto: unknown): string {
  let s = String(texto ?? '').trim();

  const coma = s.lastIndexOf(',');
  if (coma > 0) s = s.slice(0, coma).trim();

  for (const [re, largo] of ABREVIATURAS) s = s.replace(re, largo);
  return sinAcentos(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Normaliza una descripcion del sistema con el mismo criterio, para comparar peras con peras. */
export function normalizarDescripcionSistema(texto: unknown): string {
  const s = String(texto ?? '').trim();
  return sinAcentos(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Similitud
// ---------------------------------------------------------------------------

/** Distancia de Levenshtein, iterativa y con una sola fila de memoria. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const actual = [i];
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      actual[j] = Math.min(actual[j - 1] + 1, previa[j] + 1, previa[j - 1] + costo);
    }
    previa = actual;
  }
  return previa[b.length];
}

/**
 * Palabras de relleno que no distinguen una prenda de otra.
 *
 * "pantalon dama" y "pantalon para dama" son la MISMA prenda escrita de dos maneras.
 * Contando "para" como palabra propia, el solapamiento cae de 2/2 a 2/3 y la fila se va
 * a revision sin motivo. Medido: era una de las cuatro prendas de Cambridge que
 * quedaban en 69% siendo emparejamientos correctos.
 */
const RELLENO = new Set(['de', 'del', 'para', 'con', 'en', 'el', 'la', 'los', 'las', 'y', 'a']);

/**
 * ¿Estas dos palabras son la misma, con tolerancia?
 *
 * Tres casos que aparecen de verdad en este archivo:
 *   deportivo / deportiva   genero distinto -> comparten prefijo largo
 *   buzo / buso             variante de escritura -> distancia 1
 *   corta / corta           iguales
 *
 * La tolerancia de una edicion se aplica solo desde cuatro caracteres: en palabras
 * cortas, una edicion cambia el significado ("dama" y "cama" no son lo mismo).
 */
function mismaPalabra(x: string, y: string): boolean {
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  if (min >= 5 && (x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5)))) return true;
  if (min >= 4 && levenshtein(x, y) <= 1) return true;
  return false;
}

/**
 * Confianza de 0 a 1 entre dos descripciones YA normalizadas.
 *
 * Combina dos señales porque ninguna sola alcanza:
 *   - distancia de edicion, que capta erratas y orden parecido
 *   - solapamiento de PALABRAS con tolerancia, que capta el orden distinto, el genero
 *     y las variantes de escritura
 *
 * Se pondera mas el solapamiento: en nombres de prendas, compartir "chamarra" e
 * "invierno" dice mas que coincidir letra por letra.
 */
export function similitud(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const dist = levenshtein(a, b);
  const porEdicion = 1 - dist / Math.max(a.length, b.length);

  const pa = a.split(' ').filter((p) => p && !RELLENO.has(p));
  const pb = b.split(' ').filter((p) => p && !RELLENO.has(p));
  if (pa.length === 0 || pb.length === 0) return Math.max(0, porEdicion);

  // Emparejamiento uno a uno: cada palabra de la lista corta se consume una sola vez,
  // para que repetir una palabra no infle el puntaje.
  const libres = [...pb];
  let comunes = 0;
  for (const x of pa) {
    const i = libres.findIndex((y) => mismaPalabra(x, y));
    if (i !== -1) { comunes++; libres.splice(i, 1); }
  }
  const porPalabras = comunes / Math.max(pa.length, pb.length);

  return Math.max(0, Math.min(1, porEdicion * 0.35 + porPalabras * 0.65));
}

/** Umbral de confianza por debajo del cual la fila exige revision manual. */
export const CONFIANZA_MINIMA = 0.7;

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

export interface FilaPos {
  /** Numero de fila en la planilla, base 1 y contando el encabezado. Para poder señalarla. */
  fila: number;
  categoria: string;
  nombreProducto: string;
  variante: string;
  codigo: string;
  precioPos: number;
  cantidad: number;
}

export interface ResultadoParseo {
  filas: FilaPos[];
  descartadasPorCategoria: number;
  detalleDescartes: Record<string, number>;
  avisos: string[];
}

const aNumero = (v: unknown): number => {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Convierte las filas crudas del .xlsx en filas normalizadas.
 *
 * Recibe la matriz ya leida (`sheet_to_json` con `header: 1`) y no el buffer, para que
 * esta funcion no dependa de la libreria de Excel y se pueda probar con arreglos
 * escritos a mano.
 */
export function parsearFilasPos(matriz: any[][]): ResultadoParseo {
  const avisos: string[] = [];
  if (!Array.isArray(matriz) || matriz.length < 2) {
    return { filas: [], descartadasPorCategoria: 0, detalleDescartes: {}, avisos: ['El archivo no tiene filas de datos.'] };
  }

  // VERIFICA LOS ENCABEZADOS en vez de leer a ciegas. Si el POS cambia el orden de
  // columnas, esto lo dice antes de importar precios en la columna equivocada, que es
  // el peor error silencioso posible de este formato.
  const cab = matriz[0] || [];
  for (const [idx, esperado] of Object.entries(ENCABEZADOS_ESPERADOS)) {
    const real = String(cab[Number(idx)] ?? '').trim();
    if (real !== esperado) {
      avisos.push(
        `La columna ${Number(idx) + 1} dice "${real}" y se esperaba "${esperado}". ` +
        `El formato del export pudo cambiar: revisar antes de importar.`
      );
    }
  }

  const txt = (r: any[], i: number) => String(r[i] ?? '').trim();
  const filas: FilaPos[] = [];
  const detalleDescartes: Record<string, number> = {};
  let descartadas = 0;

  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i] || [];
    const categoria = txt(r, COL.CATEGORIA);

    if (!categoria || (CATEGORIAS_IGNORADAS as readonly string[]).includes(categoria)) {
      descartadas++;
      const clave = categoria || '(sin categoria)';
      detalleDescartes[clave] = (detalleDescartes[clave] || 0) + 1;
      continue;
    }

    filas.push({
      fila: i + 1,
      categoria,
      nombreProducto: txt(r, COL.NOMBRE_PRODUCTO),
      variante: txt(r, COL.VARIANTE),
      codigo: txt(r, COL.CODIGO),
      precioPos: aNumero(r[COL.PRECIO_POS]),
      cantidad: aNumero(r[COL.CANTIDAD]),
    });
  }

  return { filas, descartadasPorCategoria: descartadas, detalleDescartes, avisos };
}

// ---------------------------------------------------------------------------
// Resolucion
// ---------------------------------------------------------------------------

export type EstadoFila =
  | 'ok'            // resuelta, confianza suficiente
  | 'revisar'       // resuelta pero con confianza baja
  | 'sin-producto'  // ninguna prenda del colegio se parece
  | 'sin-talla'     // la talla no existe o no esta activa en el colegio
  | 'sin-precio'    // el POS no trae precio: no se importa
  | 'otro-colegio'; // la fila pertenece a otra categoria

export interface Candidato { id: string; descripcion: string; confianza: number }

export interface FilaResuelta {
  origen: FilaPos;
  estado: EstadoFila;
  motivo?: string;
  tallaId?: string;
  tallaCodigo?: string;
  /** La fila del POS no traia variante y se le asigno la talla del medio de la curva. */
  tallaAsignadaPorDefecto?: boolean;
  productoId?: string;
  productoDescripcion?: string;
  confianza: number;
  candidatos: Candidato[];
}

export interface CatalogoTalla { id: string; codigo: string }
export interface CatalogoProducto { id: string; descripcion: string; colegioId: string }
export interface CatalogoColegio { id: string; nombre: string }

export interface OpcionesResolucion {
  filas: FilaPos[];
  /** Se importa UN colegio por corrida. Las filas de otras categorias se marcan y no se tocan. */
  colegioId: string;
  colegios: CatalogoColegio[];
  /** Solo las tallas ACTIVAS de ese colegio. Filtrarlas es responsabilidad de quien llama. */
  tallasActivas: CatalogoTalla[];
  /** Solo las prendas de ese colegio. */
  productos: CatalogoProducto[];
}

export interface ResumenResolucion {
  total: number;
  ok: number;
  revisar: number;
  sinProducto: number;
  sinTalla: number;
  sinPrecio: number;
  otroColegio: number;
}

/**
 * Que categoria del POS le corresponde a un colegio del sistema.
 *
 * Devuelve null si ninguna calza: es el caso de un colegio que existe en el sistema y
 * no esta en el export, y hay que decirlo en vez de importarle filas de otro.
 */
export function categoriaDeColegio(
  colegioId: string,
  colegios: CatalogoColegio[]
): string | null {
  const col = colegios.find((c) => String(c.id) === String(colegioId));
  if (!col) return null;
  const nombre = sinAcentos(col.nombre);
  for (const [categoria, cfg] of Object.entries(CATEGORIAS_POS)) {
    if (cfg.agujas.some((a) => nombre.includes(sinAcentos(a)))) return categoria;
  }
  return null;
}

/**
 * Resuelve cada fila contra los catalogos del colegio elegido.
 *
 * REGLAS, en el orden en que se aplican:
 *
 *   1. Si la fila es de otra categoria -> 'otro-colegio'. Se importa un colegio por
 *      corrida, decidido con el usuario.
 *   2. SIN PRECIO NO SE IMPORTA. El codigo externo y el precio viajan juntos: un
 *      codigo sin precio quedaria en una fila de precio_venta que no existe. Medido
 *      sobre el archivo real: cero filas caen aca, asi que es una guarda y no un
 *      filtro.
 *   3. La talla sale de la variante, normalizada a dos digitos. SIN VARIANTE se
 *      asigna la 14 —los doce genericos de Cambridge: Riñonera, Gorra, Cinturon,
 *      Lanyard...— porque esta en el medio de la curva y el costo prorrateado que les
 *      toque no sale del extremo barato ni del caro. Se MARCA como asignada por
 *      defecto: es un casillero, no una talla real, y quien lea el preview tiene que
 *      poder saberlo.
 *   4. El producto se empareja por similitud, solo entre las prendas de ese colegio.
 *      Por debajo del umbral la fila queda en 'revisar', no se descarta: el usuario
 *      corrige o crea la prenda.
 */
export function resolverFilas(opciones: OpcionesResolucion): {
  resueltas: FilaResuelta[];
  resumen: ResumenResolucion;
  categoriaEsperada: string | null;
  avisos: string[];
} {
  const { filas, colegioId, colegios, tallasActivas, productos } = opciones;
  const avisos: string[] = [];

  const categoriaEsperada = categoriaDeColegio(colegioId, colegios);
  if (!categoriaEsperada) {
    const col = colegios.find((c) => String(c.id) === String(colegioId));
    avisos.push(
      `El colegio "${col?.nombre ?? colegioId}" no corresponde a ninguna categoria del ` +
      `export del POS. Ninguna fila se puede importar a este colegio.`
    );
  }

  // Indice de tallas por codigo canonico. Se arma una vez.
  const tallaPorCodigo = new Map<string, CatalogoTalla>();
  for (const t of tallasActivas) tallaPorCodigo.set(codigoTallaCanonico(t.codigo), t);

  // Descripciones del sistema, ya normalizadas. Tambien una vez: normalizar dentro del
  // bucle seria O(filas x productos) normalizaciones para nada.
  const delColegio = productos
    .filter((p) => String(p.colegioId) === String(colegioId))
    .map((p) => ({ ...p, norm: normalizarDescripcionSistema(p.descripcion) }));

  if (delColegio.length === 0) {
    avisos.push(
      'Este colegio no tiene ninguna prenda cargada: todas las filas van a quedar sin ' +
      'producto. Hay que crearlas desde el preview o cargarlas antes.'
    );
  }

  const resueltas: FilaResuelta[] = [];

  for (const f of filas) {
    const base = { origen: f, confianza: 0, candidatos: [] as Candidato[] };

    if (categoriaEsperada === null || f.categoria !== categoriaEsperada) {
      resueltas.push({
        ...base,
        estado: 'otro-colegio',
        motivo: `La fila es de "${f.categoria}" y se esta importando ${categoriaEsperada ?? 'un colegio sin categoria'}.`,
      });
      continue;
    }

    if (!Number.isFinite(f.precioPos) || f.precioPos <= 0) {
      resueltas.push({
        ...base,
        estado: 'sin-precio',
        motivo: 'La fila no trae "Precio POS". El codigo externo no se importa sin su precio.',
      });
      continue;
    }

    // --- talla ---
    const crudo = f.variante.replace(/^talla\s+/i, '').trim();
    const codigoBuscado = crudo ? codigoTallaCanonico(crudo) : TALLA_PRODUCTOS_SIN_VARIANTE;
    const talla = tallaPorCodigo.get(codigoBuscado);

    if (!talla) {
      resueltas.push({
        ...base,
        estado: 'sin-talla',
        motivo: crudo
          ? `La talla "${crudo}" (canonica "${codigoBuscado}") no existe o no esta activa en este colegio.`
          : `La fila no trae variante y la talla ${TALLA_PRODUCTOS_SIN_VARIANTE}, que es la que se usa para los genericos, no esta activa en este colegio.`,
      });
      continue;
    }

    // --- producto ---
    const objetivo = normalizarDescripcionPos(f.nombreProducto);
    const candidatos: Candidato[] = delColegio
      .map((p) => ({ id: p.id, descripcion: p.descripcion, confianza: similitud(objetivo, p.norm) }))
      .sort((a, b) => b.confianza - a.confianza)
      .slice(0, 5);

    const mejor = candidatos[0];
    const comun = {
      ...base,
      tallaId: talla.id,
      tallaCodigo: talla.codigo,
      tallaAsignadaPorDefecto: !crudo,
      candidatos,
      confianza: mejor ? mejor.confianza : 0,
    };

    if (!mejor || mejor.confianza <= 0) {
      resueltas.push({
        ...comun,
        estado: 'sin-producto',
        motivo: `Ninguna prenda de este colegio se parece a "${f.nombreProducto}".`,
      });
      continue;
    }

    resueltas.push({
      ...comun,
      estado: mejor.confianza >= CONFIANZA_MINIMA ? 'ok' : 'revisar',
      productoId: mejor.id,
      productoDescripcion: mejor.descripcion,
      motivo: mejor.confianza >= CONFIANZA_MINIMA
        ? undefined
        : `Confianza ${(mejor.confianza * 100).toFixed(0)}%, por debajo del ${(CONFIANZA_MINIMA * 100).toFixed(0)}% exigido. Revisar o crear la prenda.`,
    });
  }

  const resumen: ResumenResolucion = {
    total: resueltas.length,
    ok: resueltas.filter((r) => r.estado === 'ok').length,
    revisar: resueltas.filter((r) => r.estado === 'revisar').length,
    sinProducto: resueltas.filter((r) => r.estado === 'sin-producto').length,
    sinTalla: resueltas.filter((r) => r.estado === 'sin-talla').length,
    sinPrecio: resueltas.filter((r) => r.estado === 'sin-precio').length,
    otroColegio: resueltas.filter((r) => r.estado === 'otro-colegio').length,
  };

  return { resueltas, resumen, categoriaEsperada, avisos };
}

/**
 * Verificacion cruzada del sufijo del codigo contra la categoria.
 *
 * En el archivo real el sufijo coincide con la categoria en las 732 filas relevantes,
 * sin una sola excepcion. Por eso vale como CHEQUEO: una discrepancia significa que el
 * export viene mezclado, y elegir uno de los dos en silencio pondria los precios de un
 * colegio en las prendas de otro. Se reporta, no se resuelve.
 */
export function discrepanciasDeSufijo(filas: FilaPos[]): { fila: number; categoria: string; codigo: string; sufijoEsperado: string }[] {
  const malas: { fila: number; categoria: string; codigo: string; sufijoEsperado: string }[] = [];
  for (const f of filas) {
    const cfg = CATEGORIAS_POS[f.categoria];
    if (!cfg || !f.codigo) continue;
    if (!f.codigo.toLowerCase().endsWith(cfg.sufijo.toLowerCase())) {
      malas.push({ fila: f.fila, categoria: f.categoria, codigo: f.codigo, sufijoEsperado: cfg.sufijo });
    }
  }
  return malas;
}
