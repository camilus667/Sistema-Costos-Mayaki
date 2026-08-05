import { Hono } from 'hono';
import * as XLSX from 'xlsx';
import { importarVentasPos, vaciarVentasPos } from '../services/salesImport.service';
import {
  obtenerResumenColegios,
  obtenerResumenPeriodo,
  obtenerVentasPorPrendaYTalla,
  obtenerRangoFechasVentas,
  obtenerVentasConsolidadas,
  obtenerResumenMensualPorColegio,
  obtenerResumenPorMesDetalleColegios,
} from '../services/salesAnalytics.service';
import { calcularProyeccionVentas } from '../services/salesProjection.service';
import { generarVentasSimuladasExcelBuffer } from '../services/salesSimulator.service';
import { LOGO_MAYAKI_BASE64 } from '../constants/logo';
import { obtenerLiquidacionTalleristas, actualizarConfeccionistaPrenda } from '../services/talleristas.service';

const app = new Hono();

// /api/sales/limpiar - Vaciar base de datos de ventas (DELETE, POST, GET)
const handleLimpiar = async (c: any) => {
  try {
    await vaciarVentasPos();
    return c.json({
      success: true,
      message: 'La base de datos de ventas ha sido vaciada completamente.',
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Error al vaciar ventas' }, 500);
  }
};

app.delete('/limpiar', handleLimpiar);
app.post('/limpiar', handleLimpiar);
app.get('/limpiar', handleLimpiar);

// POST /api/sales/importar
app.post('/importar', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['archivo'] || body['file'];

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: 'Se requiere un archivo .xlsx válido de ventas.' }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const resultado = await importarVentasPos(buffer);

    return c.json({
      success: true,
      data: resultado,
      message: `Ventas importadas con éxito. Total filas insertadas: ${resultado.insertados}`,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message || 'Error al importar ventas' }, 500);
  }
});

// GET /api/sales/colegios
app.get('/colegios', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const colegios = await obtenerResumenColegios(colegio, anio);
    return c.json({ success: true, data: colegios });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/resumen-periodo
app.get('/resumen-periodo', async (c) => {
  try {
    const agrupacion = (c.req.query('agrupacion') as 'mensual' | 'trimestral') || 'trimestral';
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const resumen = await obtenerResumenPeriodo(agrupacion, colegio, anio);
    return c.json({ success: true, data: resumen });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/ventas-prenda
app.get('/ventas-prenda', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const trimestre = c.req.query('trimestre');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const detalle = await obtenerVentasPorPrendaYTalla(colegio, anio, trimestre);
    return c.json({ success: true, data: detalle });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/imprimir-colegios - Generar vista PDF imprimible de resumen por colegios
app.get('/imprimir-colegios', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const colegios = await obtenerResumenColegios(colegio, anio);
    const rango = await obtenerRangoFechasVentas(colegio, anio);

    let montoTotalGlobal = 0;
    let unidadesTotalGlobal = 0;

    colegios.forEach((co) => {
      montoTotalGlobal += co.totalVentaBs || 0;
      unidadesTotalGlobal += co.totalUnidades || 0;
    });

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte - Ventas por Colegio - Sistema Mayaki</title>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; padding: 20px; color: #000; background: #fff; line-height: 1.4; font-size: 11pt; }
    .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5pt solid #000; padding-bottom: 8pt; margin-bottom: 10pt; }
    .brand { display: flex; align-items: center; gap: 10pt; }
    .brand-title { font-size: 16pt; font-weight: 700; color: #000; margin: 0; }
    .brand-sub { font-size: 9.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.5pt; }
    .report-meta { text-align: right; font-size: 10pt; color: #333; }
    .report-meta-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 1pt solid #cbd5e1;
      padding: 6pt 10pt;
      border-radius: 4pt;
      margin-bottom: 12pt;
    }
    .meta-tags-left { display: flex; gap: 10pt; align-items: center; }
    .tag { background: #fff; border: 1pt solid #cbd5e1; padding: 3pt 8pt; border-radius: 4pt; font-size: 10pt; font-weight: 600; color: #000; }
    .meta-date-badge {
      background: #f1f5f9;
      border: 1pt solid #94a3b8;
      color: #000;
      padding: 4pt 12pt;
      border-radius: 4pt;
      font-size: 10pt;
      font-weight: 600;
    }
    .meta-date-badge strong {
      color: #000;
      margin-left: 3pt;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 11pt; table-layout: fixed; }
    th { background: #f1f5f9; border-bottom: 1.5pt solid #000; padding: 8pt 6pt; text-align: left; font-weight: 700; color: #000; font-size: 10pt; text-transform: uppercase; }
    td { border-bottom: 1pt solid #e2e8f0; padding: 8pt 6pt; text-align: left; font-size: 11pt; color: #000; }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot tr { background: #f1f5f9 !important; font-weight: 700; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; }
    tfoot td { padding: 10pt 6pt; font-size: 11pt; white-space: nowrap; color: #000; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap !important; }
    @media print {
      body { padding: 0; }
      @page { size: portrait; margin: 10mm; }
      tfoot { display: table-row-group; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="brand">
      <img src="${LOGO_MAYAKI_BASE64}" alt="mayaki Moda" style="height: 38px; width: auto; object-fit: contain;" />
    </div>
    <div class="report-meta">
      <div><strong>Emisión:</strong> ${new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</div>
      <div><strong>Reporte:</strong> Resumen de Colegios</div>
    </div>
  </div>

  

    <div class="meta-date-badge">
      Período: <strong>Desde ${rango.fechaInicio} hasta ${rango.fechaFin}</strong>
    </div>
  

  <table>
    <thead>
      <tr>
        <th style="width: 8%; text-align: center;">N°</th>
        <th style="width: 42%;">Colegio / Grupo</th>
        <th class="num" style="width: 25%;">Venta Total (Bs.)</th>
        <th class="num" style="width: 10%;">% Total</th>
        <th class="num" style="width: 15%;">Unidades</th>
      </tr>
    </thead>
    <tbody>
      ${colegios.map((c, idx) => {
      const pct = montoTotalGlobal > 0 ? ((c.totalVentaBs / montoTotalGlobal) * 100).toFixed(1) : '0.0';
      return `
          <tr>
            <td style="text-align: center; font-weight: 600;">${idx + 1}</td>
            <td><strong>${c.colegioGrupo}</strong></td>
            <td class="num"><strong>Bs. ${c.totalVentaBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
            <td class="num">${pct}%</td>
            <td class="num">${c.totalUnidades.toLocaleString()} u.</td>
          </tr>
        `;
    }).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2">TOTAL GENERAL</td>
        <td class="num">Bs. ${montoTotalGlobal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
        <td class="num">100.0%</td>
        <td class="num">${unidadesTotalGlobal.toLocaleString()} u.</td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    return c.html(html);
  } catch (err: any) {
    return c.text('Error al generar PDF: ' + err.message, 500);
  }
});

// GET /api/sales/imprimir-prendas - Generar vista PDF imprimible de desglose por prenda y tallas
app.get('/imprimir-prendas', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const anioStr = c.req.query('anio');
    const trimestre = c.req.query('trimestre');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;

    const prendas = await obtenerVentasPorPrendaYTalla(colegio, anio, trimestre);
    const rango = await obtenerRangoFechasVentas(colegio, anio);

    let montoTotalGlobal = 0;
    let unidadesTotalGlobal = 0;
    const desgloseGlobalTallas: Record<string, number> = {};

    prendas.forEach((p) => {
      montoTotalGlobal += p.totalVentaBs || 0;
      unidadesTotalGlobal += p.totalUnidades || 0;
      Object.entries(p.desgloseTallas).forEach(([t, cnt]) => {
        desgloseGlobalTallas[t] = (desgloseGlobalTallas[t] || 0) + cnt;
      });
    });

    const tallasGlobalBadges = Object.entries(desgloseGlobalTallas)
      .map(([t, cnt]) => {
        const tClean = t.replace(/^Talla\s*/i, '');
        return `<span class="talla-pill"><strong>${tClean}</strong>:${cnt}u</span>`;
      })
      .join('');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte - Desglose por Prenda y Tallas - Sistema Mayaki</title>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; padding: 20px; color: #000; background: #fff; line-height: 1.35; font-size: 10.5pt; }
    .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5pt solid #000; padding-bottom: 8pt; margin-bottom: 10pt; }
    .brand { display: flex; align-items: center; gap: 10pt; }
    .brand-title { font-size: 16pt; font-weight: 700; color: #000; margin: 0; }
    .brand-sub { font-size: 9.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.5pt; }
    .report-meta { text-align: right; font-size: 10pt; color: #333; }
    .report-meta-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 1pt solid #cbd5e1;
      padding: 6pt 10pt;
      border-radius: 4pt;
      margin-bottom: 12pt;
    }
    .meta-tags-left { display: flex; gap: 10pt; align-items: center; }
    .tag { background: #fff; border: 1pt solid #cbd5e1; padding: 3pt 8pt; border-radius: 4pt; font-size: 10pt; font-weight: 600; color: #000; }
    .meta-date-badge {
      background: #f1f5f9;
      border: 1pt solid #94a3b8;
      color: #000;
      padding: 4pt 12pt;
      border-radius: 4pt;
      font-size: 10pt;
      font-weight: 600;
    }
    .meta-date-badge strong {
      color: #000;
      margin-left: 3pt;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 10.5pt; table-layout: fixed; }
    th { background: #f1f5f9; border-bottom: 1.5pt solid #000; padding: 6pt 5pt; text-align: left; font-weight: 700; color: #000; font-size: 10pt; text-transform: uppercase; }
    td { border-bottom: 1pt solid #e2e8f0; padding: 5pt 5pt; text-align: left; vertical-align: middle; font-size: 10.5pt; color: #000; }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot tr { background: #f1f5f9 !important; font-weight: 700; border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000; }
    tfoot td { padding: 7pt 5pt; font-size: 11pt; white-space: nowrap; color: #000; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap !important; }
    .tallas-grid-compact {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5pt 3pt;
      align-items: center;
    }
    .talla-pill {
      display: inline-flex;
      align-items: center;
      padding: 1.5pt 4.5pt;
      background: #fff;
      border: 1pt solid #cbd5e1;
      color: #000;
      border-radius: 3pt;
      font-size: 9pt;
      font-weight: 600;
      white-space: nowrap;
    }
    .talla-pill strong {
      color: #000;
      margin-right: 1.5pt;
    }
    @media print {
      body { padding: 0; }
      @page { size: portrait; margin: 10mm; }
      tfoot { display: table-row-group; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="brand">
      <img src="${LOGO_MAYAKI_BASE64}" alt="mayaki Moda" style="height: 38px; width: auto; object-fit: contain;" />
    </div>
    <div class="report-meta">
      <div><strong>Emisión:</strong> ${new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</div>
      <div><strong>Reporte:</strong> Desglose por Prenda y Tallas</div>
    </div>
  </div>

  <div class="report-meta-strip">
    <div class="meta-tags-left">
      <span class="tag">Colegio: <strong>${colegio || 'Todos'}</strong></span>
      ${trimestre ? `<span class="tag">Trimestre: <strong>${trimestre}</strong></span>` : ''}
      <span class="tag">Total Prendas: <strong>${prendas.length}</strong></span>
    </div>
    <div class="meta-date-badge">
      Período: <strong>Desde ${rango.fechaInicio} hasta ${rango.fechaFin}</strong>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 4%; text-align: center;">N°</th>
        <th style="width: 22%;">Prenda / Producto</th>
        <th style="width: 14%;">Colegio</th>
        <th class="num" style="width: 11%;">Unidades</th>
        <th class="num" style="width: 14%;">Venta (Bs)</th>
        <th style="width: 35%;">Desglose por Tallas</th>
      </tr>
    </thead>
    <tbody>
      ${prendas.map((p, idx) => {
      const tallasStr = Object.entries(p.desgloseTallas)
        .map(([t, cnt]) => {
          const tClean = t.replace(/^Talla\s*/i, '');
          return `<span class="talla-pill"><strong>${tClean}</strong>:${cnt}u</span>`;
        })
        .join('');

      return `
          <tr>
            <td style="text-align: center; font-weight: 600;">${idx + 1}</td>
            <td><strong>${p.nombreLimpio}</strong></td>
            <td>${p.colegioGrupo}</td>
            <td class="num">${p.totalUnidades.toLocaleString()} u.</td>
            <td class="num"><strong>Bs. ${p.totalVentaBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
            <td><div class="tallas-grid-compact">${tallasStr}</div></td>
          </tr>
        `;
    }).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2">TOTALES GENERAL</td>
        <td>-</td>
        <td class="num">${unidadesTotalGlobal.toLocaleString()} u.</td>
        <td class="num">Bs. ${montoTotalGlobal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
        <td><div class="tallas-grid-compact">${tallasGlobalBadges}</div></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

    return c.html(html);
  } catch (err: any) {
    return c.text('Error al generar PDF: ' + err.message, 500);
  }
});

// POST /api/sales/proyectar
app.post('/proyectar', async (c) => {
  try {
    const body = await c.req.json();
    const colegioOrigen = body.colegioOrigen || 'Inf SM';
    const colegioDestino = body.colegioDestino || 'Cambridge';
    const anio = parseInt(body.anio, 10) || 2025;
    const trimestre = body.trimestre || undefined;
    const factorEscalaAlumnos = parseFloat(body.factorEscalaAlumnos) || 1.0;
    const factorCrecimientoPct = parseFloat(body.factorCrecimientoPct) || 0.0;
    const vendedorSimulado = body.vendedorSimulado;

    const proyeccion = await calcularProyeccionVentas(
      colegioOrigen,
      colegioDestino,
      anio,
      trimestre,
      factorEscalaAlumnos,
      factorCrecimientoPct,
      vendedorSimulado
    );

    return c.json({ success: true, data: proyeccion });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 400);
  }
});

// POST /api/sales/exportar-ventas-simuladas
app.post('/exportar-ventas-simuladas', async (c) => {
  try {
    const body = await c.req.json();
    const colegioOrigen = body.colegioOrigen || 'Inf SM';
    const colegioDestino = body.colegioDestino || 'Cambridge';
    const anio = parseInt(body.anio, 10) || 2025;
    const trimestre = body.trimestre || undefined;
    const factorEscalaAlumnos = parseFloat(body.factorEscalaAlumnos) || 1.0;
    const factorCrecimientoPct = parseFloat(body.factorCrecimientoPct) || 0.0;
    const vendedorNombre = body.vendedorNombre || 'Sara Limachi SM';
    const nPedidoInicial = parseInt(body.nPedidoInicial, 10) || 3000;
    const fechaInicioIso = body.fechaInicioIso;
    const fechaFinIso = body.fechaFinIso;

    let proyeccion = body.proyeccion;
    if (!proyeccion) {
      proyeccion = await calcularProyeccionVentas(
        colegioOrigen,
        colegioDestino,
        anio,
        trimestre,
        factorEscalaAlumnos,
        factorCrecimientoPct,
        vendedorNombre
      );
    }

    const buffer = generarVentasSimuladasExcelBuffer(proyeccion, {
      vendedorNombre,
      nPedidoInicial,
      fechaInicioIso,
      fechaFinIso,
    });

    const colegioFinal = proyeccion.colegioDestino || colegioDestino;
    const nombreArchivo = `sales_export_simulado_${colegioFinal}_${vendedorNombre.replace(/\s+/g, '_')}.xlsx`;

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="${nombreArchivo}"`);

    return c.body(Uint8Array.from(buffer));
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/consolidado - Listado consolidado ordenado cronológicamente (antigua -> nueva)
app.get('/consolidado', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const fechaInicio = c.req.query('fechaInicio');
    const fechaFin = c.req.query('fechaFin');
    const anioStr = c.req.query('anio');
    const anio = (fechaInicio || fechaFin) ? (anioStr ? parseInt(anioStr, 10) : undefined) : (anioStr === '' ? undefined : (anioStr ? parseInt(anioStr, 10) : 2026));
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '25', 10);

    const todas = await obtenerVentasConsolidadas(colegio, anio, fechaInicio, fechaFin);

    let totalCobrado = 0;
    let totalUnidades = 0;
    let totalDescuento = 0;

    todas.forEach((v) => {
      totalCobrado += v.totalCobrado || 0;
      totalUnidades += v.cantidad || 0;
      totalDescuento += v.totalDescuento || 0;
    });

    const totalCount = todas.length;
    const totalPages = Math.ceil(totalCount / limit) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * limit;
    const paginatedData = todas.slice(startIndex, startIndex + limit);

    return c.json({
      success: true,
      count: totalCount,
      page: currentPage,
      limit,
      totalPages,
      totales: {
        totalCobrado: Math.round(totalCobrado * 100) / 100,
        totalUnidades: Math.round(totalUnidades * 100) / 100,
        totalDescuento: Math.round(totalDescuento * 100) / 100,
      },
      data: paginatedData,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/exportar-consolidado-excel - Exportar Registro Consolidado a Excel (.xlsx)
app.get('/exportar-consolidado-excel', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const fechaInicio = c.req.query('fechaInicio');
    const fechaFin = c.req.query('fechaFin');
    const anioStr = c.req.query('anio');
    const anio = (fechaInicio || fechaFin) ? (anioStr ? parseInt(anioStr, 10) : undefined) : (anioStr === '' ? undefined : (anioStr ? parseInt(anioStr, 10) : 2026));

    const ventas = await obtenerVentasConsolidadas(colegio, anio, fechaInicio, fechaFin);

    const excelRows = ventas.map((v) => ({
      'pedido': v.nPedido,
      'estado': v.estado,
      'fecha': v.fecha,
      'usuario': v.usuario,
      'cliente': v.cliente,
      'nro_doc': v.nroDoc,
      'nombre_del_producto': v.nombreProducto,
      'cantidad': v.cantidad,
      'precio_unit': v.precioUnitario,
      'total_descuento': v.totalDescuento,
      'total_cobrado': v.totalCobrado,
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Consolidado_Ventas');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    c.header('Content-Disposition', `attachment; filename="Registro_Consolidado_Ventas_${Date.now()}.xlsx"`);
    return c.body(buffer);
  } catch (err: any) {
    return c.text('Error al exportar Excel: ' + err.message, 500);
  }
});

// GET /api/sales/imprimir-consolidado - Generar vista PDF imprimible de Registro Consolidado de Ventas
app.get('/imprimir-consolidado', async (c) => {
  try {
    const colegio = c.req.query('colegio');
    const fechaInicio = c.req.query('fechaInicio');
    const fechaFin = c.req.query('fechaFin');
    const anioStr = c.req.query('anio');
    const anio = (fechaInicio || fechaFin) ? (anioStr ? parseInt(anioStr, 10) : undefined) : (anioStr === '' ? undefined : (anioStr ? parseInt(anioStr, 10) : 2026));

    const ventas = await obtenerVentasConsolidadas(colegio, anio, fechaInicio, fechaFin);
    const rango = await obtenerRangoFechasVentas(colegio, anio, fechaInicio, fechaFin);

    let totalVendidoSum = 0;
    ventas.forEach((v) => { totalVendidoSum += v.totalCobrado || 0; });
    const comision = totalVendidoSum * 0.1;

    const tituloColegio = colegio ? colegio.toUpperCase() : 'SAN MARCOS';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Registro Consolidado de Ventas del ${rango.fechaInicio} al ${rango.fechaFin}</title>
  <style>
    @page {
      size: letter landscape;
      margin: 10mm 10mm 10mm 10mm;
      @bottom-center {
        content: "Página " counter(page) " de " counter(pages);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 8pt;
        color: #333;
      }
    }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      padding: 0;
      color: #0f172a;
      background: #fff;
      font-size: 9pt;
      line-height: 1.2;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .brand-logo-box {
      display: flex;
      flex-direction: column;
    }
    .brand-logo-title {
      font-family: 'Outfit', sans-serif;
      font-size: 19pt;
      font-weight: 800;
      color: #be123c;
      line-height: 0.85;
      letter-spacing: -0.5pt;
    }
    .brand-logo-sub {
      font-size: 9.5pt;
      font-weight: 700;
      color: #0f172a;
    }
    .report-title-center {
      font-size: 12pt;
      font-weight: 800;
      color: #0f172a;
      text-align: center;
      flex-grow: 1;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      font-size: 9pt;
      table-layout: fixed;
    }
    th {
      background: #0f4c81;
      color: #ffffff;
      padding: 4.5pt 4pt;
      text-align: left;
      font-weight: 700;
      font-size: 9pt;
      border: 0.8pt solid #0f4c81;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    td {
      border: 0.8pt solid #cbd5e1;
      padding: 3.5pt 4pt;
      vertical-align: middle;
      color: #0f172a;
      font-size: 9pt;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    tr:nth-child(even) { background: #f8fafc; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .summary-box-wrap {
      display: flex;
      justify-content: flex-end;
      margin-top: 8px;
      page-break-inside: avoid;
    }
    .summary-table {
      width: 200px;
      border-collapse: collapse;
      font-size: 8pt;
      border: 1pt solid #cbd5e1;
    }
    .summary-table td {
      padding: 3pt 6pt;
      border: 1pt solid #cbd5e1;
    }
    .summary-table .label {
      font-weight: 700;
      background: #f1f5f9;
      text-align: center;
    }
    .summary-table .val {
      font-weight: 700;
      text-align: right;
    }

    .page-footer-html {
      margin-top: 10px;
      text-align: center;
      font-size: 8pt;
      color: #333;
      font-weight: 600;
    }

    @media print {
      body { padding: 0; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div class="brand-logo-box">
      <img src="${LOGO_MAYAKI_BASE64}" alt="mayaki Moda" style="height: 38px; width: auto; object-fit: contain;" />
    </div>
    <div class="report-title-center">
      Registro Consolidado de Ventas del ${rango.fechaInicio} al ${rango.fechaFin}
    </div>
    <div style="width: 80px;"></div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="center" style="width: 6.5%;">pedido</th>
        <th style="width: 8.5%;">estado</th>
        <th style="width: 14%;">fecha</th>
        <th style="width: 12%;">usuario</th>
        <th class="truncate" style="width: 6%;">cliente</th>
        <th class="truncate" style="width: 6%;">nro_doc</th>
        <th style="width: 29%;">nombre_del_producto</th>
        <th class="num" style="width: 4.5%;">cantidad</th>
        <th class="num" style="width: 4.5%;">precio_unit</th>
        <th class="num" style="width: 4.5%;">total_descuento</th>
        <th class="num" style="width: 4.5%;">total_cobrado</th>
      </tr>
    </thead>
    <tbody>
      ${ventas.map((v) => {
      const cantStr = String(Math.round(v.cantidad)).padStart(2, '0');
      const puStr = v.precioUnitario.toFixed(1);
      const descStr = v.totalDescuento.toFixed(1);
      const cobStr = v.totalCobrado.toFixed(1);
      return `
          <tr>
            <td class="center"><strong>${v.nPedido}</strong></td>
            <td>${v.estado}</td>
            <td>${v.fecha}</td>
            <td>${v.usuario}</td>
            <td class="truncate">${v.cliente}</td>
            <td class="truncate">${v.nroDoc}</td>
            <td class="truncate"><strong>${v.nombreProducto}</strong></td>
            <td class="num">${cantStr}</td>
            <td class="num">${puStr}</td>
            <td class="num">${descStr}</td>
            <td class="num"><strong>${cobStr}</strong></td>
          </tr>
        `;
    }).join('')}
    </tbody>
  </table>

  <div class="summary-box-wrap">
    <table class="summary-table">
      <tr>
        <td class="label">Total Vendido</td>
        <td class="val">${totalVendidoSum.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
      </tr>

    </table>
  </div>

  <div class="page-footer-html">
   
  </div>
</body>
</html>`;

    return c.html(html);
  } catch (err: any) {
    return c.text('Error al generar PDF: ' + err.message, 500);
  }
});

// GET /api/sales/imprimir-resumen-mensual - Generar vista PDF imprimible de Resumen Mensual de Ventas por Colegio
app.get('/imprimir-resumen-mensual', async (c) => {
  try {
    const anioStr = c.req.query('anio');
    const anio = anioStr === '' ? 2026 : (anioStr ? parseInt(anioStr, 10) : 2026);

    const mesesResumen = await obtenerResumenPorMesDetalleColegios(anio);
    const rango = await obtenerRangoFechasVentas('', anio);

    let montoTotalAnualGlobal = 0;
    let unidadesTotalAnualGlobal = 0;

    mesesResumen.forEach((m) => {
      montoTotalAnualGlobal += m.totalVentaBsMes || 0;
      unidadesTotalAnualGlobal += m.totalUnidadesMes || 0;
    });

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Resumen Mensual de Ventas por Colegio del ${rango.fechaInicio} al ${rango.fechaFin}</title>
  <style>
    @page {
      size: letter portrait;
      margin: 10mm 10mm 10mm 10mm;
      @bottom-center {
        content: "Página " counter(page) " de " counter(pages);
        font-family: 'Inter', system-ui, sans-serif;
        font-size: 10pt;
        color: #333;
      }
    }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      padding: 0;
      color: #0f172a;
      background: #fff;
      font-size: 10pt;
      line-height: 1.25;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      border-bottom: 1.5pt solid #0f4c81;
      padding-bottom: 6px;
    }
    .brand-logo-title {
      font-family: 'Outfit', sans-serif;
      font-size: 22pt;
      font-weight: 800;
      color: #be123c;
      line-height: 0.85;
    }
    .brand-logo-sub {
      font-size: 11pt;
      font-weight: 700;
      color: #0f172a;
    }
    .report-title-center {
      font-size: 13.5pt;
      font-weight: 800;
      color: #0f172a;
      text-align: center;
      flex-grow: 1;
    }
    .mes-block {
      margin-bottom: 14px;
      page-break-inside: avoid;
    }
    .mes-title {
      font-size: 11pt;
      font-weight: 800;
      color: #0f4c81;
      margin-bottom: 4px;
      border-left: 3.5pt solid #0f4c81;
      padding-left: 6px;
      text-transform: uppercase;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10pt;
    }
    th {
      background: #0f4c81;
      color: #ffffff;
      padding: 4.5pt 6pt;
      text-align: left;
      font-weight: 700;
      font-size: 10pt;
      border: 0.8pt solid #0f4c81;
    }
    td {
      border: 0.8pt solid #cbd5e1;
      padding: 3.5pt 6pt;
      color: #0f172a;
      font-size: 10pt;
    }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot tr {
      background: #f1f5f9 !important;
      font-weight: 700;
      border-top: 1.5pt solid #0f4c81;
      font-size: 10pt;
    }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .center { text-align: center; }

    .summary-box-wrap {
      display: flex;
      justify-content: flex-end;
      margin-top: 14px;
      page-break-inside: avoid;
    }
    .summary-table {
      width: 320px;
      border-collapse: collapse;
      font-size: 10pt;
      border: 1.5pt solid #0f4c81;
    }
    .summary-table td {
      padding: 5pt 9pt;
      border: 1pt solid #cbd5e1;
      font-size: 10pt;
    }
    .summary-table .label {
      font-weight: 700;
      background: #f1f5f9;
    }
    .summary-table .val {
      font-weight: 800;
      text-align: right;
      color: #0f4c81;
    }
    @media print {
      body { padding: 0; }
      th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="report-header">
    <div style="display: flex; align-items: center;">
      <img src="${LOGO_MAYAKI_BASE64}" alt="mayaki Moda" style="height: 38px; width: auto; object-fit: contain;" />
    </div>
    <div class="report-title-center">
      Resumen Mensual de Ventas por Colegio (${anio})
    </div>
    <div style="width: 80px;"></div>
  </div>

  ${mesesResumen.map((m) => `
    <div class="mes-block">
      <div class="mes-title">MES: ${m.mesNombre.toUpperCase()} ${anio}</div>
      <table>
        <thead>
          <tr>
            <th style="width: 35%;">Colegio / Grupo</th>
            <th class="num" style="width: 20%;">Unidades Vendidas</th>
            <th class="num" style="width: 25%;">Venta Total (Bs.)</th>
            <th class="num" style="width: 20%;">% del Mes</th>
          </tr>
        </thead>
        <tbody>
          ${m.colegios.map((c) => {
      const pct = m.totalVentaBsMes > 0 ? ((c.montoBs / m.totalVentaBsMes) * 100).toFixed(1) : '0.0';
      return `
              <tr>
                <td><strong>${c.colegioGrupo}</strong></td>
                <td class="num">${c.unidades.toLocaleString()} u.</td>
                <td class="num"><strong>Bs. ${c.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
                <td class="num">${pct}%</td>
              </tr>
            `;
    }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL ${m.mesNombre.toUpperCase()} ${anio}</td>
            <td class="num">${m.totalUnidadesMes.toLocaleString()} u.</td>
            <td class="num">Bs. ${m.totalVentaBsMes.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
            <td class="num">100.0%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `).join('')}

  <div class="summary-box-wrap">
    <table class="summary-table">
      <tr>
        <td class="label">RECAUDACIÓN TOTAL ANUAL (${anio})</td>
        <td class="val">Bs. ${montoTotalAnualGlobal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td class="label">UNIDADES TOTALES VENDIDAS (${anio})</td>
        <td class="val">${unidadesTotalAnualGlobal.toLocaleString()} u.</td>
      </tr>
    </table>
  </div>
</body>
</html>`;
    return c.html(html);
  } catch (err: any) {
    return c.text('Error al generar PDF: ' + err.message, 500);
  }
});

// GET /api/sales/talleristas - Liquidación de pagos a confeccionistas/talleristas
app.get('/talleristas', async (c) => {
  try {
    const tallerista = c.req.query('tallerista');
    const origen = (c.req.query('origen') || 'total') as any;
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : 2026;

    const res = await obtenerLiquidacionTalleristas(tallerista, origen, anio);
    return c.json(res);
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// PUT /api/sales/talleristas/asignar - Reasignar confeccionista de una prenda
app.put('/talleristas/asignar', async (c) => {
  try {
    const body = await c.req.json();
    const { productoId, confeccionista } = body;
    if (!productoId || !confeccionista) {
      return c.json({ success: false, error: 'productoId y confeccionista son requeridos.' }, 400);
    }
    const ok = await actualizarConfeccionistaPrenda(productoId, confeccionista);
    return c.json({ success: ok, message: ok ? 'Confeccionista asignado exitosamente.' : 'Error al asignar confeccionista.' });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// GET /api/sales/imprimir-talleristas - Imprimir reporte PDF vertical de liquidación de costura
app.get('/imprimir-talleristas', async (c) => {
  try {
    const tallerista = c.req.query('tallerista');
    const origen = (c.req.query('origen') || 'total') as any;
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : 2026;

    const res = await obtenerLiquidacionTalleristas(tallerista, origen, anio);
    const data = res.data || [];
    const kpis = res.kpis || {};

    const origenTexto = origen === 'total' ? 'Total Fabricado (Ventas + Stock)' : (origen === 'ventas' ? 'Solo Unidades Vendidas' : 'Solo Stock Actual');
    const tituloTallerista = tallerista && tallerista !== 'todos' ? tallerista : 'Consolidado General de Confeccionistas';

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Liquidación de Pago por Costura Externa - ${tituloTallerista}</title>
  <style>
    @page { size: letter portrait; margin: 10mm; }
    body { font-family: 'Inter', system-ui, sans-serif; padding: 0; color: #0f172a; background: #fff; font-size: 10pt; line-height: 1.35; }
    .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5pt solid #0f4c81; padding-bottom: 8pt; margin-bottom: 10pt; }
    .report-title-center { font-size: 13pt; font-weight: 800; color: #0f4c81; text-align: center; text-transform: uppercase; letter-spacing: -0.3pt; }
    .meta-strip { display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1pt solid #cbd5e1; padding: 5pt 10pt; border-radius: 4pt; margin-bottom: 10pt; font-size: 9.5pt; }
    .tag { background: #fff; border: 1pt solid #cbd5e1; padding: 2pt 7pt; border-radius: 4pt; font-weight: 700; color: #0f4c81; }
    .taller-block { margin-bottom: 14pt; page-break-inside: avoid; }
    .taller-header { background: #0f4c81; color: #fff; font-size: 10.5pt; font-weight: 800; padding: 5pt 8pt; border-radius: 3pt 3pt 0 0; display: flex; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; margin-top: 0; font-size: 9.5pt; table-layout: fixed; }
    th { background: #f1f5f9; border-bottom: 1.5pt solid #0f4c81; border-top: 1pt solid #cbd5e1; padding: 5pt 4pt; text-align: left; font-weight: 700; color: #0f4c81; font-size: 9pt; text-transform: uppercase; }
    td { border-bottom: 1pt solid #e2e8f0; padding: 4pt 4pt; text-align: left; vertical-align: middle; font-size: 9.5pt; color: #0f172a; }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot tr { background: #f1f5f9 !important; font-weight: 700; border-top: 1.5pt solid #0f4c81; border-bottom: 1.5pt solid #0f4c81; }
    tfoot td { padding: 6pt 4pt; font-size: 10pt; white-space: nowrap; color: #0f4c81; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap !important; }
    .center { text-align: center; }
    .signatures { display: flex; justify-content: space-between; margin-top: 30pt; page-break-inside: avoid; }
    .sig-box { width: 42%; text-align: center; border-top: 1pt solid #475569; padding-top: 4pt; font-size: 9pt; font-weight: 600; color: #334155; }
    @media print { body { padding: 0; } th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="report-header">
    <div style="display: flex; align-items: center;">
      <img src="${LOGO_MAYAKI_BASE64}" alt="mayaki Moda" style="height: 38px; width: auto; object-fit: contain;" />
    </div>
    <div class="report-title-center">
      Liquidación de Pago por Costura Externa (${anio})
    </div>
    <div style="font-size: 9pt; text-align: right; color: #475569;">
      <strong>Emisión:</strong> ${new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })}
    </div>
  </div>

  <div class="meta-strip">
    <div>Confeccionista / Taller: <strong>${tituloTallerista}</strong></div>
    <div>Criterio: <span class="tag">${origenTexto}</span></div>
    <div>Total Unidades: <strong>${(kpis.totalUnidadesGlobal || 0).toLocaleString()} u.</strong></div>
  </div>

  ${data.map(t => `
    <div class="taller-block">
      <div class="taller-header">
        <span>🧵 TALLERISTA / ESPECIALIDAD: ${t.confeccionista.toUpperCase()}</span>
        <span>${t.totalUnidades.toLocaleString()} u. | Bs. ${t.montoTotalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th class="center" style="width: 5%;">N°</th>
            <th style="width: 32%;">Prenda / Producto</th>
            <th style="width: 15%;">Colegio</th>
            <th class="num" style="width: 10%;">T2-10</th>
            <th class="num" style="width: 10%;">T12-S</th>
            <th class="num" style="width: 10%;">TM-4XL</th>
            <th class="num" style="width: 8%;">Total U.</th>
            <th class="num" style="width: 10%;">Total Bs.</th>
          </tr>
        </thead>
        <tbody>
          ${t.prendas.map((p: any, idx: number) => `
            <tr>
              <td class="center" style="font-weight: 600;">${idx + 1}</td>
              <td><strong>${p.descripcion}</strong></td>
              <td>${p.colegioGrupo}</td>
              <td class="num">${p.cantGrupo1} u. <span style="font-size:8pt; color:#64748b;">(Bs.${p.rateGrupo1})</span></td>
              <td class="num">${p.cantGrupo2} u. <span style="font-size:8pt; color:#64748b;">(Bs.${p.rateGrupo2})</span></td>
              <td class="num">${p.cantGrupo3} u. <span style="font-size:8pt; color:#64748b;">(Bs.${p.rateGrupo3})</span></td>
              <td class="num"><strong>${p.unidadesTotal}</strong></td>
              <td class="num" style="font-weight: 800; color: #0f4c81;">Bs. ${p.montoPagarBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">SUBTOTAL CONFECCIONISTA (${t.confeccionista})</td>
            <td colspan="4" class="num">${t.totalUnidades.toLocaleString()} u. confeccionadas</td>
            <td class="num">Bs. ${t.montoTotalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `).join('')}

  <div style="margin-top: 15pt; display: flex; justify-content: flex-end;">
    <div style="background: #f1f5f9; border: 1.5pt solid #0f4c81; padding: 8pt 14pt; border-radius: 4pt; font-size: 11pt; font-weight: 800; color: #0f4c81;">
      TOTAL GENERAL A CANCELAR EN COSTURA: Bs. ${(kpis.montoTotalGlobalBs || 0).toLocaleString('es-BO', { minimumFractionDigits: 2 })}
    </div>
  </div>

  <div class="signatures">
    <div class="sig-box">
      Entregado Por (Firma y Nombre)<br>
      Administración / Mayaki Moda
    </div>
    <div class="sig-box">
      Recibido Conforme (Firma y C.I.)<br>
      Confeccionista / Taller Externo
    </div>
  </div>
</body>
</html>`;

    return c.html(html);
  } catch (err: any) {
    return c.text('Error al generar reporte de talleristas: ' + err.message, 500);
  }
});

export default app;
