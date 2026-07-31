// @ts-nocheck
import { drizzle } from 'drizzle-orm/sql-js';
import * as schemaModule from './schema';
// seedData YA NO SE IMPORTA a proposito. Abrir la base no siembra: ver el bloque del final
// de getDb(). El sembrado vive solo en src/scripts/seed.ts y se corre a mano con
// `pnpm db:seed`. Dejar el import aunque no se use invitaria a volver a llamarlo.
// import { seedData } from '../scripts/seed';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const schema = schemaModule;

let dbInstance = null;
let dbDrizzle = null;

/**
 * Ruta del archivo de base de datos.
 *
 * Antes esto era `path.resolve(process.cwd(), 'sistema_inventario.db')`, o sea que
 * la base que se abria DEPENDIA del directorio desde el que se corriera el
 * comando. Y como `getDb()` crea y siembra la base cuando el archivo no existe,
 * correr cualquier script desde la raiz del monorepo fabricaba una base nueva
 * ahi, sembrada del Excel y SIN las 228 lineas de detalle_acc ni los 28 precios
 * de adquisicion, porque esos vinieron de importadores y no del sembrado.
 *
 * Efecto: un script corrido desde el directorio equivocado calculaba contra datos
 * incompletos y devolvia numeros plausibles pero falsos, sin ninguna senal. Es la
 * misma familia de problema que el falso verde del arnes de paridad: no falla,
 * responde mal.
 *
 * Ahora la ruta se resuelve contra la ubicacion de ESTE archivo, asi que es la
 * misma sin importar desde donde se ejecute. `SISTEMA_DB_PATH` permite apuntar a
 * una copia para experimentar sin tocar la base real.
 */
export function getDbFilePath() {
  if (process.env.SISTEMA_DB_PATH) {
    return path.resolve(process.env.SISTEMA_DB_PATH);
  }
  try {
    // Este archivo vive en packages/api/src/database/, la base en packages/api/.
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(aqui, '..', '..', 'sistema_inventario.db');
  } catch (e) {
    // Si el bundler no deja usar import.meta.url, se vuelve al comportamiento
    // anterior en vez de romper. Las rutas de Workers usan D1 y nunca llegan aca.
    return path.resolve(process.cwd(), 'sistema_inventario.db');
  }
}

/**
 * Instancia CRUDA de sql.js, no la de Drizzle.
 *
 * Hace falta para DDL. Drizzle no sabe recrear tablas, y en SQLite cambiar un
 * NOT NULL o quitar una columna exige recrear: no hay ALTER que lo haga. Un
 * comentario en copiarPesos.ts dice que se intento raw SQL por otra via y fallo,
 * asi que esto lo expone de forma explicita en vez de depender de internals de
 * Drizzle.
 *
 * Solo para scripts de migracion. Las rutas usan Drizzle.
 */
export function getRawDb() {
  if (!dbInstance) {
    throw new Error('La base no esta abierta todavia. Llamar getDb() antes de getRawDb().');
  }
  return dbInstance;
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
 -- Posicion cuando se ven varios colegios juntos. NULL = ordenar por fecha de creacion.
 "orden" integer,
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
 -- FASE 5: vocabulario de industria. precio_venta define que tallas se ofrecen.
 "colegio_id" text,
 "codigo" text NOT NULL,
 "nombre" text NOT NULL,
 "orden" integer NOT NULL,
 "activo" integer DEFAULT true NOT NULL
);
-- Que tallas ofrece cada colegio. SIN FILA = ACTIVA, para que una base existente
-- no cambie de comportamiento el dia que aparece la tabla. El unico por par impide
-- dos verdades sobre la misma combinacion.
CREATE TABLE IF NOT EXISTS "colegio_talla" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "activo" integer DEFAULT true NOT NULL,
 "orden" integer
);
CREATE UNIQUE INDEX IF NOT EXISTS "colegio_talla_unico" ON "colegio_talla" ("colegio_id", "talla_id");
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
 -- FASE 5: NULL = compartido.
 "colegio_id" text,
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
 -- FASE 5: NULL = compartido a nivel empresa.
 "colegio_id" text,
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
 -- FASE 5: sin colegio_id. El pool de indirectos es de la empresa.
 "anio_id" text,
 "concepto" text NOT NULL,
 "monto_mensual" real NOT NULL
);
CREATE TABLE IF NOT EXISTS "precio_adquisicion" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "precio_bs" real NOT NULL,
 "proveedor" text,
 "con_factura" integer DEFAULT false NOT NULL,
 "vigente_desde" text DEFAULT CURRENT_TIMESTAMP NOT NULL,
 "vigente_hasta" text
);
CREATE TABLE IF NOT EXISTS "precio_venta" (
 "id" text PRIMARY KEY NOT NULL,
 "producto_id" text NOT NULL,
 "talla_id" text NOT NULL,
 "precio_bs" real NOT NULL,
 "vigente_desde" text DEFAULT CURRENT_TIMESTAMP,
 "vigente_hasta" text,
 -- Codigo del producto-talla en el POS. Nullable: las filas que ya existen no lo
 -- tienen. Ver el comentario del schema para por que vive aca y no en "producto".
 "codigo_externo" text
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
 -- FASE 5: el tipo de cambio no es del colegio.
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
CREATE TABLE IF NOT EXISTS "costo_snapshot" (
  "id" text PRIMARY KEY NOT NULL,
  "nombre" text NOT NULL,
  "descripcion" text,
  "colegio_id" text,
  "datos_json" text NOT NULL,
  "creado_por" text,
  "creado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE IF NOT EXISTS "configuracion_sistema" (
 "id" text PRIMARY KEY NOT NULL,
 "clave" text NOT NULL UNIQUE,
 "valor" text NOT NULL,
 "descripcion" text,
 "actualizado_en" text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
`;

export interface OpcionesGetDb {
  /**
   * Abre la base SIN sembrar y SIN escribir el archivo.
   *
   * Por que hace falta. Abrir la base era una operacion de ESCRITURA: las DOS
   * ramas del if de mas abajo llaman a `seedData` y despues a `saveDbToDisk`,
   * tanto con la base vacia como con la base ya cargada. Asi que cualquier script
   * que dijera "simulacion, no escribe nada" escribia igual, porque el archivo se
   * reescribia antes de que corriera su primera linea.
   *
   * Las migraciones NO se saltean: los CREATE TABLE IF NOT EXISTS, los ALTER
   * TABLE y los indices van antes de este punto y son idempotentes. Lo unico que
   * se saltea es el sembrado de datos y la escritura del archivo.
   *
   * NOTA DE 2026-07-29, y la dejo escrita porque el comentario que estaba aca me
   * hizo perder cuatro verificaciones y casi le doy un susto al usuario.
   *
   * Decia, en PRESENTE, que `mano_obra` se borra completa y se reinserta desde el
   * Excel en cada arranque, y lo marcaba "pendiente de decision del usuario". Eso
   * ERA cierto y ya NO lo es: seed.ts tiene guarda de tabla vacia desde el mismo
   * dia, y la decision esta tomada y escrita ahi —la base manda, el Excel siembra
   * una sola vez—. Verificado en vivo: el arranque del servidor imprime
   * "Mano de Obra: 448 tarifas ya en la base, no se re-siembra".
   *
   * Si el texto viejo hubiera seguido siendo cierto, la mano de obra que copia
   * copiarPrenda.service.ts se habria borrado en el reinicio siguiente. Fui a
   * medirlo antes de avisar y no era asi.
   *
   * Es la misma clase de error que este refactor viene persiguiendo —una
   * afirmacion verdadera cuando se escribio y falsa ahora— pero en la
   * DOCUMENTACION en vez del codigo. Y es peor de lo que parece: un comentario
   * viejo no falla nunca, no rompe ningun test, y se lee con la misma confianza
   * que el codigo de al lado.
   */
  skipSeed?: boolean;
}

export async function getDb(opciones: OpcionesGetDb = {}) {
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

  // Modo de costeo de la prenda. Va como ALTER y no en el CREATE TABLE porque
  // las tablas se crean con IF NOT EXISTS: en una base ya existente el CREATE no
  // se vuelve a ejecutar y la columna nunca apareceria.
  try { dbInstance.run("ALTER TABLE \"producto\" ADD COLUMN \"modo_costeo\" TEXT DEFAULT 'confeccion';"); } catch (e) {}

  // Posicion del colegio cuando se ven varios juntos. NULL significa "ordenar por fecha de
  // creacion", asi que la columna nace vacia y el comportamiento no cambia hasta que el
  // usuario arrastre en Perfil & Colegios. Va como ALTER porque las tablas se crean con
  // IF NOT EXISTS y en una base existente el CREATE no se vuelve a ejecutar.
  try { dbInstance.run('ALTER TABLE "colegio" ADD COLUMN "orden" INTEGER;'); } catch (e) {}
  // Abreviatura del colegio: es la que forma `CC-01` en la columna Prod y la que empareja el
  // sufijo del codigo del POS con su colegio al importar. Aditivo e idempotente.
  try { dbInstance.run('ALTER TABLE "colegio" ADD COLUMN "abreviatura" TEXT;'); } catch (e) {}

  // Codigo del POS en precio_venta. Va como ALTER ademas del CREATE por la misma razon
  // que modo_costeo: las tablas se crean con IF NOT EXISTS, asi que en una base que ya
  // existe el CREATE no se vuelve a ejecutar y la columna nunca apareceria. El try vacio
  // es correcto aca: si la columna ya esta, ALTER tira y no hay nada que hacer.
  try { dbInstance.run('ALTER TABLE "precio_venta" ADD COLUMN "codigo_externo" TEXT;'); } catch (e) {}
  // Los cuatro INPUTS de un insumo que hasta ahora vivian solo en la tabla auxiliar de
  // CAMBRIDGE.xlsx. El costo de uso NO se agrega: se calcula (ver costoInsumo.ts).
  try { dbInstance.run('ALTER TABLE "accesorio" ADD COLUMN "unidades_por_prenda" REAL;'); } catch (e) {}
  try { dbInstance.run('ALTER TABLE "accesorio" ADD COLUMN "ojales" TEXT;'); } catch (e) {}
  try { dbInstance.run('ALTER TABLE "accesorio" ADD COLUMN "unidades_por_metro" REAL;'); } catch (e) {}
  try { dbInstance.run('ALTER TABLE "accesorio" ADD COLUMN "costo_cm2" REAL;'); } catch (e) {}

  // Un codigo del POS no puede apuntar a dos producto-talla distintos. El indice es
  // PARCIAL —solo sobre las filas que tienen codigo— porque las 297 que ya existen lo
  // tienen en NULL y un unique normal las tomaria como duplicadas entre si.
  try {
    dbInstance.run('CREATE UNIQUE INDEX IF NOT EXISTS "idx_precio_venta_codigo_externo" ON "precio_venta" ("codigo_externo") WHERE "codigo_externo" IS NOT NULL;');
  } catch (e) {
    // No se silencia: si falla es porque ya hay dos filas con el mismo codigo del POS, y
    // eso significa que una importacion escribio el mismo codigo en dos lugares. Hay que
    // resolverlo antes de volver a importar.
    console.warn('No se pudo crear el indice unico de codigo_externo en precio_venta. Probablemente haya dos filas con el mismo codigo del POS. Revisar antes de importar de nuevo.', e);
  }

  // Tallas activas por colegio. Se crea vacia a proposito: sin fila la talla esta
  // activa, asi que una base existente no cambia de comportamiento.
  try {
    dbInstance.run(`CREATE TABLE IF NOT EXISTS "colegio_talla" (
      "id" text PRIMARY KEY NOT NULL,
      "colegio_id" text NOT NULL,
      "talla_id" text NOT NULL,
      "activo" integer DEFAULT true NOT NULL,
      "orden" integer
    );`);
    dbInstance.run('CREATE UNIQUE INDEX IF NOT EXISTS "colegio_talla_unico" ON "colegio_talla" ("colegio_id", "talla_id");');
  } catch (e) {}

  // Integridad de la asignacion de accesorios a prendas (detalle_acc).
  // Las tablas se crean con "CREATE TABLE IF NOT EXISTS", asi que agregar la
  // restriccion al DDL no afectaria a bases ya existentes. Un indice unico si
  // se puede crear sobre una tabla que ya existe, y por eso va aparte.
  try {
    dbInstance.run('CREATE UNIQUE INDEX IF NOT EXISTS "idx_detalle_acc_prod_acc" ON "detalle_acc" ("producto_id", "accesorio_id");');
  } catch (e) {
    // No se silencia: si falla es porque ya hay lineas duplicadas y el costo de
    // esas prendas esta inflado. Hay que resolverlas a mano antes de continuar.
    console.warn('⚠️ No se pudo crear el indice unico de detalle_acc. Probablemente existan asignaciones duplicadas (producto_id + accesorio_id) que inflan el costo. Revisar antes de seguir.', e);
  }
  try { dbInstance.run('CREATE INDEX IF NOT EXISTS "idx_detalle_acc_producto" ON "detalle_acc" ("producto_id");'); } catch (e) {}
  try { dbInstance.run('CREATE INDEX IF NOT EXISTS "idx_detalle_acc_accesorio" ON "detalle_acc" ("accesorio_id");'); } catch (e) {}

  // Integridad de los precios de adquisicion: una prenda no puede tener dos
  // precios para la misma talla con la misma fecha de vigencia.
  try {
    dbInstance.run('CREATE UNIQUE INDEX IF NOT EXISTS "idx_precio_adq_prod_talla_desde" ON "precio_adquisicion" ("producto_id", "talla_id", "vigente_desde");');
  } catch (e) {
    console.warn('⚠️ No se pudo crear el indice unico de precio_adquisicion. Probablemente haya precios duplicados para la misma prenda, talla y fecha. Revisar.', e);
  }
  try { dbInstance.run('CREATE INDEX IF NOT EXISTS "idx_precio_adq_producto" ON "precio_adquisicion" ("producto_id");'); } catch (e) {}

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

  if (opciones.skipSeed) {
    console.log(
      `🔒 Base de datos abierta en modo solo lectura (${dbPath}), ${rowCount} colegio(s). ` +
      `No se sembro nada y no se escribio el archivo.`
    );
    return dbDrizzle;
  }

  // ---------------------------------------------------------------------------
  // ABRIR LA BASE ES UNA OPERACION DE LECTURA. No siembra y no escribe el archivo.
  //
  // DECISION DEL USUARIO, 31-jul-2026, textual: "ya no quiero nada del sembrado desde
  // CAMBRIDGE.xlsx, los datos ya estan en la bd, quita completamente el sembrado de la
  // logica". Los datos definitivos viven en la base y el Excel no tiene nada que aportar.
  //
  // QUE HACIA ANTES, y por que estaba mal aunque no perdiera datos:
  //
  //   1. Llamaba a `seedData` en las DOS ramas —base vacia y base cargada— asi que abria y
  //      parseaba CAMBRIDGE.xlsx en cada arranque. El servidor dependia de un archivo que
  //      ya no aporta nada: moverlo rompia el arranque.
  //
  //   2. Llamaba a `saveDbToDisk()` aunque `seedData` no hubiera insertado una sola fila.
  //      Eso convertia "abrir la base" en una ESCRITURA, y tuvo una consecuencia concreta:
  //      un arranque que despues fallo por el puerto ocupado ya habia reescrito el archivo
  //      de la base del usuario antes de morirse.
  //
  //   3. Imprimia "Todos los datos fijos han sido completamente insertados" cuando no
  //      inserto nada. Un mensaje que afirma mas de lo que hizo es peor que ninguno.
  //
  //   4. Dejaba una trampa: las guardas de `seedData` son "si la tabla esta vacia". El dia
  //      que una tabla quedara vacia —un borrado, una restauracion incompleta— el arranque
  //      siguiente la resembraba desde el Excel, en silencio y sin que nadie lo pidiera.
  //
  // Las MIGRACIONES no se tocan y siguen corriendo arriba: los CREATE TABLE IF NOT EXISTS,
  // los ALTER TABLE y los indices son idempotentes y no dependen de ningun Excel.
  //
  // `seedData` sigue existiendo en src/scripts/seed.ts, alcanzable solo a mano con
  // `pnpm db:seed`, para una instalacion desde cero. NADA lo llama automaticamente.
  // ---------------------------------------------------------------------------
  if (rowCount > 0) {
    console.log(`✅ Base de datos cargada desde disco (${dbPath}) con ${rowCount} colegio(s).`);
  } else {
    // Una base vacia ya NO se siembra sola. Se dice, con la instruccion exacta, en vez de
    // rellenarla con datos de otro colegio a espaldas del usuario.
    console.warn(
      `⚠️  La base en ${dbPath} no tiene ningun colegio. No se siembra nada automaticamente.\n` +
      `    Si es una instalacion nueva y queres los datos de ejemplo: pnpm db:seed`
    );
  }

  return dbDrizzle;
}
