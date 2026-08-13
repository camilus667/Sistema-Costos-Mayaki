import ExcelJS from 'exceljs';
import * as xlsx from 'xlsx';
import { getDb } from '../../../api/src/database/sqljs.ts';
import { posProductos } from '../../../api/src/database/schema.ts';
import { obtenerMatrizGrupo } from './posMatrix.service';
import { POS_GRUPOS_REPORTE, POS_GRUPO_REFERENCIA } from '@sistema-uniformes/shared';
export async function generarExcelColegioBuffer(grupo, tipo = 'ambos') {
    if (grupo === POS_GRUPO_REFERENCIA) {
        throw new Error('El grupo de referencia no se exporta a Excel individual.');
    }
    const matriz = await obtenerMatrizGrupo(grupo);
    const workbook = new ExcelJS.Workbook();
    const sheetName = `${grupo.slice(0, 20)}_${tipo.toUpperCase()}`.slice(0, 31);
    const sheet = workbook.addWorksheet(sheetName);
    const headers = ['Cod', 'Prenda', ...matriz.columnasTallas, 'Subtotal'];
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '1E293B' },
    };
    matriz.filas.forEach((fila) => {
        const rowValues = [fila.cod, fila.nombreLimpio];
        matriz.columnasTallas.forEach((talla) => {
            const celda = fila.celdas[talla];
            if (!celda) {
                rowValues.push('-');
            }
            else if (tipo === 'precios') {
                rowValues.push(celda.precioPos !== null ? celda.precioPos : '-');
            }
            else if (tipo === 'stock') {
                rowValues.push(celda.cantInvGeneral !== null ? celda.cantInvGeneral : '-');
            }
            else {
                let text = `${celda.precioPos ?? '-'} Bs`;
                if (celda.cantInvGeneral !== null) {
                    text += ` (${celda.cantInvGeneral} un)`;
                }
                rowValues.push(text);
            }
        });
        const subtotal = tipo === 'precios' ? fila.subtotalPrecio : fila.subtotalStock;
        rowValues.push(subtotal);
        sheet.addRow(rowValues);
    });
    if (tipo === 'stock') {
        const totalesTallas = {};
        let granTotal = 0;
        matriz.filas.forEach(f => {
            matriz.columnasTallas.forEach(t => {
                const c = f.celdas[t];
                if (c && c.cantInvGeneral !== null) {
                    totalesTallas[t] = (totalesTallas[t] || 0) + Number(c.cantInvGeneral);
                    granTotal += Number(c.cantInvGeneral);
                }
            });
        });
        const totalRowValues = ['', 'TOTAL INVENTARIO'];
        matriz.columnasTallas.forEach(t => totalRowValues.push(totalesTallas[t] || 0));
        totalRowValues.push(granTotal);
        const totalRow = sheet.addRow(totalRowValues);
        totalRow.font = { bold: true };
    }
    sheet.columns.forEach((col, i) => {
        col.width = i === 1 ? 25 : 10;
    });
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
export async function generarExcelGlobalBuffer() {
    const workbook = new ExcelJS.Workbook();
    const colegios = Object.keys(POS_GRUPOS_REPORTE);
    for (const grupo of colegios) {
        const matriz = await obtenerMatrizGrupo(grupo);
        const sheetName = grupo.replace(/^C\s+/, '').slice(0, 31);
        const sheet = workbook.addWorksheet(sheetName);
        const headers = ['Cod', 'Prenda', ...matriz.columnasTallas, 'Subtotal Stock'];
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: '1E293B' },
        };
        matriz.filas.forEach((fila) => {
            const rowValues = [fila.cod, fila.nombreLimpio];
            matriz.columnasTallas.forEach((talla) => {
                const celda = fila.celdas[talla];
                if (celda && celda.precioPos !== null && celda.precioPos !== undefined) {
                    let text = `${celda.precioPos} Bs`;
                    if (celda.cantInvGeneral !== null && celda.cantInvGeneral !== undefined) {
                        text += ` (${celda.cantInvGeneral} un)`;
                    }
                    rowValues.push(text);
                }
                else {
                    rowValues.push('-');
                }
            });
            rowValues.push(fila.subtotalStock);
            sheet.addRow(rowValues);
        });
        sheet.columns.forEach((col, i) => {
            col.width = i === 1 ? 25 : 12;
        });
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
export async function generarXlsxPos38Buffer() {
    const db = await getDb();
    const productos = db.select().from(posProductos).all();
    if (productos.length === 0) {
        throw new Error('No hay productos cargados en el POS para exportar.');
    }
    let cabeceraOriginal = [];
    try {
        const primerObj = JSON.parse(productos[0].datosOriginales);
        cabeceraOriginal = Object.keys(primerObj);
    }
    catch (e) {
        cabeceraOriginal = [];
    }
    if (cabeceraOriginal.length === 0) {
        cabeceraOriginal = [
            'posIdProducto', 'idPosicionamiento', 'nombreProducto', 'categoriaGenerica',
            'categoria', 'subCategoriaGenerica', 'subCategoria', 'nombreVariante',
            'idContenedorPadre', 'idVariantePadre', 'codProducto', 'impuestoPrincipal',
            'tipoCodigoBarras', 'codigoBarras', 'costoEstablecido', 'porcentajeRentabilidadEstablecido',
            'gananciaBrutaEstablecida', 'rentabilidadEsperada', 'gananciaBrutaEsperada',
            'Precio POS', 'tipoInventario', 'precioEditablePos', 'descontarGenericoDeInventario',
            'idProveedor', 'idInsumoOPrendaDeVestir', 'sePuedeVender', 'sePuedeComprar',
            'mostrarEnElCatalogo', 'soloReferencia', 'costoUltimaCompra', 'precioUltimaVenta',
            'Cant. Inv. General', 'cantInvConsignacion', 'cantMinimaInvGeneral',
            'cantMaximaInvGeneral', 'metodoManejoCostoInventario', 'idRelacionCatalogo',
            'datosExtra',
        ];
    }
    const filasSalida = [cabeceraOriginal];
    productos.forEach((p) => {
        let datosOrig = {};
        try {
            datosOrig = JSON.parse(p.datosOriginales);
        }
        catch (e) {
            datosOrig = {};
        }
        datosOrig['posIdProducto'] = p.posIdProducto;
        datosOrig['nombreVariante'] = p.nombreVariante;
        datosOrig['categoria'] = p.categoria;
        datosOrig['nombreProducto'] = p.nombreProducto;
        datosOrig['codProducto'] = p.codProducto ?? datosOrig['codProducto'] ?? '';
        datosOrig['Precio POS'] = p.precioPos !== null ? p.precioPos : '';
        datosOrig['Cant. Inv. General'] = p.cantInvGeneral !== null ? p.cantInvGeneral : '';
        datosOrig['tipoInventario'] = p.tipoInventario ?? datosOrig['tipoInventario'] ?? '';
        const filaArray = cabeceraOriginal.map((colKey) => datosOrig[colKey] ?? '');
        filasSalida.push(filaArray);
    });
    const ws = xlsx.utils.aoa_to_sheet(filasSalida);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'POS_Export_38');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return Buffer.from(buffer);
}
//# sourceMappingURL=posExport.service.js.map