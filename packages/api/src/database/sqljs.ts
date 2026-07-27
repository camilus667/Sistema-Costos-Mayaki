// @ts-nocheck
import { drizzle } from 'drizzle-orm/sql-js';
import * as schemaModule from './schema';
import { seedData } from '../scripts/seed';
import fs from 'fs';
import path from 'path';

export const schema = schemaModule;

let dbInstance = null;
let dbDrizzle = null;

export function getDbFilePath() {
  return path.resolve(process.cwd(), 'sistema_inventario.db');
}

export function saveDbToDisk() {
  if (dbInstance) {
    try {
      const dbPath = getDbFilePath();
      const data = dbInstance.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(dbPath, buffer);
      console.log(`💾 Base de datos guardada en disco (${dbPath})`);
    } catch (err) {
      console.error('Error al guardar la base de datos en disco:', err);
    }
  }
}

const createTablesSQL = `
CREATE TABLE IF NOT EXISTS "colegio" (
 "id" text PRIMARY KEY NOT NULL,
 "nombre" text NOT NULL,
 "direccion" text,
 "nit" text,
 "telefono" text,
 "activo" integer DEFAULT true NOT NULL,
 "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "anio_escolar" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "anio" text NOT NULL,
 "periodo" text,
 "activo" integer DEFAULT false
);
CREATE TABLE IF NOT EXISTS "usuario" (
 "id" text PRIMARY KEY NOT NULL,
 "nombre" text NOT NULL,
 "email" text NOT NULL UNIQUE,
 "password_hash" text NOT NULL,
 "rol" text NOT NULL,
 "activo" integer DEFAULT true NOT NULL,
 "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "usuario_colegio" (
 "id" text PRIMARY KEY NOT NULL,
 "usuario_id" text NOT NULL,
 "colegio_id" text NOT NULL,
 "rol_colegio" text NOT NULL,
 "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "talla" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "codigo" text NOT NULL,
 "nombre" text NOT NULL,
 "orden" integer NOT NULL,
 "activo" integer DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS "producto" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "anio_id" text,
 "item_numero" integer NOT NULL,
 "orden" integer DEFAULT 0,
 "descripcion" text NOT NULL,
 "tela_id" text,
 "factor_complejidad" integer DEFAULT 1,
 "costo_fijo" real DEFAULT 0,
 "planchado_extra" real DEFAULT 0,
 "colocacion_botones" real DEFAULT 0,
 "operaciones_extra" real DEFAULT 0,
 "activo" integer DEFAULT true NOT NULL,
 "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "tela" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "orden" integer DEFAULT 0,
 "descripcion" text NOT NULL,
 "rendimiento" real NOT NULL,
 "ancho_mts" real,
 "unid" text DEFAULT 'kilo' NOT NULL,
 "densidad_g_m2" real,
 "peso_mt_lineal" real,
 "precio_compra" real NOT NULL,
 "precio_bs_kg" real,
 "precio_bs_g" real,
 "precio_unitario" real NOT NULL,
 "activo" integer DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS "accesorio" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "descripcion" text NOT NULL,
 "codigo" text,
 "unidad_compra" text NOT NULL,
 "cantidad_x_ud" real NOT NULL,
 "costo_ud_compra" real NOT NULL,
 "costo_unitario" real NOT NULL,
 "activo" integer DEFAULT true NOT NULL
);
CREATE TABLE IF NOT EXISTS "detalle_acc" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "accesorio_id" text NOT NULL,
 "cantidad_uso" real NOT NULL
);
CREATE TABLE IF NOT EXISTS "peso_mat_prima" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "peso_exacto_gramos" real DEFAULT 0,
 "peso_gramos" real NOT NULL,
 "merma_porcentaje" real DEFAULT 8 NOT NULL,
 "peso_con_merma" real NOT NULL
);
CREATE TABLE IF NOT EXISTS "mano_obra" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "costo_bs" real NOT NULL
);
CREATE TABLE IF NOT EXISTS "costo_indirecto" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "anio_id" text,
 "concepto" text NOT NULL,
 "monto_mensual" real NOT NULL
);
CREATE TABLE IF NOT EXISTS "precio_venta" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "precio_bs" real NOT NULL,
 "vigente_desde" text DEFAULT CURRENT_TIMESTAMP,
 "vigente_hasta" text
);
CREATE TABLE IF NOT EXISTS "inventario" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "anio_id" text,
 "cantidad" integer DEFAULT 0 NOT NULL,
 "costo_unitario" real,
 "costo_total" real
);
CREATE TABLE IF NOT EXISTS "inventario_transaccion" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "anio_id" text,
 "tipo" text NOT NULL,
 "cantidad" integer NOT NULL,
 "costo_unitario" real,
 "motivo" text,
 "documento_referencia" text,
 "realizado_por" text NOT NULL,
 "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "historico_precio" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "precio_anterior" real NOT NULL,
 "precio_nuevo" real NOT NULL,
 "cambio_por" text NOT NULL,
 "cambiado_por" text NOT NULL,
 "cambiado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "per_soles" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "tipo_cambio" real NOT NULL,
 "vigente_desde" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "auditoria" (
 "id" text PRIMARY KEY NOT NULL,
 "usuario_id" text,
 "colegio_id" text,
 "accion" text NOT NULL,
 "tabla" text NOT NULL,
 "registro_id" text,
 "datos_anteriores" text,
 "datos_nuevos" text,
 "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
`;

export async function getDb() {
  if (dbInstance && dbDrizzle) return dbDrizzle;

  const initSqlJs = (await import('sql.js')).default;
  if (typeof initSqlJs !== 'function') {
    throw new Error('initSqlJs no está disponible en sql.js. Revisa la versión instalada.');
  }

  const SQL = await initSqlJs();
  const dbPath = getDbFilePath();
  let isDbFileExisting = false;

  if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
    try {
      const fileBuffer = fs.readFileSync(dbPath);
      dbInstance = new SQL.Database(fileBuffer);
      isDbFileExisting = true;
    } catch (e) {
      console.warn('⚠️ No se pudo leer el archivo de base de datos existente. Se creará una nueva.', e);
      dbInstance = new SQL.Database();
    }
  } else {
    dbInstance = new SQL.Database();
  }

  createTablesSQL.split(';').forEach(stmt => {
    const s = stmt.trim();
    if (s) dbInstance.run(s);
  });

  try { dbInstance.run('ALTER TABLE "producto" ADD COLUMN "orden" INTEGER DEFAULT 0;'); } catch (e) {}
  try { dbInstance.run('ALTER TABLE "producto" ADD COLUMN "tela_id" TEXT;'); } catch (e) {}
  try { dbInstance.run('ALTER TABLE "tela" ADD COLUMN "orden" INTEGER DEFAULT 0;'); } catch (e) {}

  dbDrizzle = drizzle(dbInstance, { schema: schemaModule });

  let rowCount = 0;
  if (isDbFileExisting) {
    try {
      const res = dbInstance.exec("SELECT COUNT(*) FROM colegio;");
      rowCount = res[0]?.values[0][0] || 0;
    } catch (e) {
      rowCount = 0;
    }
  }

  if (rowCount > 0) {
    console.log(`✅ Base de datos persistente cargada desde disco (${dbPath}) con ${rowCount} colegio(s).`);
    // Run seed anyway for any pending migrations (guarded internally)
    try {
      await seedData(dbDrizzle);
      saveDbToDisk();
    } catch (err) {
      console.error('Error al ejecutar migraciones:', err);
    }
  } else {
    console.log(`🌱 Base de datos vacía o nueva. Ejecutando sembrado inicial desde Excel (una sola vez)...`);
    try {
      await seedData(dbDrizzle);
      saveDbToDisk();
    } catch (err) {
      console.error('Error al poblar la base de datos local:', err);
    }
  }

  return dbDrizzle;
}
