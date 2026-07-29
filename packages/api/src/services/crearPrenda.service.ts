/**
 * Alta de una prenda, con sus filas por talla. UNA SOLA CASA.
 *
 * POR QUE EXISTE ESTE ARCHIVO. Hay DOS endpoints que crean prendas:
 *
 *   POST /api/colegios/:id/prendas   el que usa la pantalla de Configuracion
 *   POST /api/productos              el CRUD generico, que la pantalla no llama
 *
 * y hacian cosas distintas. El primero valida que el colegio exista y crea las filas
 * de peso e inventario por cada talla. El segundo insertaba la fila de producto y nada
 * mas: sin validar el colegio y sin crear una sola talla.
 *
 * Las dos diferencias son bugs, y son bugs que ya pagamos:
 *
 * 1. SIN VALIDAR EL COLEGIO nace una prenda HUERFANA. Es exactamente lo que creo el
 *    item 28 con colegio_id = "all" que borramos con limpiarHuerfanas.ts: ningun filtro
 *    por colegio la encuentra, y el conteo sin filtro la cuenta, asi que 27 + 1 daba 29.
 *    Tape ese agujero en colegio.ts (eb7293d) y declare el problema resuelto. No lo
 *    estaba: arregle la INSTANCIA y no la CLASE, que es el error que se repitio toda la
 *    sesion. La puerta seguia abierta aca.
 *
 *    Y SQLite no ayuda: las foreign keys estan APAGADAS por defecto y este proyecto solo
 *    las prende para el DDL de la migracion de la Fase 5. Una FK que apunta a la nada se
 *    inserta sin protestar. La validacion tiene que estar en el codigo.
 *
 * 2. SIN LAS FILAS POR TALLA la prenda no se puede costear ni vender. Ese fue el peor de
 *    los tres filtros que rompio la Fase 5: con las tallas compartidas (colegio_id NULL)
 *    el `where(eq(tallas.colegioId, id))` devolvia cero filas, y toda prenda creada
 *    desde la pantalla nacia sin peso y sin inventario. Con status 200.
 *
 * Mientras fueran dos copias, cualquier arreglo a una dejaba la otra atras. Es la misma
 * historia que la formula de costeo en seis lugares, que el lookup de prenda por item, y
 * que las dos definiciones de cargarConfigAdminColegio. Una funcion con una sola casa no
 * se desincroniza.
 *
 * NO CAMBIA EL COMPORTAMIENTO del alta que ya funciona: colegio.ts pasa a delegar aca y
 * hace lo mismo que hacia, con una sola mejora deliberada, abajo.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { colegios, productos, tallas, pesoMateriaPrima, inventario } from '../database/schema';
import { getSystemConfig } from './configService';

export type DatosNuevaPrenda = {
  colegioId: string;
  itemNumero?: number;
  orden?: number;
  descripcion?: string;
  telaId?: string | null;
  factorComplejidad?: number;
  modoCosteo?: 'confeccion' | 'adquirido';
  anioId?: string | null;
  costoFijo?: number;
  planchadoExtra?: number;
  colocacionBotones?: number;
  operacionesExtra?: number;
};

export type ResultadoAlta =
  | { ok: false; estado: 404 | 409; error: string }
  | {
      ok: true;
      prenda: any;
      tallas: { creadas: number; codigos: string[] };
      avisos: string[];
    };

/**
 * Da de alta una prenda y sus filas derivadas por talla.
 *
 * Devuelve un resultado en vez de tirar una excepcion para que los dos endpoints puedan
 * traducirlo a HTTP sin envolver todo en try/catch, igual que copiarPrenda.service.ts.
 */
export async function crearPrendaConTallas(
  db: any,
  datos: DatosNuevaPrenda
): Promise<ResultadoAlta> {
  const avisos: string[] = [];

  // ------------------------------------------------------ 1. el colegio existe
  const [colegio] = await db
    .select()
    .from(colegios)
    .where(eq(colegios.id, datos.colegioId))
    .limit(1);

  if (!colegio) {
    return {
      ok: false,
      estado: 404,
      error:
        `No existe el colegio "${datos.colegioId}". Una prenda tiene que pertenecer a un ` +
        `colegio real: si se creara con este id quedaria huerfana, invisible en toda ` +
        `pantalla que filtre por colegio y contada en los totales sin filtro.`,
    };
  }

  // ------------------------------------------------- 2. item y orden dentro del colegio
  //
  // itemNumero es la clave de NEGOCIO que usan las matrices, y se numera POR COLEGIO. Se
  // calcula contando las prendas del colegio, no de la empresa: dos colegios pueden tener
  // su item 1 sin conflicto.
  const delColegio = await db
    .select({ id: productos.id, itemNumero: productos.itemNumero })
    .from(productos)
    .where(eq(productos.colegioId, datos.colegioId));

  // MEJORA DELIBERADA sobre el comportamiento anterior, que hacia `existentes.length + 1`.
  // Con 27 prendas numeradas 1..27 eso da 28 y esta bien, pero si alguna se borro —o si
  // los numeros tienen huecos— repite un item que ya existe. Y itemNumero repetido dentro
  // del mismo colegio rompe el lookup por item: resolverPrendaPorItem() encuentra dos y
  // devuelve 409. Ya vimos ese 409 hoy, causado por el item 28 duplicado entre colegios.
  // El maximo + 1 no puede repetir.
  const maxItem = delColegio.reduce((m: number, p: any) => Math.max(m, Number(p.itemNumero) || 0), 0);
  const itemNumero = datos.itemNumero ?? maxItem + 1;

  const yaUsado = delColegio.some((p: any) => Number(p.itemNumero) === Number(itemNumero));
  if (yaUsado) {
    return {
      ok: false,
      estado: 409,
      error:
        `El colegio ${colegio.nombre} ya tiene una prenda con el item ${itemNumero}. ` +
        `El numero de item identifica a la prenda en las matrices de costeo: repetirlo ` +
        `hace que el lookup por item encuentre dos y no pueda decidir. Usa otro numero, ` +
        `o no mandes itemNumero y se asigna el siguiente libre (${maxItem + 1}).`,
    };
  }

  const orden = datos.orden ?? itemNumero;

  // -------------------------------------------------------------- 3. la prenda
  const [prenda] = await db
    .insert(productos)
    .values({
      colegioId: datos.colegioId,
      anioId: datos.anioId ?? null,
      itemNumero,
      orden,
      descripcion: datos.descripcion || 'Nueva Prenda',
      telaId: datos.telaId ?? null,
      factorComplejidad: datos.factorComplejidad ?? 1,
      modoCosteo: datos.modoCosteo ?? 'confeccion',
      costoFijo: datos.costoFijo ?? 0,
      planchadoExtra: datos.planchadoExtra ?? 0,
      colocacionBotones: datos.colocacionBotones ?? 0,
      operacionesExtra: datos.operacionesExtra ?? 0,
      activo: true,
    })
    .returning();

  // ------------------------------------------------- 4. una fila por talla aplicable
  //
  // `= colegio OR IS NULL`, nunca `= colegio` a secas. Es el patron de la Fase 5 y este
  // es el lugar donde su ausencia hacia mas daño: con solo `eq` no devolvia ninguna talla
  // y la prenda nacia sin peso y sin inventario.
  const tallasAplicables = await db
    .select({ id: tallas.id, codigo: tallas.codigo })
    .from(tallas)
    .where(or(eq(tallas.colegioId, datos.colegioId), isNull(tallas.colegioId)));

  if (tallasAplicables.length === 0) {
    avisos.push(
      'El colegio no tiene ninguna talla habilitada, asi que la prenda quedo sin filas de ' +
      'peso ni de inventario y no se puede costear todavia. Habilita tallas en ' +
      'Configuracion y volve a crearla.'
    );
  }

  // La merma sale de configuracion_sistema y no de un 8 escrito a mano. Ese literal
  // aparecia en CUATRO lugares del codigo; la Fase 3 lo saco del motor a proposito para
  // que el default viviera solo en el schema y en la configuracion. Este era el cuarto.
  const config = await getSystemConfig(db);
  const merma = config.mermaPorcentajeEstandar;

  for (const t of tallasAplicables) {
    await db.insert(pesoMateriaPrima).values({
      productoId: prenda.id,
      tallaId: t.id,
      pesoExactoGramos: 0,
      pesoGramos: 0,
      mermaPorcentaje: merma,
      pesoConMerma: 0,
    });
    await db.insert(inventario).values({
      productoId: prenda.id,
      tallaId: t.id,
      cantidad: 0,
      costoUnitario: 0,
      costoTotal: 0,
    });
  }

  // Los pesos nacen en CERO, y eso no es un dato: es la ausencia de uno. Sin peso el
  // costo de tela es cero, y sin mano de obra —que el alta no crea— ese componente
  // tambien. Una prenda recien creada costea casi nada y la pantalla no lo distingue de
  // una prenda barata. Decirlo aca es mas honesto que dejar que se descubra mirando un
  // costo que parece plausible.
  if (tallasAplicables.length > 0) {
    avisos.push(
      `Se crearon ${tallasAplicables.length} fila(s) de peso y de inventario, todas en CERO. ` +
      `La prenda todavia no costea nada: le falta el peso de tela por talla y la mano de ` +
      `obra. Se pueden copiar de una prenda de referencia con ` +
      `POST /api/productos/${prenda.id}/copiar-de/:origenId.`
    );
  }

  if (!datos.telaId) {
    avisos.push(
      'La prenda no tiene tela asignada. El costo de material es peso x precio del gramo, ' +
      'asi que sin tela ese costo queda en cero aunque se carguen los pesos.'
    );
  }

  return {
    ok: true,
    prenda,
    tallas: { creadas: tallasAplicables.length, codigos: tallasAplicables.map((t: any) => t.codigo) },
    avisos,
  };
}

/**
 * Las tablas que cuelgan de una prenda, en el orden en que hay que borrarlas.
 *
 * El orden importa: los hijos antes que el padre. Al reves quedan filas apuntando a una
 * prenda que ya no existe, y como las foreign keys estan apagadas SQLite lo permite sin
 * decir nada. Es la misma lista y el mismo orden que limpiarHuerfanas.ts, que tuvo que
 * limpiar a mano exactamente este desastre.
 */
export const TABLAS_HIJAS_DE_PRENDA = [
  'detalle_acc',
  'precio_venta',
  'precio_adquisicion',
  'peso_mat_prima',
  'mano_obra',
  'inventario_transaccion',
  'inventario',
  'historico_precio',
] as const;
