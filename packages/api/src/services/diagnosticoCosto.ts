/**
 * DICE QUE LE FALTA A UNA PRENDA PARA QUE SU COSTO SEA REAL.
 *
 * PEDIDO DEL USUARIO: "la prenda nueva costea en cero, ok, pero quiero que en alguna tabla
 * esas prendas se noten visiblemente diferente a las que si obtienen un valor en el costo".
 *
 * Y NO ES HIPOTETICO: hay UNA prenda mal hoy. Pero llegar a ese numero costo corregirme, y la
 * correccion es la parte que vale la pena leer.
 *
 * MI PRIMERA MEDICION FUE INGENUA. Consulte `peso_gramos > 0` y `tela_id IS NOT NULL` y
 * concluí que habia dos prendas sin costo: `Chompa cuello en V` y `Chaleco cuello en V`, las
 * dos con 0 de 16 pesos y sin tela. Escribi eso en los comentarios y en los tests.
 *
 * ERA FALSO. Las dos son `modo_costeo = 'adquirido'`: prendas que el negocio COMPRA, con 14
 * filas de `precio_adquisicion` cada una. No llevan tela ni peso porque no se confeccionan, y
 * su costo sale del precio de compra. Marcarlas seria reportar como falta algo que su modo de
 * costeo no usa —que es exactamente la guarda que este archivo ya tenia, escrita para un caso
 * que crei hipotetico y que resulto ser el unico caso real de la base—.
 *
 * LO QUE SI ESTA MAL, medido con este servicio corriendo contra la base:
 *
 *   Internacional SM  item 28  Camisa Formal   14 de 16 tallas con peso, y 16 ofrecidas
 *                                              -> 2 tallas ofrecidas sin peso: "sin pesos"
 *
 * Y `Saco` (item 27) no tiene tela pero tampoco tiene un solo precio vigente: no se ofrece,
 * asi que no se marca. Tres prendas que a la consulta cruda le parecen problemas y que al
 * criterio correcto le parecen: dos bien y una mal.
 *
 * La leccion, y por eso queda escrita: `peso_gramos > 0` no es el criterio. El criterio es lo
 * que el motor de costeo REALMENTE usa, y eso incluye el modo de costeo, el peso exacto como
 * respaldo del peso con merma, y si la talla se ofrece.
 *
 * POR QUE DICE QUE FALTA Y NO SOLO "INCOMPLETA". Son tres causas con tres arreglos distintos:
 *
 *   sin tela        el costo de material es peso x precio del gramo. Sin tela ese factor no
 *                   existe, y cargar los pesos no arregla nada.
 *   sin pesos       la tela esta, pero no se sabe cuanto entra en la prenda.
 *   sin mano de obra el componente de confeccion es cero.
 *
 * Un cartel que solo dijera "incompleta" obliga a entrar a la prenda a averiguar cual de las
 * tres es. Decirlo en la celda ahorra ese viaje, y es la diferencia entre un aviso util y uno
 * que se aprende a ignorar.
 *
 * NO CONSULTA NADA. El motor de costeo ya reporta `origenPeso`, `telaVinculada` y
 * `tieneManoObra` en el meta de cada fila; esto solo agrega por prenda. Agregar una consulta
 * habria sido duplicar informacion que ya viaja.
 */

/** Lo que este diagnostico necesita de cada fila costeada. Es un subconjunto de MetaCosteo. */
export interface MetaParaDiagnostico {
  /** 'ninguno' cuando no hay peso cargado para esa talla. */
  origenPeso?: 'pesoGramos' | 'pesoExactoGramos' | 'ninguno' | string;
  telaVinculada?: boolean;
  tieneManoObra?: boolean;
  /**
   * Si la prenda se ofrece en esa talla. El diagnostico mira SOLO las tallas ofrecidas: que
   * falte el peso de una talla que no se vende no es un problema, y contarlo llenaria la
   * pantalla de avisos que nadie puede accionar.
   */
  seOfrece?: boolean;
  /** 'adquirido' no se confecciona: no lleva peso ni mano de obra, y no es un faltante. */
  modoCosteo?: 'confeccion' | 'adquirido' | string;
}

export type Faltante = 'tela' | 'pesos' | 'mano-obra';

export interface DiagnosticoPrenda {
  /** Nada que reportar: todas las tallas ofrecidas tienen sus tres componentes. */
  completa: boolean;
  faltan: Faltante[];
  /** Cuantas tallas OFRECIDAS estan afectadas por cada falta, sobre cuantas se ofrecen. */
  detalle: { tallasOfrecidas: number; sinTela: number; sinPesos: number; sinManoObra: number };
  /** Rotulo corto para la celda. Vacio si esta completa. */
  etiqueta: string;
  /** Texto largo, para el tooltip y el reporte. Vacio si esta completa. */
  motivo: string;
}

const ROTULO: Record<Faltante, string> = {
  'tela': 'sin tela',
  'pesos': 'sin pesos',
  'mano-obra': 'sin mano de obra',
};

const EXPLICACION: Record<Faltante, string> = {
  'tela': 'no tiene tela asignada, asi que el costo de material es cero aunque se carguen los pesos',
  'pesos': 'no tiene el peso de tela cargado, asi que el costo de material es cero',
  'mano-obra': 'no tiene mano de obra cargada, asi que el costo de confeccion es cero',
};

/**
 * Diagnostica una prenda a partir de las filas costeadas de sus tallas.
 *
 * Sin filas devuelve completa: una prenda sin ninguna talla es otro problema —no tiene
 * variantes que vender— y no es este el lugar para reportarlo. Inventar un faltante aca
 * pondria una marca sobre algo que este diagnostico no midio.
 */
export function diagnosticarPrenda(metas: MetaParaDiagnostico[]): DiagnosticoPrenda {
  const vacio: DiagnosticoPrenda = {
    completa: true,
    faltan: [],
    detalle: { tallasOfrecidas: 0, sinTela: 0, sinPesos: 0, sinManoObra: 0 },
    etiqueta: '',
    motivo: '',
  };
  if (!metas || metas.length === 0) return vacio;

  // Una prenda ADQUIRIDA no se confecciona: no lleva peso de tela ni mano de obra, y marcarla
  // seria reportar como falta algo que su modo de costeo no usa.
  if (metas.some((m) => m.modoCosteo === 'adquirido')) return vacio;

  const ofrecidas = metas.filter((m) => m.seOfrece !== false);
  if (ofrecidas.length === 0) return vacio;

  const sinTela = ofrecidas.filter((m) => m.telaVinculada === false).length;
  const sinPesos = ofrecidas.filter((m) => m.origenPeso === 'ninguno').length;
  const sinManoObra = ofrecidas.filter((m) => m.tieneManoObra === false).length;

  const faltan: Faltante[] = [];
  // ORDEN DELIBERADO: la tela primero. Es la que hay que resolver antes, porque sin tela los
  // pesos no sirven de nada; decirlas en el otro orden mandaria a cargar pesos que no van a
  // cambiar el costo.
  if (sinTela > 0) faltan.push('tela');
  if (sinPesos > 0) faltan.push('pesos');
  if (sinManoObra > 0) faltan.push('mano-obra');

  if (faltan.length === 0) {
    return { ...vacio, detalle: { tallasOfrecidas: ofrecidas.length, sinTela: 0, sinPesos: 0, sinManoObra: 0 } };
  }

  const cuantas = (f: Faltante) => (f === 'tela' ? sinTela : f === 'pesos' ? sinPesos : sinManoObra);

  // El motivo dice CUANTAS tallas, y solo cuando no son todas. "sin pesos" sobre una prenda
  // entera y "sin pesos en 3 de 16 tallas" son dos problemas de tamaño distinto.
  const partes = faltan.map((f) => {
    const n = cuantas(f);
    const alcance = n === ofrecidas.length ? '' : ` (${n} de ${ofrecidas.length} tallas)`;
    return `${EXPLICACION[f]}${alcance}`;
  });

  return {
    completa: false,
    faltan,
    detalle: { tallasOfrecidas: ofrecidas.length, sinTela, sinPesos, sinManoObra },
    etiqueta: faltan.map((f) => ROTULO[f]).join(' · '),
    motivo: 'El costo de esta prenda esta SUBESTIMADO: ' + partes.join('; ') + '.',
  };
}

/**
 * Diagnostica muchas prendas de una vez, agrupando por prenda.
 *
 * `clave` saca el identificador de prenda de cada fila. Se pasa desde afuera porque las
 * distintas pantallas nombran ese campo de forma distinta —`productoId`, `meta.productoId`—
 * y adivinarlo aca seria una tercera forma de equivocarse.
 */
export function diagnosticarPorPrenda<T>(
  filas: T[],
  clave: (f: T) => string,
  meta: (f: T) => MetaParaDiagnostico
): Map<string, DiagnosticoPrenda> {
  const porPrenda = new Map<string, MetaParaDiagnostico[]>();
  for (const f of filas) {
    const k = clave(f);
    const arr = porPrenda.get(k);
    if (arr) arr.push(meta(f));
    else porPrenda.set(k, [meta(f)]);
  }
  const salida = new Map<string, DiagnosticoPrenda>();
  for (const [k, metas] of porPrenda) salida.set(k, diagnosticarPrenda(metas));
  return salida;
}

/** Resumen para el encabezado de un reporte: cuantas prendas tienen el costo subestimado. */
export function resumirDiagnosticos(diags: Iterable<DiagnosticoPrenda>): {
  total: number;
  incompletas: number;
  sinTela: number;
  sinPesos: number;
  sinManoObra: number;
} {
  let total = 0, incompletas = 0, sinTela = 0, sinPesos = 0, sinManoObra = 0;
  for (const d of diags) {
    total++;
    if (d.completa) continue;
    incompletas++;
    if (d.faltan.includes('tela')) sinTela++;
    if (d.faltan.includes('pesos')) sinPesos++;
    if (d.faltan.includes('mano-obra')) sinManoObra++;
  }
  return { total, incompletas, sinTela, sinPesos, sinManoObra };
}
