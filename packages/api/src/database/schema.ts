import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
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
  descripcion: text('descripcion').notNull(),
  factorComplejidad: integer('factor_complejidad').default(1),
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
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
  codigo: text('codigo').notNull(),
  nombre: text('nombre').notNull(),
  orden: integer('orden').notNull(),
  activo: integer('activo', { mode: 'boolean' }).default(true).notNull(),
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
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
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
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
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
});

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
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
  anioId: text('anio_id').references(() => aniosEscolares.id),
  concepto: text('concepto').notNull(),
  montoMensual: real('monto_mensual').notNull(),
});

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
  colegioId: text('colegio_id').notNull().references(() => colegios.id),
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
