/**
 * FASE 5 — migracion del catalogo a nivel empresa. DRY-RUN POR DEFECTO.
 *
 * Nueve tablas llevan `colegio_id` y solo cuatro deberian. Esta migracion arregla
 * las cinco sobre-scopeadas:
 *
 *   accesorio        colegio_id pasa a NULLABLE. NULL = compartido.
 *   tela             idem.
 *   talla            idem. Como precio_venta ya define que tallas se ofrecen, la
 *                    tabla es solo un vocabulario de codigos de industria.
 *   costo_indirecto  se ELIMINA la columna. Decidido: el pool es de la empresa.
 *   per_soles        se ELIMINA la columna. El tipo de cambio no es del colegio.
 *
 * POR QUE AHORA. Con un solo colegio no hay filas repetidas que fusionar, asi que
 * esto es DDL puro: sin migracion de datos ni repunte de claves foraneas. El dia
 * que exista un segundo colegio, el mismo cambio exige un pase de deduplicacion
 * con fusion de filas y repunte de detalle_acc. Es el momento mas facil que va a
 * haber.
 *
 * CLASIFICACION, confirmada por el usuario el 29-jul-2026. Son del colegio los
 * insumos que llevan la identidad de Cambridge: los bordados, las serigrafias, los
 * vinilos, el cuello y la botamanga (vienen tejidos en los colores del colegio), y
 * la tela escocesa, que es el tartan. Todo lo demas — botones, cierres, elasticos,
 * hilo, etiquetas, entretelas, y las otras once telas — es generico de la empresa.
 *
 * SQLite no permite cambiar NOT NULL ni quitar una columna con un ALTER, asi que
 * cada tabla se recrea: se crea la nueva, se copian las filas nombrando las
 * columnas una por una (nunca `SELECT *`, que depende del orden), se borra la
 * vieja y se renombra. Todo dentro de una transaccion.
 *
 * USO
 *   npx tsx src/scripts/migrarCatalogoCompartido.ts            simulacion
 *   npx tsx src/scripts/migrarCatalogoCompartido.ts --aplicar   escribe
 *
 * Con --aplicar hace un backup del .db antes de tocar nada.
 */

import fs from 'fs';
import { getDb, getRawDb, getDbFilePath, saveDbToDisk } from '../database/sqljs';

const APLICAR = process.argv.includes('--aplicar');
const SEP = '='.repeat(78);

/** Accesorios que llevan la identidad del colegio. Confirmado por el usuario. */
const ACCESORIOS_DEL_COLEGIO = [
  'Bordado escudo',
  'Bordado espalda Chamarra',
  'Serigrafia escudo polera',
  'Serigrafia rectangulo polera, espalda',
  'Serigrafía calza',
  'Serigrafia Bullying',
  'Serigrafia polera colores',
  'Vinilo Calzas',
  'Vinilo para shorts',
  'Cuello',
  'Botamanga (par)',
];

/** El tartan de Cambridge. */
const TELAS_DEL_COLEGIO = [
  'Tela Casimir Escoces para faldas/vestidos/corbatas/',
];

function main() {
  console.log(SEP);
  console.log(`  CATALOGO A NIVEL EMPRESA — ${APLICAR ? 'APLICANDO' : 'SIMULACION, no escribe nada'}`);
  console.log(SEP);

  return getDb({ skipSeed: true }).then(() => {
    const raw = getRawDb();

    const uno = (sql: string): any => {
      const r = raw.exec(sql);
      return r[0]?.values?.[0]?.[0];
    };
    const filas = (sql: string): any[][] => {
      const r = raw.exec(sql);
      return r[0]?.values || [];
    };

    // ---------- Precondiciones ----------
    const nColegios = Number(uno('SELECT COUNT(*) FROM colegio;')) || 0;
    const colegioId = uno('SELECT id FROM colegio LIMIT 1;');

    console.log('');
    console.log(`Colegios: ${nColegios}`);
    if (nColegios !== 1) {
      console.log('');
      console.log('ABORTA: esta migracion asume UN colegio.');
      console.log('Con dos o mas hay que hacer antes un pase de deduplicacion: identificar el');
      console.log('mismo insumo repetido entre colegios, fusionarlo y repuntar detalle_acc.');
      return;
    }

    // ---------- Estado real, medido en dimensiones INDEPENDIENTES ----------
    //
    // La primera version de esto miraba solo el flag notnull de PRAGMA table_info y
    // salia con "YA MIGRADA" si la columna era nullable. Eso conflacionaba dos cosas
    // distintas: que la columna ACEPTE NULL y que la clasificacion se haya APLICADO.
    // Si la columna se volvia nullable por cualquier otra via — un DDL de arranque
    // actualizado, una tabla recreada a mano — el script salia temprano y dejaba los
    // 38 accesorios apuntando al colegio, ninguno compartido: trabajo a medias
    // reportado como exito. Paso exactamente eso.
    //
    // Ahora se mide cada cosa por separado y se hace solo lo que falta.
    const infoDe = (tabla: string) => filas("PRAGMA table_info('" + tabla + "');");
    const tieneColumna = (tabla: string) =>
      infoDe(tabla).some((f) => String(f[1]) === 'colegio_id');
    const esNullable = (tabla: string) => {
      const col = infoDe(tabla).find((f) => String(f[1]) === 'colegio_id');
      return col ? Number(col[3]) === 0 : null;
    };
    const nulls = (tabla: string) =>
      Number(uno('SELECT COUNT(*) FROM ' + tabla + ' WHERE colegio_id IS NULL;')) || 0;

    const estado = {
      accNullable: esNullable('accesorio'),
      telaNullable: esNullable('tela'),
      tallaNullable: esNullable('talla'),
      ciTieneColumna: tieneColumna('costo_indirecto'),
      psTieneColumna: tieneColumna('per_soles'),
      accNulls: tieneColumna('accesorio') ? nulls('accesorio') : 0,
      telaNulls: tieneColumna('tela') ? nulls('tela') : 0,
      tallaNulls: tieneColumna('talla') ? nulls('talla') : 0,
    };

    console.log('');
    console.log(SEP);
    console.log('  ESTADO ACTUAL DE LA BASE');
    console.log(SEP);
    console.log('  accesorio.colegio_id nullable:    ' + estado.accNullable);
    console.log('  tela.colegio_id nullable:         ' + estado.telaNullable);
    console.log('  talla.colegio_id nullable:        ' + estado.tallaNullable);
    console.log('  costo_indirecto tiene colegio_id: ' + estado.ciTieneColumna);
    console.log('  per_soles tiene colegio_id:       ' + estado.psTieneColumna);
    console.log('  accesorios ya compartidos (NULL): ' + estado.accNulls);
    console.log('  telas ya compartidas (NULL):      ' + estado.telaNulls);
    console.log('  tallas ya compartidas (NULL):     ' + estado.tallaNulls);

    // Que falta hacer, en dos frentes separados.
    const faltaDDL =
      estado.accNullable === false ||
      estado.telaNullable === false ||
      estado.tallaNullable === false ||
      estado.ciTieneColumna ||
      estado.psTieneColumna;

    const faltaClasificacion =
      estado.accNulls === 0 || estado.telaNulls === 0 || estado.tallaNulls === 0;

    console.log('');
    console.log('  Falta recrear tablas (DDL): ' + (faltaDDL ? 'SI' : 'no'));
    console.log('  Falta clasificar:           ' + (faltaClasificacion ? 'SI' : 'no'));

    if (!faltaDDL && !faltaClasificacion) {
      console.log('');
      console.log('YA MIGRADA por completo: las tres columnas son nullables, las dos sobrantes');
      console.log('desaparecieron, y la clasificacion esta aplicada. No se hace nada.');
      return;
    }

    const conteos: Record<string, number> = {};
    for (const t of ['accesorio', 'tela', 'talla', 'costo_indirecto', 'per_soles', 'detalle_acc', 'producto']) {
      conteos[t] = Number(uno(`SELECT COUNT(*) FROM ${t};`)) || 0;
    }
    console.log(
      `Filas: accesorio ${conteos.accesorio}, tela ${conteos.tela}, talla ${conteos.talla}, ` +
      `costo_indirecto ${conteos.costo_indirecto}, per_soles ${conteos.per_soles}`
    );

    // ---------- Verificar que la clasificacion matchea ----------
    // Si un nombre no matchea, el insumo se volveria COMPARTIDO en silencio. Eso
    // no puede pasar: se aborta y se dice cual.
    console.log('');
    console.log(SEP);
    console.log('  CLASIFICACION — verificando que los nombres existen');
    console.log(SEP);

    const esc = (s: string) => s.replace(/'/g, "''");
    const noMatchean: string[] = [];

    for (const nombre of ACCESORIOS_DEL_COLEGIO) {
      const n = Number(uno(`SELECT COUNT(*) FROM accesorio WHERE descripcion = '${esc(nombre)}';`)) || 0;
      console.log(`  ${n === 1 ? 'ok  ' : 'FALLA'} accesorio  ${nombre}${n !== 1 ? `  (${n} coincidencias)` : ''}`);
      if (n !== 1) noMatchean.push(`accesorio: ${nombre} (${n} coincidencias)`);
    }
    for (const nombre of TELAS_DEL_COLEGIO) {
      const n = Number(uno(`SELECT COUNT(*) FROM tela WHERE descripcion = '${esc(nombre)}';`)) || 0;
      console.log(`  ${n === 1 ? 'ok  ' : 'FALLA'} tela       ${nombre}${n !== 1 ? `  (${n} coincidencias)` : ''}`);
      if (n !== 1) noMatchean.push(`tela: ${nombre} (${n} coincidencias)`);
    }

    if (noMatchean.length > 0) {
      console.log('');
      console.log('ABORTA: hay nombres de la clasificacion que no matchean exactamente una fila.');
      console.log('Si se siguiera, esos insumos quedarian COMPARTIDOS en silencio, que es');
      console.log('justo el error que esta verificacion existe para evitar. Revisar acentos y');
      console.log('espacios; los nombres del catalogo son inconsistentes ("Serigrafía calza"');
      console.log('con acento contra "Serigrafia Bullying" sin acento).');
      noMatchean.forEach((s) => console.log(`  - ${s}`));
      return;
    }

    const compartidosAcc = conteos.accesorio - ACCESORIOS_DEL_COLEGIO.length;
    const compartidasTelas = conteos.tela - TELAS_DEL_COLEGIO.length;
    console.log('');
    console.log(`  ${compartidosAcc} accesorios compartidos, ${ACCESORIOS_DEL_COLEGIO.length} del colegio.`);
    console.log(`  ${compartidasTelas} telas compartidas, ${TELAS_DEL_COLEGIO.length} del colegio.`);
    console.log(`  ${conteos.talla} tallas, todas compartidas.`);
    console.log(`  costo_indirecto y per_soles pierden la columna colegio_id.`);

    if (!APLICAR) {
      console.log('');
      console.log(SEP);
      console.log('SIMULACION: no se escribio nada. Para aplicar, agregar --aplicar.');
      console.log('Se va a hacer un backup del .db antes de tocar nada.');
      console.log(SEP);
      return;
    }

    // ---------- Backup ----------
    const dbPath = getDbFilePath();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = `${dbPath}.antes-fase5-${stamp}`;
    fs.copyFileSync(dbPath, backup);
    console.log('');
    console.log(`BACKUP: ${backup}`);

    // ---------- Migracion ----------
    // Las columnas se nombran una por una a proposito. `INSERT INTO nueva SELECT *`
    // depende del orden de las columnas y falla en silencio si alguien agrego una.
    const pasos: Array<{ tabla: string; ddl: string; columnas: string[] }> = [
      {
        tabla: 'accesorio',
        ddl: `CREATE TABLE "accesorio_nueva" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text,
 "descripcion" text NOT NULL,
 "codigo" text,
 "unidad_compra" text NOT NULL,
 "cantidad_x_ud" real NOT NULL,
 "costo_ud_compra" real NOT NULL,
 "costo_unitario" real NOT NULL,
 "activo" integer DEFAULT true NOT NULL
)`,
        columnas: ['id', 'colegio_id', 'descripcion', 'codigo', 'unidad_compra', 'cantidad_x_ud', 'costo_ud_compra', 'costo_unitario', 'activo'],
      },
      {
        tabla: 'tela',
        ddl: `CREATE TABLE "tela_nueva" (
 "id" text PRIMARY KEY NOT NULL,
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
)`,
        columnas: ['id', 'colegio_id', 'orden', 'descripcion', 'rendimiento', 'ancho_mts', 'unid', 'densidad_g_m2', 'peso_mt_lineal', 'precio_compra', 'precio_bs_kg', 'precio_bs_g', 'precio_unitario', 'activo'],
      },
      {
        tabla: 'talla',
        ddl: `CREATE TABLE "talla_nueva" (
 "id" text PRIMARY KEY NOT NULL,
 "colegio_id" text,
 "codigo" text NOT NULL,
 "nombre" text NOT NULL,
 "orden" integer NOT NULL,
 "activo" integer DEFAULT true NOT NULL
)`,
        columnas: ['id', 'colegio_id', 'codigo', 'nombre', 'orden', 'activo'],
      },
      {
        tabla: 'costo_indirecto',
        ddl: `CREATE TABLE "costo_indirecto_nueva" (
 "id" text PRIMARY KEY NOT NULL,
 "anio_id" text,
 "concepto" text NOT NULL,
 "monto_mensual" real NOT NULL
)`,
        columnas: ['id', 'anio_id', 'concepto', 'monto_mensual'],
      },
      {
        tabla: 'per_soles',
        ddl: `CREATE TABLE "per_soles_nueva" (
 "id" text PRIMARY KEY NOT NULL,
 "tipo_cambio" real NOT NULL,
 "vigente_desde" text DEFAULT CURRENT_TIMESTAMP NOT NULL
)`,
        columnas: ['id', 'tipo_cambio', 'vigente_desde'],
      },
    ];

    console.log('');
    console.log(SEP);
    console.log('  APLICANDO');
    console.log(SEP);

    try {
      raw.run('PRAGMA foreign_keys=OFF;');
      raw.run('BEGIN TRANSACTION;');

      // Solo se recrea si hace falta. Si el DDL ya esta bien y lo unico que falta es
      // la clasificacion, recrear seria trabajo inutil con riesgo gratis.
      for (const p of (faltaDDL ? pasos : [])) {
        const cols = p.columnas.map((c) => `"${c}"`).join(', ');
        raw.run(p.ddl);
        raw.run(`INSERT INTO "${p.tabla}_nueva" (${cols}) SELECT ${cols} FROM "${p.tabla}";`);
        raw.run(`DROP TABLE "${p.tabla}";`);
        raw.run(`ALTER TABLE "${p.tabla}_nueva" RENAME TO "${p.tabla}";`);
        console.log(`  ok  ${p.tabla} recreada`);
      }

      // Compartido = NULL. Se pone NULL en TODO y despues se marcan los del colegio,
      // asi ningun insumo queda scopeado por olvido.
      raw.run('UPDATE accesorio SET colegio_id = NULL;');
      raw.run('UPDATE tela SET colegio_id = NULL;');
      raw.run('UPDATE talla SET colegio_id = NULL;');

      for (const nombre of ACCESORIOS_DEL_COLEGIO) {
        raw.run(`UPDATE accesorio SET colegio_id = '${esc(String(colegioId))}' WHERE descripcion = '${esc(nombre)}';`);
      }
      for (const nombre of TELAS_DEL_COLEGIO) {
        raw.run(`UPDATE tela SET colegio_id = '${esc(String(colegioId))}' WHERE descripcion = '${esc(nombre)}';`);
      }

      raw.run('COMMIT;');
      raw.run('PRAGMA foreign_keys=ON;');
      console.log('  ok  clasificacion aplicada');
    } catch (e) {
      try { raw.run('ROLLBACK;'); } catch (e2) {}
      console.log('');
      console.log('ERROR durante la migracion, se hizo ROLLBACK. La base quedo como estaba.');
      console.log(`Backup por si acaso: ${backup}`);
      throw e;
    }

    // ---------- Verificacion ----------
    console.log('');
    console.log(SEP);
    console.log('  VERIFICACION');
    console.log(SEP);

    let fallas = 0;
    const chequear = (etiqueta: string, obtenido: any, esperado: any) => {
      const ok = String(obtenido) === String(esperado);
      if (!ok) fallas++;
      console.log(`  ${ok ? 'ok  ' : 'FALLA'} ${etiqueta}: ${obtenido}${ok ? '' : ` (esperado ${esperado})`}`);
    };

    for (const t of ['accesorio', 'tela', 'talla', 'costo_indirecto', 'per_soles']) {
      chequear(`filas en ${t}`, uno(`SELECT COUNT(*) FROM ${t};`), conteos[t]);
    }
    chequear('accesorios del colegio', uno('SELECT COUNT(*) FROM accesorio WHERE colegio_id IS NOT NULL;'), ACCESORIOS_DEL_COLEGIO.length);
    chequear('accesorios compartidos', uno('SELECT COUNT(*) FROM accesorio WHERE colegio_id IS NULL;'), compartidosAcc);
    chequear('telas del colegio', uno('SELECT COUNT(*) FROM tela WHERE colegio_id IS NOT NULL;'), TELAS_DEL_COLEGIO.length);
    chequear('telas compartidas', uno('SELECT COUNT(*) FROM tela WHERE colegio_id IS NULL;'), compartidasTelas);
    chequear('tallas compartidas', uno('SELECT COUNT(*) FROM talla WHERE colegio_id IS NULL;'), conteos.talla);

    // Integridad referencial: nada puede haber quedado huerfano.
    chequear(
      'lineas de detalle_acc sin accesorio',
      uno('SELECT COUNT(*) FROM detalle_acc d LEFT JOIN accesorio a ON a.id = d.accesorio_id WHERE a.id IS NULL;'),
      0
    );
    chequear(
      'prendas con tela_id inexistente',
      uno('SELECT COUNT(*) FROM producto p LEFT JOIN tela t ON t.id = p.tela_id WHERE p.tela_id IS NOT NULL AND t.id IS NULL;'),
      0
    );
    chequear(
      'pesos con talla inexistente',
      uno('SELECT COUNT(*) FROM peso_mat_prima m LEFT JOIN talla t ON t.id = m.talla_id WHERE t.id IS NULL;'),
      0
    );
    chequear(
      'precios de venta con talla inexistente',
      uno('SELECT COUNT(*) FROM precio_venta v LEFT JOIN talla t ON t.id = v.talla_id WHERE t.id IS NULL;'),
      0
    );

    if (fallas > 0) {
      console.log('');
      console.log(`ATENCION: ${fallas} verificaciones fallaron. NO se guardo en disco.`);
      console.log(`Restaurar desde el backup: ${backup}`);
      return;
    }

    saveDbToDisk();
    console.log('');
    console.log('Todas las verificaciones pasaron. Base guardada en disco.');
    console.log(`Backup previo: ${backup}`);
    console.log(SEP);
  });
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
