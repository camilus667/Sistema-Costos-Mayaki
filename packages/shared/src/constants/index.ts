// ============================================
// CONSTANTES DEL SISTEMA
// ============================================

// IVA / IPM (Impuesto al Patrimonio Mental - 13% en Ecuador)
export const IVA_RATE = 0.13;

// Merma default por materia prima
export const DEFAULT_MERMA_PORCENTAJE = 0.08;

// Roles permitidos
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  EDITOR: 'editor',
  VISUALIZADOR: 'visualizador',
} as const;

// Roles de colegio
export const COLEGIO_ROLES = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  VISUALIZADOR: 'visualizador',
} as const;

// Tipos de transacción de inventario
export const TIPOS_TRANSACCION = {
  ENTRADA: 'entrada',
  SALIDA: 'salida',
  MERMA: 'merma',
  AJUSTE: 'ajuste',
} as const;

// Acciones de auditoría
export const ACCIONES_AUDITORIA = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const;

// Token configuration
export const JWT_EXPIRES_IN = '15m';
export const JWT_REFRESH_EXPIRES_IN = '7d';

// Cloudflare D1 binding name
export const D1_DATABASE_NAME = 'sistema-uniformes';

// ============================================
// SISTEMA POS - CONSTANTES
// ============================================

export const POS_GRUPOS_REPORTE: Record<string, { sufijo: string; tallas: string[] }> = {
  'Cambridge': {
    sufijo: ', CC',
    tallas: ['02', '04', '06', '08', '10', '12', '14', '16/34', '36/XS', '38/S', '40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL'],
  },
  'Intl S Marcos': {
    sufijo: ', Intl SM',
    tallas: ['04', '06', '08', '10', '12', '14', '16/34', '38/S', '40/M', '42/L', '44/XL', '46/2XL', '48/3XL', '50/4XL'],
  },
  'Edad de Oro': {
    sufijo: ', EO',
    tallas: ['04', '06', '08', '10', '12', '14', '16/34', '38/S', '40/M', '42/L', '44/XL', '46/2XL', '48/3XL'],
  },
  'Inf S Marcos': {
    sufijo: ', Inf SM',
    tallas: ['02', '04', '06', '08', '10', '12', '14', '16/34', '38/S'],
  },
  'Col S Marcos': {
    sufijo: ', Col SM',
    tallas: ['04', '06', '08', '10', '12', '14', '16/34', '38/S'],
  },
  'Saint Jude': {
    sufijo: ', SJ',
    tallas: ['02', '03', '04', '06', '08', '10'],
  },
} as const;

export const POS_GRUPO_REFERENCIA = 'Empresas y General';
export const POS_CATEGORIAS_REFERENCIA = ['Empresas', 'General'] as const;

export const POS_TALLA_GENERICO = '14';
export const POS_COLUMNA_UNICA = 'ÚNICA';

