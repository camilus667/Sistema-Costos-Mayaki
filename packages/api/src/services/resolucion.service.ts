/**
 * Resolucion de entidades por identificadores "de negocio", en un solo lugar.
 *
 * POR QUE EXISTE. Dos endpoints de calculo.ts resolvian la prenda por itemNumero con
 * `where(eq(itemNumero)).limit(1)` y sin colegio. itemNumero se numera POR COLEGIO
 * —viene de la fila del Excel de cada colegio— asi que con dos colegios cargados el
 * mismo numero identifica dos prendas y ese limit(1) sin ORDER BY elegia cualquiera.
 * Los dos endpoints ESCRIBEN: editar el precio de una prenda del colegio B le habria
 * cambiado el precio a la del colegio A, en silencio y devolviendo success.
 *
 * Se arreglo primero dentro de calculo.ts. Cuando el mismo lookup hizo falta en
 * inputs.ts para la matriz de accesorios, copiarlo habria sido exactamente el defecto
 * que este refactor viene eliminando: la formula de costeo estaba en cuatro lugares y
 * dos de las copias estaban mal. Una funcion con una sola casa no se desincroniza.
 */

import { and, eq, ne } from 'drizzle-orm';
import { productos, detalleAccesorio } from '../database/schema';

/**
 * Genera un id con el mismo formato que el default del schema
 * (`lower(hex(randomblob(16)))`): 32 caracteres hexadecimales.
 *
 * Se genera en JS y no en SQL porque las tablas se crean con DDL literal en
 * sqljs.ts, donde la columna `id` no lleva DEFAULT.
 */
export function nuevoIdHex(): string {
  const c: any = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export type PrendaResuelta = {
  prenda: any | null;
  estado: number;
  error: string | null;
};

/**
 * Resuelve la prenda a partir de su numero de item, exigiendo colegio si hace falta.
 *
 *  - con colegioId, filtra por el;
 *  - sin colegioId, si el numero identifica UNA sola prenda usa esa. Con un colegio
 *    cargado eso es identico al comportamiento anterior, byte por byte;
 *  - sin colegioId y con varias candidatas, RECHAZA con 409. Ambiguo es ambiguo, y
 *    frente a la duda entre errar y escribirle los datos a otro cliente, se erra.
 *
 * El limit(2) es deliberado: solo hace falta distinguir "una" de "mas de una".
 */
export async function resolverPrendaPorItem(
  db: any,
  itemNumero: number,
  colegioId?: string
): Promise<PrendaResuelta> {
  const cond = colegioId
    ? and(eq(productos.itemNumero, itemNumero), eq(productos.colegioId, colegioId))
    : eq(productos.itemNumero, itemNumero);

  const candidatas = await db.select().from(productos).where(cond).limit(2);

  if (candidatas.length === 0) {
    return {
      prenda: null,
      estado: 404,
      error: colegioId
        ? `No existe la prenda con item ${itemNumero} en el colegio ${colegioId}.`
        : `No existe la prenda con item ${itemNumero}.`,
    };
  }
  if (candidatas.length > 1) {
    return {
      prenda: null,
      estado: 409,
      error: `El item ${itemNumero} existe en mas de un colegio. Manda colegioId para indicar cual.`,
    };
  }
  return { prenda: candidatas[0], estado: 200, error: null };
}

/**
 * Usos de un insumo o una tela por prendas de OTROS colegios.
 *
 * POR QUE HACE FALTA. Volver un item exclusivo de un colegio cuando otro lo esta usando
 * deja ese uso HUERFANO de la peor forma posible: el motor de costeo resuelve por id y
 * no mira colegio, asi que sigue cobrando el insumo con normalidad, mientras el selector
 * de la pantalla deja de ofrecerlo. El dato queda vivo e invisible, que es exactamente
 * la clase de inconsistencia silenciosa que este refactor viene eliminando.
 *
 * Con esto, el endpoint puede rechazar el cambio y decir QUIEN lo esta usando, en vez de
 * dejar que el usuario descubra el problema tres meses despues cuando un costo no cuadre.
 */
export async function usosEnOtrosColegios(
  db: any,
  tipo: 'accesorio' | 'tela',
  itemId: string,
  colegioNuevo: string
): Promise<Array<{ colegioId: string; itemNumero: number; descripcion: string }>> {
  if (tipo === 'accesorio') {
    return await db
      .select({
        colegioId: productos.colegioId,
        itemNumero: productos.itemNumero,
        descripcion: productos.descripcion,
      })
      .from(detalleAccesorio)
      .innerJoin(productos, eq(detalleAccesorio.productoId, productos.id))
      .where(and(
        eq(detalleAccesorio.accesorioId, itemId),
        ne(productos.colegioId, colegioNuevo)
      ));
  }

  return await db
    .select({
      colegioId: productos.colegioId,
      itemNumero: productos.itemNumero,
      descripcion: productos.descripcion,
    })
    .from(productos)
    .where(and(eq(productos.telaId, itemId), ne(productos.colegioId, colegioNuevo)));
}
