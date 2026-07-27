import { getDb } from '../database/sqljs';
import * as schema from '../database/schema';
import { eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findExcelPath(): string {
  const possiblePaths = [
    path.resolve(process.cwd(), 'CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '../CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '../../CAMBRIDGE.xlsx'),
    path.resolve(process.cwd(), '../../../CAMBRIDGE.xlsx'),
    path.resolve(__dirname, '../../../../CAMBRIDGE.xlsx'),
    path.resolve(__dirname, '../../../CAMBRIDGE.xlsx'),
    path.resolve(__dirname, '../../../../../CAMBRIDGE.xlsx'),
    path.resolve('j:/_Antigravity/SISTEMA INVENTARIO/CAMBRIDGE.xlsx'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error('No se encontró el archivo CAMBRIDGE.xlsx en las rutas buscadas.');
}

export async function seedData(db: any) {
  const excelPath = findExcelPath();
  console.log(`🌱 Cargando datos fijos en la BD desde: ${excelPath}`);

  const fileBuffer = fs.readFileSync(excelPath);
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

  // 1. COLEGIO
  const existingColegios = await db.select().from(schema.colegios);
  let colegio = existingColegios[0];

  if (!colegio) {
    [colegio] = await db.insert(schema.colegios).values({
      nombre: 'CAMBRIDGE',
      direccion: 'Av. Principal Cambridge',
      nit: '1029384756',
      telefono: '77000000',
      activo: true,
    }).returning();
    console.log(`  ✅ Colegio en DB: ${colegio.nombre}`);
  }

  // 2. AÑO ESCOLAR
  const existingAnios = await db.select().from(schema.aniosEscolares);
  let anio = existingAnios[0];
  if (!anio) {
    [anio] = await db.insert(schema.aniosEscolares).values({
      colegioId: colegio.id,
      anio: '2026',
      periodo: '2026-2027',
      activo: true,
    }).returning();
    console.log(`  ✅ Año Escolar en DB: ${anio.anio}`);
  }

  // 3. USUARIO ADMIN
  const existingUsuarios = await db.select().from(schema.usuarios);
  let usuario = existingUsuarios[0];
  if (!usuario) {
    [usuario] = await db.insert(schema.usuarios).values({
      nombre: 'Admin Cambridge',
      email: 'admin@cambridge.edu',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz123456',
      rol: 'admin',
      activo: true,
    }).returning();

    await db.insert(schema.usuarioColegios).values({
      usuarioId: usuario.id,
      colegioId: colegio.id,
      rolColegio: 'admin',
    });
    console.log(`  ✅ Usuario Admin en DB: ${usuario.email}`);
  }

  // 4. TALLAS (desde hoja INVENTARIO)
  const inventarioSheet = workbook.Sheets['INVENTARIO'];
  const inventarioRows = XLSX.utils.sheet_to_json<any[]>(inventarioSheet, { header: 1 });
  const tallasHeader = inventarioRows[1].slice(2);

  let tallas = await db.select().from(schema.tallas);
  if (tallas.length === 0) {
    tallas = await db.insert(schema.tallas).values(
      tallasHeader.map((codigo: any, idx: number) => ({
        colegioId: colegio.id,
        codigo: String(codigo),
        nombre: `Talla ${codigo}`,
        orden: idx + 1,
        activo: true,
      }))
    ).returning();
    console.log(`  ✅ Tallas en DB: ${tallas.length}`);
  }

  // 5. PRODUCTOS & FIJOS DE FIJOSXPRENDA
  let fxpMap = new Map<number, { costoFijo: number; factor: number }>();
  if (workbook.Sheets['fijosXprenda']) {
    const fxpRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['fijosXprenda'], { header: 1 });
    fxpRows.slice(2).forEach(row => {
      if (row && typeof row[0] === 'number') {
        fxpMap.set(Number(row[0]), {
          factor: Number(row[2]) || 1,
          costoFijo: Number(row[3]) || 0,
        });
      }
    });
  }

  let productos = await db.select().from(schema.productos);
  if (productos.length === 0) {
    const dataRows = inventarioRows.slice(2).filter(r => r && r[0] && typeof r[0] === 'number');
    productos = await db.insert(schema.productos).values(
      dataRows.map((row) => {
        const itemNum = Number(row[0]);
        const fxpData = fxpMap.get(itemNum);
        return {
          colegioId: colegio.id,
          anioId: anio.id,
          itemNumero: itemNum,
          orden: itemNum,
          descripcion: String(row[1]).trim(),
          factorComplejidad: fxpData?.factor || 1,
          costoFijo: parseFloat((fxpData?.costoFijo || 0).toFixed(4)),
          planchadoExtra: 0,
          colocacionBotones: 0,
          operacionesExtra: 0,
          activo: true,
        };
      })
    ).returning();
    console.log(`  ✅ Productos con fijosXprenda en DB: ${productos.length}`);
  } else {
    // Migration: update factorComplejidad if all are still at default (1)
    const allFactorsDefault = productos.every((p: any) => (p.factorComplejidad || 1) === 1);
    if (allFactorsDefault && fxpMap.size > 0) {
      console.log('  🔄 Migrando factorComplejidad desde Excel...');
      for (const prod of productos) {
        const fxpData = fxpMap.get((prod as any).itemNumero);
        if (fxpData && fxpData.factor > 1) {
          await db.update(schema.productos).set({
            factorComplejidad: fxpData.factor,
          }).where(eq(schema.productos.id, (prod as any).id));
        }
      }
      productos = await db.select().from(schema.productos);
      console.log('  ✅ factorComplejidad migrado para', productos.length, 'productos');
    }
  }

  const productoMapByItem = new Map<number, any>();
  productos.forEach((p: any) => productoMapByItem.set(p.itemNumero, p));

  const tallaMapByIdx = new Map<number, any>();
  tallas.forEach((t: any, idx: number) => tallaMapByIdx.set(idx, t));

  // 6. TELAS (desde hoja Tela)
  let telas = await db.select().from(schema.telas);
  if (telas.length === 0 && workbook.Sheets['Tela']) {
    const telaRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['Tela'], { header: 1 });
    const dataRows = telaRows.filter(r => r && typeof r[0] === 'number');
    if (dataRows.length > 0) {
      telas = await db.insert(schema.telas).values(
        dataRows.map((row) => {
          const rendimiento = Number(row[2]) || 1;
          const anchoMts = Number(row[3]) || 1.5;
          const unid = row[4] ? String(row[4]).toLowerCase().trim() : 'kilo';
          const densidadGm2 = Number(row[5]) || 200;
          const pesoMtLineal = Number(row[6]) || (anchoMts * densidadGm2);
          const precioCompra = Number(row[7]) || 0;
          
          let precioBsKg = Number(row[8]);
          if (!precioBsKg || isNaN(precioBsKg)) {
            precioBsKg = unid === 'metro' ? precioCompra * rendimiento : precioCompra;
          }
          const precioBsG = Number(row[9]) || (precioBsKg / 1000);

          return {
            colegioId: colegio.id,
            descripcion: String(row[1]).trim(),
            rendimiento: parseFloat(rendimiento.toFixed(4)),
            anchoMts: parseFloat(anchoMts.toFixed(2)),
            unid: unid,
            densidadGm2: parseFloat(densidadGm2.toFixed(2)),
            pesoMtLineal: parseFloat(pesoMtLineal.toFixed(2)),
            precioCompra: parseFloat(precioCompra.toFixed(2)),
            precioBsKg: parseFloat(precioBsKg.toFixed(4)),
            precioBsG: parseFloat(precioBsG.toFixed(4)),
            precioUnitario: parseFloat(precioBsG.toFixed(4)),
            activo: true,
          };
        })
      ).returning();
      console.log(`  ✅ Telas en DB: ${telas.length}`);
    }
  }

  // 7. ACCESORIOS (desde hoja Acc)
  let accesorios = await db.select().from(schema.accesorios);
  if (accesorios.length === 0 && workbook.Sheets['Acc']) {
    const accRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['Acc'], { header: 1 });
    const startIdx = accRows.findIndex(r => r && r[0] === 'DESCRIPCION');
    if (startIdx !== -1) {
      const dataRows = accRows.slice(startIdx + 1).filter(r => r && r[0] && typeof r[0] === 'string' && r[1] !== undefined);
      accesorios = await db.insert(schema.accesorios).values(
        dataRows.map((row, idx) => ({
          colegioId: colegio.id,
          descripcion: String(row[0]).trim(),
          codigo: row[1] ? String(row[1]) : `ACC-${idx+1}`,
          unidadCompra: row[2] ? String(row[2]) : 'unidad',
          cantidadXUd: Number(row[3]) || 1,
          costoUdCompra: Number(row[4]) || 0,
          costoUnitario: Number(row[5]) || 0,
          activo: true,
        }))
      ).returning();
      console.log(`  ✅ Accesorios en DB: ${accesorios.length}`);
    }
  }

  // 8. PESO MATERIA PRIMA (Top: con merma, Bottom: exacto sin merma desde 'PESO DE MATERIA PRIMA ESTIMADO EN GRAMOS')
  const existingPeso = await db.select().from(schema.pesoMateriaPrima);
  if (existingPeso.length === 0 && workbook.Sheets['PesoMatPrima']) {
    const pesoRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['PesoMatPrima'], { header: 1 });
    
    // Buscar el porcentaje de merma inicial (fila 61: ['Merma', 8])
    const mermaRow = pesoRows.find(r => r && String(r[0]).trim().toUpperCase() === 'MERMA');
    const mermaPct = mermaRow && typeof mermaRow[1] === 'number' ? Number(mermaRow[1]) : 8;

    const sinMermaHeaderIdx = pesoRows.findIndex(r => r && String(r[0]).toUpperCase().includes('ESTIMADO'));
    
    const topRows = pesoRows.slice(2, sinMermaHeaderIdx !== -1 ? sinMermaHeaderIdx : 30).filter(r => r && typeof r[0] === 'number');
    const bottomRows = sinMermaHeaderIdx !== -1 ? pesoRows.slice(sinMermaHeaderIdx + 2).filter(r => r && typeof r[0] === 'number') : [];

    const bottomMap = new Map<string, number>();
    bottomRows.forEach(row => {
      const itemNum = Number(row[0]);
      tallas.forEach((talla: any, idx: number) => {
        const val = Number(row[2 + idx]) || 0;
        bottomMap.set(`${itemNum}_${idx}`, val);
      });
    });

    const pesoInserts: any[] = [];
    topRows.forEach((row) => {
      const itemNum = Number(row[0]);
      const prod = productoMapByItem.get(itemNum);
      if (!prod) return;

      tallas.forEach((talla: any, idx: number) => {
        const pesoConMermaExcel = Number(row[2 + idx]) || 0;
        const pesoExactoVal = bottomMap.get(`${itemNum}_${idx}`) || (pesoConMermaExcel > 0 ? parseFloat((pesoConMermaExcel / (1 + mermaPct / 100)).toFixed(2)) : 0);
        const pesoConMermaVal = pesoExactoVal > 0 ? parseFloat((pesoExactoVal * (1 + mermaPct / 100)).toFixed(2)) : pesoConMermaExcel;

        if (pesoConMermaVal >= 0 || pesoExactoVal >= 0) {
          pesoInserts.push({
            productoId: prod.id,
            tallaId: talla.id,
            pesoExactoGramos: parseFloat(pesoExactoVal.toFixed(2)),
            pesoGramos: parseFloat(pesoConMermaVal.toFixed(2)),
            mermaPorcentaje: mermaPct,
            pesoConMerma: parseFloat(pesoConMermaVal.toFixed(2)),
          });
        }
      });
    });

    if (pesoInserts.length > 0) {
      await db.insert(schema.pesoMateriaPrima).values(pesoInserts);
      console.log(`  ✅ Registros Peso Materia Prima en DB: ${pesoInserts.length} (Merma: ${mermaPct}%)`);
    }
  }

  // 9. MANO DE OBRA (desde hoja ManoDeObra)
  if (workbook.Sheets['ManoDeObra']) {
    await db.delete(schema.manoObra);
    const moRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['ManoDeObra'], { header: 1 });
    const dataRows = moRows.slice(2).filter(r => r && typeof r[0] === 'number');

    const moInserts: any[] = [];
    dataRows.forEach((row) => {
      const itemNum = Number(row[0]);
      const prod = productoMapByItem.get(itemNum);
      if (!prod) return;

      const g1 = Number(row[2]) || 0;
      const g2 = Number(row[3]) || 0;
      const g3 = Number(row[4]) || 0;

      tallas.forEach((talla: any) => {
        const code = talla.codigo;
        let costoBs = g3;
        if (['2', '4', '6', '8', '10'].includes(code)) costoBs = g1;
        else if (['12', '14', '16/34', '36/XS', '38/S'].includes(code)) costoBs = g2;

        moInserts.push({
          productoId: prod.id,
          tallaId: talla.id,
          costoBs,
        });
      });
    });

    if (moInserts.length > 0) {
      await db.insert(schema.manoObra).values(moInserts);
      console.log(`  ✅ Tarifas Mano de Obra en DB: ${moInserts.length}`);
    }
  }

  // 10. PRECIOS DE VENTA (desde hoja PrecioDeVenta)
  const existingPrecios = await db.select().from(schema.preciosVenta);
  if (existingPrecios.length === 0 && workbook.Sheets['PrecioDeVenta']) {
    const precioRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['PrecioDeVenta'], { header: 1 });
    const dataRows = precioRows.filter(r => r && typeof r[0] === 'number');

    const precioInserts: any[] = [];
    dataRows.forEach((row) => {
      const prod = productoMapByItem.get(Number(row[0]));
      if (!prod) return;

      tallas.forEach((talla: any, idx: number) => {
        const val = row[2 + idx];
        const precioBs = Number(val) || 0;
        if (precioBs > 0) {
          precioInserts.push({
            productoId: prod.id,
            tallaId: talla.id,
            precioBs: precioBs,
          });
        }
      });
    });

    if (precioInserts.length > 0) {
      await db.insert(schema.preciosVenta).values(precioInserts);
      console.log(`  ✅ Precios de Venta en DB: ${precioInserts.length}`);
    }
  }

  // 11. INVENTARIO INICIAL (desde hoja INVENTARIO)
  const existingInventario = await db.select().from(schema.inventario);
  if (existingInventario.length === 0) {
    const dataRows = inventarioRows.slice(2).filter(r => r && typeof r[0] === 'number');
    const invInserts: any[] = [];

    dataRows.forEach((row) => {
      const prod = productoMapByItem.get(Number(row[0]));
      if (!prod) return;

      tallas.forEach((talla: any, idx: number) => {
        const val = row[2 + idx];
        const cantidad = parseInt(val) || 0;
        invInserts.push({
          productoId: prod.id,
          tallaId: talla.id,
          anioId: anio.id,
          cantidad: cantidad,
          costoUnitario: 0,
          costoTotal: 0,
        });
      });
    });

    if (invInserts.length > 0) {
      await db.insert(schema.inventario).values(invInserts);
      console.log(`  ✅ Registros de Inventario en DB: ${invInserts.length}`);
    }
  }

  // 12. COSTOS INDIRECTOS DE PRODUCCIÓN (desde hoja Fij&Var)
  const existingCi = await db.select().from(schema.costosIndirectos);
  if (existingCi.length === 0 && workbook.Sheets['Fij&Var']) {
    const fjvRows = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets['Fij&Var'], { header: 1 });
    const dataRows = fjvRows.slice(1).filter((r: any) => r && r[0] && typeof r[0] === 'number' && r[1]);
    const ciInserts = dataRows.map((r: any) => ({
      colegioId: colegio.id,
      anioId: anio.id,
      concepto: String(r[1]).trim(),
      montoMensual: Number(r[2]) || 0,
    }));
    if (ciInserts.length > 0) {
      await db.insert(schema.costosIndirectos).values(ciInserts);
      console.log(`  ✅ Costos Indirectos de Producción en DB: ${ciInserts.length}`);
    }
  }

  console.log('🎉 Todos los datos fijos han sido completamente insertados y estructurados en la BD.');
}

if (process.argv[1]?.includes('seed.ts')) {
  getDb().then(db => seedData(db)).catch(console.error);
}
