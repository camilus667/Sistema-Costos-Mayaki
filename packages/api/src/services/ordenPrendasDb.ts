/**
 * PUENTE ENTRE EL ORDEN Y LA BASE. Lo minimo que necesita una ruta para ordenar.
 *
 * POR QUE ESTA SEPARADO DE ordenPrendas.ts. Ese archivo es PURO: recibe filas y devuelve
 * filas ordenadas, sin conocer la base ni el schema. Eso es lo que permite probarlo con
 * veintiocho casos sin levantar un servidor ni sembrar nada. Meterle una consulta lo
 * convertiria en algo que hay que mockear para testear, y sus tests dejarian de ser
 * afirmaciones sobre el criterio para volverse afirmaciones sobre un mock.
 *
 * Y POR QUE EXISTE. Diez consultas necesitan las posiciones de los colegios. Escribir el
 * `select` diez veces es la misma trampa que este trabajo vino a cerrar: el dia que el
 * criterio necesite un campo mas —un `activo`, un `archivado`— habria que acordarse de
 * diez lugares. Aca es uno.
 */

import { colegios } from '../database/schema';
import { posicionesDeColegios, type CriterioOrden, type OpcionesOrden, ordenarPrendas, type PrendaOrdenable } from './ordenPrendas';

/** Lee los colegios y devuelve sus posiciones. Es todo lo que una ruta necesita para ordenar. */
export async function posicionesDesdeBase(db: any): Promise<Map<string, number>> {
  const filas = await db
    .select({
      id: colegios.id,
      nombre: colegios.nombre,
      orden: colegios.orden,
      creadoEn: colegios.creadoEn,
    })
    .from(colegios);
  return posicionesDeColegios(filas as any);
}

/**
 * Ordena prendas leyendo las posiciones de la base. El atajo de las nueve consultas que
 * solo quieren el orden por defecto y no ofrecen criterios alternativos.
 */
export async function ordenarPrendasDesdeBase<T extends PrendaOrdenable>(
  db: any,
  filas: T[],
  criterio: CriterioOrden = 'defecto',
  opciones: OpcionesOrden = {}
): Promise<T[]> {
  return ordenarPrendas(filas, criterio, await posicionesDesdeBase(db), opciones);
}

/** Nombre de cada colegio, para las filas separadoras y los rotulos. */
export async function nombresDeColegios(db: any): Promise<Map<string, string>> {
  const filas = await db.select({ id: colegios.id, nombre: colegios.nombre }).from(colegios);
  return new Map(filas.map((c: any) => [String(c.id), String(c.nombre)]));
}
