/**
 * MODO FISCAL DE LA PANTALLA: con factura o sin factura.
 *
 * EL DEFECTO QUE ORIGINA ESTE ARCHIVO. El interruptor "Modalidad F" del header
 * existia desde el commit "Mejornado CF SF", pero solo LLEGABA a un endpoint. En
 * el dashboard, `getModalidadFQueryParam()` se definia una vez y se usaba una
 * sola vez —en `/api/dashboard-resumen`— mientras que matriz-consolidada,
 * matriz-prenda, inventario/stock y el desglose recibian el parametro de
 * instantanea y NO el de modalidad. Y del lado del servidor la asimetria era
 * peor: un grep sobre routes/ por `modalidadF` daba CERO. La unica lectura vivia
 * en server.ts.
 *
 * O sea que el usuario tocaba un interruptor global y cinco de las seis pantallas
 * ni se enteraban. La que "funcionaba" —Costeo Multitalla— tampoco leia el
 * parametro: mostraba y ocultaba una seccion de la tabla del lado del navegador,
 * lo que se ve mucho pero no cambia un solo numero.
 *
 * Es el mismo patron que este proyecto ya corrigio dos veces: la formula de
 * costeo vivia en seis lugares y dos estaban mal (9d751ad), y el default del IVA
 * vivia en tres. La correccion no es agregar la lectura en cada router: es que
 * haya UN solo lugar que resuelva el modo y UN solo lugar que aplique el precio.
 *
 * ---
 *
 * QUE PRECIO SE MUESTRA EN CADA MODO. Decidido con el usuario el 30-jul-2026.
 *
 *   con factura    precio de lista          100,00
 *   sin factura    lista x (1 - descuento)   90,00
 *
 * `precio_venta` guarda precios CON factura —lo dice configService.ts— asi que el
 * precio de lista ES el precio con factura y no hay que ajustarlo. Sin factura se
 * resigna el descuento comercial configurado.
 *
 * ANTES HACIA LO CONTRARIO Y POR ESO NO SE NOTABA. server.ts mostraba
 * `lista x (1 - IVA)` = 87 con factura contra `lista x (1 - descuento)` = 90 sin
 * factura. Dos problemas de una vez: el precio CON factura salia MAS BAJO que sin
 * factura, al reves de lo esperado, y la diferencia entre modos era de 3,3% —
 * suficientemente chica como para que el usuario reportara que "no pasa nada" al
 * tocar el interruptor. El sintoma reportado y el error de signo eran la misma
 * cosa vista por dos lados.
 *
 * LO QUE NO CAMBIA, Y ES A PROPOSITO. El margen se sigue midiendo contra el
 * ingreso EFECTIVAMENTE COBRADO, que con factura es `lista x (1 - IVA)` porque el
 * debito fiscal se va. Esa matematica ya estaba bien en costoTotal.service.ts y no
 * se toca: mostrar 100 como precio no significa que entren 100 al bolsillo. Por eso
 * este modulo distingue DOS cantidades que antes estaban mezcladas en una sola
 * variable llamada `ingresoEfectivo`:
 *
 *   precioVentaEfectivo   lo que se le cobra al cliente     se MUESTRA
 *   ingresoNetoEfectivo   lo que queda despues de impuestos se usa para el MARGEN
 *
 * Con factura difieren exactamente en el debito fiscal. Sin factura son iguales.
 * Confundirlas es lo que producia una "Ganancia" que no cerraba con
 * "Venta - Inversion" sin que nada lo explicara.
 */

import type { SystemConfig } from './configService';

export type ModalidadFiscal = 'conFactura' | 'sinFactura';

/**
 * Lee el modo del query string. Sin parametro, SIN FACTURA.
 *
 * El default no es neutral y conviene decir por que: sin factura es la venta
 * directa, que es el caso habitual del negocio, y ademas es el lado conservador —
 * reporta el ingreso mas bajo de los dos. Coincide con el default `false` de
 * `modalidadFActual` en el dashboard y con `impuestosActivos` en false de
 * configuracion_sistema.
 *
 * Solo la cadena 'true' exacta activa el modo con factura, mismo criterio que
 * usa configService para `impuestos_activos`: cualquier valor raro cae del lado
 * conservador en vez de adivinar.
 */
export function leerModalidadFiscal(c: any): ModalidadFiscal {
  return c.req.query('modalidadF') === 'true' ? 'conFactura' : 'sinFactura';
}

/**
 * El descuento sin factura como FRACCION, venga como fraccion o como porcentaje.
 *
 * POR QUE HACE FALTA ESTA GUARDA. `tasaIva` tiene su `tasaIvaComoFraccion()`
 * desde la Fase 3, con un comentario que explica que pasar 13 donde se espera
 * 0,13 da 1300% de IVA. `descuentoSinFactura` NO tenia el equivalente: se leia
 * crudo de la base y se metia directo en `1 - descuento`.
 *
 * El agujero es real y esta a un clic. PUT /api/inputs/configuracion acepta
 * `descuentoSinFactura` y lo guarda con String() sin normalizar, asi que si
 * alguien escribe "10" pensando en 10%, el precio sin factura pasa a ser
 * `lista x (1 - 10)` = MENOS NUEVE VECES el precio. Un precio negativo, y encima
 * plausible de tipear.
 *
 * Hoy la fila no existe en configuracion_sistema —verificado contra la base real,
 * solo hay merma, absorcion, talla_defecto, tasa_iva y volumen— asi que corre el
 * default 0,1 de configService y el bug esta latente, no activo. Latente es peor
 * que activo: no lo ve nadie hasta que alguien toca la pantalla de configuracion.
 *
 * EL CRITERIO. Un descuento comercial mayor a 1 no puede ser una fraccion: nadie
 * regala mas del 100%. Asi que un valor > 1 se interpreta como porcentaje y se
 * divide por 100. El limite superior es 0,95: un descuento del 95% ya no es un
 * descuento, es un dato mal cargado, y prefiero avisar y usar el default antes que
 * valorizar un inventario entero a monedas.
 */
export function descuentoSinFacturaComoFraccion(
  sysConfig: Pick<SystemConfig, 'descuentoSinFactura'>,
  avisos?: string[]
): number {
  const bruto = Number(sysConfig?.descuentoSinFactura);

  if (!Number.isFinite(bruto) || bruto <= 0) {
    return 0.1;
  }

  const fraccion = bruto > 1 ? bruto / 100 : bruto;

  if (fraccion > 0.95) {
    avisos?.push(
      `El descuento sin factura configurado (${bruto}) da una fraccion de ${fraccion}, ` +
      'que dejaria el precio practicamente en cero. Se usa el default de 10%. ' +
      'Revisar configuracion_sistema.descuento_sin_factura.'
    );
    return 0.1;
  }

  return fraccion;
}

/**
 * Todo lo que hace falta para resolver precios en UNA respuesta.
 *
 * Existe para que los numeros de una misma pantalla no puedan salir de modos
 * distintos. Antes cada router repetia tres lineas —leer el modo, leer la tasa,
 * leer el descuento— y tres copias de la misma lectura es exactamente como el
 * default del IVA termino viviendo en tres lugares.
 */
export interface ContextoFiscal {
  modalidad: ModalidadFiscal;
  descuentoFraccion: number;
  tasaIvaFraccion: number;
  impuestosActivos: boolean;
}

/**
 * Arma el contexto a partir del request y del contexto de costeo.
 *
 * `ctx` es el que devuelven `costearLote` y `cargarContextoCosteo`: ya trae la
 * tasa de IVA como fraccion y la configuracion del sistema, asi que no hay que
 * volver a la base ni escribir defaults nuevos.
 */
export function construirContextoFiscal(
  c: any,
  ctx: { tasaIvaFraccion: number; sysConfig: Pick<SystemConfig, 'descuentoSinFactura' | 'impuestosActivos'> },
  avisos?: string[]
): ContextoFiscal {
  return {
    modalidad: leerModalidadFiscal(c),
    descuentoFraccion: descuentoSinFacturaComoFraccion(ctx.sysConfig, avisos),
    tasaIvaFraccion: ctx.tasaIvaFraccion > 0 ? ctx.tasaIvaFraccion : 0.13,
    impuestosActivos: ctx.sysConfig?.impuestosActivos === true,
  };
}

/**
 * El precio que se le cobra al cliente en este modo. Es el que se MUESTRA.
 *
 * Sin precio de lista devuelve 0 y no inventa nada: un precio faltante y un
 * precio de cero se veian igual, y esa confusion es la que hacia que el Resumen
 * mostrara "Venta Total Proyectada 8.160" con "Inversion Total 0,00" sin un solo
 * aviso (9d751ad).
 */
export function precioVentaEfectivo(
  precioLista: number | null | undefined,
  fiscal: ContextoFiscal
): number {
  const lista = Number(precioLista) || 0;
  if (lista <= 0) return 0;

  return fiscal.modalidad === 'conFactura' ? lista : lista * (1 - fiscal.descuentoFraccion);
}

/**
 * Lo que queda del precio despues del debito fiscal. Es el que se usa para el
 * MARGEN, y no coincide con el precio mostrado cuando hay factura Y los impuestos
 * estan activos.
 *
 * RESPETA `impuestosActivos`, igual que costoTotal.service.ts. Es la misma regla
 * en los dos lados a proposito: si el motor y las pantallas discrepan sobre si el
 * IVA se descuenta, el margen de Costeo Multitalla y el del Resumen dejan de
 * coincidir para la misma prenda y nada lo detecta.
 *
 * Con el check prendido el IVA va POR DENTRO: de 100 se van 13 y quedan 87.
 * Con el check apagado —que es el default y lo que hay hoy en la base— el ingreso
 * con factura ES el precio de lista.
 */
export function ingresoNetoEfectivo(
  precioLista: number | null | undefined,
  fiscal: ContextoFiscal
): number {
  const lista = Number(precioLista) || 0;
  if (lista <= 0) return 0;

  if (fiscal.modalidad === 'sinFactura') {
    return lista * (1 - fiscal.descuentoFraccion);
  }
  return fiscal.impuestosActivos ? lista * (1 - fiscal.tasaIvaFraccion) : lista;
}

/**
 * Las tres cantidades de una vez, que es como las consumen las pantallas.
 *
 * Devolver un objeto y no tres llamadas sueltas es deliberado: los tres numeros
 * tienen que salir del MISMO modo y del MISMO descuento. Tres llamadas separadas
 * es exactamente la forma en que una pantalla termina mostrando el precio de un
 * modo con el margen del otro.
 */
export function resolverPrecios(
  precioLista: number | null | undefined,
  fiscal: ContextoFiscal
): { precioLista: number; precioVenta: number; ingresoNeto: number; ivaDebito: number } {
  const lista = Number(precioLista) || 0;
  const precioVenta = precioVentaEfectivo(lista, fiscal);
  const ingresoNeto = ingresoNetoEfectivo(lista, fiscal);

  return {
    precioLista: lista,
    precioVenta,
    ingresoNeto,
    // Con factura e impuestos activos es el debito fiscal que se va. En cualquier
    // otro caso es 0: el descuento sin factura ya esta descontado del precio
    // cobrado, no es un impuesto posterior.
    ivaDebito: precioVenta - ingresoNeto,
  };
}

/** Etiqueta para las pantallas, para que se vea QUE precio se esta mostrando. */
export function etiquetaModalidad(modalidad: ModalidadFiscal): string {
  return modalidad === 'conFactura'
    ? 'Con Factura (precio de lista, IVA por dentro)'
    : 'Sin Factura (venta directa, con descuento)';
}
