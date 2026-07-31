/**
 * EL CODIGO DEL POS DE CADA PRENDA+TALLA. UNA SOLA CASA.
 *
 * Vive en `precio_venta.codigo_externo`, y es el unico dato del sistema que el POS reconoce: es
 * con lo que se concilia stock y precios contra el punto de venta.
 *
 * POR QUE ES UN SERVICIO Y NO UNA CONSULTA MAS. La leia solo Inventario Real, con el mapa armado
 * adentro del handler. Ahora la necesitan tres pantallas —Inventario Real, Costeo Individual y
 * Costeo Multitalla— y este repositorio ya pago tres veces el precio de una regla copiada: la
 * formula de costeo en seis lugares, el orden de prendas en diez consultas con tres criterios, y
 * el filtro de tallas de la Fase 5. Tres copias de "como se arma la clave" es una desincronizacion
 * esperando fecha.
 *
 * LA CLAVE ES prenda+talla, NO la prenda. Medido en el export del POS: `Pantalón de Varon, CC`
 * tiene ocho codigos, `001-cc` a `008-cc`, uno por talla, y 70 de 102 productos tienen mas de uno.
 * Por eso el codigo no puede ser una columna por prenda en las matrices: ahi la fila es una prenda
 * y las columnas son tallas, asi que el codigo va en la celda o no va.
 */

import { preciosVenta } from '../database/schema';

/**
 * La clave con la que se busca un codigo. Existe para que nadie la vuelva a escribir a mano:
 * el orden de los dos ids y el separador tienen que ser identicos en quien guarda y quien busca.
 */
export function claveCodigoPos(
  productoId: unknown,
  tallaId: unknown,
): string {
  return `${String(productoId ?? '')}_${String(tallaId ?? '')}`;
}

/**
 * Todos los codigos del POS, por prenda+talla.
 *
 * Devuelve un Map y no una consulta por fila a proposito: quien la llama necesita el codigo de
 * decenas o cientos de combinaciones en la misma pantalla, y la base es sql.js EN MEMORIA.
 *
 * Las filas sin codigo NO entran al mapa. Asi `get` devuelve `undefined` y quien muestra puede
 * poner un guion, en vez de recibir una cadena vacia que se confunde con "el codigo es vacio".
 * Los codigos entran con la importacion del POS; antes de eso faltan, y eso es informacion.
 */
export async function codigosPosDesdeBase(db: any): Promise<Map<string, string>> {
  const filas = await db
    .select({
      productoId: preciosVenta.productoId,
      tallaId: preciosVenta.tallaId,
      codigoExterno: preciosVenta.codigoExterno,
    })
    .from(preciosVenta);

  const mapa = new Map<string, string>();
  for (const f of filas) {
    const codigo = f?.codigoExterno == null ? '' : String(f.codigoExterno).trim();
    if (codigo !== '') mapa.set(claveCodigoPos(f.productoId, f.tallaId), codigo);
  }
  return mapa;
}
