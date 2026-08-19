import { Hono } from 'hono';
import XLSX from 'xlsx';
import { parsearExtractoBancarioBuffer } from '../services/bankParser.service';
import {
  guardarMovimientos,
  vaciarMovimientos,
  obtenerMetadataResumen,
  obtenerMovimientosFiltrados,
  obtenerRecurrentes,
  obtenerResumenMensualClasificado,
  obtenerRespaldoResumenCuentas,
} from '../services/bankAnalytics.service';

const bankRoutes = new Hono();

// Info de la base de datos de extractos
bankRoutes.get('/info', (c) => {
  try {
    const meta = obtenerMetadataResumen();
    return c.json({ success: true, data: meta });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Importar extracto bancario (.xls / .xlsx)
bankRoutes.post('/importar', async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body['archivo'];

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, error: 'No se envió ningún archivo de extracto válido.' }, 400);
    }

    const fileName = file.name;
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const resImport = parsearExtractoBancarioBuffer(buffer, fileName);

    if (resImport.totalTransacciones === 0) {
      return c.json({ success: false, error: 'No se encontraron movimientos válidos en el archivo provisto.' }, 400);
    }

    guardarMovimientos(resImport.movimientos, true);

    return c.json({
      success: true,
      message: `Extracto importado con éxito: ${resImport.totalTransacciones} movimientos detectados (${resImport.bancoDetectado}).`,
      data: resImport,
    });
  } catch (e: any) {
    console.error('Error al importar extracto:', e);
    return c.json({ success: false, error: e.message || 'Error al procesar el archivo Excel.' }, 500);
  }
});

// Movimientos paginados y filtrables
bankRoutes.get('/movimientos', (c) => {
  try {
    const banco = c.req.query('banco');
    const tipo = c.req.query('tipo');
    const categoria = c.req.query('categoria');
    const anomaloOnly = c.req.query('anomaloOnly') === 'true';
    const fechaInicio = c.req.query('fechaInicio');
    const fechaFin = c.req.query('fechaFin');
    const search = c.req.query('search');
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '25', 10);

    const res = obtenerMovimientosFiltrados({
      banco,
      tipo,
      categoria,
      anomaloOnly,
      fechaInicio,
      fechaFin,
      search,
      page,
      limit,
    });

    return c.json({ success: true, data: res });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Anomalías detectadas
bankRoutes.get('/anomalias', (c) => {
  try {
    const res = obtenerMovimientosFiltrados({ anomaloOnly: true, limit: 100 });
    return c.json({ success: true, data: res.data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Contrapartes recurrentes (Top Clientes y Top Proveedores)
bankRoutes.get('/recurrentes', (c) => {
  try {
    const tipo = c.req.query('tipo') as 'INGRESO' | 'EGRESO' | undefined;
    const limit = parseInt(c.req.query('limit') || '15', 10);
    const data = obtenerRecurrentes(tipo, limit);
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Resumen Mensual Clasificado por Origen y Propósito
bankRoutes.get('/resumen-mensual', (c) => {
  try {
    const anioStr = c.req.query('anio');
    const anio = anioStr ? parseInt(anioStr, 10) : undefined;
    const data = obtenerResumenMensualClasificado(anio);
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Vaciar datos de extractos
bankRoutes.post('/limpiar', (c) => {
  try {
    vaciarMovimientos();
    return c.json({ success: true, message: 'Base de datos de extractos bancarios vaciada exitosamente.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Generar Reporte PDF Imprimible
bankRoutes.get('/imprimir-reporte', (c) => {
  try {
    const meta = obtenerMetadataResumen();
    const resumenes = obtenerResumenMensualClasificado();
    const recurrentesIngresos = obtenerRecurrentes('INGRESO', 5);
    const recurrentesEgresos = obtenerRecurrentes('EGRESO', 5);
    const anomalias = obtenerMovimientosFiltrados({ anomaloOnly: true, limit: 50 }).data;

    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte Ejecutivo de Extractos Bancarios - MAYAKI</title>
        <style>
          @page { size: letter; margin: 15mm; }
          body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; background: #fff; line-height: 1.4; margin: 0; padding: 0; font-size: 12px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; }
          .logo { font-size: 22px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; }
          .logo span { color: #0f172a; }
          .meta-info { text-align: right; font-size: 11px; color: #64748b; }
          h2 { color: #0f172a; font-size: 16px; margin: 18px 0 8px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
          .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; text-align: center; }
          .kpi-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; }
          .kpi-val { font-size: 15px; font-weight: 700; color: #0284c7; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
          th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 6px 8px; border: 1px solid #cbd5e1; }
          td { padding: 6px 8px; border: 1px solid #e2e8f0; }
          .text-right { text-align: right; }
          .badge-anomalo { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; }
          .badge-ingreso { color: #16a34a; font-weight: 700; }
          .badge-egreso { color: #dc2626; font-weight: 700; }
          .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 10px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="logo">SISTEMA <span>MAYAKI</span></div>
            <div style="font-size: 13px; font-weight: 600; color: #475569;">Análisis de Extractos Bancarios & Detección de Anomalías</div>
          </div>
          <div class="meta-info">
            <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
            <div><strong>Bancos Registrados:</strong> ${meta.bancosDetectados.join(', ') || 'General'}</div>
            <div><strong>Rango Evaluado:</strong> ${meta.fechaMin} al ${meta.fechaMax}</div>
          </div>
        </div>

        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-title">Total Ingresos Bancarios</div>
            <div class="kpi-val" style="color: #16a34a;">Bs. ${meta.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Total Egresos Bancarios</div>
            <div class="kpi-val" style="color: #dc2626;">Bs. ${meta.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Balance Neto Acumulado</div>
            <div class="kpi-val" style="color: #0284c7;">Bs. ${(meta.totalIngresosBs - meta.totalEgresosBs).toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">Transacciones Anómalas</div>
            <div class="kpi-val" style="color: #ea580c;">${meta.totalAnomalias} 🚩</div>
          </div>
        </div>

        <h2>1. Resumen de Flujo de Fondos por Mes</h2>
        <table>
          <thead>
            <tr>
              <th>Período</th>
              <th>Transacciones</th>
              <th class="text-right">Total Ingresos</th>
              <th class="text-right">Total Egresos</th>
              <th class="text-right">Balance Neto</th>
              <th class="text-right">Anomalías</th>
            </tr>
          </thead>
          <tbody>
            ${resumenes.map((r) => `
              <tr>
                <td><strong>${r.periodoTexto}</strong></td>
                <td>${r.totalTransacciones} movs.</td>
                <td class="text-right badge-ingreso">Bs. ${r.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                <td class="text-right badge-egreso">Bs. ${r.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                <td class="text-right" style="font-weight: 700;">Bs. ${r.balanceMesBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                <td class="text-right">${r.anomalias.length > 0 ? `<span class="badge-anomalo">${r.anomalias.length} alertas</span>` : '0'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>2. Principales Clientes (Mayores Ingresos Recurrentes)</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre del Cliente / Originante</th>
              <th>Banco / Entidad</th>
              <th class="text-right">Frecuencia</th>
              <th class="text-right">Monto Promedio</th>
              <th class="text-right">Total Ingresado</th>
            </tr>
          </thead>
          <tbody>
            ${recurrentesIngresos.map((c) => `
              <tr>
                <td><strong>${c.contraparteNombre}</strong></td>
                <td>${c.banco}</td>
                <td class="text-right">${c.cantidadTransacciones} depósitos</td>
                <td class="text-right">Bs. ${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                <td class="text-right badge-ingreso">Bs. ${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <h2>3. Principales Proveedores de Telas e Insumos (Mayores Egresos)</h2>
        <table>
          <thead>
            <tr>
              <th>Nombre del Proveedor / Entidad</th>
              <th>Banco / Entidad</th>
              <th class="text-right">Frecuencia</th>
              <th class="text-right">Monto Promedio</th>
              <th class="text-right">Total Pagado</th>
            </tr>
          </thead>
          <tbody>
            ${recurrentesEgresos.map((c) => `
              <tr>
                <td><strong>${c.contraparteNombre}</strong></td>
                <td>${c.banco}</td>
                <td class="text-right">${c.cantidadTransacciones} pagos</td>
                <td class="text-right">Bs. ${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                <td class="text-right badge-egreso">Bs. ${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${anomalias.length > 0 ? `
          <h2>4. Transacciones Atípicas y Abultadas (🚩 Hallazgos Detectados)</h2>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Banco</th>
                <th>Tipo</th>
                <th>Contraparte / Origen</th>
                <th class="text-right">Monto (Bs.)</th>
                <th>Glosa / Motivo de Alerta</th>
              </tr>
            </thead>
            <tbody>
              ${anomalias.slice(0, 15).map((a) => `
                <tr>
                  <td>${a.fechaTexto}</td>
                  <td>${a.banco}</td>
                  <td><span class="${a.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${a.tipo}</span></td>
                  <td><strong>${a.contraparteNombre}</strong></td>
                  <td class="text-right" style="font-weight: 700;">Bs. ${a.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td><span class="badge-anomalo">${a.motivoAnomalia || a.glosaDetalle}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : ''}

        <div class="footer">
          Reporte generado automáticamente por el Sistema de Análisis de Extractos Bancarios MAYAKI • ${fechaHoy}
        </div>
      </body>
      </html>
    `;

    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Endpoint JSON del reporte estilo "12.0 Respaldo bancario resumen de cuentas"
bankRoutes.get('/respaldo-resumen-cuentas', (c) => {
  try {
    const data = obtenerRespaldoResumenCuentas();
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Endpoint Exportar Excel .xlsx con estructura idéntica a "12.0 Respaldo bancario resumen de cuentas.xlsx"
bankRoutes.get('/exportar-respaldo-excel', (c) => {
  try {
    const data = obtenerRespaldoResumenCuentas();
    const wb = XLSX.utils.book_new();

    // Hoja 1: ingresos (Resumen mensual de cuentas bancarias)
    const rowsIngresos: any[][] = [];
    rowsIngresos.push(['Resumen de cuentas Bancarias']);
    rowsIngresos.push([]);

    data.cuentas.forEach((cuenta) => {
      rowsIngresos.push(['Cuenta', cuenta.nroCuenta, 'Banco:', cuenta.banco]);
      rowsIngresos.push([null, null, `Saldo al ${cuenta.fechaInicialTexto}`, cuenta.saldoInicialBs]);
      rowsIngresos.push([]);
      rowsIngresos.push(['Mes', 'Creditos', 'Débitos', 'Saldo']);

      cuenta.filasMensuales.forEach((f) => {
        rowsIngresos.push([f.mesTexto, f.creditosBs, f.debitosBs, f.saldoBs]);
      });

      rowsIngresos.push([null, cuenta.totalCreditosBs, cuenta.totalDebitosBs, cuenta.saldoFinalBs]);
      rowsIngresos.push([]);
      rowsIngresos.push([]);
    });

    const wsIngresos = XLSX.utils.aoa_to_sheet(rowsIngresos);
    XLSX.utils.book_append_sheet(wb, wsIngresos, 'ingresos');

    // Hoja 2: egresos (Comparativo mensual entre bancos)
    const rowsEgresos: any[][] = [];
    const bancosList = Array.from(new Set(data.cuentas.map((c) => c.banco)));
    const headerEgresos = ['Mes', ...bancosList.map((b) => `${b} Egresos`), 'Total Mensual'];
    rowsEgresos.push(headerEgresos);

    let sumTotalEgresosGeneral = 0;
    const sumBancosEgresos: Record<string, number> = {};

    data.comparativoMeses.forEach((m) => {
      const row: any[] = [m.mesTexto];
      bancosList.forEach((b) => {
        const val = m.egresosPorBanco[b] || 0;
        row.push(val);
        sumBancosEgresos[b] = (sumBancosEgresos[b] || 0) + val;
      });
      row.push(m.totalEgresosMensualBs);
      sumTotalEgresosGeneral += m.totalEgresosMensualBs;
      rowsEgresos.push(row);
    });

    const totalRowEgresos: any[] = [null, ...bancosList.map((b) => sumBancosEgresos[b] || 0), sumTotalEgresosGeneral];
    rowsEgresos.push(totalRowEgresos);

    const wsEgresos = XLSX.utils.aoa_to_sheet(rowsEgresos);
    XLSX.utils.book_append_sheet(wb, wsEgresos, 'egresos');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    return c.body(buf, 200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="12.0_Respaldo_bancario_resumen_cuentas.xlsx"',
    });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default bankRoutes;
