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

/**
 * La forma canonica de un codigo tecleado a mano, o `null` si no hay codigo.
 *
 * SE RECORTA Y NADA MAS. No se cambia la caja, y eso es una decision medida: en el export del POS
 * conviven `001-cc` en minuscula y `619-JS` en mayuscula. Forzar mayusculas —o minusculas— haria que
 * el codigo guardado dejara de ser identico al del POS, y el BUSCARV contra el export no
 * encontraria nada. El unico trabajo legitimo aca es sacar los espacios, que son invisibles en
 * pantalla y si rompen un emparejamiento.
 *
 * VACIO SIGNIFICA BORRAR. Devolver la cadena vacia dejaria una fila con codigo `''`, que no es lo
 * mismo que sin codigo: el indice unico parcial solo excluye los NULL, asi que dos filas vacias
 * chocarian entre si. Y las pantallas leen con `?? null`, que no atrapa la cadena vacia.
 */
export function normalizarCodigoPos(entrada: unknown): string | null {
  if (entrada === null || entrada === undefined) return null;
  const limpio = String(entrada).trim();
  return limpio === '' ? null : limpio;
}

/** Una fila que ya tiene un codigo, para poder decir CUAL choca. */
export interface DuenoDeCodigo {
  productoId: string;
  tallaId: string;
  precioId?: string | null;
}

/**
 * Quien ya tiene ese codigo, si alguien lo tiene.
 *
 * POR QUE NO SE DEJA QUE FALLE EL INDICE. La base tiene un indice unico parcial y cumple su
 * trabajo, pero su error es `UNIQUE constraint failed: precio_venta.codigo_externo`: dice que hay
 * un choque y NO dice contra que. Con 766 combinaciones, "esta repetido" sin decir donde manda a
 * buscar a mano. Esta funcion existe para poder responder "ya lo tiene la prenda X en la talla Y".
 *
 * La MISMA fila no cuenta como choque: reescribir un codigo con el valor que ya tenia tiene que
 * poder hacerse, y guardar sin cambiar nada es lo mas comun al corregir a mano.
 */
export function buscarDuenoDeCodigo(
  codigo: string,
  existentes: Array<{ productoId: string; tallaId: string; precioId?: string | null; codigo: string }>,
  excluir?: { productoId?: string | null; tallaId?: string | null },
): DuenoDeCodigo | null {
  for (const e of existentes) {
    if (e.codigo !== codigo) continue;
    const esLaMisma =
      excluir !== undefined &&
      String(e.productoId) === String(excluir.productoId ?? '') &&
      String(e.tallaId) === String(excluir.tallaId ?? '');
    if (esLaMisma) continue;
    return { productoId: e.productoId, tallaId: e.tallaId, precioId: e.precioId ?? null };
  }
  return null;
}
