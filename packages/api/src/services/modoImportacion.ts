/**
 * QUE SE IMPORTA DEL POS. Un modo elegido, no una combinacion de casillas.
 *
 * POR QUE EXISTE. El importador escribia el precio SIEMPRE, y lo unico opcional eran dos casillas
 * escondidas en el ultimo paso: "traer tambien el inventario" y "crear las prendas que faltan". Con
 * eso no habia forma de traer SOLO el inventario ni SOLO los nombres de las prendas, y la pantalla
 * anunciaba "trae precios y codigos" como un hecho fijo.
 *
 * DOS CASILLAS NO SON CUATRO MODOS. Con banderas independientes, "solo inventario" se escribiria
 * como "inventario si, precios... " y no hay casilla para apagar el precio, porque el precio no era
 * opcional. Un modo unico y explicito hace imposible el estado invalido, y ademas le permite a la
 * pantalla decir de antemano que va a pasar: con `inventario` las tarjetas de "precios que cambian"
 * no significan nada y no se muestran.
 *
 * EL CODIGO DEL POS VIAJA CON EL PRECIO y no tiene modo propio. Vive en `precio_venta`, en la misma
 * fila: no se puede escribir un codigo sin escribir su precio. Un modo "solo codigos" seria una
 * promesa que la base no puede cumplir. Para corregir un codigo suelto esta la celda editable de
 * Inventario Real.
 */

export type ModoImportacion =
  /** Precio de venta y codigo del POS. No toca el inventario. */
  | 'precios'
  /** Cantidades de inventario. No toca precios ni codigos. */
  | 'inventario'
  /** Precio, codigo y cantidades. */
  | 'precios-inventario'
  /** Solo da de alta las prendas que faltan, vacias. No escribe precios ni cantidades. */
  | 'prendas';

export const MODOS: ModoImportacion[] = ['precios', 'inventario', 'precios-inventario', 'prendas'];

/** Que escribe efectivamente un modo. Es lo que consulta el ejecutor antes de cada escritura. */
export interface EfectosDelModo {
  escribePrecios: boolean;
  escribeInventario: boolean;
  /**
   * Si el modo IMPLICA crear las prendas que faltan.
   *
   * Solo `prendas` lo implica: es todo lo que ese modo hace, asi que pedirlo y encima tener que
   * marcar una casilla seria pedir lo mismo dos veces. En los otros tres el alta sigue siendo una
   * decision aparte, porque importar precios sobre las prendas que ya existen es un caso legitimo
   * y frecuente.
   */
  creaPrendasSiempre: boolean;
}

export function efectosDelModo(modo: ModoImportacion): EfectosDelModo {
  switch (modo) {
    case 'precios':
      return { escribePrecios: true, escribeInventario: false, creaPrendasSiempre: false };
    case 'inventario':
      return { escribePrecios: false, escribeInventario: true, creaPrendasSiempre: false };
    case 'precios-inventario':
      return { escribePrecios: true, escribeInventario: true, creaPrendasSiempre: false };
    case 'prendas':
      return { escribePrecios: false, escribeInventario: false, creaPrendasSiempre: true };
  }
}

/**
 * El modo que pidio quien llama, o el que se deduce de las banderas viejas.
 *
 * COMPATIBILIDAD A PROPOSITO. Antes de esto la peticion mandaba `inventario` y `crearPrendas`
 * sueltas. Rechazar una peticion sin `modo` rompería cualquier cliente ya escrito —y las pruebas
 * que ya existen— por un cambio que es puramente de presentacion. Sin `modo`, el comportamiento
 * historico se conserva exactamente: el precio se escribia siempre, asi que la deduccion nunca da
 * `inventario` ni `prendas` a solas.
 *
 * Un `modo` desconocido NO se ignora en silencio: se devuelve el error. Ignorarlo importaria con el
 * modo por defecto, que es la peor respuesta posible a "pedi algo que no entendes" cuando lo que
 * está en juego es qué filas se sobrescriben.
 */
export function resolverModo(opciones: any): { ok: true; modo: ModoImportacion } | { ok: false; error: string } {
  const pedido = opciones?.modo;

  if (pedido !== undefined && pedido !== null && String(pedido).trim() !== '') {
    const limpio = String(pedido).trim();
    if (!MODOS.includes(limpio as ModoImportacion)) {
      return {
        ok: false,
        error:
          `Modo de importacion desconocido: "${limpio}". Los validos son ${MODOS.join(', ')}. ` +
          `No se importa con el modo por defecto: elegir mal que se sobrescribe es peor que fallar.`,
      };
    }
    return { ok: true, modo: limpio as ModoImportacion };
  }

  // Sin `modo`: el comportamiento de siempre. El precio se escribia siempre.
  return { ok: true, modo: opciones?.inventario === true ? 'precios-inventario' : 'precios' };
}

/** Rotulo corto para la pantalla y los reportes. */
export function etiquetaModo(modo: ModoImportacion): string {
  switch (modo) {
    case 'precios': return 'Solo precios';
    case 'inventario': return 'Solo inventario';
    case 'precios-inventario': return 'Precios e inventario';
    case 'prendas': return 'Solo nombres de prendas';
  }
}

/**
 * Que va a pasar, en una frase, para mostrarla ANTES de importar.
 *
 * Se redacta por modo y no se arma pegando fragmentos: la version pegada daba frases como
 * "escribe precios y no escribe inventario y no crea prendas", que es cierta y no se entiende.
 */
export function descripcionModo(modo: ModoImportacion): string {
  switch (modo) {
    case 'precios':
      return 'Escribe el precio de venta y el codigo del POS de cada talla. El inventario no se toca.';
    case 'inventario':
      return 'Reemplaza las cantidades en stock con las del POS. Los precios y los codigos no se tocan.';
    case 'precios-inventario':
      return 'Escribe precio, codigo del POS y cantidades en stock. Es todo lo que trae el archivo.';
    case 'prendas':
      return 'Solo da de alta las prendas que el sistema todavia no tiene, vacias. No escribe ningun precio ni ninguna cantidad.';
  }
}

/**
 * La advertencia del modo, o `null`.
 *
 * Cada una responde a un dato medido, no a una precaucion generica. Se separan de la descripcion
 * porque son lo unico que hay que leer dos veces antes de confirmar.
 */
export function advertenciaModo(modo: ModoImportacion): string | null {
  switch (modo) {
    case 'precios':
    case 'precios-inventario':
      // MEDIDO sobre el export real: de 463 filas con colegio destino, 429 cambian el precio y 126
      // cambian 40% o mas, la mayor de 140 a 350.
      return 'El precio del archivo REEMPLAZA al del sistema y el anterior no queda guardado. ' +
             'El camino de vuelta es la instantanea, que por eso es obligatoria.';
    case 'inventario':
      return 'Las cantidades del archivo REEMPLAZAN el conteo actual. Si el inventario se lleva a ' +
             'mano aparte del POS, esto lo pisa, y a diferencia del precio no se nota mirando la pantalla.';
    case 'prendas':
      return 'Las prendas nacen con peso de tela y mano de obra en CERO, asi que su costo es casi ' +
             'cero y su margen se va a ver enorme y falso hasta que se carguen los costos.';
  }
}
