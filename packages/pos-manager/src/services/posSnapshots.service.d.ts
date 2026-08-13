export interface PosSnapshotSummary {
    id: string;
    nombre: string;
    descripcion: string | null;
    totalProductos: number;
    creadoPor: string | null;
    creadoEn: string;
}
export declare function crearSnapshotPos(nombre: string, descripcion?: string, creadoPor?: string): Promise<PosSnapshotSummary>;
export declare function listarSnapshotsPos(): Promise<PosSnapshotSummary[]>;
export declare function restaurarSnapshotPos(id: string): Promise<{
    restaurados: number;
}>;
export declare function eliminarSnapshotPos(id: string): Promise<{
    ok: boolean;
}>;
//# sourceMappingURL=posSnapshots.service.d.ts.map