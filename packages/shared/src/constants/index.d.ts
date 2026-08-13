export declare const IVA_RATE = 0.13;
export declare const DEFAULT_MERMA_PORCENTAJE = 0.08;
export declare const ROLES: {
    readonly SUPER_ADMIN: "super_admin";
    readonly ADMIN: "admin";
    readonly EDITOR: "editor";
    readonly VISUALIZADOR: "visualizador";
};
export declare const COLEGIO_ROLES: {
    readonly ADMIN: "admin";
    readonly EDITOR: "editor";
    readonly VISUALIZADOR: "visualizador";
};
export declare const TIPOS_TRANSACCION: {
    readonly ENTRADA: "entrada";
    readonly SALIDA: "salida";
    readonly MERMA: "merma";
    readonly AJUSTE: "ajuste";
};
export declare const ACCIONES_AUDITORIA: {
    readonly CREATE: "CREATE";
    readonly UPDATE: "UPDATE";
    readonly DELETE: "DELETE";
};
export declare const JWT_EXPIRES_IN = "15m";
export declare const JWT_REFRESH_EXPIRES_IN = "7d";
export declare const D1_DATABASE_NAME = "sistema-uniformes";
export declare const POS_GRUPOS_REPORTE: Record<string, {
    sufijo: string;
    tallas: string[];
}>;
export declare const POS_GRUPO_REFERENCIA = "Empresas y General";
export declare const POS_CATEGORIAS_REFERENCIA: readonly ["Empresas", "General"];
export declare const POS_TALLA_GENERICO = "14";
export declare const POS_COLUMNA_UNICA = "\u00DANICA";
//# sourceMappingURL=index.d.ts.map