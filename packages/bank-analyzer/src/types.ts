export type BancoTipo = 'BNB' | 'Banco Bisa' | 'Banco Unión' | 'Desconocido';

export type CategoriaTransaccion =
  | 'COMPRA_TELAS_INSUMOS'
  | 'VENTA_UNIFORMES_CLIENTE'
  | 'SERVICIOS_COMERCIO_POS'
  | 'RETIRO_ATM_CAJA'
  | 'CARGO_BANCARIO_IMPUESTO'
  | 'TRANSACCION_ANOMALA'
  | 'OTRO_SIN_CLASIFICAR';

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
}

export interface ContraparteRecurrenteItem {
  contraparteNombre: string;
  banco: string;
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
