import { Decimal } from 'decimal.js';

/**
 * Motor de calculo del costo unitario.
 *
 * FORMULA IMPLEMENTADA (este comentario describe lo que el codigo hace de
 * verdad; el anterior no coincidia con la implementacion):
 *
 * LADO DEL COSTO — nunca lleva IVA.
 *   1. pesoConMerma      = peso limpio x (1 + merma/100)   [ver nota de merma]
 *   2. costoTela         = pesoConMerma x precioBsG
 *   3. costoBruto        = costoTela + costoAccesorios + costoManoObra
 *   4. costoFijosVar     = costoFijo x factorComplejidad
 *   5. costoIndirecto    = indirectoMensual / produccionMes  [ver nota]
 *   6. costoUnitarioNeto = costoBruto + costoFijosVar + costoIndirecto
 *
 * LADO DEL PRECIO — aca si entran los impuestos, y solo si el check esta activo.
 *   7. ingresoNetoConFactura = precioVenta x (1 - tasa)    [IVA por dentro]
 *   8. ingresoNetoSinFactura = precioVenta x (1 - descuentoSinFactura)
 *   9. utilidad<canal>       = ingresoNeto<canal> - costoUnitarioNeto
 *  10. margen<canal> %       = utilidad<canal> / ingresoNeto<canal> x 100
 *
 * FASE 3 — por que desaparecieron `costoAntesImpuestos`, `iva` y `costoTotal`.
 * El paso 7 anterior hacia `iva = costoAntesImp x tasa` y el 8 se lo sumaba al
 * costo. Eso es un error contable: en el regimen general boliviano el IVA de
 * compras es credito fiscal recuperable, asi que no es costo. Sumarlo
 * sobreestimaba el costo ~13% y subestimaba el margen, y podia llevar a rechazar
 * negocio rentable o a sobre-preciar. Ademas `costoAntesImpuestos` y
 * `costoUnitarioNeto` son el mismo numero, y el nombre viejo mentia: sugeria que
 * faltaba sumarle un impuesto cuando ya era el costo completo.
 *
 * El margen se mide contra el ingreso efectivamente cobrado, no contra el precio
 * de lista. Medirlo contra plata que nunca entra al bolsillo lo sobreestima.
 *
 * NOTA SOBRE LA MERMA — corrige un error de doble aplicacion.
 * En la base, `peso_mat_prima` guarda el peso de dos formas:
 *   peso_exacto_gramos = 350   (limpio, sin merma)
 *   peso_gramos        = 378   = 350 x 1.08, YA INCLUYE la merma
 *   peso_con_merma     = 378   (copia identica de peso_gramos)
 * Verificado sobre las 432 filas: donde peso_exacto_gramos > 0, la relacion
 * peso_gramos / peso_exacto_gramos es exactamente 1.08 en las 270 filas, y
 * peso_gramos == peso_con_merma en las 432.
 *
 * La version anterior recibia `pesoGramos` y hacia `pesoGramos * (1 + merma/100)`,
 * aplicando la merma por segunda vez e inflando el costo de tela un 8%.
 * Comprobado contra el Excel con el Saco talla 2: la hoja CostoBruto implica
 * 45.94 Bs de tela (378 x 0.1215) y el motor devolvia 49.60.
 *
 * Ahora los dos pesos son campos distintos y explicitos:
 *   pesoConMermaGramos  -> se usa tal cual, NO se le aplica merma
 *   pesoExactoGramos    -> el motor le aplica la merma
 * `pesoGramos` sigue aceptandose por compatibilidad y se interpreta como peso
 * que ya incluye la merma, que es lo que efectivamente guarda la base.
 *
 * NOTA SOBRE LOS INDIRECTOS.
 * El prorrateo por produccion del mes hace que la misma prenda cueste distinto
 * segun el mes en que se produjo: en temporada baja el indirecto unitario se
 * dispara. Se acepta `costoIndirectoUnitario` ya calculado para permitir un
 * denominador anual. Mientras se siga pasando indirectoMensual y produccionMes,
 * el comportamiento es el de antes.
 */

export interface CalculoInputs {
  /** Peso que YA incluye la merma. Se usa tal cual. */
  pesoConMermaGramos?: number;
  /** Peso limpio, sin merma. El motor le aplica la merma. */
  pesoExactoGramos?: number;
  /** Compatibilidad: se interpreta como peso que ya incluye la merma. */
  pesoGramos?: number;
  mermaPorcentaje?: number;

  /** Precio de la tela en Bs por gramo. Camino preferido. */
  precioBsG?: number;
  /** Alternativa: precio por unidad de compra + rendimiento en m/kg. */
  precioTelaUnitario?: number;
  rendimientoTela?: number;

  /**
   * Prendas adquiridas (semiterminadas o de reventa): reemplaza al costo de
   * tela. Si viene, no se calcula tela.
   */
  precioAdquisicion?: number;

  costoAccesorios?: number;
  costoManoObra?: number;
  factorComplejidad?: number;
  /** Fijos por prenda: planchado, colocacion de botones, operaciones extra. */
  costoFijo?: number;

  /** Indirecto unitario ya prorrateado. Tiene prioridad sobre el par mensual. */
  costoIndirectoUnitario?: number;
  costoIndirectoMensual?: number;
  produccionTotalMes?: number;

  precioVenta?: number | null;
  tasaIva?: number;

  // ------------------------------------------------------------------------
  // FASE 3 — impuestos. ADITIVO: nada de esto altera los campos existentes.
  // ------------------------------------------------------------------------

  /**
   * Si los impuestos se consideran del lado del PRECIO. Default false, decidido
   * con el usuario el 28-jul-2026.
   *
   * Nunca toca el lado del costo. `costoUnitarioNeto` se calcula siempre sin IVA,
   * porque el IVA de compras es credito fiscal recuperable en el regimen general
   * boliviano: meterlo al costo lo sobreestima ~13% y subestima el margen.
   */
  impuestosActivos?: boolean;

  /**
   * Descuento que se aplica cuando la venta va SIN factura. 0.10 en Cambridge.
   * Los precios de `precio_venta` son precios de lista CON factura.
   */
  descuentoSinFactura?: number;
}

export interface CalculoResultado {
  pesoConMerma: number;
  costoTela: number;
  costoAccesorios: number;
  costoManoObra: number;
  costoBruto: number;
  costoFijosVariable: number;
  costoIndirecto: number;
  /**
   * EL costo unitario. Sin IVA, y no hay otro.
   *
   * Reemplaza a los tres campos que habia antes — `costoAntesImpuestos`, `iva` y
   * `costoTotal` — que eran dos representaciones del mismo numero mas un error.
   * El IVA de compras es credito fiscal recuperable en el regimen general
   * boliviano, asi que no pertenece al costo: sumarlo lo sobreestimaba ~13% y
   * subestimaba el margen, lo que puede llevar a rechazar negocio rentable.
   *
   * El nombre viejo `costoAntesImpuestos` mentia: sugeria que faltaba sumarle un
   * impuesto cuando ya era el costo completo. Y tener `costoTotal` al lado, con el
   * 13% encima, era la misma patologia que la auditoria marco en la tabla de
   * telas: cuatro representaciones del mismo precio, cualquiera de ellas capaz de
   * quedar inconsistente.
   */
  costoUnitarioNeto: number;

  /**
   * Lo que queda en el bolsillo por canal, sobre el precio de lista.
   *
   * El IVA boliviano es "por dentro": el 13% se calcula sobre el precio bruto. Con
   * factura, de 100 Bs entran 100 y se deben 13 de debito fiscal, quedan 87. Sin
   * factura se descuenta el 10%, entran 90 y no se debe nada, quedan 90.
   *
   * A primera vista sin factura gana por 3 Bs. Pero eso ignora el credito fiscal:
   * la venta facturada permite usar el credito de las compras facturadas, que en
   * la venta sin factura queda inutilizable. El descuento del 10% esta calibrado
   * casi al punto de indiferencia, y que canal conviene depende de que proporcion
   * de las COMPRAS esta facturada — dato que el sistema todavia no guarda.
   *
   * Con `impuestosActivos` en false, los dos son el precio de lista sin ajustar.
   */
  ingresoNetoConFactura: number | null;
  ingresoNetoSinFactura: number | null;
  /** Ingreso neto menos el costo neto, por canal. Reemplaza a `utilidadNeta`. */
  utilidadConFactura: number | null;
  utilidadSinFactura: number | null;
  /** Sobre el ingreso cobrado, no sobre el precio de lista. */
  margenConFactura: number | null;
  margenSinFactura: number | null;
  /**
   * Condiciones que antes se resolvian devolviendo 0 en silencio. No se lanza
   * excepcion porque hoy la ausencia de peso significa dos cosas distintas en
   * los datos: "esta prenda no se ofrece en esta talla" (una corbata existe en
   * una sola talla, y eso es legitimo) y "falta cargar el peso". Romper seria
   * romper casos validos. Se expone para que la UI lo muestre en vez de mostrar
   * un costo que parece correcto.
   */
  diagnostico: {
    sinBaseDeTela: boolean;
    sinPrecioDeTela: boolean;
    origenCostoTela: 'precioBsG' | 'rendimiento' | 'adquisicion' | 'ninguno';
    advertencias: string[];
  };
}

const D = (v: number | undefined | null): Decimal => new Decimal(v ?? 0);

/** Se redondea SOLO al presentar, nunca en los pasos intermedios. */
const out = (d: Decimal): number => d.toDecimalPlaces(2).toNumber();

export function calcularCostoTotal(inputs: CalculoInputs): CalculoResultado {
  const advertencias: string[] = [];

  // La merma no lleva default hardcodeado en el motor: el default vive en el
  // schema de la base (merma_porcentaje DEFAULT 8) y en configuracion_sistema
  // (merma_porcentaje_estandar). Tenerlo en tres lugares los desincroniza.
  const mermaPct = D(inputs.mermaPorcentaje);
  if (inputs.mermaPorcentaje === undefined || inputs.mermaPorcentaje === null) {
    advertencias.push('No se recibio mermaPorcentaje; se calculo con merma 0.');
  }

  // ---------- Peso con merma ----------
  let pesoConMerma = new Decimal(0);
  let sinBaseDeTela = false;

  if (inputs.pesoConMermaGramos != null && inputs.pesoConMermaGramos > 0) {
    pesoConMerma = D(inputs.pesoConMermaGramos);
  } else if (inputs.pesoExactoGramos != null && inputs.pesoExactoGramos > 0) {
    pesoConMerma = D(inputs.pesoExactoGramos).times(mermaPct.div(100).plus(1));
  } else if (inputs.pesoGramos != null && inputs.pesoGramos > 0) {
    // Compatibilidad: la base guarda este valor CON la merma ya aplicada.
    pesoConMerma = D(inputs.pesoGramos);
  } else {
    sinBaseDeTela = true;
  }

  // ---------- Costo de tela o precio de adquisicion ----------
  let costoTela = new Decimal(0);
  let origenCostoTela: CalculoResultado['diagnostico']['origenCostoTela'] = 'ninguno';
  let sinPrecioDeTela = false;

  if (inputs.precioAdquisicion != null && inputs.precioAdquisicion > 0) {
    // Prenda comprada semiterminada o para reventa: no lleva tela propia.
    costoTela = D(inputs.precioAdquisicion);
    origenCostoTela = 'adquisicion';
    pesoConMerma = new Decimal(0);
    sinBaseDeTela = false;
  } else if (sinBaseDeTela) {
    advertencias.push(
      'Sin peso de tela y sin precio de adquisicion: el costo de material queda en 0. ' +
      'Puede ser que la prenda no se ofrezca en esta talla, o que falte cargar el peso.'
    );
  } else if (inputs.precioBsG != null && inputs.precioBsG > 0) {
    costoTela = pesoConMerma.times(D(inputs.precioBsG));
    origenCostoTela = 'precioBsG';
  } else if (
    inputs.precioTelaUnitario != null && inputs.precioTelaUnitario > 0 &&
    inputs.rendimientoTela != null && inputs.rendimientoTela > 0
  ) {
    // Conversion correcta: gramos -> kilos -> metros -> Bs.
    //   peso_g / 1000            = kg
    //   kg x rendimiento (m/kg)  = metros de tela
    //   metros x precio por metro = Bs
    //
    // La version anterior hacia `peso / (rendimiento * 1000)`, o sea DIVIDIA por
    // el rendimiento en vez de multiplicar, y subcosteaba la tela por un factor
    // de rendimiento al cuadrado. Comprobado con el Saco talla 2 y Casimir
    // Italiano (rendimiento 1.7362 m/kg, 70 Bs/metro):
    //   correcto: 378/1000 x 1.7362 x 70 = 45.94  <- coincide con el Excel
    //   anterior: 378 / (1.7362 x 1000) x 70 = 15.24
    // El Excel implica 45.94 (CostoBruto 169.464 - accesorios 23.52 - mano de
    // obra 100), y el camino de precioBsG da 45.93. Los tres coinciden ahora.
    costoTela = pesoConMerma
      .div(1000)
      .times(D(inputs.rendimientoTela))
      .times(D(inputs.precioTelaUnitario));
    origenCostoTela = 'rendimiento';
  } else {
    // Antes esto devolvia 0 sin ninguna senal: una prenda con peso cargado pero
    // sin tela vinculada se costeaba con tela gratis. Es el caso real del item
    // 27 Saco, que tiene 378 g en talla 2 y tela_id nulo.
    sinPrecioDeTela = true;
    advertencias.push(
      'La prenda tiene peso de tela pero no tiene precio de tela (falta vincular la tela). ' +
      'El costo de tela queda en 0 y el costo total esta subestimado.'
    );
  }

  const costoAccesorios = D(inputs.costoAccesorios);
  const costoManoObra = D(inputs.costoManoObra);
  const costoBruto = costoTela.plus(costoAccesorios).plus(costoManoObra);

  const factor = inputs.factorComplejidad != null && inputs.factorComplejidad > 0
    ? D(inputs.factorComplejidad)
    : new Decimal(1);
  const costoFijosVariable = D(inputs.costoFijo).times(factor);

  // ---------- Indirectos ----------
  let costoIndirecto = new Decimal(0);
  if (inputs.costoIndirectoUnitario != null && inputs.costoIndirectoUnitario > 0) {
    costoIndirecto = D(inputs.costoIndirectoUnitario);
  } else if (
    inputs.costoIndirectoMensual != null && inputs.costoIndirectoMensual > 0 &&
    inputs.produccionTotalMes != null && inputs.produccionTotalMes > 0
  ) {
    costoIndirecto = D(inputs.costoIndirectoMensual).div(D(inputs.produccionTotalMes));
    advertencias.push(
      'Indirectos prorrateados sobre la produccion del mes: la misma prenda cuesta ' +
      'distinto segun el mes en que se produjo. Conviene pasar costoIndirectoUnitario ' +
      'calculado sobre volumen anual.'
    );
  }

  const costoAntesImpuestos = costoBruto.plus(costoFijosVariable).plus(costoIndirecto);

  // La tasa se usa SOLO del lado del precio. El costo no lleva IVA.
  //
  // Sin default hardcodeado, por la misma razon que la merma. Antes esto hacia
  // `D(inputs.tasaIva ?? IVA_RATE ?? 0.13)`, o sea el default del IVA vivia en
  // TRES lugares a la vez: configuracion_sistema.tasa_iva, la constante IVA_RATE
  // del paquete shared, y el literal 0.13 de esta linea. Tres lugares que se
  // desincronizan, que es exactamente el problema que se elimino con la merma.
  // Ahora la unica fuente es configuracion_sistema, y si no llega, se avisa.
  const tasa = D(inputs.tasaIva);
  if (inputs.tasaIva == null && inputs.impuestosActivos === true) {
    advertencias.push(
      'Los impuestos estan activos pero no se recibio tasaIva; el ingreso con factura ' +
      'se calculo sin descontar el debito fiscal.'
    );
  }

  // El costo neto es la suma de sus componentes y nada mas. Antes aca se le sumaba
  // el 13% para producir `costoTotal`, que era el error contable de fondo.
  const costoUnitarioNeto = costoAntesImpuestos;

  let ingresoNetoConFactura: number | null = null;
  let ingresoNetoSinFactura: number | null = null;
  let utilidadConFactura: number | null = null;
  let utilidadSinFactura: number | null = null;
  let margenConFactura: number | null = null;
  let margenSinFactura: number | null = null;

  if (inputs.precioVenta != null && inputs.precioVenta > 0) {
    const pv = D(inputs.precioVenta);
    const impuestos = inputs.impuestosActivos === true;
    const descuento =
      inputs.descuentoSinFactura != null ? D(inputs.descuentoSinFactura) : new Decimal(0);

    // Con factura: el debito fiscal va POR DENTRO del precio, el 13% se calcula
    // sobre el bruto. De 100 quedan 87 Bs.
    //
    // Y SOLO SI EL CHECK ESTA PRENDIDO. `impuestos` se declaraba en la linea de
    // arriba y NO SE USABA en ningun lado: el IVA se descontaba siempre, incluso
    // con `impuestosActivos` en false. La constante estaba calculada, el comentario
    // de la interfaz prometia "con impuestosActivos en false, los dos son el precio
    // de lista sin ajustar", y el test de la Fase 3 lo exigia — pero el codigo hacia
    // otra cosa. main venia en 53 de 54 por esto.
    //
    // No es cosmetico, y explica parte del sintoma reportado por el usuario:
    // `impuestos_activos` NO existe como fila en configuracion_sistema, asi que
    // corre el default false y toda la aplicacion deberia mostrar 100 como ingreso
    // con factura. Mostraba 87. El canal CON factura aparecia mas barato que el
    // canal SIN factura, que es exactamente lo que se veia mal en pantalla.
    const netoCon = impuestos ? pv.times(new Decimal(1).minus(tasa)) : pv;

    // Sin factura: descuento comercial y sin debito fiscal. El descuento se aplica
    // aunque el check de impuestos este apagado, porque es un descuento de precio,
    // no un impuesto: si no facturas, resignas ese 10% de ingreso igual.
    const netoSin = pv.times(new Decimal(1).minus(descuento));

    // NOTA sobre el denominador: estos margenes se calculan sobre el ingreso
    // efectivamente cobrado, no sobre el precio de lista. El `margenPorcentaje`
    // que existia antes dividia por el precio bruto, y eso sobreestima la
    // rentabilidad: mide el margen contra plata que nunca entra al bolsillo.
    ingresoNetoConFactura = out(netoCon);
    ingresoNetoSinFactura = out(netoSin);
    utilidadConFactura = out(netoCon.minus(costoUnitarioNeto));
    utilidadSinFactura = out(netoSin.minus(costoUnitarioNeto));
    margenConFactura = netoCon.isZero()
      ? null
      : out(netoCon.minus(costoUnitarioNeto).div(netoCon).times(100));
    margenSinFactura = netoSin.isZero()
      ? null
      : out(netoSin.minus(costoUnitarioNeto).div(netoSin).times(100));
  }

  return {
    pesoConMerma: out(pesoConMerma),
    costoTela: out(costoTela),
    costoAccesorios: out(costoAccesorios),
    costoManoObra: out(costoManoObra),
    costoBruto: out(costoBruto),
    costoFijosVariable: out(costoFijosVariable),
    costoIndirecto: out(costoIndirecto),
    costoUnitarioNeto: out(costoUnitarioNeto),
    ingresoNetoConFactura,
    ingresoNetoSinFactura,
    utilidadConFactura,
    utilidadSinFactura,
    margenConFactura,
    margenSinFactura,
    diagnostico: {
      sinBaseDeTela,
      sinPrecioDeTela,
      origenCostoTela,
      advertencias,
    },
  };
}

/**
 * Suma el costo de los accesorios de una prenda.
 *
 * Las lineas vienen de `detalle_acc` (cantidadUso) unidas a `accesorio`
 * (costoUnitario). Cada linea se redondea a 2 decimales antes de sumar, para
 * que el subtotal cuadre exactamente con el desglose que se muestra linea por
 * linea en pantalla.
 */
export function calcularCostoAccesorios(
  detalleAccesorios: Array<{ cantidadUso: number; costoUnitario: number }>
): number {
  return out(
    detalleAccesorios.reduce(
      (total, acc) => total.plus(D(acc.cantidadUso).times(D(acc.costoUnitario)).toDecimalPlaces(2)),
      new Decimal(0)
    )
  );
}
