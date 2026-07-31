import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ============================================
// COLEGIOS
// ============================================
export const colegios = sqliteTable('colegio', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  nombre: text('nombre').notNull(),
  direccion: text('direccion'),
  nit: text('nit'),
  telefono: text('telefono'),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// USUARIOS
// ============================================
export const usuarios = sqliteTable('usuario', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  nombre: text('nombre').notNull(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  rol: text('rol', { enum: ['super_admin', 'admin', 'editor', 'visualizador'] }).notNull(),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// USUARIO - COLEGIO (Many-to-Many)
// ============================================
export const usuarioColegios = sqliteTable('usuario_colegio', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  usuarioId: text('usuario_id').notNull().references(() => usuarios.id),
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
  rolColegio: text('rol_colegio', { enum: ['admin', 'editor', 'visualizador'] }).notNull(),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// AÑOS ESCOLARES
// ============================================
export const aniosEscolares = sqliteTable('anio_escolar', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
  anio: text('anio').notNull(),
  periodo: text('periodo'),
  activo: integer('activo', { mode: 'boolean' }).default(false),
});

// ============================================
// PRODUCTOS
// ============================================
export const productos = sqliteTable('producto', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
  anioId: text('anio_id').references(() => aniosEscolares.id),
  itemNumero: integer('item_numero').notNull(),
  orden: integer('orden').default(0),
  descripcion: text('descripcion').notNull(),
  telaId: text('tela_id'),
  /**
   * Como se costea la prenda.
   *   'confeccion' -> se produce: costo de material = tela (peso x precio/g)
   *   'adquirido'  -> se compra semiterminada o para revender: el costo de
   *                   material es el precio de adquisicion por talla, de la
   *                   tabla precio_adquisicion.
   *
   * Es un enum y no un booleano `esSemiterminado` a proposito: semiterminado y
   * reventa comparten exactamente la misma formula, y la unica diferencia es si
   * la receta de accesorios tiene lineas o esta vacia. Un solo modo cubre los
   * dos casos. Con booleanos separados serian dos campos que pueden estar ambos
   * en true, que es un estado invalido que la base permitiria guardar.
   *
   * Ademas convierte un cero ambiguo en intencion declarada: sin este campo,
   * "no hay peso de tela" no se distingue de "falta cargar el peso".
   */
  modoCosteo: text('modo_costeo', { enum: ['confeccion', 'adquirido'] })
    .default('confeccion').notNull(),
  factorComplejidad: real('factor_complejidad').default(1),
  costoFijo: real('costo_fijo').default(0),
  planchadoExtra: real('planchado_extra').default(0),
  colocacionBotones: real('colocacion_botones').default(0),
  operacionesExtra: real('operaciones_extra').default(0),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// TALLAS
// ============================================
export const tallas = sqliteTable('talla', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  colegioId: text('colegio_id').references(() => colegios.id),
  codigo: text('codigo').notNull(),
  nombre: text('nombre').notNull(),
  orden: integer('orden').notNull(),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
});

// ============================================
// TALLAS ACTIVAS POR COLEGIO
// ============================================
/**
 * Que tallas ofrece CADA colegio.
 *
 * POR QUE HACE FALTA UNA TABLA Y NO ALCANZA UN FLAG. `talla.activo` es un booleano
 * en la fila de la talla, y las tallas del sistema tienen `colegio_id` nulo: son
 * COMPARTIDAS. Un flag en una fila compartida no puede decir "activa en Cambridge y
 * apagada en Saint Jude"; solo puede decir "activa" o "apagada" para todos.
 *
 * Y el sistema ya ofrecia ese control como si existiera:
 *
 *   PUT /api/colegios/:id/tallas-config
 *      -> db.update(tallas).set({ activo }).where(eq(tallas.id, t.id))
 *
 * El handler recibe el colegio en la ruta y NO LO USA. Apagar una talla "en
 * Cambridge" la apagaba en los dos colegios. Es la misma clase de defecto que el
 * proyecto ya documento en export.ts: un endpoint que acepta un filtro y lo ignora
 * es peor que uno que no lo acepta, porque el usuario cree que acoto y no acoto.
 *
 * REGLA DE COMPATIBILIDAD: SIN FILA = ACTIVA. Es deliberado y es lo que hace que
 * este cambio no mueva ningun costo el dia que se aplica. Una base existente no
 * tiene ninguna fila aca, asi que todos los colegios siguen viendo todas las tallas
 * exactamente como antes. La tabla solo habla cuando alguien decide apagar algo.
 *
 * El `orden` es opcional y por colegio: dos colegios pueden querer su curva en otra
 * secuencia. Si es nulo, manda el `orden` global de la talla.
 */
export const colegioTallas = sqliteTable('colegio_talla', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
  orden: integer('orden'),
});

// ============================================
// PESO MATERIA PRIMA
// ============================================
export const pesoMateriaPrima = sqliteTable('peso_mat_prima', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  pesoExactoGramos: real('peso_exacto_gramos').default(0),
  pesoGramos: real('peso_gramos').notNull(), // Peso con merma
  mermaPorcentaje: real('merma_porcentaje').default(8).notNull(),
  pesoConMerma: real('peso_con_merma').notNull(),
});

// ============================================
// TELAS
// ============================================
export const telas = sqliteTable('tela', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  colegioId: text('colegio_id').references(() => colegios.id),
  orden: integer('orden').default(0),
  descripcion: text('descripcion').notNull(),
  rendimiento: real('rendimiento').notNull(), // m/kg
  anchoMts: real('ancho_mts'), // m
  unid: text('unid').default('kilo').notNull(), // 'kilo' | 'metro'
  densidadGm2: real('densidad_g_m2'), // g/m²
  pesoMtLineal: real('peso_mt_lineal'), // Ancho * Densidad
  precioCompra: real('precio_compra').notNull(), // Precio unidad de compra / Bs
  precioBsKg: real('precio_bs_kg'), // Precio Bs / Kg
  precioBsG: real('precio_bs_g'), // Precio Bs / g
  precioUnitario: real('precio_unitario').notNull(),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
});

// ============================================
// ACCESORIOS
// ============================================
export const accesorios = sqliteTable('accesorio', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  colegioId: text('colegio_id').references(() => colegios.id),
  descripcion: text('descripcion').notNull(),
  codigo: text('codigo'),
  unidadCompra: text('unidad_compra').notNull(),
  cantidadXUd: real('cantidad_x_ud').notNull(),
  costoUdCompra: real('costo_ud_compra').notNull(),
  costoUnitario: real('costo_unitario').notNull(),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
});

// ============================================
// DETALLE ACCESORIO
// ============================================
export const detalleAccesorio = sqliteTable('detalle_acc', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  accesorioId: text('accesorio_id').notNull().references(() => accesorios.id),
  cantidadUso: real('cantidad_uso').notNull(),
}, (t) => ({
  // Una prenda no puede llevar dos veces el mismo accesorio. Sin esta
  // restriccion una linea duplicada duplica el costo en silencio segun como
  // resuelva el join, y en una tabla de costeo eso es un error invisible.
  prodAccUnico: uniqueIndex('idx_detalle_acc_prod_acc').on(t.productoId, t.accesorioId),
  porProducto: index('idx_detalle_acc_producto').on(t.productoId),
  porAccesorio: index('idx_detalle_acc_accesorio').on(t.accesorioId),
}));

// ============================================
// MANO DE OBRA
// ============================================
export const manoObra = sqliteTable('mano_obra', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  costoBs: real('costo_bs').notNull(),
});

// ============================================
// COSTOS INDIRECTOS
// ============================================
export const costosIndirectos = sqliteTable('costo_indirecto', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  anioId: text('anio_id').references(() => aniosEscolares.id),
  concepto: text('concepto').notNull(),
  montoMensual: real('monto_mensual').notNull(),
});

// ============================================
// PRECIOS DE ADQUISICION (prendas compradas)
// ============================================
/**
 * Precio al que se compra una prenda que no se confecciona: semiterminada
 * (una chompa de punto que llega casi lista y solo se le agrega bordado y
 * etiquetas) o terminada para revender.
 *
 * POR TALLA, obligatoriamente. En los datos de Cambridge la chompa va de 50 Bs
 * en talla 2 a 140 Bs en 48/3XL, un factor de 2.8. Promediar eso sobrecostearia
 * las tallas chicas unos 40 Bs y subcostearia las grandes unos 45, que en tallas
 * grandes es la diferencia entre ganar y perder. Distinto del caso de los
 * accesorios, donde el promedio se acepto porque la diferencia entre tallas era
 * de centimos.
 *
 * CON VIGENCIA TEMPORAL, porque el Excel ya trae dos filas de "Costos
 * anteriores": el historial de precios se estaba llevando a mano. Aca se
 * formaliza, y ademas permite recostear un pedido viejo al precio de su momento.
 *
 * `conFactura` importa para el IVA: la compra sin factura no genera credito
 * fiscal, asi que su precio completo es costo.
 */
export const preciosAdquisicion = sqliteTable('precio_adquisicion', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  precioBs: real('precio_bs').notNull(),
  proveedor: text('proveedor'),
  conFactura: integer('con_factura', { mode: 'boolean' }).default(false).notNull(),
  vigenteDesde: text('vigente_desde').default(sql`CURRENT_TIMESTAMP`).notNull(),
  vigenteHasta: text('vigente_hasta'),
}, (t) => ({
  vigenteUnico: uniqueIndex('idx_precio_adq_prod_talla_desde')
    .on(t.productoId, t.tallaId, t.vigenteDesde),
  porProducto: index('idx_precio_adq_producto').on(t.productoId),
}));

// ============================================
// PRECIOS DE VENTA
// ============================================
export const preciosVenta = sqliteTable('precio_venta', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  precioBs: real('precio_bs').notNull(),
  vigenteDesde: text('vigente_desde').default(sql`CURRENT_TIMESTAMP`),
  vigenteHasta: text('vigente_hasta'),
  /**
   * Codigo del producto-talla en el sistema POS. Lo escribe el importador.
   *
   * VIVE ACA Y NO EN `producto` porque el POS codifica la combinacion prenda+talla, no
   * la prenda: `001-cc` es el pantalon de varon de Cambridge en UNA talla, y cada talla
   * trae el suyo. La unica tabla del sistema con esa granularidad y con el precio al
   * lado es esta.
   *
   * Va JUNTO AL PRECIO a proposito, y eso tiene una consecuencia que el importador hace
   * cumplir: una fila del POS sin precio no puede aportar su codigo, porque no habria
   * fila donde ponerlo. Por eso el parseo exige "Precio POS" en todas.
   *
   * Es NULLABLE: las 297 filas que ya existen no tienen codigo y no lo van a tener
   * hasta que se importen. Nada del sistema lo lee todavia; es la llave para la proxima
   * importacion, que va a poder emparejar por codigo en vez de por descripcion.
   */
  codigoExterno: text('codigo_externo'),
});

// ============================================
// INVENTARIO (Sintético - calculado)
// ============================================
export const inventario = sqliteTable('inventario', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  anioId: text('anio_id').references(() => aniosEscolares.id),
  cantidad: integer('cantidad').notNull().default(0),
  costoUnitario: real('costo_unitario'),
  costoTotal: real('costo_total'),
});

// ============================================
// INVENTARIO TRANSACCIONES
// ============================================
export const inventarioTransacciones = sqliteTable('inventario_transaccion', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  anioId: text('anio_id').references(() => aniosEscolares.id),
  tipo: text('tipo', { enum: ['entrada', 'salida', 'merma', 'ajuste'] }).notNull(),
  cantidad: integer('cantidad').notNull(),
  costoUnitario: real('costo_unitario'),
  motivo: text('motivo'),
  documentoReferencia: text('documento_referencia'),
  realizadoPor: text('realizado_por').notNull().references(() => usuarios.id),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// HISTORICO PRECIOS
// ============================================
export const historicoPrecios = sqliteTable('historico_precio', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  productoId: text('producto_id').notNull().references(() => productos.id),
  tallaId: text('talla_id').notNull().references(() => tallas.id),
  precioAnterior: real('precio_anterior').notNull(),
  precioNuevo: real('precio_nuevo').notNull(),
  cambioPor: text('cambio_por').notNull(),
  cambiadoPor: text('cambiado_por').notNull().references(() => usuarios.id),
  cambiadoEn: text('cambiado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// PER SOLES (Tipo de cambio)
// ============================================
export const perSoles = sqliteTable('per_soles', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  tipoCambio: real('tipo_cambio').notNull(),
  vigenteDesde: text('vigente_desde').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// AUDITORIA
// ============================================
export const auditoria = sqliteTable('auditoria', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  usuarioId: text('usuario_id').references(() => usuarios.id),
  colegioId: text('colegio_id').references(() => colegios.id),
  accion: text('accion').notNull(),
  tabla: text('tabla').notNull(),
  registroId: text('registro_id'),
  datosAnteriores: text('datos_anteriores'),
  datosNuevos: text('datos_nuevos'),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// INSTANTANEAS / SNAPSHOTS DE COSTOS
// ============================================
export const costoSnapshots = sqliteTable('costo_snapshot', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  nombre: text('nombre').notNull(),
  descripcion: text('descripcion'),
  colegioId: text('colegio_id').references(() => colegios.id),
  datosJson: text('datos_json').notNull(),
  creadoPor: text('creado_por'),
  creadoEn: text('creado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// ============================================
// CONFIGURACION SISTEMA (Parámetros Generales)
// ============================================
export const configuracionSistema = sqliteTable('configuracion_sistema', {
  id: text('id').primaryKey().default(sql`lower(hex(randomblob(16)))`),
  clave: text('clave').unique().notNull(),
  valor: text('valor').notNull(),
  descripcion: text('descripcion'),
  actualizadoEn: text('actualizado_en').default(sql`CURRENT_TIMESTAMP`).notNull(),
});
