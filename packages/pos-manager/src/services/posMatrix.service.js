import { eq } from 'drizzle-orm';
import { getDb, saveDbToDisk } from '../../../api/src/database/sqljs.ts';
import { posProductos, colegios } from '../../../api/src/database/schema.ts';
import { POS_GRUPOS_REPORTE, POS_GRUPO_REFERENCIA, } from '@sistema-uniformes/shared';
const ABREVIATURAS_GRUPO = {
    'Cambridge': 'CC',
    'Intl S Marcos': 'INTLSM',
    'Edad de Oro': 'EO',
    'Inf S Marcos': 'INFSM',
    'Col S Marcos': 'COLSM',
    'Saint Jude': 'SJ',
    'Empresas y General': 'REF',
};
async function resolverAbreviaturaColegio(grupo) {
    try {
        const db = await getDb();
        const cols = db.select().from(colegios).all();
        const normG = grupo.toLowerCase();
        const match = cols.find((c) => {
            const normName = (c.nombre || '').toLowerCase();
            const abrev = (c.abreviatura || '').toLowerCase();
            return normName.includes(normG) || normG.includes(normName) || (abrev && normG.includes(abrev));
        });
        if (match && match.abreviatura) {
            return match.abreviatura.toUpperCase();
        }
    }
    catch (e) { }
    return ABREVIATURAS_GRUPO[grupo] || 'POS';
}
export async function obtenerGrupos() {
    const db = await getDb();
    const todos = db.select().from(posProductos).all();
    const conteos = {};
    todos.forEach((p) => {
        const g = p.grupoMatriz;
        if (!conteos[g])
            conteos[g] = { filas: 0, productos: new Set() };
        conteos[g].filas++;
        conteos[g].productos.add(p.posIdProducto);
    });
    const ordenGrupos = [...Object.keys(POS_GRUPOS_REPORTE), POS_GRUPO_REFERENCIA];
    return ordenGrupos.map((g) => {
        const data = conteos[g] || { filas: 0, productos: new Set() };
        return {
            nombre: g,
            totalProductos: data.productos.size,
            totalFilas: data.filas,
            soloReferencia: g === POS_GRUPO_REFERENCIA,
        };
    });
}
export async function obtenerMatrizGrupo(grupo) {
    const configGrupo = POS_GRUPOS_REPORTE[grupo];
    if (!configGrupo && grupo !== POS_GRUPO_REFERENCIA) {
        throw new Error(`Grupo desconocido: '${grupo}'`);
    }
    const db = await getDb();
    const productosGrupo = db.select()
        .from(posProductos)
        .where(eq(posProductos.grupoMatriz, grupo))
        .all();
    const soloReferencia = grupo === POS_GRUPO_REFERENCIA;
    const columnasTallas = configGrupo ? [...configGrupo.tallas] : [];
    const abrev = await resolverAbreviaturaColegio(grupo);
    const mapaFilas = new Map();
    productosGrupo.forEach((item) => {
        const key = item.posIdProducto;
        if (!mapaFilas.has(key)) {
            mapaFilas.set(key, {
                nombreLimpio: item.nombreLimpio,
                orden: item.orden ?? 9999,
                items: [],
            });
        }
        mapaFilas.get(key).items.push(item);
    });
    const filasOrdenadas = Array.from(mapaFilas.values()).sort((a, b) => a.orden - b.orden);
    const filas = filasOrdenadas.map((f, idx) => {
        const celdas = {};
        let subtotalPrecio = 0;
        let subtotalStock = 0;
        f.items.forEach((item) => {
            const colKey = item.tallaPresentacion || item.talla || 'ÚNICA';
            celdas[colKey] = {
                id: item.id,
                posIdProducto: item.posIdProducto,
                nombreVariante: item.nombreVariante,
                talla: item.talla,
                tallaPresentacion: item.tallaPresentacion,
                precioPos: item.precioPos,
                cantInvGeneral: item.cantInvGeneral,
                tipoInventario: item.tipoInventario,
                precioEditablePos: item.precioEditablePos,
                esGenerico: Boolean(item.esGenerico),
            };
            if (item.precioPos !== null && item.precioPos !== undefined) {
                subtotalPrecio += item.precioPos;
            }
            if (item.cantInvGeneral !== null && item.cantInvGeneral !== undefined) {
                subtotalStock += item.cantInvGeneral;
            }
        });
        const cod = `${abrev}-${String(idx + 1).padStart(2, '0')}`;
        return {
            cod,
            posIdProducto: f.items[0].posIdProducto,
            nombreLimpio: f.nombreLimpio,
            orden: f.orden,
            subtotalPrecio: Math.round(subtotalPrecio * 100) / 100,
            subtotalStock: Math.round(subtotalStock * 100) / 100,
            celdas,
        };
    });
    return {
        grupo,
        soloReferencia,
        columnasTallas,
        filas,
    };
}
export async function obtenerListaReferencia() {
    const db = await getDb();
    const items = db.select()
        .from(posProductos)
        .where(eq(posProductos.grupoMatriz, POS_GRUPO_REFERENCIA))
        .all();
    const abrev = await resolverAbreviaturaColegio(POS_GRUPO_REFERENCIA);
    return items.map((p, idx) => ({
        id: p.id,
        cod: `${abrev}-${String(idx + 1).padStart(2, '0')}`,
        posIdProducto: p.posIdProducto,
        categoria: p.categoria,
        nombreProducto: p.nombreProducto,
        nombreLimpio: p.nombreLimpio,
        nombreVariante: p.nombreVariante,
        talla: p.talla,
        precioPos: p.precioPos,
        cantInvGeneral: p.cantInvGeneral,
        tipoInventario: p.tipoInventario,
        precioEditablePos: p.precioEditablePos,
    }));
}
export async function actualizarProductoPos(id, cambios) {
    const db = await getDb();
    const producto = db.select().from(posProductos).where(eq(posProductos.id, id)).get();
    if (!producto) {
        throw new Error(`Producto no encontrado: id ${id}`);
    }
    if (producto.soloReferencia) {
        throw new Error('Los productos del grupo de referencia son de solo lectura.');
    }
    const updates = {
        actualizadoEn: new Date().toISOString(),
    };
    if (cambios.precioPos !== undefined) {
        updates.precioPos = cambios.precioPos;
    }
    if (cambios.cantInvGeneral !== undefined) {
        if (producto.tipoInventario === 'SIN INVENTARIO') {
            updates.cantInvGeneral = null;
        }
        else {
            updates.cantInvGeneral = cambios.cantInvGeneral;
        }
    }
    let datosOrig = {};
    try {
        datosOrig = JSON.parse(producto.datosOriginales);
    }
    catch (e) {
        datosOrig = {};
    }
    if (updates.precioPos !== undefined) {
        datosOrig['Precio POS'] = updates.precioPos ?? '';
    }
    if (updates.cantInvGeneral !== undefined) {
        datosOrig['Cant. Inv. General'] = updates.cantInvGeneral ?? '';
    }
    updates.datosOriginales = JSON.stringify(datosOrig);
    db.update(posProductos)
        .set(updates)
        .where(eq(posProductos.id, id))
        .run();
    saveDbToDisk();
    return db.select().from(posProductos).where(eq(posProductos.id, id)).get();
}
export async function actualizarOrdenProductos(grupo, ordenPosIds) {
    const db = await getDb();
    ordenPosIds.forEach((posId, idx) => {
        db.update(posProductos)
            .set({ orden: idx, actualizadoEn: new Date().toISOString() })
            .where(eq(posProductos.posIdProducto, posId))
            .run();
    });
    saveDbToDisk();
}
//# sourceMappingURL=posMatrix.service.js.map