/**
 * LA REFERENCIA DE UNA PRENDA: `CC-01`.
 *
 * Es lo que se ve en la columna `Prod`, y reemplaza al numero de item, que era GLOBAL y por eso
 * ilegible: Cambridge ocupaba 1 a 27 e Internacional SM arrancaba en 28. Ese es exactamente el
 * `1, 28, 2, 3` que se veia en la matriz. Con la abreviatura del colegio adelante, cada colegio
 * numera desde 1 y se sabe de quien es de un vistazo.
 *
 * DOS DECISIONES QUE VALE EXPLICAR
 *
 * 1. EL NUMERO ES LA POSICION, no el valor crudo de `orden`.
 *    Hoy dan lo mismo: `producto.orden` es contiguo 1..N por colegio (medido: Cambridge 1-27,
 *    Internacional SM 1, sin duplicados ni ceros). Pero si se borra una prenda y queda
 *    `1, 2, 4, 5`, la posicion sigue dando `01, 02, 03, 04` mientras el valor crudo daria
 *    `01, 02, 04, 05`, con un hueco que nadie pidio. La posicion no puede tener huecos.
 *
 *    El costo de esto, dicho: la referencia CAMBIA si se reordenan las prendas. Es lo que se
 *    pidio —que coincida con el orden de "Prendas & Recetas"— y para las pantallas es lo
 *    correcto, porque siempre muestran lo actual. Donde importa es en un PDF archivado: dos
 *    reportes de fechas distintas pueden usar `CC-05` para prendas distintas.
 *
 * 2. LA ABREVIATURA TIENE QUE SER UNICA entre colegios.
 *    `Prod` es un identificador: si dos colegios abrevian igual, `CC-01` deja de identificar una
 *    sola prenda. Las abreviaturas que se escriben a mano pueden repetirse, y las derivadas de
 *    un nombre chocan facil —"Internacional SM" e "Infantil San Marcos" dan las dos ISM—. Por
 *    eso `asignarAbreviaturas` desempata con un sufijo numerico en vez de dejar pasar el choque.
 *
 * SIN DEPENDENCIAS. No toca la base ni Drizzle: entra data, sale data. El puente con la base
 * vive en `referenciaPrendaDb.ts`, igual que `ordenPrendas` / `ordenPrendasDb`.
 */

/** Palabras que no aportan a una abreviatura derivada de un nombre de colegio. */
const PALABRAS_VACIAS = new Set([
  'col', 'col.', 'colegio', 'c', 'c.', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'unidad',
  'educativa',
]);

export interface ColegioConAbreviatura {
  id: string;
  nombre: string;
  abreviatura?: string | null;
}

export interface PrendaOrdenable {
  id: string;
  colegioId?: string | null;
  orden?: number | null;
  itemNumero?: number | null;
}

/**
 * Deriva una abreviatura del NOMBRE, para cuando el colegio todavia no tiene una cargada.
 *
 * Es provisional a proposito: casi nunca va a coincidir con el sufijo que usa el POS, porque
 * ese sufijo es una convencion del POS y no se puede deducir de un nombre —de "Col. Cambridge"
 * no sale `cc` por ninguna regla razonable—. Su unico trabajo es que la columna `Prod` muestre
 * algo legible antes de que se cargue la abreviatura de verdad.
 *
 * Con dos o mas palabras utiles usa las iniciales ("C Edad de Oro" -> EO, que da la del POS de
 * casualidad); con una sola, las tres primeras letras ("Col. Cambridge" -> CAM).
 */
export function abreviaturaPorDefecto(nombre: string): string {
  const limpio = String(nombre || '').trim();
  if (!limpio) return 'XX';

  const palabras = limpio
    .split(/[\s.]+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .filter((p) => !PALABRAS_VACIAS.has(p.toLowerCase()));

  if (palabras.length === 0) {
    // El nombre era todo palabras vacias ("Colegio de la C"). Se cae al nombre crudo.
    const crudo = limpio.replace(/[^\p{L}\p{N}]/gu, '');
    return (crudo.slice(0, 3) || 'XX').toUpperCase();
  }
  if (palabras.length === 1) return palabras[0].slice(0, 3).toUpperCase();

  // Una palabra que YA viene toda en mayusculas es una sigla ("SM" por San Marcos) y se
  // conserva entera: quedarse con su primera letra pierde el dato. Asi "Internacional SM" da
  // ISM y no IS.
  return palabras
    .map((p) => (p.length >= 2 && p === p.toUpperCase() ? p : p[0]))
    .join('')
    .slice(0, 6)
    .toUpperCase();
}

/**
 * Resuelve la abreviatura de cada colegio, respetando la cargada y desempatando los choques.
 *
 * El desempate agrega un numero (`ISM`, `ISM2`) y se aplica SOLO al segundo en aparecer, para
 * que agregar un colegio nuevo no le cambie la abreviatura a uno que ya estaba —si renumerara
 * todo, cambiarian las referencias de prendas que no se tocaron—.
 *
 * Una abreviatura cargada a mano tambien puede chocar, asi que pasa por el mismo desempate: la
 * unicidad de `Prod` no puede depender de que nadie se equivoque al escribir.
 */
export function asignarAbreviaturas(colegios: ColegioConAbreviatura[]): Map<string, string> {
  const salida = new Map<string, string>();
  const usadas = new Set<string>();

  for (const col of colegios || []) {
    if (!col || col.id === undefined || col.id === null) continue;
    const propuesta = String(col.abreviatura || '').trim() || abreviaturaPorDefecto(col.nombre);
    const base = propuesta.toUpperCase();

    let final = base;
    let n = 2;
    while (usadas.has(final)) final = `${base}${n++}`;

    usadas.add(final);
    salida.set(String(col.id), final);
  }
  return salida;
}

/**
 * Arma la referencia. El numero va a DOS digitos como minimo, y crece si hace falta: con 120
 * prendas, `CC-120` es correcto y `CC-20` seria una mentira.
 */
export function formarReferencia(abreviatura: string, posicion: number): string {
  const abrev = String(abreviatura || '').trim().toUpperCase() || 'XX';
  const pos = Number(posicion);
  if (!Number.isFinite(pos) || pos < 1) return abrev;
  return `${abrev}-${String(Math.trunc(pos)).padStart(2, '0')}`;
}

/**
 * La referencia de cada prenda, por id.
 *
 * La posicion se calcula DENTRO de cada colegio, ordenando por `orden` y desempatando por
 * `itemNumero` —el mismo criterio que usa `ordenPrendas`, para que el numero que se ve coincida
 * con el orden en que salen las filas. Si no coincidieran, la columna `Prod` diria `03` en la
 * primera fila y seria peor que no tenerla.
 *
 * Una prenda sin colegio no se saltea: se agrupa bajo la clave vacia y recibe su referencia con
 * la abreviatura de reserva. Dejarla sin `Prod` la volveria invisible en una pantalla que
 * ordena por esa columna.
 */
export function asignarReferencias(
  colegios: ColegioConAbreviatura[],
  prendas: PrendaOrdenable[],
  abreviaturaSinColegio = 'SN',
): Map<string, string> {
  const abrevs = asignarAbreviaturas(colegios);

  const porColegio = new Map<string, PrendaOrdenable[]>();
  for (const p of prendas || []) {
    if (!p || p.id === undefined || p.id === null) continue;
    const clave = p.colegioId === undefined || p.colegioId === null ? '' : String(p.colegioId);
    if (!porColegio.has(clave)) porColegio.set(clave, []);
    porColegio.get(clave)!.push(p);
  }

  const salida = new Map<string, string>();
  for (const [colegioId, lista] of porColegio) {
    const ordenadas = [...lista].sort((a, b) => {
      const oa = a.orden ?? Number.MAX_SAFE_INTEGER;
      const ob = b.orden ?? Number.MAX_SAFE_INTEGER;
      if (oa !== ob) return oa - ob;
      return (a.itemNumero ?? 0) - (b.itemNumero ?? 0);
    });
    const abrev = abrevs.get(colegioId) || abreviaturaSinColegio;
    ordenadas.forEach((p, i) => salida.set(String(p.id), formarReferencia(abrev, i + 1)));
  }
  return salida;
}

/**
 * Saca la abreviatura de un codigo del POS: `001-cc` -> `cc`, `048-JS` -> `JS`.
 *
 * Devuelve null cuando el codigo no tiene sufijo, que es como vienen las 33 filas de `General`
 * y `Empresas` —servicios y categorias, no prendas—. Distinguir "sin sufijo" de "sufijo raro"
 * importa: lo primero es normal y se excluye, lo segundo es un error del POS que hay que
 * mostrar.
 *
 * Parte por el PRIMER guion: un codigo `001-cc-x` deja el sufijo `cc-x`, que no va a emparejar
 * con ningun colegio y por eso va a salir reportado en vez de caer en el colegio equivocado.
 */
export function abreviaturaDeCodigoPos(codigo: string): string | null {
  const limpio = String(codigo || '').trim();
  const i = limpio.indexOf('-');
  if (i === -1 || i === limpio.length - 1) return null;
  const suf = limpio.slice(i + 1).trim();
  return suf || null;
}

/**
 * Forma comparable de un nombre de colegio: sin espacios de sobra, sin mayusculas, sin acentos
 * y sin el prefijo `C` / `Col.` / `Colegio`.
 *
 * Es la que empareja la CATEGORIA del POS con el colegio del sistema, y cada normalizacion sale
 * de algo medido en el export, no de precaucion generica:
 *
 *   trim        `C Saint Jude ` viene con un espacio al final. Un emparejamiento exacto
 *               perderia sus 48 filas.
 *   prefijo     el POS escribe `C Cambridge` y el sistema `Col. Cambridge`.
 *   acentos     una tilde de diferencia mandaria 95 filas al reporte de "sin colegio" por nada.
 *   espacios    dos espacios seguidos entre palabras no son una diferencia real.
 */
export function normalizarNombreColegio(nombre: string): string {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*(colegio|col\.?|c\.?)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
