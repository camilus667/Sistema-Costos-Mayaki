import { Hono } from 'hono';
import { importarArchivoPos, } from '../services/posImport.service';
import { obtenerGrupos, obtenerMatrizGrupo, obtenerListaReferencia, actualizarProductoPos, actualizarOrdenProductos, } from '../services/posMatrix.service';
import { generarExcelColegioBuffer, generarExcelGlobalBuffer, generarXlsxPos38Buffer, } from '../services/posExport.service';
import { crearSnapshotPos, listarSnapshotsPos, restaurarSnapshotPos, eliminarSnapshotPos, } from '../services/posSnapshots.service';
import { POS_GRUPO_REFERENCIA } from '@sistema-uniformes/shared';
const app = new Hono();
// POST /api/pos/importar
app.post('/importar', async (c) => {
    try {
        const body = await c.req.parseBody();
        const file = body['archivo'] || body['file'];
        if (!file || !(file instanceof File)) {
            return c.json({ success: false, error: 'Se requiere un archivo .xlsx válido.' }, 400);
        }
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const resultado = await importarArchivoPos(buffer);
        return c.json({
            success: true,
            data: resultado,
            message: `Archivo importado con éxito. Total filas: ${resultado.totalFilas}`,
        });
    }
    catch (err) {
        return c.json({ success: false, error: err.message || 'Error al importar archivo' }, 500);
    }
});
// GET /api/pos/grupos
app.get('/grupos', async (c) => {
    try {
        const grupos = await obtenerGrupos();
        return c.json({ success: true, data: grupos });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// GET /api/pos/matriz/:grupo
app.get('/matriz/:grupo', async (c) => {
    try {
        const grupo = c.req.param('grupo');
        const matriz = await obtenerMatrizGrupo(grupo);
        return c.json({ success: true, data: matriz });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 400);
    }
});
// GET /api/pos/referencia
app.get('/referencia', async (c) => {
    try {
        const items = await obtenerListaReferencia();
        return c.json({ success: true, data: items });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// PATCH /api/pos/producto/:id
app.patch('/producto/:id', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const actualizado = await actualizarProductoPos(id, {
            precioPos: body.precioPos,
            cantInvGeneral: body.cantInvGeneral,
        });
        return c.json({ success: true, data: actualizado });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 400);
    }
});
// PATCH /api/pos/orden/:grupo
app.patch('/orden/:grupo', async (c) => {
    try {
        const grupo = c.req.param('grupo');
        const body = await c.req.json();
        if (!Array.isArray(body.orden)) {
            return c.json({ success: false, error: 'El campo orden debe ser un arreglo de IDs' }, 400);
        }
        await actualizarOrdenProductos(grupo, body.orden);
        return c.json({ success: true, message: 'Orden actualizado correctamente' });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// GET /api/pos/exportar/excel/:grupo
app.get('/exportar/excel/:grupo', async (c) => {
    try {
        const grupo = c.req.param('grupo');
        const tipo = (c.req.query('tipo') || 'ambos');
        const buffer = await generarExcelColegioBuffer(grupo, tipo);
        const safeName = grupo.replace(/[^a-zA-Z0-9_-]/g, '_');
        return c.body(buffer, 200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="Matriz_${safeName}_${tipo.toUpperCase()}.xlsx"`,
        });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 400);
    }
});
// GET /api/pos/exportar/excel-global
app.get('/exportar/excel-global', async (c) => {
    try {
        const buffer = await generarExcelGlobalBuffer();
        return c.body(buffer, 200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="Matrices_Colegios_Global.xlsx"',
        });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// GET /api/pos/exportar/pos-38
app.get('/exportar/pos-38', async (c) => {
    try {
        const buffer = await generarXlsxPos38Buffer();
        return c.body(buffer, 200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': 'attachment; filename="POS_38_Columnas_Export.xlsx"',
        });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// GET /api/pos/imprimir/:grupo
app.get('/imprimir/:grupo', async (c) => {
    try {
        const grupo = c.req.param('grupo');
        const tipo = c.req.query('tipo') || 'precios'; // 'precios' o 'stock'
        if (grupo === POS_GRUPO_REFERENCIA) {
            return c.html('<h3>El grupo de referencia no genera vista de impresión.</h3>');
        }
        const matriz = await obtenerMatrizGrupo(grupo);
        const titulo = tipo === 'precios' ? 'Matriz de Precios' : 'Matriz de Inventario';
        const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${titulo} - ${grupo}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 20px; color: #000; font-size: 11px; }
    h1 { margin-bottom: 5px; font-size: 16px; }
    p { color: #555; margin-top: 0; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
    th, td { border: 1px solid #ccc; padding: 4px 6px; font-size: 10px; text-align: left; }
    th { background: #f0f0f0; }
    th.num, td.num { width: 25px; min-width: 25px; max-width: 25px; text-align: center; }
    th.prod, td.prod { width: 220px; min-width: 220px; max-width: 220px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @media print {
      body { padding: 0; }
      @page { size: letter landscape; margin: 10mm; }
    }
  </style>
</head>
<body>
  <div style="display: flex; align-items: center; margin-bottom: 10px;">
    <div style="margin-right: 20px;">
      <img src="/logo.png" style="height: 40px; width: auto; object-fit: contain;" alt="MODA mayaki" />
    </div>
    <div>
      <h1 style="margin-bottom: 2px;">${titulo} - ${grupo}</h1>
      <p style="margin-top: 0; margin-bottom: 0;">Fecha de emisión: ${new Date().toLocaleDateString('es-BO')}</p>
    </div>
  </div>
  <table style="margin-top: 0;">
    <thead>
      <tr>
        <th class="num">N°</th>
        <th class="prod">Producto</th>
        ${matriz.columnasTallas.map((t) => `<th>${t}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${matriz.filas
            .map((f, idx) => `
        <tr>
          <td class="num">${idx + 1}</td>
          <td class="prod">${f.nombreLimpio}</td>
          ${matriz.columnasTallas
            .map((t) => {
            const celda = f.celdas[t];
            if (celda) {
                if (tipo === 'precios' && celda.precioPos !== null && celda.precioPos !== undefined) {
                    return `<td>${celda.precioPos}</td>`;
                }
                else if (tipo === 'stock' && celda.cantInvGeneral !== null && celda.cantInvGeneral !== undefined) {
                    if (celda.tipoInventario === 'SIN INVENTARIO') {
                        return `<td>SIN INV</td>`;
                    }
                    return `<td>${celda.cantInvGeneral}</td>`;
                }
            }
            return '<td>-</td>';
        })
            .join('')}
        </tr>
      `)
            .join('')}
    </tbody>
  </table>
  <script>
    window.onload = function() { window.print(); }
  </script>
</body>
</html>
    `;
        return c.html(html);
    }
    catch (err) {
        return c.html(`<h3>Error: ${err.message}</h3>`, 400);
    }
});
// GET /api/pos/snapshots
app.get('/snapshots', async (c) => {
    try {
        const snapshots = await listarSnapshotsPos();
        return c.json({ success: true, data: snapshots });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// POST /api/pos/snapshots
app.post('/snapshots', async (c) => {
    try {
        const body = await c.req.json();
        if (!body.nombre) {
            return c.json({ success: false, error: 'El nombre de la instantánea es obligatorio' }, 400);
        }
        const snap = await crearSnapshotPos(body.nombre, body.descripcion, body.creadoPor);
        return c.json({ success: true, data: snap, message: 'Instantánea creada correctamente' });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});
// POST /api/pos/snapshots/:id/restaurar
app.post('/snapshots/:id/restaurar', async (c) => {
    try {
        const id = c.req.param('id');
        const res = await restaurarSnapshotPos(id);
        return c.json({ success: true, data: res, message: `Instantánea restaurada (${res.restaurados} productos)` });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 400);
    }
});
// DELETE /api/pos/snapshots/:id
app.delete('/snapshots/:id', async (c) => {
    try {
        const id = c.req.param('id');
        await eliminarSnapshotPos(id);
        return c.json({ success: true, message: 'Instantánea eliminada' });
    }
    catch (err) {
        return c.json({ success: false, error: err.message }, 400);
    }
});
export default app;
//# sourceMappingURL=pos.js.map