import { Hono } from 'hono';
import { importarVentasPos, vaciarVentasPos } from '../services/salesImport.service';
import {
  obtenerResumenColegios,
  obtenerResumenPeriodo,
  obtenerVentasPorPrendaYTalla,
} from '../services/salesAnalytics.service';
import { calcularProyeccionVentas } from '../services/salesProjection.service';
import { generarVentasSimuladasExcelBuffer } from '../services/salesSimulator.service';

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

    let montoTotalGlobal = 0;
    let unidadesTotalGlobal = 0;
    let filasTotalGlobal = 0;

    colegios.forEach((co) => {
      montoTotalGlobal += co.totalVentaBs || 0;
      unidadesTotalGlobal += co.totalUnidades || 0;
      filasTotalGlobal += co.totalFilas || 0;
    });

    const precioPromedioGlobal = unidadesTotalGlobal > 0 ? (montoTotalGlobal / unidadesTotalGlobal) : 0;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte PDF - Ventas Totales por Colegio - Sistema Mayaki</title>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; padding: 20px; color: #0f172a; background: #fff; line-height: 1.4; font-size: 11pt; }
    .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2pt solid #6366f1; padding-bottom: 8pt; margin-bottom: 10pt; }
    .brand { display: flex; align-items: center; gap: 10pt; }
    .brand-logo { font-size: 18pt; background: #6366f1; color: #fff; width: 32pt; height: 32pt; border-radius: 6pt; display: flex; align-items: center; justify-content: center; }
    .brand-title { font-size: 16pt; font-weight: 700; color: #0f172a; margin: 0; }
    .brand-sub { font-size: 10pt; color: #64748b; text-transform: uppercase; }
    .report-meta { text-align: right; font-size: 10.5pt; color: #475569; }
    .report-meta-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 1pt solid #cbd5e1;
      padding: 6pt 10pt;
      border-radius: 6pt;
      margin-bottom: 12pt;
    }
    .meta-tags-left { display: flex; gap: 8pt; align-items: center; }
    .tag { background: #fff; border: 1pt solid #cbd5e1; padding: 3pt 8pt; border-radius: 5pt; font-size: 10.5pt; font-weight: 600; color: #334155; }
    .meta-year-badge {
      background: #4338ca;
      color: #ffffff;
      padding: 4pt 12pt;
      border-radius: 5pt;
      font-size: 11pt;
      font-weight: 700;
      letter-spacing: 0.5pt;
    }
    .meta-year-badge strong {
      font-size: 14pt;
      font-weight: 900;
      color: #fef08a;
      margin-left: 4pt;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 11pt; table-layout: fixed; }
    th { background: #f8fafc; border-bottom: 2pt solid #cbd5e1; padding: 8pt 6pt; text-align: left; font-weight: 700; color: #334155; font-size: 10pt; text-transform: uppercase; overflow: hidden; }
    td { border-bottom: 1pt solid #e2e8f0; padding: 8pt 6pt; text-align: left; font-size: 11pt; overflow: hidden; text-overflow: ellipsis; }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot tr { background: #e0e7ff !important; font-weight: 700; border-top: 2pt solid #6366f1; }
    tfoot td { border-bottom: 2pt solid #6366f1; padding: 10pt 6pt; font-size: 11.5pt; white-space: nowrap; }
    .num, .amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap !important; }
    .badge { padding: 3pt 6pt; border-radius: 4pt; font-size: 10.5pt; font-weight: 600; white-space: nowrap; display: inline-block; }
    .badge-green { background: #d1fae5; color: #047857; }
    .badge-blue { background: #cff4fc; color: #0891b2; }
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
      <div class="brand-logo">📊</div>
      <div>
        <h1 class="brand-title">MAYAKI - Ventas Totales por Colegio</h1>
        <div class="brand-sub">Sistema de Gestión de Ventas & Proyecciones</div>
      </div>
    </div>
    <div class="report-meta">
      <div><strong>Emisión:</strong> ${new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</div>
      <div><strong>Reporte:</strong> Resumen de Colegios</div>
    </div>
  </div>

  <div class="report-meta-strip">
    <div class="meta-tags-left">
      <span class="tag">🏫 Colegio: <strong>${colegio || 'Todos'}</strong></span>
      <span class="tag">📊 Total: <strong>${colegios.length} colegios</strong></span>
    </div>
    <div class="meta-year-badge">
      AÑO EVALUADO: <strong>${anio ? anio : 'TODOS LOS AÑOS'}</strong>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 4%; text-align: center;">N°</th>
        <th style="width: 26%;">Colegio / Grupo</th>
        <th class="num" style="width: 22%;">Venta Total (Bs.)</th>
        <th class="num" style="width: 10%;">% Total</th>
        <th class="num" style="width: 12%;">Unidades</th>
        <th class="num" style="width: 14%;">Precio Prom. (Bs)</th>
        <th class="num" style="width: 12%;">Transacciones</th>
      </tr>
    </thead>
    <tbody>
      ${colegios.map((c, idx) => {
        const pct = montoTotalGlobal > 0 ? ((c.totalVentaBs / montoTotalGlobal) * 100).toFixed(1) : '0.0';
        const prom = c.totalUnidades > 0 ? (c.totalVentaBs / c.totalUnidades).toFixed(2) : '0.00';
        return `
          <tr>
            <td style="text-align: center; font-weight: 600;">${idx + 1}</td>
            <td><strong>${c.colegioGrupo}</strong></td>
            <td class="num"><strong style="color: #047857; white-space: nowrap;">Bs. ${c.totalVentaBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
            <td class="num"><span class="badge badge-blue">${pct}%</span></td>
            <td class="num"><span class="badge badge-green">${c.totalUnidades.toLocaleString()} u.</span></td>
            <td class="num" style="white-space: nowrap;">Bs. ${prom}</td>
            <td class="num" style="white-space: nowrap;">${c.totalFilas.toLocaleString()} reg.</td>
          </tr>
        `;
      }).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="white-space: nowrap;">TOTALES GLOBAL</td>
        <td class="num" style="white-space: nowrap;">Bs. ${montoTotalGlobal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
        <td class="num" style="white-space: nowrap;">100.0%</td>
        <td class="num" style="white-space: nowrap;">${unidadesTotalGlobal.toLocaleString()} u.</td>
        <td class="num" style="white-space: nowrap;">Bs. ${precioPromedioGlobal.toFixed(2)}</td>
        <td class="num" style="white-space: nowrap;">${filasTotalGlobal.toLocaleString()} reg.</td>
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
  <title>Reporte PDF - Desglose por Prenda y Tallas - Sistema Mayaki</title>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; padding: 20px; color: #0f172a; background: #fff; line-height: 1.35; font-size: 10.5pt; }
    .report-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2pt solid #6366f1; padding-bottom: 8pt; margin-bottom: 10pt; }
    .brand { display: flex; align-items: center; gap: 10pt; }
    .brand-logo { font-size: 18pt; background: #6366f1; color: #fff; width: 32pt; height: 32pt; border-radius: 6pt; display: flex; align-items: center; justify-content: center; }
    .brand-title { font-size: 16pt; font-weight: 700; color: #0f172a; margin: 0; }
    .brand-sub { font-size: 10pt; color: #64748b; text-transform: uppercase; }
    .report-meta { text-align: right; font-size: 10.5pt; color: #475569; }
    .report-meta-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f8fafc;
      border: 1pt solid #cbd5e1;
      padding: 6pt 10pt;
      border-radius: 6pt;
      margin-bottom: 12pt;
    }
    .meta-tags-left { display: flex; gap: 8pt; align-items: center; }
    .tag { background: #fff; border: 1pt solid #cbd5e1; padding: 3pt 8pt; border-radius: 5pt; font-size: 10.5pt; font-weight: 600; color: #334155; }
    .meta-year-badge {
      background: #4338ca;
      color: #ffffff;
      padding: 4pt 12pt;
      border-radius: 5pt;
      font-size: 11pt;
      font-weight: 700;
      letter-spacing: 0.5pt;
    }
    .meta-year-badge strong {
      font-size: 14pt;
      font-weight: 900;
      color: #fef08a;
      margin-left: 4pt;
    }
    table { width: 100%; border-collapse: collapse; margin-top: 8pt; font-size: 10.5pt; table-layout: fixed; }
    th { background: #f8fafc; border-bottom: 2pt solid #cbd5e1; padding: 6pt 5pt; text-align: left; font-weight: 700; color: #334155; font-size: 10pt; text-transform: uppercase; overflow: hidden; }
    td { border-bottom: 1pt solid #e2e8f0; padding: 5pt 5pt; text-align: left; vertical-align: middle; font-size: 10.5pt; overflow: hidden; text-overflow: ellipsis; }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot tr { background: #e0e7ff !important; font-weight: 700; border-top: 2pt solid #6366f1; }
    tfoot td { border-bottom: 2pt solid #6366f1; padding: 7pt 5pt; font-size: 11pt; white-space: nowrap; }
    .num, .amount { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap !important; }
    .badge { padding: 2pt 5pt; border-radius: 4pt; font-size: 9.5pt; font-weight: 600; white-space: nowrap; display: inline-block; }
    .badge-green { background: #d1fae5; color: #047857; }
    .badge-purple { background: #f3e8ff; color: #7e22ce; }
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
      background: #f1f5f9;
      border: 1pt solid #cbd5e1;
      color: #1e293b;
      border-radius: 3pt;
      font-size: 9.5pt;
      font-weight: 700;
      white-space: nowrap;
      line-height: 1.25;
    }
    .talla-pill strong {
      color: #4338ca;
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
      <div class="brand-logo">👗</div>
      <div>
        <h1 class="brand-title">MAYAKI - Desglose por Prenda y Tallas</h1>
        <div class="brand-sub">Sistema de Gestión de Ventas & Proyecciones</div>
      </div>
    </div>
    <div class="report-meta">
      <div><strong>Emisión:</strong> ${new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</div>
      <div><strong>Reporte:</strong> Desglose por Prenda y Tallas</div>
    </div>
  </div>

  <div class="report-meta-strip">
    <div class="meta-tags-left">
      <span class="tag">🏫 Colegio: <strong>${colegio || 'Todos'}</strong></span>
      ${trimestre ? `<span class="tag">📅 Trimestre: <strong>${trimestre}</strong></span>` : ''}
      <span class="tag">👗 Total: <strong>${prendas.length} prendas</strong></span>
    </div>
    <div class="meta-year-badge">
      AÑO EVALUADO: <strong>${anio ? anio : 'TODOS LOS AÑOS'}</strong>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 3.5%; text-align: center;">N°</th>
        <th style="width: 20%;">Prenda / Producto</th>
        <th style="width: 12.5%;">Colegio</th>
        <th class="num" style="width: 9%;">Unidades</th>
        <th class="num" style="width: 13%;">Venta (Bs)</th>
        <th style="width: 42%;">Desglose por Tallas</th>
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
            <td><span class="badge badge-purple">${p.colegioGrupo}</span></td>
            <td class="num"><span class="badge badge-green">${p.totalUnidades.toLocaleString()} u.</span></td>
            <td class="num"><strong style="color: #047857; white-space: nowrap;">Bs. ${p.totalVentaBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
            <td><div class="tallas-grid-compact">${tallasStr}</div></td>
          </tr>
        `;
      }).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="white-space: nowrap;">TOTALES GLOBAL (${prendas.length} prendas)</td>
        <td>-</td>
        <td class="num" style="white-space: nowrap;">${unidadesTotalGlobal.toLocaleString()} u.</td>
        <td class="num" style="white-space: nowrap;">Bs. ${montoTotalGlobal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
        <td style="white-space: normal;"><div class="tallas-grid-compact">${tallasGlobalBadges}</div></td>
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

export default app;
