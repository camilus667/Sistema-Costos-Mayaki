/**
 * ARMA EL PLAN DE CAMBIOS DE UNA IMPORTACION. NO ESCRIBE NADA.
 *
 * Toma las filas ya resueltas —que dicen a que prenda y a que talla va cada una— y el
 * ESTADO ACTUAL de la base, y devuelve que cambiaria: precio de tal a cual, codigo nuevo,
 * cantidad de tal a cual. Es lo unico que la pantalla necesita mostrar antes de escribir,
 * y es puro: no conoce la base, recibe los valores actuales como mapas.
 *
 * POR QUE EXISTE APARTE de importarPos.service.ts. Ese archivo contesta "a donde va cada
 * fila". Este contesta "que cambia si la escribo". Son dos preguntas distintas y la
 * segunda es la que el usuario revisa. Separarlas deja que el emparejamiento se pruebe
 * sin inventar precios y que el delta se pruebe sin inventar descripciones.
 *
 * LO QUE MOTIVO ESTE ARCHIVO, medido sobre el archivo real y las 463 filas que hoy
 * tienen colegio destino:
 *
 *   precio IGUAL al actual     19
 *   precio CAMBIA             429
 *   precio NUEVO, no habia     15
 *   cambian 40% o mas         126   el mayor, +150%: un pantalon de 140 a 350
 *
 * O sea que importar NO es un ajuste menor: reescribe casi todos los precios del colegio.
 * Y el patron dice algo mas incomodo. En Cambridge la razon POS/actual tiene mediana
 * 1.23x con el 82% de los cambios dentro de +-10% de esa misma razon: un salto casi
 * uniforme, que no parece una lista de precios de venta real sino un valor derivado. En
 * Internacional SM la mediana es 1.45x pero solo el 29% cae dentro de +-10%: ahi si varia
 * caso por caso, y ahi viven los +150%.
 *
 * De ahi la decision de diseño de todo el archivo: LA PANTALLA MUESTRA ACTUAL -> NUEVO
 * CON EL DELTA, no solo el precio nuevo. Un "OK" verde que oculta un salto de 150% es
 * peor que un aviso, porque invita a confirmar sin mirar.
 *
 * Y se agrupa POR PRENDA, no por fila. Dieciseis filas de `Pantalón de Dama` son UNA
 * decision —a que prenda del sistema va— y dieciseis precios que vienen del archivo y no
 * exigen criterio. Medido: 297 filas de Cambridge son 36 decisiones, y 166 de
 * Internacional SM son 14. Cincuenta decisiones en total, no 732 filas.
 */

import type { FilaPos, FilaResuelta, EstadoFila, Candidato } from './importarPos.service';
// El nombre y la abreviatura sugeridos para un colegio que falta. Ver `sugerenciaDeColegio`.
import { sugerenciaDeColegio } from './importarPos.service';

/**
 * A partir de que porcentaje un cambio de precio se marca para que salte a la vista.
 *
 * 40% no es redondo por casualidad: con el archivo real deja 126 filas marcadas de 429
 * que cambian. Mas alto esconde saltos que importan; mas bajo marca tantas que la marca
 * deja de significar algo, que es la forma habitual en que un aviso se vuelve inutil.
 */
export const UMBRAL_SALTO_PRECIO = 0.40;

/**
 * Por debajo de esta confianza se considera que NO HAY candidato y la prenda se puede crear.
 *
 * POR QUE HACE FALTA, y es un defecto que encontro una captura de pantalla y no un test.
 * `resolverFilas` marca `sin-producto` solo cuando NINGUNA prenda del colegio da algun
 * parecido, y como la similitud devuelve algo mayor que cero para casi cualquier par de
 * textos, ese estado no aparece nunca en la practica. Medido sobre el archivo real: de los
 * 11 grupos de Cambridge que no resuelven, los 11 son `revisar`, ninguno `sin-producto`. O
 * sea que la opcion de crear las prendas que faltan estaba muerta: no habia grupo al que
 * aplicarse.
 *
 * EL 0.45 SALE DE LOS DATOS, no de una intuicion. Las confianzas de los grupos que no
 * resuelven se separan en dos familias con un hueco entre ellas:
 *
 *   3% a 39%   prendas que el sistema realmente no tiene, emparejadas con cualquier cosa:
 *              Riñonera -> Pantalón para dama, Gorra -> Corbata larga, Lanyard -> Calza,
 *              Sombrero -> Jamper, y las 14 de Internacional SM contra "Camisa Formal".
 *   58%        el unico caso que es una decision de verdad: Pantalón de Varon contra
 *              Pantalón de vestir, que comparten "pantalon" y podrian ser la misma prenda.
 *
 * El corte en 0.45 deja el 58% pidiendo criterio humano —que es lo correcto, ahi hay una
 * pregunta real— y habilita crear las de 39% para abajo, donde no hay ninguna duda de que
 * la prenda falta. Un corte mas alto ofreceria duplicar una prenda que si existe, que es el
 * error mas caro de esta importacion: dos prendas para lo mismo, con el costo en una y el
 * precio en la otra.
 */
export const CONFIANZA_SIN_CANDIDATO = 0.45;

export type AccionPrecio =
  | 'crear'       // no habia precio para esa prenda-talla
  | 'actualizar'  // habia y cambia
  | 'sin-cambio'; // habia y es el mismo

export interface CambioFila {
  origen: FilaPos;
  estado: EstadoFila;
  motivo?: string;

  productoId: string | null;
  productoDescripcion: string | null;
  confianza: number;
  candidatos: Candidato[];

  tallaId: string | null;
  tallaCodigo: string | null;
  /** El codigo canonico de la talla que falta. Solo cuando el estado es `sin-talla`. */
  tallaCodigoFaltante?: string | null;
  /** La fila no traia variante y se le asigno la talla del medio de la curva. */
  tallaAsignadaPorDefecto?: boolean;

  // ---- precio
  accionPrecio: AccionPrecio;
  precioActual: number | null;
  precioPos: number;
  /** Fraccion, no porcentaje: 0.5 es +50%. `null` cuando no habia precio con que comparar. */
  delta: number | null;
  saltoExtremo: boolean;

  // ---- codigo del POS
  codigoActual: string | null;
  codigoPos: string;
  codigoCambia: boolean;

  // ---- inventario
  cantidadActual: number | null;
  cantidadPos: number;
  cantidadCambia: boolean;
}

export interface GrupoPrenda {
  /** El nombre tal cual viene del POS, con su sufijo. Es la clave que ve el usuario. */
  nombrePos: string;
  productoId: string | null;
  productoDescripcion: string | null;
  confianza: number;
  /** El estado del grupo es el PEOR de sus filas: un grupo con una fila sin talla no es "ok". */
  estado: EstadoFila;
  /** Solo cuando el estado es `sin-producto`: se puede crear la prenda al importar. */
  puedeCrearPrenda: boolean;
  /**
   * Cuantas filas del grupo tienen talla resuelta, o sea cuantas el ejecutor puede escribir.
   *
   * EXISTE POR UNA MEDICION. `estado` es el PEOR de las filas, asi que un grupo con 14 filas y UNA
   * talla desactivada quedaba en `sin-talla` y se descartaba entero. Desactivando dos tallas en la
   * base de prueba: 22 grupos en `sin-talla`, 268 filas descartadas, y 225 de esas filas TENIAN
   * talla. Diecisiete de los 22 emparejaban el nombre al 100%.
   *
   * El ejecutor ya saltea fila por fila las que no tienen talla —`if (!f.tallaId) continue`—, asi
   * que bloquear el grupo no protegia de nada: tiraba las filas buenas para evitar las malas que el
   * bucle ya evitaba solo.
   */
  filasConTalla: number;
  /** Los codigos de talla que faltan o estan desactivados, para poder nombrarlos. */
  tallasFaltantes: string[];
  /**
   * Los codigos de talla que SI emparejaron.
   *
   * Se dicen las dos listas y no solo la que falta: "entran 12 de 14" contesta cuantas, y no
   * CUALES. Al conciliar contra el POS la pregunta es cual talla quedo sin precio, y responderla
   * obligaba a abrir Inventario Real y comparar catorce filas a ojo.
   */
  tallasEmparejadas: string[];
  filas: CambioFila[];
  resumen: {
    filas: number;
    crear: number;
    actualizar: number;
    sinCambio: number;
    saltosExtremos: number;
    /** El delta mas grande en valor absoluto del grupo, para ordenar por riesgo. */
    deltaMaximo: number | null;
    precioMin: number;
    precioMax: number;
  };
}

export interface PlanImportacion {
  colegioId: string;
  colegioNombre: string;
  categoriaEsperada: string | null;
  grupos: GrupoPrenda[];
  resumen: {
    filasDelColegio: number;
    decisiones: number;
    importables: number;
    exigenRevision: number;
    crear: number;
    actualizar: number;
    sinCambio: number;
    saltosExtremos: number;
    prendasPorCrear: number;
    tallaPorDefecto: number;
    /**
     * Cuantas cantidades de stock cambiarian si el modo escribe inventario.
     *
     * Existe porque las tarjetas del resumen dependen del modo: con "solo inventario", "PRECIOS QUE
     * CAMBIAN" no va a pasar y "CANTIDADES A REEMPLAZAR" es lo unico que importa mirar. Antes esa
     * cifra no se calculaba, asi que el modo de inventario no tenia nada que mostrar.
     */
    cantidadesQueCambian: number;
  };
  /**
   * Categorias del archivo que NO tienen colegio en el sistema, con su conteo de filas.
   *
   * Existe porque medirlo dio un numero que no se puede pasar por alto: hoy el sistema
   * tiene dos colegios y el archivo trae cinco, asi que 269 de 732 filas no tienen a
   * donde ir. Descartarlas en silencio seria dejar creer que se importo todo.
   */
  categoriasSinColegio: {
    categoria: string; filas: number; nombreSugerido: string; abreviaturaSugerida: string;
  }[];
  avisos: string[];
  /** Huella del contenido resuelto. La ejecucion exige la misma; ver `huellaDePlan`. */
  huella: string;
}

export interface EstadoActual {
  /** `${productoId}|${tallaId}` -> precio vigente. Sin entrada = no hay precio. */
  precios: Map<string, number>;
  /** `${productoId}|${tallaId}` -> codigo del POS ya guardado. */
  codigos: Map<string, string | null>;
  /** `${productoId}|${tallaId}` -> cantidad en inventario. */
  inventario: Map<string, number>;
}

const clave = (p: string, t: string) => `${p}|${t}`;

/**
 * El estado de un grupo es el peor de sus filas, en este orden de gravedad.
 *
 * Importa que `sin-producto` gane a `revisar`: un grupo donde la prenda no existe pide
 * una decision distinta —crearla o saltearla— que uno donde solo hay poca confianza.
 */
const GRAVEDAD: Record<EstadoFila, number> = {
  'ok': 0,
  'revisar': 1,
  'sin-talla': 2,
  'sin-precio': 3,
  'sin-producto': 4,
  'otro-colegio': 5,
};

/**
 * Huella del contenido de un plan.
 *
 * PARA QUE SIRVE: la ejecucion vuelve a leer el archivo y a resolver desde cero en vez de
 * confiar en lo que manda el navegador. Pero entonces hay que probar que el archivo que
 * se ejecuta es el mismo que se reviso. La huella es esa prueba: si no coincide, la
 * ejecucion se niega. Sin esto se podria revisar una planilla y confirmar otra.
 *
 * Es FNV-1a y no un hash criptografico a proposito. No defiende contra un atacante que
 * quiera forjar una colision, defiende contra un archivo distinto por descuido —otra
 * version, otro colegio, otro export— y para eso alcanza. Ademas no depende de `crypto`,
 * que en el runtime de Workers no esta disponible de la misma forma que en node.
 */
export function huellaDePlan(colegioId: string, filas: FilaResuelta[]): string {
  /**
   * Separadores entre campos y entre filas. Van como ESCAPE y no como el caracter
   * literal, por dos razones.
   *
   * TIENEN QUE EXISTIR: sin separador, codigo "1" con precio 234 y codigo "12" con precio
   * 34 producen la misma secuencia de caracteres y por lo tanto la misma huella. Es el
   * error clasico de una huella hecha a mano, y hay un test que lo fija.
   *
   * Y TIENEN QUE ESTAR ESCRITOS COMO `\u001f`: la primera version de esta funcion llevaba
   * el byte de control metido literalmente en el fuente. Funcionaba —las huellas si
   * diferian— pero era invisible en cualquier editor y git empezaba a tratar el archivo
   * como BINARIO, o sea sin diffs legibles. Un caracter que no se ve y que cambia el
   * comportamiento es una trampa para el que venga despues.
   */
  const SEP_CAMPO = '\u001f';
  const SEP_FILA = '\u001e';

  let h = 0x811c9dc5;
  const comer = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  comer(String(colegioId));
  // Se ordena por numero de fila: el orden de resolucion no debe cambiar la huella.
  for (const f of [...filas].sort((a, b) => a.origen.fila - b.origen.fila)) {
    comer(SEP_FILA);
    comer(String(f.origen.fila));
    comer(SEP_CAMPO);
    comer(f.origen.codigo);
    comer(SEP_CAMPO);
    comer(String(f.origen.precioPos));
    comer(SEP_CAMPO);
    comer(String(f.origen.cantidad));
    comer(SEP_CAMPO);
    comer(f.productoId ?? '');
    comer(SEP_CAMPO);
    comer(f.tallaId ?? '');
  }
  return h.toString(16).padStart(8, '0');
}

export interface OpcionesPlan {
  colegioId: string;
  colegioNombre: string;
  categoriaEsperada: string | null;
  resueltas: FilaResuelta[];
  actual: EstadoActual;
  /** Conteo de filas por categoria del archivo completo, para detectar las sin colegio. */
  filasPorCategoria: Map<string, number>;
  /** Las categorias que SI tienen colegio en el sistema. */
  categoriasConColegio: Set<string>;
  /**
   * El sufijo del codigo del POS que se descubrio para cada categoria del archivo.
   *
   * Es lo que permite proponer la abreviatura de un colegio que NO esta en `CATEGORIAS_POS`. Sin
   * esto, un export con colegios nuevos los ofrecia crear con la abreviatura vacia, y su primera
   * importacion no encontraba ninguna de sus filas.
   */
  sufijosPorCategoria?: Map<string, string>;
  /**
   * Los codigos de talla EN EL ORDEN DEL CATALOGO, para poder listarlas como una curva.
   *
   * Sin esto la lista de tallas emparejadas sale en el orden en que el archivo trae las filas, que
   * dio `06, 10, 12, 08, 14, 16/34...` y se lee como ruido. Y alfabeticamente seria peor: `10`
   * iria antes que `02`. El orden bueno es el que el usuario define arrastrando en Configuracion,
   * y es el que ya trae la consulta de tallas activas.
   */
  ordenTallas?: string[];
  avisos?: string[];
}

/**
 * Arma el plan. No escribe, no consulta: todo lo que necesita llega por parametro.
 */
export function planificarCambios(op: OpcionesPlan): PlanImportacion {
  const avisos = [...(op.avisos ?? [])];

  // Rango de cada talla para ordenar las listas. Una talla que no este en el catalogo va al final
  // en vez de al principio: es el caso de las que faltan, y ponerlas primeras enterraria la curva.
  const rangoTalla = new Map<string, number>();
  (op.ordenTallas ?? []).forEach((c, i) => rangoTalla.set(String(c), i));
  /**
   * Orden de curva, con respaldo NUMERICO cuando la talla no esta en el catalogo.
   *
   * El respaldo importa: sin `ordenTallas` el orden pasaba a ser el del archivo, que dio `04, 02`.
   * Lo encontro un test que ya existia. Un comparador numerico da `02, 04, 10, 16/34`, que es lo
   * que cualquiera espera, y no depende de en que fila venga cada talla.
   */
  const porCurva = (a: string, b: string) => {
    const ra = rangoTalla.get(a);
    const rb = rangoTalla.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    // Una conocida va antes que una desconocida: la curva primero, lo raro al final.
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  };

  const delColegio = op.resueltas.filter((r) => r.estado !== 'otro-colegio');

  const cambios: CambioFila[] = delColegio.map((r) => {
    const k = r.productoId && r.tallaId ? clave(r.productoId, r.tallaId) : null;

    const precioActual = k && op.actual.precios.has(k) ? Number(op.actual.precios.get(k)) : null;
    const codigoActual = k ? (op.actual.codigos.get(k) ?? null) : null;
    const cantidadActual = k && op.actual.inventario.has(k) ? Number(op.actual.inventario.get(k)) : null;

    let accionPrecio: AccionPrecio;
    if (precioActual === null) accionPrecio = 'crear';
    // Medio centavo de tolerancia: los precios vienen del POS como texto y el redondeo
    // de coma flotante no debe contar como un cambio.
    else if (Math.abs(precioActual - r.origen.precioPos) < 0.005) accionPrecio = 'sin-cambio';
    else accionPrecio = 'actualizar';

    // El delta se calcula contra el precio ACTUAL, y solo si hay uno mayor que cero:
    // dividir por cero daria Infinity y la pantalla mostraria un porcentaje absurdo.
    const delta =
      precioActual !== null && precioActual > 0
        ? (r.origen.precioPos - precioActual) / precioActual
        : null;

    return {
      origen: r.origen,
      estado: r.estado,
      motivo: r.motivo,
      productoId: r.productoId ?? null,
      productoDescripcion: r.productoDescripcion ?? null,
      confianza: r.confianza,
      candidatos: r.candidatos,
      tallaId: r.tallaId ?? null,
      tallaCodigo: r.tallaCodigo ?? null,
      tallaCodigoFaltante: r.tallaCodigoFaltante ?? null,
      tallaAsignadaPorDefecto: r.tallaAsignadaPorDefecto,
      accionPrecio,
      precioActual,
      precioPos: r.origen.precioPos,
      delta,
      saltoExtremo: delta !== null && Math.abs(delta) >= UMBRAL_SALTO_PRECIO,
      codigoActual,
      codigoPos: r.origen.codigo,
      codigoCambia: (codigoActual ?? '') !== r.origen.codigo,
      cantidadActual,
      cantidadPos: r.origen.cantidad,
      cantidadCambia: cantidadActual === null || cantidadActual !== r.origen.cantidad,
    };
  });

  // ---------------------------------------------------------------- agrupar por prenda
  //
  // La clave es el NOMBRE DEL POS y no el productoId: dos nombres del POS podrian caer en
  // la misma prenda del sistema —eso es un problema que hay que ver, no fusionar— y una
  // prenda que no existe todavia no tiene id con que agrupar.
  const porNombre = new Map<string, CambioFila[]>();
  for (const c of cambios) {
    const arr = porNombre.get(c.origen.nombreProducto);
    if (arr) arr.push(c);
    else porNombre.set(c.origen.nombreProducto, [c]);
  }

  const grupos: GrupoPrenda[] = [];
  for (const [nombrePos, filas] of porNombre) {
    const peor = filas.reduce(
      (a, b) => (GRAVEDAD[b.estado] > GRAVEDAD[a.estado] ? b : a),
      filas[0]
    );
    const conPrecio = filas.filter((f) => f.delta !== null);
    const deltas = conPrecio.map((f) => Math.abs(f.delta as number));
    const precios = filas.map((f) => f.precioPos);

    grupos.push({
      nombrePos,
      // La prenda del grupo es la de la fila con mas confianza que haya resuelto: si
      // alguna fila emparejo, todas las del mismo nombre van a la misma prenda.
      productoId: filas.find((f) => f.productoId)?.productoId ?? null,
      productoDescripcion: filas.find((f) => f.productoDescripcion)?.productoDescripcion ?? null,
      confianza: filas.reduce((m, f) => Math.max(m, f.confianza), 0),
      estado: peor.estado,
      // Se puede crear cuando no hay prenda, o cuando el mejor parecido es tan malo que
      // equivale a no haber encontrado nada. Ver CONFIANZA_SIN_CANDIDATO.
      puedeCrearPrenda:
        peor.estado === 'sin-producto' ||
        (peor.estado === 'revisar' &&
          filas.reduce((m, f) => Math.max(m, f.confianza), 0) < CONFIANZA_SIN_CANDIDATO),
      filasConTalla: filas.filter((f) => f.tallaId).length,
      // Ordenadas y sin repetir: son 14 filas que se quejan de las mismas dos tallas.
      // Las dos listas EN ORDEN DE CURVA, no alfabetico ni del archivo. Ver `ordenTallas`.
      tallasFaltantes: [...new Set(
        filas.filter((f) => !f.tallaId && f.tallaCodigoFaltante).map((f) => String(f.tallaCodigoFaltante)),
      )].sort(porCurva),
      tallasEmparejadas: [...new Set(
        filas.filter((f) => f.tallaId && f.tallaCodigo).map((f) => String(f.tallaCodigo)),
      )].sort(porCurva),
      filas,
      resumen: {
        filas: filas.length,
        crear: filas.filter((f) => f.accionPrecio === 'crear').length,
        actualizar: filas.filter((f) => f.accionPrecio === 'actualizar').length,
        sinCambio: filas.filter((f) => f.accionPrecio === 'sin-cambio').length,
        saltosExtremos: filas.filter((f) => f.saltoExtremo).length,
        deltaMaximo: deltas.length ? Math.max(...deltas) : null,
        precioMin: precios.length ? Math.min(...precios) : 0,
        precioMax: precios.length ? Math.max(...precios) : 0,
      },
    });
  }

  // Los grupos que exigen atencion van PRIMERO, y dentro de esos los del salto mas
  // grande. Ordenar por nombre dejaria el riesgo repartido por toda la lista.
  grupos.sort((a, b) => {
    const g = GRAVEDAD[b.estado] - GRAVEDAD[a.estado];
    if (g !== 0) return g;
    return (b.resumen.deltaMaximo ?? -1) - (a.resumen.deltaMaximo ?? -1);
  });

  // ------------------------------------------------- categorias sin colegio en el sistema
  // Cada categoria que falta viaja con el nombre y la abreviatura que conviene proponer, para que
  // crear ese colegio desde el importador sea un clic. La abreviatura sale del sufijo que el POS ya
  // usa en sus codigos, asi que el colegio nace emparejando: adivinarla dejaria su primera
  // importacion sin encontrar ninguna de sus filas.
  const categoriasSinColegio: {
    categoria: string; filas: number; nombreSugerido: string; abreviaturaSugerida: string;
  }[] = [];
  for (const [cat, n] of op.filasPorCategoria) {
    if (!op.categoriasConColegio.has(cat)) {
      categoriasSinColegio.push({
        categoria: cat, filas: n,
        ...sugerenciaDeColegio(cat, op.sufijosPorCategoria?.get(cat)),
      });
    }
  }
  categoriasSinColegio.sort((a, b) => b.filas - a.filas);

  if (categoriasSinColegio.length) {
    const total = categoriasSinColegio.reduce((a, x) => a + x.filas, 0);
    avisos.push(
      `${total} fila(s) del archivo pertenecen a ${categoriasSinColegio.length} categoria(s) que ` +
      `no tienen colegio en el sistema: ${categoriasSinColegio.map((x) => `${x.categoria} (${x.filas})`).join(', ')}. ` +
      `Esas filas no se pueden importar todavia. Hay que crear esos colegios primero, con sus ` +
      `prendas y tallas, y despues importar cada uno por separado.`
    );
  }

  const importables = cambios.filter((c) => c.estado === 'ok').length;
  const saltos = cambios.filter((c) => c.saltoExtremo).length;
  if (saltos > 0) {
    avisos.push(
      `${saltos} fila(s) cambian el precio ${(UMBRAL_SALTO_PRECIO * 100).toFixed(0)}% o mas. ` +
      `Estan marcadas en la lista. Conviene mirarlas una por una antes de confirmar: el ` +
      `precio del archivo reemplaza al del sistema sin dejar el anterior a mano.`
    );
  }

  return {
    colegioId: op.colegioId,
    colegioNombre: op.colegioNombre,
    categoriaEsperada: op.categoriaEsperada,
    grupos,
    resumen: {
      filasDelColegio: cambios.length,
      decisiones: grupos.length,
      importables,
      exigenRevision: cambios.length - importables,
      crear: cambios.filter((c) => c.accionPrecio === 'crear' && c.estado === 'ok').length,
      actualizar: cambios.filter((c) => c.accionPrecio === 'actualizar' && c.estado === 'ok').length,
      sinCambio: cambios.filter((c) => c.accionPrecio === 'sin-cambio' && c.estado === 'ok').length,
      saltosExtremos: saltos,
      prendasPorCrear: grupos.filter((g) => g.puedeCrearPrenda).length,
      tallaPorDefecto: cambios.filter((c) => c.tallaAsignadaPorDefecto).length,
      // Solo las filas que el ejecutor tocaria: la misma condicion que usa al escribir
      // —`cantidadCambia`— y solo donde la prenda quedo resuelta.
      cantidadesQueCambian: cambios.filter((c) => c.cantidadCambia && c.estado === 'ok').length,
    },
    categoriasSinColegio,
    avisos,
    huella: huellaDePlan(op.colegioId, delColegio),
  };
}
