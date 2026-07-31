import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import * as xlsx from 'xlsx';
import { getDb } from '../../../api/src/database/sqljs.ts';
import { importarArchivoPos } from './posImport.service';
import { generarXlsxPos38Buffer } from './posExport.service';

describe('posExport38 (Round-Trip Test)', () => {
  beforeAll(async () => {
    getDb();
    const filePath = path.resolve('d:/DOCUMENTOS/Contabilidad/Documentacion MAYAKI/Documentos Credito FIE/Inventario/SISTEMA INVENTARIO/pos2.xlsx');
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      await importarArchivoPos(buffer);
    }
  });

  it('generarXlsxPos38Buffer produce un archivo válido con 38 columnas y 869 filas', async () => {
    const buffer = await generarXlsxPos38Buffer();
    expect(buffer).toBeDefined();

    const wb = xlsx.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    // Encabezado + 869 filas = 870 filas totales
    expect(data.length).toBe(870);
    expect(data[0].length).toBe(38);
    expect(data[0][0]).toBe('Nro');
    expect(data[0][1]).toBe('ID Producto');
    expect(data[0][4]).toBe('Categorías');
  });
});
