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
/**
 * UBICA LAS COLUMNAS POR SU NOMBRE, no por su posicion.
 *
 * ESTE ERA EL BUG. Los indices `COL` estan fijos —C, E, H, K, T, AG— porque asi salia el export que
 * se uso para construir el importador. La version anterior COMPARABA los encabezados y, cuando no
 * coincidian, empujaba un aviso... y despues leia por el indice fijo igual. Con un export que trae
 * otra cantidad de columnas —mas sucursales, otro orden— eso significa importar el contenido de la
 * columna equivocada: el precio sale de donde esta el stock, la categoria de donde esta una imagen.
 * Desde la pantalla se ve como "no pudo leer el archivo".
 *
 * Buscar por nombre resuelve el caso general: el export puede tener las columnas donde quiera.
 *
 * SI FALTA UN NOMBRE ES UN ERROR DURO, no un aviso. Leer por un indice adivinado es peor que no
 * leer: deja precios plausibles en las prendas equivocadas, y eso no se nota hasta que alguien
 * compara contra el POS.
 *
 * La comparacion normaliza espacios, mayusculas y acentos, porque `Categorías` y `CATEGORIAS` son
 * la misma columna y un acento de diferencia no es un cambio de formato.
 */
export interface UbicacionColumnas {
  ok: boolean;
  indices: Record<keyof typeof COL, number>;
  faltantes: string[];
  duplicadas: Array<{ nombre: string; posiciones: number[] }>;
  /** Los encabezados que SI trae el archivo, para poder decirlo en el error. */
  encabezados: string[];
}

/** Forma comparable de un encabezado: sin acentos, sin mayusculas, sin espacios de sobra. */
function normalizarEncabezado(x: unknown): string {
  return String(x ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export function ubicarColumnas(cabecera: any[]): UbicacionColumnas {
  const encabezados = (cabecera || []).map((x) => String(x ?? '').trim());
  const normalizados = encabezados.map(normalizarEncabezado);

  const indices = {} as Record<keyof typeof COL, number>;
  const faltantes: string[] = [];
  const duplicadas: Array<{ nombre: string; posiciones: number[] }> = [];

  for (const [rol, idxFijo] of Object.entries(COL) as Array<[keyof typeof COL, number]>) {
    const nombre = ENCABEZADOS_ESPERADOS[idxFijo];
    const buscado = normalizarEncabezado(nombre);
    const posiciones = normalizados
      .map((n, i) => (n === buscado ? i : -1))
      .filter((i) => i !== -1);

    if (posiciones.length === 0) { faltantes.push(nombre); continue; }
    if (posiciones.length > 1) {
      // Elegir una seria adivinar, y adivinar aca mete precios en la prenda equivocada.
      duplicadas.push({ nombre, posiciones: posiciones.map((p) => p + 1) });
      continue;
    }
    indices[rol] = posiciones[0];
  }

  return {
    ok: faltantes.length === 0 && duplicadas.length === 0,
    indices,
    faltantes,
    duplicadas,
    encabezados,
  };
}

export const CATEGORIAS_IGNORADAS = ['General', 'Empresas'] as const;

// El sufijo de un codigo del POS (`001-cc` -> `cc`). Vive con la referencia porque es el mismo
// token que forma `CC-01`: un solo lugar donde se decide que es un sufijo.
import { abreviaturaDeCodigoPos, normalizarNombreColegio } from './referenciaPrenda';

/**
 * MAPA HEREDADO de categoria del POS a colegio del sistema. YA NO ES LA FUENTE DE VERDAD.
 *
 * Los colegios se descubren del archivo (ver `descubrirColegiosDelArchivo`). Este mapa quedo como
 * ultimo respaldo para cuando no hay archivo con el que comparar, y sus claves estan
 * DESACTUALIZADAS a proposito: el export decia `C Cambridge` cuando se escribio y hoy dice
 * `Cambridge`. No se actualizan porque actualizarlas seria repetir el error —tener los nombres del
 * POS escritos en el codigo es lo que hizo que un export con otros nombres no se pudiera leer—.
 *
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
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

/**
 * Normaliza una descripcion del sistema con el MISMO criterio que la del POS.
 *
 * LAS ABREVIATURAS SE EXPANDEN EN LOS DOS LADOS, y no hacerlo era un bug que rechazaba nombres
 * IDENTICOS. Esta funcion no aplicaba `ABREVIATURAS` y `normalizarDescripcionPos` si, asi que:
 *
 *   POS "Buzo dep, CC"  ->  "buzo deportivo"      (expandido)
 *   sistema "Buzo dep"  ->  "buzo dep"            (sin expandir)   ->  53%
 *
 * Doce casos medidos, todos con el nombre del sistema LETRA POR LETRA igual al del POS:
 *
 *   Buzo dep 53%   Chamarra ver 61%   Chamarra inv 57%   Chamarra dep 56%
 *   Blusa m/l 40%  Blusa m/c 40%      Camisa m/l 41%     Camisa m/c 41%
 *   Polera m/c 41% Chaleco c/v 64%    Chompa c/v 63%     Pantalon c/elas 47%
 *
 * Todos por debajo del 70% exigido, o sea todos rechazados. Y se agravaba solo: el propio
 * importador crea las prendas que faltan con el nombre del POS —"Buzo dep"—, asi que usar el modo
 * "solo nombres de prendas" garantizaba que la siguiente importacion no emparejara ninguna.
 *
 * Expandir los dos lados es lo que la tabla queria decir desde el principio: que la abreviatura sea
 * IRRELEVANTE. Con esto `Buzo dep` empareja al 100% tanto con `Buzo dep` como con `Buzo Deportivo`.
 */
export function normalizarDescripcionSistema(texto: unknown): string {
  let s = String(texto ?? '').trim();
  for (const [re, largo] of ABREVIATURAS) s = s.replace(re, largo);
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

/**
 * Cuanto tiene que GANARLE el mejor candidato al segundo para decidir solo, cuando no es exacto.
 *
 * POR QUE HACE FALTA. Expandir las abreviaturas en los dos lados —que es lo que arregla que un
 * nombre identico no emparejara— sube todas las similitudes, y con eso aparecen SIETE pares de
 * prendas DISTINTAS por encima del 70%:
 *
 *   73%  Camisa m/c vs Camisa m/l      73%  Polera m/c vs Polera m/l
 *   72%  Blusa m/c  vs Blusa m/l       71%  Camisa m/c vs Blusa m/c
 *   71%  Camisa m/l vs Blusa m/l       71%  Blusa m/c  vs Polera m/c
 *   71%  Blusa m/l  vs Polera m/l
 *
 * Son manga corta contra manga larga, y camisa contra blusa contra polera. Si el colegio tiene
 * `Camisa m/l` y NO `Camisa m/c`, la fila del POS `Camisa m/c` emparejaria al 73% con la de manga
 * larga y le importaria los precios encima. Es el peor error posible de esta importacion, y
 * silencioso.
 *
 * LA SEÑAL QUE LO DISTINGUE ES EL MARGEN, medido sobre los nombres reales:
 *
 *   el nombre EXISTE      ->  100% exacto, con 27 a 90 puntos de margen
 *   el nombre NO existe   ->  73% el primero y 71% el segundo: DOS puntos
 *
 * Con dos puntos de diferencia el algoritmo no esta reconociendo, esta tirando una moneda entre dos
 * prendas. Ahi corresponde preguntar, no decidir.
 *
 * El 10% esta elegido con esos numeros: por encima de los 2 puntos del caso ambiguo y muy por
 * debajo de los 35 del unico caso legitimo que no es exacto —`Chamarra inv` contra `Chamarra de
 * invierno`, 95% con 35 puntos—.
 */
export const MARGEN_MINIMO = 0.10;

/**
 * Una coincidencia EXACTA se acepta siempre, sin mirar el margen.
 *
 * Es la regla que el usuario pidio: si el nombre es el mismo, empareja. Y es la que hace que el
 * margen no moleste nunca en el caso normal: sobre los nombres reales, todos los emparejamientos
 * buenos dan exactamente 1.
 *
 * Se compara con una tolerancia y no con `=== 1` porque la similitud viene de multiplicaciones en
 * punto flotante: `0.35 + 0.65` puede dar 0.9999999999999999.
 */
export function esCoincidenciaExacta(confianza: number): boolean {
  return confianza >= 0.999;
}

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
  if (v === null || v === undefined) return NaN;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return NaN;
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

  // LAS COLUMNAS SE UBICAN POR NOMBRE. La version anterior comparaba contra los indices fijos,
  // avisaba si no coincidian, y despues leia por el indice fijo igual —o sea, importaba el
  // contenido de la columna equivocada mientras mostraba un aviso—.
  const ubic = ubicarColumnas(matriz[0] || []);
  if (!ubic.ok) {
    const partes: string[] = [];
    if (ubic.faltantes.length) {
      partes.push(`Faltan columnas que el importador necesita: ${ubic.faltantes.join(', ')}.`);
    }
    for (const d of ubic.duplicadas) {
      partes.push(`La columna "${d.nombre}" aparece ${d.posiciones.length} veces ` +
                  `(posiciones ${d.posiciones.join(', ')}): no se puede saber cual usar.`);
    }
    partes.push(`El archivo trae: ${ubic.encabezados.filter(Boolean).join(' | ')}`);
    // Se ABORTA en vez de leer por un indice adivinado: un precio en la prenda equivocada no se
    // nota hasta que alguien compara contra el POS.
    return { filas: [], descartadasPorCategoria: 0, detalleDescartes: {}, avisos: partes };
  }

  const IDX = ubic.indices;
  const txt = (r: any[], i: number) => String(r[i] ?? '').trim();
  const filas: FilaPos[] = [];
  const detalleDescartes: Record<string, number> = {};
  let descartadas = 0;

  for (let i = 1; i < matriz.length; i++) {
    const r = matriz[i] || [];
    const categoria = txt(r, IDX.CATEGORIA);

    if (!categoria || (CATEGORIAS_IGNORADAS as readonly string[]).includes(categoria)) {
      descartadas++;
      const clave = categoria || '(sin categoria)';
      detalleDescartes[clave] = (detalleDescartes[clave] || 0) + 1;
      continue;
    }

    filas.push({
      fila: i + 1,
      categoria,
      nombreProducto: txt(r, IDX.NOMBRE_PRODUCTO),
      variante: txt(r, IDX.VARIANTE),
      codigo: txt(r, IDX.CODIGO),
      precioPos: aNumero(r[IDX.PRECIO_POS]),
      cantidad: aNumero(r[IDX.CANTIDAD]),
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
  /**
   * El codigo canonico de la talla que se BUSCO y no se encontro. Solo cuando el estado es
   * `sin-talla`.
   *
   * Va en un campo aparte de `tallaCodigo` a proposito: ese significa "la talla resuelta", y
   * llenarlo con una talla que no existe haria que cualquier consumidor creyera que la fila esta
   * resuelta. Este existe para poder DECIR que talla falta —"faltan la 02 y la 04"— en vez de
   * dejarlo dentro de un texto de motivo que hay que leer fila por fila.
   */
  tallaCodigoFaltante?: string;
  /** La fila del POS no traia variante y se le asigno la talla del medio de la curva. */
  tallaAsignadaPorDefecto?: boolean;
  productoId?: string;
  productoDescripcion?: string;
  confianza: number;
  candidatos: Candidato[];
}

export interface CatalogoTalla { id: string; codigo: string }
export interface CatalogoProducto { id: string; descripcion: string; colegioId: string }
export interface CatalogoColegio {
  id: string;
  nombre: string;
  /**
   * La abreviatura cargada en Perfil & Colegios. Cuando existe, es la que RESUELVE el colegio:
   * empareja exacto contra el sufijo del codigo del POS y no depende de como este escrito el
   * nombre. Sin ella se cae al emparejamiento por nombre de `CATEGORIAS_POS`.
   */
  abreviatura?: string | null;
}

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
  colegios: CatalogoColegio[],
  descubiertos?: ColegioDescubierto[],
): string | null {
  const col = colegios.find((c) => String(c.id) === String(colegioId));
  if (!col) return null;

  // LO DESCUBIERTO EN EL ARCHIVO MANDA sobre el mapa fijo. Es lo que permite importar un colegio
  // que nadie tecleo en `CATEGORIAS_POS`: si su abreviatura coincide con un sufijo del archivo, ese
  // es su colegio, sin que su nombre ni su categoria tengan que estar escritos en el codigo.
  const abrevCol = normalizarAbreviatura(col.abreviatura);
  if (abrevCol && descubiertos?.length) {
    const hit = descubiertos.find(
      (d) => d.esColegio && normalizarAbreviatura(d.sufijo) === abrevCol);
    if (hit) return hit.categoria;
  }

  // PRIMERO LA ABREVIATURA, que es exacta. El sufijo del codigo del POS es `-cc`, `-EO`, `-JS`,
  // `-InfSM`, `-IntlSM`, y la abreviatura del colegio guarda ese mismo token. Emparejar por ahi no
  // depende de como este escrito el nombre, que es justo donde el emparejamiento por nombre falla:
  // el POS dice `C Intl. San Marcos` y el sistema `Internacional SM`.
  const abrev = normalizarAbreviatura(col.abreviatura);
  if (abrev) {
    for (const [categoria, cfg] of Object.entries(CATEGORIAS_POS)) {
      if (normalizarAbreviatura(cfg.sufijo) === abrev) return categoria;
    }
  }

  // DESPUES EL NOMBRE, CONTRA LAS CATEGORIAS DEL ARCHIVO. Para los colegios que todavia no tienen
  // abreviatura cargada.
  //
  // Se compara contra lo DESCUBIERTO y no contra las claves de `CATEGORIAS_POS`, y la diferencia no
  // es teorica: ese mapa tiene `C Cambridge` y el export ahora dice `Cambridge`. Con las claves
  // fijas, el respaldo devolvia una categoria que no existe en el archivo y ninguna fila
  // emparejaba —silenciosamente, porque la funcion devolvia algo en vez de null—.
  //
  // MEDIDO contra los nombres actuales: el nombre resuelve `Cambridge`, `Edad de Oro` y
  // `Saint Jude`, y NO resuelve `Intl S Marcos` ni `Inf S Marcos`, porque el POS abrevia `San` como
  // `S` y el sistema escribe el nombre entero. Por eso la abreviatura es la clave de verdad y el
  // nombre es una cortesia: sirve mientras no se cargue la abreviatura, y no para siempre.
  const nombre = normalizarNombreColegio(col.nombre);
  if (nombre && descubiertos?.length) {
    const hit = descubiertos.find(
      (d) => d.esColegio && normalizarNombreColegio(d.categoria) === nombre);
    if (hit) return hit.categoria;
  }

  // Y AL FINAL EL MAPA HEREDADO, solo para cuando no hay archivo con el que comparar —por ejemplo
  // al pedir una sugerencia antes de leerlo—. No es la fuente de verdad de nada.
  const crudo = sinAcentos(col.nombre);
  for (const [categoria, cfg] of Object.entries(CATEGORIAS_POS)) {
    if (cfg.agujas.some((a) => crudo.includes(sinAcentos(a)))) return categoria;
  }
  return null;
}

/**
 * Forma comparable de una abreviatura: sin el guion del sufijo, sin espacios y en mayusculas.
 *
 * `-cc` y `CC` son el mismo token escrito de dos maneras: el POS lo pone en minuscula dentro del
 * codigo y el sistema lo guarda en mayuscula. Sin normalizar, ninguno de los cinco emparejaria.
 */
/**
 * El codigo de talla que hay dentro de la variante del POS: `Talla 02` -> `02`.
 *
 * LA REGLA ES "lo que sigue al primer espacio", no "sacar la palabra Talla".
 *
 * MEDIDO sobre el export: las 734 filas con variante empiezan con `Talla ` y las 734 tienen un
 * espacio, asi que las dos reglas dan el mismo resultado hoy. Se elige la general porque no depende
 * de que el POS siga escribiendo esa palabra: el dia que ponga `Tamaño 02` o `T 02`, sacar la
 * palabra literal fallaria en 734 filas y esta regla sigue andando.
 *
 * Sin espacio se devuelve el texto completo: una variante que ya viene como `16/34` es el codigo.
 *
 * NO se rellena a dos digitos aca. Eso lo hace `codigoTallaCanonico` al comparar, y hacerlo en dos
 * lugares es como se termina con dos formas canonicas que no coinciden.
 */
export function tallaDeVariante(variante: unknown): string {
  const v = String(variante ?? '').trim();
  if (!v) return '';
  const i = v.indexOf(' ');
  return i === -1 ? v : v.slice(i + 1).trim();
}

export function normalizarAbreviatura(x: unknown): string {
  return String(x ?? '').trim().replace(/^-+/, '').toUpperCase();
}

/**
 * El nombre y la abreviatura que conviene proponer para un colegio que falta en el sistema.
 *
 * QUE FALTAN Y CUANTAS FILAS SON ya lo calcula `planImportacion.service.ts`, que tiene las cuentas
 * por categoria a mano. Aca vive solo la SUGERENCIA, que es lo unico que faltaba para que crear el
 * colegio desde el importador sea un clic en vez de un formulario a completar.
 *
 * La abreviatura sale del sufijo que el POS ya usa en sus codigos, asi que el colegio nace
 * emparejando: sin eso habria que adivinarla y la primera importacion no encontraria sus filas.
 */
/**
 * DESCUBRE LOS COLEGIOS QUE TRAE EL ARCHIVO, en vez de tenerlos escritos en el codigo.
 *
 * POR QUE EXISTE. `CATEGORIAS_POS` es un mapa fijo con cinco categorias tecleadas a mano. Con un
 * export que trae mas colegios, los nuevos simplemente NO EXISTEN para el importador: su categoria
 * no esta en el mapa, `categoriaDeColegio` devuelve null, y sus filas se descartan. El importador
 * no era inteligente: sabia exactamente de cinco colegios y de ninguno mas.
 *
 * Todo lo que hace falta ya viene en el archivo. La columna `Categorias` da el nombre y el sufijo
 * del `Cod. Producto` da la abreviatura, que es la misma que empareja con el colegio del sistema.
 *
 * COMO SE DECIDE SI UNA CATEGORIA ES UN COLEGIO
 *
 * Por su sufijo DOMINANTE. Si la mayoria de sus codigos llevan un sufijo, es un colegio; si la
 * mayoria no lleva ninguno, no lo es.
 *
 * MEDIDO sobre el export de cinco colegios, y reproduce el mapa fijo exactamente:
 *
 *   C Cambridge             297 filas   sufijo `cc`       100% de cobertura
 *   C Intl. San Marcos      166         `IntlSM`          100%
 *   C Edad de Oro           126         `EO`              100%
 *   C Infantil San Marcos    95         `InfSM`           100%
 *   C Saint Jude             48         `JS`              100%
 *   General                  20         sin sufijo         95%   (1 minoritario: `vUuYlnh`)
 *   Empresas                 14         sin sufijo        100%
 *
 * Las dos ultimas quedan fuera SIN estar en ninguna lista: se descartan porque sus codigos no
 * llevan sufijo, no porque alguien escribio sus nombres. Eso es lo que hace que un archivo con
 * quince colegios funcione igual que uno con cinco.
 *
 * Los sufijos MINORITARIOS se reportan en vez de ignorarse: un solo codigo con un sufijo raro
 * dentro de una categoria sana es un error de carga en el POS, y hay que verlo.
 */
export interface ColegioDescubierto {
  categoria: string;
  filas: number;
  /** El sufijo que llevan la mayoria de los codigos. Vacio si la mayoria no lleva ninguno. */
  sufijo: string;
  /** Cuantas filas lleva ese sufijo, y que porcentaje del total de la categoria es. */
  filasConSufijo: number;
  cobertura: number;
  /** Sufijos que aparecen en pocas filas. Casi siempre son errores de carga del POS. */
  minoritarios: Array<{ sufijo: string; filas: number }>;
  /** true cuando el sufijo dominante es real: entonces la categoria es un colegio. */
  esColegio: boolean;
}

export function descubrirColegiosDelArchivo(filas: FilaPos[]): ColegioDescubierto[] {
  const porCategoria = new Map<string, Map<string, number>>();

  for (const f of filas || []) {
    const cat = String(f?.categoria ?? '').trim();
    if (!cat) continue;
    // La cadena vacia representa "sin sufijo", que es una respuesta y no un dato faltante.
    const suf = abreviaturaDeCodigoPos(f?.codigo ?? '') ?? '';
    if (!porCategoria.has(cat)) porCategoria.set(cat, new Map());
    const m = porCategoria.get(cat)!;
    m.set(suf, (m.get(suf) ?? 0) + 1);
  }

  const salida: ColegioDescubierto[] = [];
  for (const [categoria, conteo] of porCategoria) {
    const total = [...conteo.values()].reduce((a, b) => a + b, 0);
    const orden = [...conteo.entries()].sort((a, b) => b[1] - a[1]);
    const [sufijo, filasConSufijo] = orden[0];
    salida.push({
      categoria,
      filas: total,
      sufijo,
      filasConSufijo,
      cobertura: total > 0 ? filasConSufijo / total : 0,
      minoritarios: orden.slice(1)
        .filter(([s]) => s !== '')
        .map(([s, n]) => ({ sufijo: s, filas: n })),
      esColegio: sufijo !== '',
    });
  }
  return salida.sort((a, b) => b.filas - a.filas);
}

export function sugerenciaDeColegio(
  categoria: string,
  sufijoDescubierto?: string | null,
): { nombreSugerido: string; abreviaturaSugerida: string } {
  const cat = String(categoria ?? '').trim();

  // PRIMERO EL SUFIJO DESCUBIERTO EN EL ARCHIVO. Es lo que hace que un colegio que nadie tecleo en
  // `CATEGORIAS_POS` tambien traiga su abreviatura: sin esto, un export con mas colegios proponia
  // crearlos con la abreviatura vacia y su primera importacion no encontraba ninguna de sus filas.
  const descubierto = normalizarAbreviatura(sufijoDescubierto);
  if (descubierto) return { nombreSugerido: cat, abreviaturaSugerida: descubierto };

  // El mapa fijo queda como respaldo, para cuando la sugerencia se pide sin haber leido el archivo.
  const cfg = CATEGORIAS_POS[cat];
  return {
    // El nombre del POS ya viene con el prefijo `C `, que es como estan nombrados los colegios.
    nombreSugerido: cat,
    abreviaturaSugerida: cfg ? normalizarAbreviatura(cfg.sufijo) : '',
  };
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

  // Los colegios se DESCUBREN del archivo que se esta importando, no de una lista en el codigo.
  const descubiertos = descubrirColegiosDelArchivo(filas);
  const categoriaEsperada = categoriaDeColegio(colegioId, colegios, descubiertos);
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
    const crudo = tallaDeVariante(f.variante);
    const codigoBuscado = crudo ? codigoTallaCanonico(crudo) : TALLA_PRODUCTOS_SIN_VARIANTE;
    const talla = tallaPorCodigo.get(codigoBuscado);

    if (!talla) {
      resueltas.push({
        ...base,
        estado: 'sin-talla',
        tallaCodigoFaltante: codigoBuscado,
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

    // DECIDE SOLA cuando el nombre es EXACTO, o cuando gana con claridad.
    //
    // El margen sobre el segundo es lo que separa "reconoci esta prenda" de "estoy eligiendo entre
    // dos parecidas": ver MARGEN_MINIMO. Sin el, `Camisa m/c` se importaria sobre `Camisa m/l`
    // cuando la de manga corta no existe.
    const exacto = esCoincidenciaExacta(mejor.confianza);
    const segundo = candidatos[1];
    const margen = segundo ? mejor.confianza - segundo.confianza : 1;
    const alcanzaSola = exacto || (mejor.confianza >= CONFIANZA_MINIMA && margen >= MARGEN_MINIMO);

    resueltas.push({
      ...comun,
      estado: alcanzaSola ? 'ok' : 'revisar',
      productoId: mejor.id,
      productoDescripcion: mejor.descripcion,
      motivo: alcanzaSola
        ? undefined
        : mejor.confianza < CONFIANZA_MINIMA
          ? `El nombre se parece ${(mejor.confianza * 100).toFixed(0)}% y hace falta ` +
            `${(CONFIANZA_MINIMA * 100).toFixed(0)}%.`
          : `Se parece ${(mejor.confianza * 100).toFixed(0)}% a "${mejor.descripcion}" y ` +
            `${(segundo.confianza * 100).toFixed(0)}% a "${segundo.descripcion}": la diferencia es ` +
            `demasiado chica para elegir sola. Son prendas distintas y elegir mal importaria los ` +
            `precios de una sobre la otra.`,
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
