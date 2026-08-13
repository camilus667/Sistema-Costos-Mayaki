export interface PosGrupoSummary {
    nombre: string;
    totalProductos: number;
    totalFilas: number;
    soloReferencia: boolean;
}
export interface MatrizCelda {
    id: string;
    posIdProducto: string;
    nombreVariante: string;
    talla: string | null;
    tallaPresentacion: string | null;
    precioPos: number | null;
    cantInvGeneral: number | null;
    tipoInventario: string | null;
    precioEditablePos: string | null;
    esGenerico: boolean;
}
export interface MatrizFila {
    cod: string;
    posIdProducto: string;
    nombreLimpio: string;
    orden: number;
    subtotalPrecio: number;
    subtotalStock: number;
    celdas: Record<string, MatrizCelda>;
}
export interface MatrizRespuesta {
    grupo: string;
    soloReferencia: boolean;
    columnasTallas: string[];
    filas: MatrizFila[];
}
export interface ReferenciaItem {
    id: string;
    cod: string;
    posIdProducto: string;
    categoria: string;
    nombreProducto: string;
    nombreLimpio: string;
    nombreVariante: string;
    talla: string | null;
    precioPos: number | null;
    cantInvGeneral: number | null;
    tipoInventario: string | null;
    precioEditablePos: string | null;
}
export declare function obtenerGrupos(): Promise<PosGrupoSummary[]>;
export declare function obtenerMatrizGrupo(grupo: string): Promise<MatrizRespuesta>;
export declare function obtenerListaReferencia(): Promise<ReferenciaItem[]>;
export declare function actualizarProductoPos(id: string, cambios: {
    precioPos?: number | null;
    cantInvGeneral?: number | null;
}): Promise<any>;
export declare function actualizarOrdenProductos(grupo: string, ordenPosIds: string[]): Promise<void>;
//# sourceMappingURL=posMatrix.service.d.ts.map