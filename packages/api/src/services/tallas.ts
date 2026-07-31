/**
 * CODIGOS DE TALLA: una sola forma canonica, y un solo lugar que la define.
 *
 * LA FORMA CANONICA ES DE DOS DIGITOS. `2` se escribe `02`, `4` se escribe `04`.
 * Decidido con el usuario el 30-jul-2026, y no es cosmetico: es la forma que usa el
 * sistema POS del que se importan precios e inventario, y tener dos formas del mismo
 * codigo es exactamente lo que hacia que el emparejamiento del importador fallara en
 * 249 de 732 filas. Un codigo que se escribe de dos maneras no es una clave.
 *
 * POR QUE ESTE ARCHIVO EXISTE, Y ES LO MAS IMPORTANTE DE TODO EL CAMBIO.
 *
 * El renombre de `2` a `02` parece un UPDATE de una columna. No lo es: habia TRES
 * lugares con la lista de codigos escrita a mano, y ninguno se habria enterado.
 *
 *   routes/inputs.ts:782   const tGroup1 = allTallas.find(t => ['2','4','6','8','10'].includes(t.codigo))
 *   routes/inputs.ts:883   if (['2','4','6','8','10'].includes(code)) costoBs = grupo1
 *   scripts/seed.ts:321    if (['2','4','6','8','10'].includes(code)) costoBs = g1
 *
 * Los tres agrupan la MANO DE OBRA en tres bandas por tamaño de talla. Con los
 * codigos renombrados, `find` no encuentra ninguna talla del grupo 1, devuelve
 * undefined, y la pantalla cae al valor del Excel en vez del de la base. En el
 * camino de ESCRITURA es peor: la mano de obra de las tallas chicas se guardaria con
 * el costo del grupo 3, que es el de las tallas grandes. Sin error, sin aviso, con
 * status 200 — y la mano de obra es uno de los tres componentes del costo unitario.
 *
 * Es la tercera vez en este proyecto que un dato canonico vive en varios lugares: el
 * default del IVA vivia en tres, la formula de costeo en seis con dos mal. La
 * correccion no es actualizar las tres listas: es que haya UNA, y que compare
 * NORMALIZANDO, para que la agrupacion siga funcionando con `2` y con `02` y no
 * vuelva a depender de como se escriba el codigo.
 *
 * Y de paso el sembrado deja de imponer su estilo. `seed.ts` insertaba
 * `codigo: String(codigo)` tomado crudo del encabezado de CAMBRIDGE.xlsx, asi que la
 * forma de la clave la decidia una planilla. Normalizando al insertar, una base nueva
 * nace con la forma canonica sin importar como venga el archivo.
 */

/**
 * Lleva un codigo de talla a su forma canonica.
 *
 * Solo rellena los NUMERICOS PUROS: `2` -> `02`, `4` -> `04`. Los codigos
 * compuestos se dejan intactos —`16/34`, `36/XS`, `50/4XL`— porque su primer numero
 * ya viene de dos digitos y rellenarlos los corromperia.
 *
 * Es idempotente a proposito: aplicarla sobre `02` devuelve `02`. Asi la migracion se
 * puede correr dos veces sin daño, y el codigo que la use no necesita saber si la
 * base ya fue migrada.
 */
export function codigoTallaCanonico(codigo: unknown): string {
  const s = String(codigo ?? '').trim();
  if (!s) return '';
  return /^\d+$/.test(s) ? s.padStart(2, '0') : s;
}

/**
 * Las tres bandas de mano de obra, en forma canonica.
 *
 * Se conservan EXACTAMENTE los mismos miembros que tenian las tres listas escritas a
 * mano; lo unico que cambia es que ahora hay una sola copia y que la comparacion
 * normaliza. Cambiar quien pertenece a cada banda movería costos, y eso no es parte
 * de este trabajo.
 */
export const BANDAS_MANO_OBRA: readonly (readonly string[])[] = [
  ['02', '04', '06', '08', '10'],
  ['12', '14', '16/34', '36/XS', '38/S'],
  ['40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL'],
] as const;

/**
 * En que banda de mano de obra cae un codigo: 1, 2 o 3.
 *
 * Devuelve 3 para lo desconocido, que es el comportamiento que ya tenian los tres
 * lugares originales: su `else` final asignaba el grupo 3. Se preserva para no mover
 * ningun costo con este cambio.
 */
export function bandaManoObra(codigo: unknown): 1 | 2 | 3 {
  const c = codigoTallaCanonico(codigo);
  if (BANDAS_MANO_OBRA[0].includes(c)) return 1;
  if (BANDAS_MANO_OBRA[1].includes(c)) return 2;
  return 3;
}

/** ¿Este codigo pertenece a la banda indicada? Comparacion normalizada. */
export function esDeBanda(codigo: unknown, banda: 1 | 2 | 3): boolean {
  return bandaManoObra(codigo) === banda;
}

/**
 * TALLA DE LOS PRODUCTOS SIN VARIANTE.
 *
 * Doce productos del POS no tienen talla porque son genericos: Riñonera, Gorra,
 * Sombrero, Cinturon, Lanyard, Gorro, las dos corbatas, los dos de profesor y los dos
 * sacos a medida. Se les asigna la talla 14.
 *
 * Decidido con el usuario el 30-jul-2026, y su razon es la que vale: la 14 esta en el
 * medio de la curva, asi que el costo prorrateado que le toque a un cinturon no sale
 * ni del extremo barato ni del caro. Se descarto crear una talla UNICA para no
 * agregar una columna a las matrices.
 *
 * EL COSTO DE ESTA DECISION, dicho de frente: en las matrices esos productos van a
 * figurar bajo la columna 14 y solo ahi. No es la talla real —no la tienen— sino el
 * casillero donde viven su precio y su stock. Quien lea la matriz sin saberlo puede
 * leer "Cinturon talla 14" como un dato, y no lo es.
 */
export const TALLA_PRODUCTOS_SIN_VARIANTE = '14';
