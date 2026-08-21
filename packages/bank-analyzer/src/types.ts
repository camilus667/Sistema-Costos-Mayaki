export type BancoTipo = 'BNB' | 'Banco Bisa' | 'Banco Unión' | 'Desconocido';

export type CategoriaTransaccion =
  | 'COMPRA_TELAS_INSUMOS'
  | 'VENTA_UNIFORMES_CLIENTE'
  | 'ROPA_A_MEDIDA'
  | 'SERVICIOS_CONFECCION_BORDADO'
  | 'PAGO_MANO_DE_OBRA_TALLER'
  | 'SERVICIOS_COMERCIO_POS'
  | 'GASTO_OPERATIVO_ALQUILER'
  | 'RETIRO_ATM_CAJA'
  | 'CARGO_BANCARIO_IMPUESTO'
  | 'INGRESO_CONOCIDO'
  | 'GASTO_CONOCIDO'
  | 'TRANSACCION_ANOMALA'
  | 'OTRO_SIN_CLASIFICAR'
  | string;

export interface CategoriaCustomMeta {
  id: string;
  nombreVisible: string;
  icono: string;
  tipo: 'INGRESO' | 'EGRESO' | 'AMBOS';
  esCustom?: boolean;
  creadoEn?: string;
}

export interface ReglaPersonaConocida {
  id: string;
  keyword: string; // Nombre de la persona o palabra clave en glosa (ej. "JUAN PEREZ", "CHARITO")
  banco?: string; // Opcional: Mi Banco específico (ej. 'BNB', 'Banco Bisa', 'Banco Unión', o 'TODOS')
  bancoContraparte?: string; // Opcional: Banco de la Contraparte / Cliente (ej. 'BANCO DE CREDITO', 'BANCO BISA', etc.)
  accion: 'EXCLUIR_ANOMALIA' | 'CLASIFICAR_CONOCIDO' | 'IGNORAR';
  categoriaDestino?: string; // ID de categoría custom o predefinida
  tipoTransaccion?: 'TODOS' | 'INGRESO' | 'EGRESO';
  nota?: string;
  creadoEn: string;
}

export interface MovimientoBancario {
  id: string;
  banco: BancoTipo;
  nroCuentaTitular: string;
  titularNombre: string;
  fechaIso: string; // YYYY-MM-DD
  fechaTexto: string; // DD/MM/YYYY
  hora: string; // HH:MM:SS
  anio: number;
  mes: number;
  trimestre: string;
  tipo: 'INGRESO' | 'EGRESO';
  montoBs: number;
  saldoBs: number;
  descripcionRaw: string;
  referencia: string;
  contraparteNombre: string;
  contraparteCuenta: string;
  contraparteBanco: string;
  glosaDetalle: string;
  categoria: CategoriaTransaccion;
  esAnomalo: boolean;
  motivoAnomalia?: string;
  esReversion?: boolean;
  ordenOriginal?: number;
  archivoOrigen: string;
  creadoEn: string;
}

export interface BalanceBancoAccountItem {
  banco: BancoTipo;
  nroCuenta: string;
  titularNombre: string;
  saldoInicialBs: number;
  totalIngresosBs: number;
  totalEgresosBs: number;
  balanceNetoBs: number;
  saldoFinalBs: number;
  conciliadoOk: boolean;
  diferenciaConciliacionBs: number;
}

export interface BankImportResult {
  bancoDetectado: BancoTipo;
  nroCuenta: string;
  titularNombre: string;
  totalTransacciones: number;
  saldoInicialBs: number;
  totalIngresosBs: number;
  totalEgresosBs: number;
  saldoFinalBs: number;
  conciliadoOk: boolean;
  totalAnomalias: number;
  movimientos: MovimientoBancario[];
}

export interface CategoriaResumenItem {
  categoria: CategoriaTransaccion;
  nombreVisible: string;
  icono: string;
  cantidad: number;
  montoBs: number;
  pctDelTotal: number;
  detalles?: {
    fechaTexto: string;
    contraparteNombre: string;
    montoBs: number;
    motivo?: string;
    banco: string;
    contraparteBanco?: string;
    tipo: 'INGRESO' | 'EGRESO';
  }[];
}

export interface ContraparteRecurrenteItem {
  contraparteNombre: string;
  banco: string;
  contraparteBanco?: string;
  tipo: 'INGRESO' | 'EGRESO';
  cantidadTransacciones: number;
  totalMontoBs: number;
  promedioBs: number;
  categoriaPrincipal: CategoriaTransaccion;
}

export interface AnomaliaDetectadaItem {
  movimiento: MovimientoBancario;
  motivo: string;
  nivelRiesgo: 'ALTO' | 'MEDIO';
}

export interface ResumenMensualClasificado {
  periodoTexto: string; // ej: "Julio 2025"
  anio: number;
  mesNum: number;
  totalIngresosBs: number;
  totalEgresosBs: number;
  balanceMesBs: number;
  totalTransacciones: number;
  ingresosPorCategoria: CategoriaResumenItem[];
  egresosPorCategoria: CategoriaResumenItem[];
  topContrapartes: ContraparteRecurrenteItem[];
  anomalias: AnomaliaDetectadaItem[];
}
