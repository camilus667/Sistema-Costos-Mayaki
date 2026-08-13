export interface PosImportResult {
    totalFilasLeidas: number;
    totalFilas?: number;
    insertados: number;
    actualizados: number;
    categorias: Record<string, number>;
    grupos: Record<string, number>;
}
export declare function normalizarTexto(str: string): string;
export declare function limpiarNombreProducto(nombre: string): string;
export declare function importarArchivoPos(buffer: Buffer): Promise<PosImportResult>;
//# sourceMappingURL=posImport.service.d.ts.map