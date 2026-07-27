// ============================================
// ROLES Y PERMISOS
// ============================================

export type UserRole = 'super_admin' | 'admin' | 'editor' | 'visualizador';

export type ColegioRole = 'admin' | 'editor' | 'visualizador';

export type RolAcceso = UserRole | ColegioRole;

// ============================================
// PRODUCTOS
// ============================================

export interface Producto {
  id: string;
  colegioId: string;
  anioId: string | null;
  itemNumero: number;
  descripcion: string;
  factorComplejidad: number;
  costoFijo: number;
  activo: boolean;
  creadoEn: string;
}

// ============================================
// TALLAS
// ============================================

export interface Talla {
  id: string;
  colegioId: string;
  codigo: string;
  nombre: string;
  orden: number;
  activo: boolean;
}

// ============================================
// MATERIAS PRIMAS
// ============================================

export interface Tela {
  id: string;
  colegioId: string;
  descripcion: string;
  rendimiento: number;
  anchoMts: number | null;
  densidadGm2: number | null;
  precioCompra: number;
  precioUnitario: number;
  activo: boolean;
}

export interface Accesorio {
  id: string;
  colegioId: string;
  descripcion: string;
  codigo: string | null;
  unidadCompra: string;
  cantidadXUd: number;
  costoUdCompra: number;
  costoUnitario: number;
  activo: boolean;
}

// ============================================
// PESO MATERIA PRIMA
// ============================================

export interface PesoMateriaPrima {
  id: string;
  productoId: string;
  tallaId: string;
  pesoGramos: number;
  mermaPorcentaje: number;
  pesoConMerma: number;
}

// ============================================
// MANO DE OBRA
// ============================================

export interface ManoObra {
  id: string;
  productoId: string;
  tallaId: string;
  costoBs: number;
}

// ============================================
// DETALLE ACCESORIO
// ============================================

export interface DetalleAccesorio {
  id: string;
  productoId: string;
  accesorioId: string;
  cantidadUso: number;
}

// ============================================
// COSTOS INDIRECTOS
// ============================================

export interface CostoIndirecto {
  id: string;
  colegioId: string;
  anioId: string | null;
  concepto: string;
  montoMensual: number;
}

// ============================================
// PRECIOS DE VENTA
// ============================================

export interface PrecioVenta {
  id: string;
  productoId: string;
  tallaId: string;
  precioBs: number;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

// ============================================
// INVENTARIO
// ============================================

export interface Inventario {
  id: string;
  productoId: string;
  tallaId: string;
  anioId: string | null;
  cantidad: number;
  costoUnitario: number | null;
  costoTotal: number | null;
}

export type TipoTransaccion = 'entrada' | 'salida' | 'merma' | 'ajuste';

export interface InventarioTransaccion {
  id: string;
  productoId: string;
  tallaId: string;
  anioId: string | null;
  tipo: TipoTransaccion;
  cantidad: number;
  costoUnitario: number | null;
  motivo: string | null;
  documentoReferencia: string | null;
  realizadoPor: string;
  creadoEn: string;
}

// ============================================
// HISTORICO DE PRECIOS
// ============================================

export interface HistoricoPrecio {
  id: string;
  productoId: string;
  tallaId: string;
  precioAnterior: number;
  precioNuevo: number;
  cambioPor: string;
  cambiadoPor: string;
  cambiadoEn: string;
}

// ============================================
// COLEGIOS
// ============================================

export interface Colegio {
  id: string;
  nombre: string;
  direccion: string | null;
  nit: string | null;
  telefono: string | null;
  activo: boolean;
  creadoEn: string;
}

// ============================================
// USUARIOS
// ============================================

export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  passwordHash: string;
  rol: UserRole;
  activo: boolean;
  creadoEn: string;
}

export interface UsuarioColegio {
  id: string;
  usuarioId: string;
  colegioId: string;
  rolColegio: ColegioRole;
  creadoEn: string;
}

// ============================================
// AÑOS ESCOLARES
// ============================================

export interface AnioEscolar {
  id: string;
  colegioId: string;
  anio: string;
  periodo: string | null;
  activo: boolean;
}

// ============================================
// TIPO DE CAMBIO
// ============================================

export interface PerSoles {
  id: string;
  colegioId: string;
  tipoCambio: number;
  vigenteDesde: string;
}

// ============================================
// AUDITORIA
// ============================================

export interface RegistroAuditoria {
  id: string;
  usuarioId: string | null;
  colegioId: string | null;
  accion: 'CREATE' | 'UPDATE' | 'DELETE';
  tabla: string;
  registroId: string | null;
  datosAnteriores: string | null;
  datosNuevos: string | null;
  creadoEn: string;
}

// ============================================
// RESULTADO DE CALCULO DE COSTOS
// ============================================

export interface ResultadoCalculo {
  productoId: string;
  talla: string;
  pesoMateriaPrima: number;
  pesoConMerma: number;
  costoTela: number;
  costoAccesorios: number;
  costoManoObra: number;
  costoBruto: number;
  costoFijosVariable: number;
  costoIndirecto: number;
  costoAntesImpuestos: number;
  iva: number;
  costoTotal: number;
  precioVenta: number | null;
  utilidadNeta: number | null;
  margenPorcentaje: number | null;
}

// ============================================
// RESPUESTAS DE API
// ============================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
