import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../../api/src/database/sqljs.ts';
import { posProductos } from '../../../api/src/database/schema.ts';
import {
  importarArchivoPos,
  limpiarNombreProducto,
  normalizarTexto,
} from './posImport.service';

describe('posImport.service', () => {
  beforeAll(() => {
    getDb();
  });

  it('limpiarNombreProducto remueve el sufijo de colegio', () => {
    expect(limpiarNombreProducto('Camisa m/c, CC')).toBe('Camisa m/c');
    expect(limpiarNombreProducto('Pantalón Dama, Intl SM')).toBe('Pantalón Dama');
    expect(limpiarNombreProducto('Short Falda c/elast, Col SM')).toBe('Short Falda c/elast');
    expect(limpiarNombreProducto('Buzo Dep, SJ')).toBe('Buzo Dep');
    expect(limpiarNombreProducto('Sin Coma')).toBe('Sin Coma');
  });

  it('normalizarTexto remueve acentos y pasa a minúsculas', () => {
    expect(normalizarTexto('Buzo dep')).toBe('buzo dep');
    expect(normalizarTexto('Pantalón de Dama')).toBe('pantalon de dama');
    expect(normalizarTexto('  C  Cambridge  ')).toBe('c cambridge');
  });

  it('importarArchivoPos procesa pos2.xlsx correctamente', async () => {
    const filePath = path.resolve('d:/DOCUMENTOS/Contabilidad/Documentacion MAYAKI/Documentos Credito FIE/Inventario/SISTEMA INVENTARIO/pos2.xlsx');
    if (!fs.existsSync(filePath)) {
      console.warn('pos2.xlsx no encontrado, omitiendo test de integración con archivo');
      return;
    }

    const buffer = fs.readFileSync(filePath);
    const res = await importarArchivoPos(buffer);

    expect(res.totalFilas).toBe(869);
    expect(Object.keys(res.categorias)).toContain('Cambridge');
    expect(Object.keys(res.categorias)).toContain('Col S Marcos');
    expect(Object.keys(res.grupos)).toContain('Empresas y General');

    const db = await getDb();
    const count = db.select().from(posProductos).all().length;
    expect(count).toBe(869);
  });
});
