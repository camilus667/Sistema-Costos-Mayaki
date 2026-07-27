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
