import * as XLSX from 'xlsx';
import { getDb, getRawDb, saveDbToDisk } from '../../../api/src/database/sqljs';
import { posVentas } from '../../../api/src/database/schema';

export interface SalesImportResult {
  totalFilasLeidas: number;
  insertados: number;
  colegiosDetectados: Record<string, number>;
  aniosDetectados: Record<number, number>;
  nombreArchivo?: string;
}

const MESES_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12,
};

export function guardarConfiguracion(clave: string, valor: string, descripcion?: string): void {
  try {
    const rawDb = getRawDb();
    rawDb.run(`
      INSERT INTO configuracion_sistema (id, clave, valor, descripcion, actualizado_en)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = CURRENT_TIMESTAMP;
    `, [clave, valor, descripcion || null]);
    saveDbToDisk();
  } catch (e) {
    console.error('Error al guardar configuración en SQLite:', e);
  }
}

export function obtenerConfiguracion(clave: string): string | null {
  try {
    const rawDb = getRawDb();
    const res = rawDb.exec('SELECT valor FROM configuracion_sistema WHERE clave = ? LIMIT 1;', [clave]);
    if (res && res.length > 0 && res[0].values.length > 0) {
      return String(res[0].values[0][0]);
    }
  } catch (e) {
    console.error('Error al leer configuración en SQLite:', e);
  }
  return null;
}

export function obtenerMetadataImportacion(): {
  nombreArchivo: string | null;
  fechaImportacion: string | null;
  totalFilas: number;
} {
  const nombreArchivo = obtenerConfiguracion('pos_ventas_archivo_nombre');
  const fechaImportacion = obtenerConfiguracion('pos_ventas_fecha_importacion');
  const totalFilasStr = obtenerConfiguracion('pos_ventas_total_filas');
  const totalFilas = totalFilasStr ? parseInt(totalFilasStr, 10) || 0 : 0;
  return { nombreArchivo, fechaImportacion, totalFilas };
}

export function parsearFechaVenta(fechaStr: string): { iso: string; anio: number; mes: number; trimestre: string } {
  if (!fechaStr) {
    const d = new Date();
    return {
      iso: d.toISOString().split('T')[0],
      anio: d.getFullYear(),
      mes: d.getMonth() + 1,
      trimestre: `Q${Math.ceil((d.getMonth() + 1) / 3)}`,
    };
  }

  // Si viene como número serial de fecha de Excel
  const numVal = Number(fechaStr);
  if (!isNaN(numVal) && numVal > 30000 && numVal < 60000) {
    const d = new Date(Math.round((numVal - 25569) * 86400 * 1000));
    const anio = d.getFullYear();
    const mes = d.getMonth() + 1;
    const dia = d.getDate();
    const iso = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    return { iso, anio, mes, trimestre: `Q${Math.ceil(mes / 3)}` };
  }

  const str = String(fechaStr).trim();
  const partes = str.split(/[\s\-\/]+/);

  let dia = 1;
  let mes = 1;
  let anio = 2025;

  if (partes.length >= 3) {
    const p0 = parseInt(partes[0], 10);
    const p2 = parseInt(partes[2], 10);

    if (p0 >= 1900 && p0 <= 2100) {
      // Formato YYYY-MM-DD
      anio = p0;
      const mesTxt = (partes[1] || '').toLowerCase();
      mes = MESES_MAP[mesTxt] || parseInt(partes[1], 10) || 1;
      dia = parseInt(partes[2], 10) || 1;
    } else if (p2 >= 1900 && p2 <= 2100) {
      // Formato DD/MM/YYYY o DD/MMM/YYYY
      anio = p2;
      const mesTxt = (partes[1] || '').toLowerCase();
      mes = MESES_MAP[mesTxt] || parseInt(mesTxt, 10) || 1;
      dia = p0 || 1;
    } else {
      const parsedD = new Date(str);
      if (!isNaN(parsedD.getTime())) {
        anio = parsedD.getFullYear();
        mes = parsedD.getMonth() + 1;
        dia = parsedD.getDate();
      }
    }
  } else {
    const parsedD = new Date(str);
    if (!isNaN(parsedD.getTime())) {
      anio = parsedD.getFullYear();
      mes = parsedD.getMonth() + 1;
      dia = parsedD.getDate();
    }
  }

  const mesPadded = String(mes).padStart(2, '0');
  const diaPadded = String(dia).padStart(2, '0');
  const iso = `${anio}-${mesPadded}-${diaPadded}`;
  const trimestre = `Q${Math.ceil(mes / 3)}`;

  return { iso, anio, mes, trimestre };
}

export function desglosarNombreProducto(nombreRaw: string): {
  nombreLimpio: string;
  colegioGrupo: string;
  talla: string;
} {
  let raw = String(nombreRaw || '').trim();

  // 1. Extraer Talla de los paréntesis ej: "(Talla 12)", "(Talla S)"
  let talla = 'ÚNICA';
  const matchTalla = raw.match(/\((?:talla\s*)?([^)]+)\)/i);
  if (matchTalla) {
    talla = matchTalla[1].trim();
    raw = raw.replace(matchTalla[0], '').trim();
  }

  // 2. Extraer Colegio del sufijo tras coma ej: ", Inf SM", ", Cambridge", ", EO"
  let colegioGrupo = 'Empresas y General';
  if (raw.includes(',')) {
    const partes = raw.split(',');
    const posibleColegio = partes[partes.length - 1].trim();

    // Mapeo conocido de sufijos a grupos de colegios
    const normC = posibleColegio.toLowerCase();
    if (normC.includes('cambridge') || normC === 'cc') colegioGrupo = 'Cambridge';
    else if (normC.includes('intl sm') || normC.includes('intl. sm') || normC === 'intlsm') colegioGrupo = 'Intl S Marcos';
    else if (normC.includes('inf sm') || normC.includes('inf. sm') || normC === 'infsm') colegioGrupo = 'Inf S Marcos';
    else if (normC.includes('col sm') || normC.includes('col. sm') || normC === 'colsm') colegioGrupo = 'Col S Marcos';
    else if (normC.includes('edad de oro') || normC === 'eo') colegioGrupo = 'Edad de Oro';
    else if (normC.includes('saint jude') || normC === 'sj' || normC === 'js') colegioGrupo = 'Saint Jude';
    else if (normC.includes('saco') || normC.includes('pantal')) colegioGrupo = 'Saco y Pantalón';
    else colegioGrupo = posibleColegio;

    raw = partes.slice(0, partes.length - 1).join(',').trim();
  }

  // 3. Nombre limpio de la prenda
  const nombreLimpio = raw.replace(/\s+/g, ' ').trim();

  return { nombreLimpio, colegioGrupo, talla };
}

export async function vaciarVentasPos(): Promise<void> {
  await getDb(); // asegurar que la BD está abierta
  const rawDb = getRawDb();
  rawDb.run('DELETE FROM pos_venta;');
  guardarConfiguracion('pos_ventas_archivo_nombre', '', 'Nombre de archivo vaciado');
  guardarConfiguracion('pos_ventas_fecha_importacion', '', 'Fecha importación vaciada');
  guardarConfiguracion('pos_ventas_total_filas', '0', 'Filas vaciadas');
  saveDbToDisk();
}

export async function importarVentasPos(buffer: Buffer, nombreArchivo?: string): Promise<SalesImportResult> {
  // Vaciar ventas anteriores SIEMPRE antes de procesar un nuevo archivo para evitar duplicados
  await vaciarVentasPos();

  const db = await getDb();

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) throw new Error('El archivo Excel está vacío.');

  const rawData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rawData.length < 2) throw new Error('El archivo no contiene filas suficientes.');

  let headerRowIndex = 0;
  for (let r = 0; r < Math.min(10, rawData.length); r++) {
    const rowStr = (rawData[r] || []).map((c) => String(c || '')).join(' ').toLowerCase();
    if (rowStr.includes('n_pedido') || rowStr.includes('nombre_del_producto') || rowStr.includes('cantidad')) {
      headerRowIndex = r;
      break;
    }
  }

  const cabecera = (rawData[headerRowIndex] || []).map((h) => String(h || '').trim().toLowerCase());

  const idxNPedido = cabecera.indexOf('n_pedido');
  const idxTipo = cabecera.indexOf('tipo');
  const idxEstado = cabecera.indexOf('estado');
  const idxFecha = cabecera.indexOf('fecha');
  const idxSucursal = cabecera.indexOf('sucursal');
  const idxUsuario = cabecera.indexOf('usuario');
  const idxCliente = cabecera.indexOf('razon_social') !== -1
    ? cabecera.indexOf('razon_social')
    : (cabecera.indexOf('cliente') !== -1 ? cabecera.indexOf('cliente') : cabecera.indexOf('nombre_cliente'));

  const idxNroDoc = cabecera.indexOf('numero_documento') !== -1
    ? cabecera.indexOf('numero_documento')
    : (cabecera.indexOf('nro_doc') !== -1 ? cabecera.indexOf('nro_doc') : cabecera.indexOf('nro_doc_c'));
  const idxProducto = cabecera.indexOf('nombre_del_producto');
  const idxCantidad = cabecera.indexOf('cantidad');
  const idxPrecioUnit = cabecera.indexOf('precio_unit');
  const idxTotalDescuento = cabecera.indexOf('total_descuento');
  const idxSubtotal = cabecera.indexOf('subtotal');
  const idxTotalCobrado = cabecera.indexOf('total_cobrado');
  const idxCostoUnit = cabecera.indexOf('costo_unit');
  const idxCostoTotal = cabecera.indexOf('costo_total');

  if (idxProducto === -1 || idxCantidad === -1) {
    throw new Error('No se encontraron las columnas necesarias (nombre_del_producto, cantidad).');
  }

  let insertados = 0;
  const colegiosDetectados: Record<string, number> = {};
  const aniosDetectados: Record<number, number> = {};

  const batch: any[] = [];

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) continue;

    const nombreRaw = String(row[idxProducto] || '').trim();
    if (!nombreRaw) continue;

    const nPedido = idxNPedido !== -1 ? String(row[idxNPedido] || '') : `${i}`;
    const tipo = idxTipo !== -1 ? String(row[idxTipo] || 'Pedido') : 'Pedido';
    const estado = idxEstado !== -1 ? String(row[idxEstado] || 'Completado') : 'Completado';
    const fechaRaw = idxFecha !== -1 ? String(row[idxFecha] || '') : '';
    const sucursal = idxSucursal !== -1 ? String(row[idxSucursal] || '') : 'Central';
    const usuario = idxUsuario !== -1 ? String(row[idxUsuario] || '') : '';
    const cliente = idxCliente !== -1 ? String(row[idxCliente] || '').trim() : '';
    const nroDoc = idxNroDoc !== -1 ? String(row[idxNroDoc] || '').trim() : '';

    const cantidad = parseFloat(row[idxCantidad]) || 1;
    const precioUnitario = parseFloat(row[idxPrecioUnit]) || 0;
    const subtotal = parseFloat(row[idxSubtotal]) || cantidad * precioUnitario;
    const totalCobrado = idxTotalCobrado !== -1 ? (parseFloat(row[idxTotalCobrado]) || subtotal) : subtotal;
    const totalDescuento = idxTotalDescuento !== -1
      ? (parseFloat(row[idxTotalDescuento]) || 0)
      : Math.max(0, subtotal - totalCobrado);
    const costoUnitario = idxCostoUnit !== -1 ? (parseFloat(row[idxCostoUnit]) || 0) : 0;
    const costoTotal = idxCostoTotal !== -1 ? (parseFloat(row[idxCostoTotal]) || 0) : 0;

    const { iso, anio, mes, trimestre } = parsearFechaVenta(fechaRaw);
    const { nombreLimpio, colegioGrupo, talla } = desglosarNombreProducto(nombreRaw);

    colegiosDetectados[colegioGrupo] = (colegiosDetectados[colegioGrupo] || 0) + 1;
    aniosDetectados[anio] = (aniosDetectados[anio] || 0) + 1;

    batch.push({
      nPedido,
      tipo,
      estado,
      fecha: fechaRaw || iso,
      fechaIso: iso,
      anio,
      mes,
      trimestre,
      nombreProductoRaw: nombreRaw,
      nombreLimpio,
      colegioGrupo,
      talla,
      cantidad,
      precioUnitario,
      subtotal,
      totalCobrado,
      costoUnitario,
      costoTotal,
      usuario,
      sucursal,
      datosOriginales: JSON.stringify({ cliente, nroDoc, totalDescuento, row }),
    });
  }

  if (batch.length > 0) {
    // Reemplazar ventas anteriores para garantizar coherencia y evitar duplicados al reimportar
    db.delete(posVentas).run();

    const chunkSize = 200;
    for (let i = 0; i < batch.length; i += chunkSize) {
      const chunk = batch.slice(i, i + chunkSize);
      db.insert(posVentas).values(chunk).run();
      insertados += chunk.length;
    }

    if (nombreArchivo) {
      guardarConfiguracion('pos_ventas_archivo_nombre', nombreArchivo, 'Nombre del archivo Excel de ventas importado');
    }
    const ahora = new Date().toISOString();
    guardarConfiguracion('pos_ventas_fecha_importacion', ahora, 'Fecha y hora de importación');
    guardarConfiguracion('pos_ventas_total_filas', String(insertados), 'Total filas de ventas insertadas');

    saveDbToDisk();
  }

  const finalNombreArchivo = nombreArchivo || obtenerConfiguracion('pos_ventas_archivo_nombre') || undefined;

  return {
    totalFilasLeidas: rawData.length - (headerRowIndex + 1),
    insertados,
    colegiosDetectados,
    aniosDetectados,
    nombreArchivo: finalNombreArchivo,
  };
}
