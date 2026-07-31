import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDb } from '../../../api/src/database/sqljs.ts';
import { importarArchivoPos } from './posImport.service';
import {
  obtenerGrupos,
  obtenerMatrizGrupo,
  obtenerListaReferencia,
  actualizarProductoPos,
} from './posMatrix.service';

describe('posMatrix.service', () => {
  beforeAll(async () => {
    await getDb();
    const filePath = path.resolve('d:/DOCUMENTOS/Contabilidad/Documentacion MAYAKI/Documentos Credito FIE/Inventario/SISTEMA INVENTARIO/pos2.xlsx');
    if (fs.existsSync(filePath)) {
      const buffer = fs.readFileSync(filePath);
      await importarArchivoPos(buffer);
    }
  });

  it('obtenerGrupos devuelve los 6 colegios más el grupo de referencia', async () => {
    const grupos = await obtenerGrupos();
    expect(grupos.length).toBe(7);

    const nombres = grupos.map((g) => g.nombre);
    expect(nombres).toContain('Cambridge');
    expect(nombres).toContain('Col S Marcos');
    expect(nombres).toContain('Empresas y General');
  });

  it('obtenerMatrizGrupo para Cambridge genera columnas de tallas correctas', async () => {
    const matriz = await obtenerMatrizGrupo('Cambridge');
    expect(matriz.grupo).toBe('Cambridge');
    expect(matriz.soloReferencia).toBe(false);
    expect(matriz.columnasTallas).toContain('02');
    expect(matriz.columnasTallas).toContain('14');
    expect(matriz.filas.length).toBeGreaterThan(0);
  });

  it('obtenerMatrizGrupo para Col S Marcos incluye las 8 tallas numéricas', async () => {
    const matriz = await obtenerMatrizGrupo('Col S Marcos');
    expect(matriz.grupo).toBe('Col S Marcos');
    expect(matriz.columnasTallas).toEqual(['04', '06', '08', '10', '12', '14', '16/34', '38/S']);
  });

  it('obtenerListaReferencia retorna los ítems de Empresas y General', async () => {
    const items = await obtenerListaReferencia();
    expect(items.length).toBe(34);
  });
});
