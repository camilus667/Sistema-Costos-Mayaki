/**
 * Diagnostico de integridad por colegio: busca filas HUERFANAS.
 *
 * POR QUE EXISTE. El usuario reporto que con 27 prendas en un colegio y 1 en el otro, el
 * total de TODA LA EMPRESA daba 29. Un +1 exacto que no aparece en ninguno de los dos
 * filtros pero si en el total significa una fila cuyo colegio_id no coincide con ningun
 * colegio existente: ningun filtro la encuentra y el conteo sin filtro la cuenta.
 *
 * EL SOSPECHOSO. crearNuevaPrenda del dashboard hace:
 *
 *   fetch('/api/colegios/' + colegioFiltroActual + '/prendas', ...)
 *
 * y POST /:id/prendas toma el colegioId del path SIN VALIDAR que ese colegio exista. Con
 * el ambito en 'all' —que era el estado por defecto mientras el literal 'CAMBRIDGE' roto
 * dejaba caer el selector ahi— eso llamaba a /api/colegios/all/prendas y creaba una
 * prenda con colegio_id = 'all'.
 *
 * SQLite no lo impide: las foreign keys estan APAGADAS por defecto, y este proyecto solo
 * las prende para el DDL de la migracion. Asi que una FK que apunta a la nada se inserta
 * sin protestar.
 *
 * Este script NO decide ni corrige: reporta. Corregir una fila huerfana es una decision
 * —reasignarla a un colegio o borrarla— y depende de que sea esa prenda.
 *
 * SOLO LEE. Abre la base con skipSeed y no escribe una sola fila.
 *
 * Uso:  pnpm tsx src/scripts/diagnosticoColegios.ts
 */

import { getDb, getRawDb } from '../database/sqljs';

const SEP = '='.repeat(78);

function filas(sql: string): any[][] {
  const raw = getRawDb();
  const res = raw.exec(sql);
  return res.length ? res[0].values : [];
}

function uno(sql: string): any {
  const f = filas(sql);
  return f.length ? f[0][0] : null;
}

async function main() {
  console.log(SEP);
  console.log('  INTEGRIDAD POR COLEGIO  —  filas huerfanas');
  console.log(SEP);

  await getDb({ skipSeed: true });

  // ------------------------------------------------------------- colegios
  const colegios = filas('SELECT id, nombre FROM colegio ORDER BY nombre;');
  console.log('');
  console.log(`Colegios existentes: ${colegios.length}`);
  for (const [id, nombre] of colegios) {
    const n = uno(`SELECT COUNT(*) FROM producto WHERE colegio_id = '${String(id).replace(/'/g, "''")}';`);
    console.log(`  ${String(nombre).padEnd(26)} ${String(n).padStart(4)} prenda(s)   ${id}`);
  }

  const totalPrendas = Number(uno('SELECT COUNT(*) FROM producto;')) || 0;
  const sumaPorColegio = colegios.reduce((t, [id]) => {
    return t + (Number(uno(`SELECT COUNT(*) FROM producto WHERE colegio_id = '${String(id).replace(/'/g, "''")}';`)) || 0);
  }, 0);

  console.log('');
  console.log(`  Total de prendas en la tabla:        ${totalPrendas}`);
  console.log(`  Suma de las prendas por colegio:    ${sumaPorColegio}`);
  console.log(`  DIFERENCIA:                         ${totalPrendas - sumaPorColegio}`);

  if (totalPrendas === sumaPorColegio) {
    console.log('  Las dos cuentas cierran: no hay prendas huerfanas.');
  } else {
    console.log('  NO CIERRAN. Las que faltan son prendas cuyo colegio_id no existe.');
  }

  // ------------------------------------------------- prendas huerfanas
  console.log('');
  console.log(SEP);
  console.log('  PRENDAS CON UN colegio_id QUE NO EXISTE');
  console.log(SEP);

  const huerfanas = filas(`
    SELECT p.id, p.item_numero, p.descripcion, p.colegio_id, p.activo
    FROM producto p
    LEFT JOIN colegio c ON c.id = p.colegio_id
    WHERE c.id IS NULL
    ORDER BY p.item_numero;
  `);

  if (huerfanas.length === 0) {
    console.log('  Ninguna.');
  } else {
    console.log(`  ${huerfanas.length} prenda(s) apuntan a un colegio inexistente:`);
    console.log('');
    for (const [id, item, desc, colId, activo] of huerfanas) {
      console.log(`    item ${String(item).padStart(3)}  ${String(desc).padEnd(28)} activo=${activo}`);
      console.log(`              colegio_id = ${JSON.stringify(colId)}`);
      console.log(`              producto.id = ${id}`);
      // Que arrastra esa prenda: si tiene datos, borrarla no es gratis.
      const q = (t: string) => uno(`SELECT COUNT(*) FROM ${t} WHERE producto_id = '${String(id).replace(/'/g, "''")}';`);
      console.log(
        `              arrastra: ${q('precio_venta')} precio(s), ${q('inventario')} fila(s) de inventario, ` +
        `${q('peso_mat_prima')} peso(s), ${q('mano_obra')} mano de obra, ${q('detalle_acc')} linea(s) de receta`
      );
      console.log('');
    }
    console.log('  COMO SE CREAN. POST /api/colegios/:id/prendas toma el colegio del path y no');
    console.log('  valida que exista. Con el ambito en "all", el dashboard llamaba a');
    console.log('  /api/colegios/all/prendas y la prenda quedaba con colegio_id = "all".');
    console.log('  SQLite no lo impide: las foreign keys estan apagadas por defecto.');
    console.log('');
    console.log('  QUE HACER, y es una decision tuya, no del script:');
    console.log('    - si es una prenda de prueba: borrarla junto con lo que arrastra;');
    console.log('    - si es una prenda real mal asignada: cambiarle el colegio_id al correcto.');
    console.log('  El script no toca nada porque las dos salidas son irreversibles y solo vos');
    console.log('  sabes que es esa prenda.');
  }

  // ------------------------------------------ otras tablas con colegio
  console.log('');
  console.log(SEP);
  console.log('  OTRAS TABLAS QUE LLEVAN COLEGIO');
  console.log(SEP);

  for (const tabla of ['anio_escolar', 'usuario_colegio', 'tela', 'talla', 'accesorio']) {
    const total = Number(uno(`SELECT COUNT(*) FROM ${tabla};`)) || 0;
    const nulos = Number(uno(`SELECT COUNT(*) FROM ${tabla} WHERE colegio_id IS NULL;`)) || 0;
    const orfanos = Number(uno(`
      SELECT COUNT(*) FROM ${tabla} t
      LEFT JOIN colegio c ON c.id = t.colegio_id
      WHERE t.colegio_id IS NOT NULL AND c.id IS NULL;
    `)) || 0;
    const nota = orfanos > 0 ? '  <-- HUERFANAS' : '';
    console.log(`  ${tabla.padEnd(16)} ${String(total).padStart(4)} filas, ${String(nulos).padStart(3)} compartidas (NULL), ${String(orfanos).padStart(3)} huerfanas${nota}`);
  }

  // ------------------------------------- derivadas que apuntan a la nada
  console.log('');
  console.log(SEP);
  console.log('  TABLAS DERIVADAS QUE APUNTAN A UNA PRENDA INEXISTENTE');
  console.log(SEP);

  for (const tabla of ['precio_venta', 'inventario', 'peso_mat_prima', 'mano_obra', 'detalle_acc', 'inventario_transaccion']) {
    const orfanos = Number(uno(`
      SELECT COUNT(*) FROM ${tabla} d
      LEFT JOIN producto p ON p.id = d.producto_id
      WHERE p.id IS NULL;
    `)) || 0;
    const total = Number(uno(`SELECT COUNT(*) FROM ${tabla};`)) || 0;
    const nota = orfanos > 0 ? '  <-- HUERFANAS' : '';
    console.log(`  ${tabla.padEnd(24)} ${String(total).padStart(5)} filas, ${String(orfanos).padStart(4)} sin prenda${nota}`);
  }

  console.log('');
  console.log(SEP);
  console.log('  Este diagnostico no corrige nada. Solo lee.');
  console.log(SEP);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
