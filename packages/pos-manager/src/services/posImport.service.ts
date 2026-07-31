import * as XLSX from 'xlsx';
import { eq } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../../../api/src/database/sqljs.ts';
import { posProductos } from '../../../api/src/database/schema.ts';
import {
  POS_GRUPOS_REPORTE,
  POS_GRUPO_REFERENCIA,
  POS_CATEGORIAS_REFERENCIA,
  POS_TALLA_GENERICO,
  POS_COLUMNA_UNICA,
} from '@sistema-uniformes/shared';

export interface PosImportResult {
  totalFilasLeidas: number;
  totalFilas?: number;
  insertados: number;
  actualizados: number;
  categorias: Record<string, number>;
  grupos: Record<string, number>;
}

export function normalizarTexto(str: string): string {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function limpiarNombreProducto(nombre: string): string {
  let resultado = nombre.trim();
  const sufijosAEliminar = [
    ', CC',
    ', Intl SM',
    ', EO',
    ', Inf SM',
    ', Col SM',
    ', SJ',
  ];

  for (const sufijo of sufijosAEliminar) {
    if (resultado.endsWith(sufijo)) {
      resultado = resultado.substring(0, resultado.length - sufijo.length).trim();
    }
  }

  return resultado;
}

function resolverIndiceColumna(cabecera: string[], candidatas: string[], indicePorDefecto: number): number {
  for (const cand of candidatas) {
    const normCand = normalizarTexto(cand);
    const idx = cabecera.findIndex((h) => normalizarTexto(h).includes(normCand));
    if (idx !== -1) return idx;
  }
  return indicePorDefecto;
}

export async function importarArchivoPos(buffer: Buffer): Promise<PosImportResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error('El archivo Excel está vacío o no contiene hojas válidas.');
  }

  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rawData.length < 2) {
    throw new Error('El archivo no contiene filas suficientes.');
  }

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    const rowStr = (rawData[r] || []).map((c) => String(c || '')).join(' ');
    if (rowStr.toLowerCase().includes('producto') || rowStr.toLowerCase().includes('categoria') || rowStr.toLowerCase().includes('posid')) {
      headerRowIndex = r;
      break;
    }
  }

  const cabecera = (rawData[headerRowIndex] || []).map((h) => String(h || '').trim());

  const idxIdProd = resolverIndiceColumna(cabecera, ['posidproducto', 'id producto', 'posid'], 0);
  const idxNombreProd = resolverIndiceColumna(cabecera, ['nombreproducto', 'nombre de producto', 'producto'], 2);
  const idxCategoria = resolverIndiceColumna(cabecera, ['categoria', 'categorías'], 4);
  const idxNombreVar = resolverIndiceColumna(cabecera, ['nombrevariante', 'nombre de variante', 'variante'], 7);
  const idxCodProd = resolverIndiceColumna(cabecera, ['codproducto', 'cod. producto', 'codigo'], 10);
  const idxPrecioPos = resolverIndiceColumna(cabecera, ['precio pos', 'preciopos', 'precio'], 19);
  const idxCantInv = resolverIndiceColumna(cabecera, ['cant. inv. general', 'cant inv general', 'cantidad', 'stock'], 32);
  const idxTipoInv = resolverIndiceColumna(cabecera, ['tipoinventario', 'tipo inventario'], 20);
  const idxPrecioEdit = resolverIndiceColumna(cabecera, ['precioeditablepos', 'precio editable'], 21);

  const db = await getDb();

  const ordenPorProductoMap = new Map<string, number>();

  const productosExistentesBD = db.select().from(posProductos).all();
  productosExistentesBD.forEach((p) => {
    const key = `${p.grupoMatriz}::${p.posIdProducto}`;
    if (!ordenPorProductoMap.has(key) && p.orden !== null && p.orden !== undefined) {
      ordenPorProductoMap.set(key, p.orden);
    }
  });

  const maxOrdenPorGrupo: Record<string, number> = {};
  for (const [key, ord] of ordenPorProductoMap.entries()) {
    const grupo = key.split('::')[0];
    if (maxOrdenPorGrupo[grupo] === undefined || ord > maxOrdenPorGrupo[grupo]) {
      maxOrdenPorGrupo[grupo] = ord;
    }
  }

  let insertados = 0;
  let actualizados = 0;
  const categoriasCount: Record<string, number> = {};
  const gruposCount: Record<string, number> = {};

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const rawId = row[idxIdProd] ?? row[0];
    const posIdProducto = String(rawId ?? '').trim();
    if (!posIdProducto) continue;

    const nombreVariante = String(row[idxNombreVar] ?? '').trim();
    const rawCategoria = String(row[idxCategoria] ?? '').trim();
    const nombreProducto = String(row[idxNombreProd] ?? '').trim();

    const codProducto = idxCodProd !== -1 ? (row[idxCodProd] ? String(row[idxCodProd]).trim() : null) : null;
    const tipoInventario = idxTipoInv !== -1 ? (row[idxTipoInv] ? String(row[idxTipoInv]).trim() : null) : null;
    const precioEditablePos = idxPrecioEdit !== -1 ? (row[idxPrecioEdit] ? String(row[idxPrecioEdit]).trim() : null) : null;

    const rawPrecio = idxPrecioPos !== -1 ? row[idxPrecioPos] : null;
    const precioPos = rawPrecio === null || rawPrecio === undefined || rawPrecio === ''
      ? null
      : Number(rawPrecio);

    const rawCant = idxCantInv !== -1 ? row[idxCantInv] : null;
    const cantInvGeneral = rawCant === null || rawCant === undefined || rawCant === ''
      ? null
      : Number(rawCant);

    let grupoMatriz = rawCategoria;
    let soloReferencia = false;

    if (POS_CATEGORIAS_REFERENCIA.includes(rawCategoria as any)) {
      grupoMatriz = POS_GRUPO_REFERENCIA;
      soloReferencia = true;
    } else if (POS_GRUPOS_REPORTE[rawCategoria]) {
      grupoMatriz = rawCategoria;
      soloReferencia = false;
    }

    categoriasCount[rawCategoria] = (categoriasCount[rawCategoria] || 0) + 1;
    gruposCount[grupoMatriz] = (gruposCount[grupoMatriz] || 0) + 1;

    let talla: string | null = null;
    let esGenerico = false;
    if (nombreVariante.startsWith('Talla ')) {
      talla = nombreVariante.replace('Talla ', '').trim();
    } else if (!nombreVariante) {
      esGenerico = true;
    } else {
      talla = nombreVariante;
    }

    let tallaPresentacion: string | null = talla;
    if (esGenerico) {
      const configGrupo = POS_GRUPOS_REPORTE[grupoMatriz];
      if (configGrupo && configGrupo.tallas.includes(POS_TALLA_GENERICO)) {
        tallaPresentacion = POS_TALLA_GENERICO;
      } else {
        tallaPresentacion = POS_COLUMNA_UNICA;
      }
    }

    const nombreLimpio = limpiarNombreProducto(nombreProducto);

    const filaObjeto: Record<string, any> = {};
    cabecera.forEach((h, colIndex) => {
      filaObjeto[h || `Col_${colIndex}`] = row[colIndex] ?? '';
    });
    const datosOriginales = JSON.stringify(filaObjeto);

    const keyOrden = `${grupoMatriz}::${posIdProducto}`;
    let ordenAsignado = ordenPorProductoMap.get(keyOrden);

    if (ordenAsignado === undefined) {
      const currentMax = maxOrdenPorGrupo[grupoMatriz] ?? -1;
      ordenAsignado = currentMax + 1;
      maxOrdenPorGrupo[grupoMatriz] = ordenAsignado;
      ordenPorProductoMap.set(keyOrden, ordenAsignado);
    }

    const existente = db.select()
      .from(posProductos)
      .where(eq(posProductos.posIdProducto, posIdProducto))
      .all()
      .find((p) => p.nombreVariante === nombreVariante);

    if (existente) {
      db.update(posProductos)
        .set({
          categoria: rawCategoria,
          grupoMatriz,
          soloReferencia,
          nombreProducto,
          nombreLimpio,
          talla,
          esGenerico,
          tallaPresentacion,
          orden: ordenAsignado,
          codProducto,
          precioPos,
          cantInvGeneral,
          tipoInventario,
          precioEditablePos,
          datosOriginales,
          actualizadoEn: new Date().toISOString(),
        })
        .where(eq(posProductos.id, existente.id))
        .run();
      actualizados++;
    } else {
      db.insert(posProductos)
        .values({
          posIdProducto,
          nombreVariante,
          categoria: rawCategoria,
          grupoMatriz,
          soloReferencia,
          nombreProducto,
          nombreLimpio,
          talla,
          esGenerico,
          tallaPresentacion,
          orden: ordenAsignado,
          codProducto,
          precioPos,
          cantInvGeneral,
          tipoInventario,
          precioEditablePos,
          datosOriginales,
        })
        .run();
      insertados++;
    }
  }

  saveDbToDisk();

  const totalFilasLeidas = rawData.length - (headerRowIndex + 1);

  return {
    totalFilasLeidas,
    totalFilas: totalFilasLeidas,
    insertados,
    actualizados,
    categorias: categoriasCount,
    grupos: gruposCount,
  };
}
