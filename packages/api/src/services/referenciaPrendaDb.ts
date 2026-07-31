/**
 * PUENTE ENTRE LA REFERENCIA Y LA BASE, con el mismo reparto que `ordenPrendas` /
 * `ordenPrendasDb`: la logica vive pura en `referenciaPrenda.ts` y aca solo se leen filas.
 *
 * POR QUE LA REFERENCIA SE CALCULA CON TODAS LAS PRENDAS Y NO CON LAS DE LA PAGINA.
 *
 * `CC-03` significa "la tercera prenda de Cambridge". Si la posicion se contara sobre las filas
 * que la consulta devuelve, en la pagina 2 la primera fila seria `CC-01` otra vez, y la
 * referencia pasaria a significar "la primera de esta pagina", que no identifica nada. Lo mismo
 * pasaria al filtrar por un colegio o al ordenar por precio.
 *
 * Por eso se leen SIEMPRE todas las prendas para numerar, y despues se busca la referencia de
 * cada fila mostrada. Son cientos de filas de dos columnas contra una base en memoria; el costo
 * es despreciable frente a tener una columna que miente.
 */

import { colegios, productos } from '../database/schema';
import { asignarReferencias, asignarAbreviaturas, normalizarNombreColegio } from './referenciaPrenda';

export { normalizarNombreColegio };

/**
 * La referencia (`CC-01`) de cada prenda, por id de prenda.
 *
 * Lee todas las prendas a proposito: ver el comentario de arriba.
 */
export async function referenciasDesdeBase(db: any): Promise<Map<string, string>> {
  const [cols, prendas] = await Promise.all([
    db.select({ id: colegios.id, nombre: colegios.nombre, abreviatura: colegios.abreviatura })
      .from(colegios),
    db.select({
      id: productos.id,
      colegioId: productos.colegioId,
      orden: productos.orden,
      itemNumero: productos.itemNumero,
    }).from(productos),
  ]);
  return asignarReferencias(cols as any, prendas as any);
}

/** La abreviatura resuelta de cada colegio, ya desempatada. */
export async function abreviaturasDesdeBase(db: any): Promise<Map<string, string>> {
  const cols = await db
    .select({ id: colegios.id, nombre: colegios.nombre, abreviatura: colegios.abreviatura })
    .from(colegios);
  return asignarAbreviaturas(cols as any);
}

/**
 * El colegio que corresponde a una abreviatura del POS, para el importador.
 *
 * El emparejamiento es SIN distinguir mayusculas y CON trim, por dos razones medidas: el POS
 * escribe `cc` en minuscula mientras la abreviatura del sistema se guarda en mayuscula, y la
 * categoria `C Saint Jude ` viene con un espacio al final —un emparejamiento exacto perderia
 * sus 48 filas—.
 */
export async function colegioPorAbreviatura(db: any): Promise<Map<string, string>> {
  const abrevs = await abreviaturasDesdeBase(db);
  const salida = new Map<string, string>();
  for (const [colegioId, abrev] of abrevs) {
    salida.set(String(abrev).trim().toUpperCase(), colegioId);
  }
  return salida;
}

/**
 * El colegio que corresponde a un nombre de categoria del POS.
 *
 * Es la SEGUNDA señal, independiente de la abreviatura. Se normaliza igual —trim y sin
 * mayusculas— y ademas se saca el prefijo `C ` / `Col. ` para que `C Cambridge` del POS
 * empareje con `Col. Cambridge` del sistema.
 */
export async function colegioPorNombreCategoria(db: any): Promise<Map<string, string>> {
  const cols = await db.select({ id: colegios.id, nombre: colegios.nombre }).from(colegios);
  const salida = new Map<string, string>();
  for (const c of cols) {
    salida.set(normalizarNombreColegio(c.nombre), String(c.id));
  }
  return salida;
}

/**
 * Agrega el campo `prod` —la referencia `CC-01`— a una lista de filas por prenda.
 *
 * EXISTE PARA NO REPETIRSE EN SEIS ENDPOINTS. Peso de materia prima, precios de adquisicion,
 * matriz de accesorios, mano de obra, factor de complejidad y desglose inteligente devuelven
 * todos filas por prenda, y cada uno tenia que aprender por separado a traer la referencia. Sin
 * esto, agregar un endpoint nuevo significa acordarse de un septimo lugar —y olvidarse es
 * exactamente lo que hizo que "Adquisicion" y "Factor de Complejidad" mostraran el numero viejo—.
 *
 * La clave de la prenda se lee de `productoId` o de `id`: cinco de las seis usan `productoId`,
 * `fijos-x-prenda` usa `id`. Aceptar las dos formas evita tocar el shape de las respuestas, que
 * es lo que la pantalla ya consume.
 */
export async function agregarReferencias<T extends Record<string, any>>(
  db: any,
  filas: T[],
): Promise<T[]> {
  if (!Array.isArray(filas) || filas.length === 0) return filas;
  const refs = await referenciasDesdeBase(db);
  return filas.map((f) => ({
    ...f,
    prod: refs.get(String(f?.productoId ?? f?.id ?? '')) ?? null,
  }));
}
