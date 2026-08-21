import { Hono } from 'hono';
import XLSX from 'xlsx';
import { LOGO_MAYAKI_BASE64 } from '../constants/logo';
import { parsearExtractoBancarioBuffer } from '../services/bankParser.service';
import {
  guardarMovimientos,
  vaciarMovimientos,
  obtenerMetadataResumen,
  obtenerMovimientosFiltrados,
  obtenerRecurrentes,
  obtenerResumenMensualClasificado,
  obtenerRespaldoResumenCuentas,
  obtenerReglas,
  guardarRegla,
  guardarReglasLote,
  eliminarRegla,
  reaplicarReglasAMovimientos,
  obtenerCategoriasTotales,
  crearCategoriaCustom,
  obtenerSugerenciasClasificacion,
} from '../services/bankAnalytics.service';

const bankRoutes = new Hono();

// Info de la base de datos de extractos
bankRoutes.get('/info', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const meta = obtenerMetadataResumen(desde, hasta);
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
    const desde = c.req.query('desde') || c.req.query('fechaInicio');
    const hasta = c.req.query('hasta') || c.req.query('fechaFin');
    const res = obtenerMovimientosFiltrados({ anomaloOnly: true, fechaInicio: desde, fechaFin: hasta, limit: 100 });
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
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const data = obtenerRecurrentes(tipo, limit, desde, hasta);
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
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const data = obtenerResumenMensualClasificado(anio, desde, hasta);
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// GET /categorias - Obtener todas las categorías (predefinidas y custom)
bankRoutes.get('/categorias', (c) => {
  try {
    const cats = obtenerCategoriasTotales();
    return c.json({ success: true, data: cats });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /categorias - Crear categoría custom al instante
bankRoutes.post('/categorias', async (c) => {
  try {
    const body = await c.req.json();
    const { nombreVisible, tipo, icono } = body;

    if (!nombreVisible || typeof nombreVisible !== 'string' || nombreVisible.trim() === '') {
      return c.json({ success: false, error: 'Debe ingresar un nombre válido para la categoría.' }, 400);
    }

    const nuevaCat = crearCategoriaCustom(nombreVisible, tipo || 'AMBOS', icono || '🏷️');
    return c.json({ success: true, message: 'Categoría personalizada creada con éxito.', data: nuevaCat });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// GET /sugerencias-clasificacion - Transacciones grandes y contrapartes frecuentes con sus fechas
bankRoutes.get('/sugerencias-clasificacion', (c) => {
  try {
    const sugerencias = obtenerSugerenciasClasificacion();
    return c.json({ success: true, data: sugerencias });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// GET /reglas - Obtener reglas de personas conocidas
bankRoutes.get('/reglas', (c) => {
  try {
    const reglas = obtenerReglas();
    return c.json({ success: true, data: reglas });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /reglas - Crear nueva regla
bankRoutes.post('/reglas', async (c) => {
  try {
    const body = await c.req.json();
    const { keyword, banco, bancoContraparte, accion, categoriaDestino, tipoTransaccion, nota } = body;

    if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
      return c.json({ success: false, error: 'Debe ingresar un nombre de persona o palabra clave válido.' }, 400);
    }

    const accionValida = accion || 'EXCLUIR_ANOMALIA';
    const nuevaRegla = guardarRegla({
      keyword: keyword.trim(),
      banco: banco || undefined,
      bancoContraparte: bancoContraparte || undefined,
      accion: accionValida,
      categoriaDestino: categoriaDestino || undefined,
      tipoTransaccion: tipoTransaccion || 'TODOS',
      nota: nota || '',
    });

    return c.json({ success: true, message: 'Regla agregada con éxito.', data: nuevaRegla });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /reglas/lote - Crear reglas masivas en lote
bankRoutes.post('/reglas/lote', async (c) => {
  try {
    const body = await c.req.json();
    const { reglas } = body;

    if (!Array.isArray(reglas) || reglas.length === 0) {
      return c.json({ success: false, error: 'Debe proporcionar una lista de reglas a guardar.' }, 400);
    }

    const reglasAInsertar = reglas.map((r: any) => ({
      keyword: String(r.keyword || '').trim(),
      banco: r.banco || undefined,
      bancoContraparte: r.bancoContraparte || undefined,
      accion: r.accion || 'EXCLUIR_ANOMALIA',
      categoriaDestino: r.categoriaDestino || undefined,
      tipoTransaccion: r.tipoTransaccion || 'TODOS',
      nota: r.nota || '',
    })).filter((r) => r.keyword !== '');

    const creadas = guardarReglasLote(reglasAInsertar);
    return c.json({ success: true, message: `${creadas.length} reglas creadas en lote con éxito.`, data: creadas });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// DELETE /reglas/:id - Eliminar una regla
bankRoutes.delete('/reglas/:id', (c) => {
  try {
    const id = c.req.param('id');
    const ok = eliminarRegla(id);
    if (!ok) return c.json({ success: false, error: 'Regla no encontrada.' }, 404);
    return c.json({ success: true, message: 'Regla eliminada exitosamente.' });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// POST /reaplicar-reglas - Re-clasificar movimientos
bankRoutes.post('/reaplicar-reglas', (c) => {
  try {
    reaplicarReglasAMovimientos();
    return c.json({ success: true, message: 'Reglas re-aplicadas a todos los movimientos.' });
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
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const meta = obtenerMetadataResumen(desde, hasta);
    const resumenes = obtenerResumenMensualClasificado(undefined, desde, hasta);
    const recurrentesIngresos = obtenerRecurrentes('INGRESO', 5, desde, hasta);
    const recurrentesEgresos = obtenerRecurrentes('EGRESO', 5, desde, hasta);
    const anomalias = obtenerMovimientosFiltrados({ anomaloOnly: true, fechaInicio: desde, fechaFin: hasta, limit: 50 }).data;

    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte Ejecutivo de Extractos Bancarios - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #1e293b; line-height: 1.4; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 20px; }
          .logo { font-size: 22px; font-weight: 800; color: #0284c7; letter-spacing: -0.5px; }
          .logo span { color: #0f172a; }
          .meta-info { text-align: right; font-size: 11px; color: #64748b; }
          h2 { color: #0f172a; font-size: 14px; margin: 18px 0 8px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
          .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; text-align: center; }
          .kpi-title { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 600; }
          .kpi-val { font-size: 15px; font-weight: 700; color: #0284c7; margin-top: 4px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 9.5pt; }
          th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: left; padding: 5px 7px; border: 1px solid #cbd5e1; }
          td { padding: 5px 7px; border: 1px solid #e2e8f0; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f1f5f9 !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .badge-anomalo { background: #fef2f2; color: #dc2626; border: 1px solid #fca5a5; padding: 2px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; }
          .badge-ingreso { color: #16a34a; font-weight: 700; }
          .badge-egreso { color: #dc2626; font-weight: 700; }
          .footer { margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 8px; font-size: 10px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
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
              <th>Banco Cliente / Origen</th>
              <th>Mi Cuenta</th>
              <th class="text-right">Frecuencia</th>
              <th class="text-right">Monto Promedio</th>
              <th class="text-right">Total Ingresado</th>
            </tr>
          </thead>
          <tbody>
            ${recurrentesIngresos.map((c) => `
              <tr>
                <td><strong>${c.contraparteNombre}</strong></td>
                <td><span style="color: #0284c7; font-weight: 600;">${c.contraparteBanco || 'Mismo Banco'}</span></td>
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
              <th>Banco Cliente / Destino</th>
              <th>Mi Cuenta</th>
              <th class="text-right">Frecuencia</th>
              <th class="text-right">Monto Promedio</th>
              <th class="text-right">Total Pagado</th>
            </tr>
          </thead>
          <tbody>
            ${recurrentesEgresos.map((c) => `
              <tr>
                <td><strong>${c.contraparteNombre}</strong></td>
                <td><span style="color: #0284c7; font-weight: 600;">${c.contraparteBanco || 'Mismo Banco'}</span></td>
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
                <th>Mi Cuenta</th>
                <th>Banco Cliente / Receptor</th>
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
                  <td><span style="color: #0284c7; font-weight: 600;">${a.contraparteBanco || 'Traspaso Directo'}</span></td>
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
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const data = obtenerRespaldoResumenCuentas(desde, hasta);
    return c.json({ success: true, data });
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Endpoint Exportar Excel .xlsx con estructura idéntica a "12.0 Respaldo bancario resumen de cuentas.xlsx"
bankRoutes.get('/exportar-respaldo-excel', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const data = obtenerRespaldoResumenCuentas(desde, hasta);
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

// 1. PDF Tab 1: Estado de Saldos & Conciliación
bankRoutes.get('/imprimir-saldos-pdf', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const meta = obtenerMetadataResumen(desde, hasta);
    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte Estado de Saldos & Conciliación - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
          .brand-logo-box { display: flex; align-items: center; gap: 10px; }
          .brand-logo-title { font-size: 11.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
          .brand-logo-sub { font-size: 8.5pt; color: #475569; margin-top: 1px; }
          .meta-info { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.3; }
          .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 10px; }
          .kpi-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px; text-align: center; }
          .kpi-title { font-size: 8.5pt; text-transform: uppercase; color: #475569; font-weight: 600; }
          .kpi-val { font-size: 12pt; font-weight: 700; color: #0f172a; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
          th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 4px 5px; border: 1px solid #94a3b8; }
          td { padding: 4px 5px; border: 1px solid #cbd5e1; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f1f5f9 !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }
          .footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 5px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 42px; width: auto; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">ESTADO DE SALDOS & CONCILIACIÓN BANCARIA</div>
                <div class="brand-logo-sub">Sistema de Análisis Contable de Extractos Oficiales • Confección y Venta de Uniformes</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
              <div><strong>Registros:</strong> ${meta.totalMovimientos} movimientos</div>
            </div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-card">
              <div class="kpi-title">Ingresos Totales</div>
              <div class="kpi-val">${meta.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-title">Egresos Totales</div>
              <div class="kpi-val">${meta.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-title">Balance Neto</div>
              <div class="kpi-val">${meta.balanceNetoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-title">Alertas Anómalas</div>
              <div class="kpi-val">${meta.totalAnomalias} 🚩</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Banco / Entidad</th>
                <th>Nro. Cuenta / Titular</th>
                <th class="text-right">Saldo Inicial</th>
                <th class="text-right">Ingresos (+)</th>
                <th class="text-right">Egresos (-)</th>
                <th class="text-right">Flujo Neto</th>
                <th class="text-right">Saldo Final</th>
                <th class="text-center">Conciliación</th>
              </tr>
            </thead>
            <tbody>
              ${meta.cuentasDetalle.map((c) => `
                <tr>
                  <td><strong>${c.banco}</strong></td>
                  <td>${c.nroCuenta}<br><span style="font-size: 8.5pt; color: #475569;">${c.titularNombre}</span></td>
                  <td class="text-right">${c.saldoInicialBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td class="text-right">${c.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td class="text-right">${c.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td class="text-right" style="font-weight: 700;">${c.balanceNetoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td class="text-right" style="font-weight: 800;">${c.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td class="text-center" style="font-weight: 700;">${c.conciliadoOk ? '✅ Conciliado' : '⚠️ Descalce'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="footer">Reporte de Estado de Saldos Bancarios • MAYAKI • ${fechaHoy}</div>
        </div>
      </body>
      </html>
    `;
    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 2. PDF Tab 2: Análisis por Mes
bankRoutes.get('/imprimir-analisis-pdf', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const resumenes = obtenerResumenMensualClasificado(undefined, desde, hasta);
    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte de Análisis Mensual Clasificado - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
          .brand-logo-box { display: flex; align-items: center; gap: 10px; }
          .brand-logo-title { font-size: 11.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
          .brand-logo-sub { font-size: 8.5pt; color: #475569; margin-top: 1px; }
          .meta-info { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.3; }
          .card-box { border: 1px solid #64748b; border-radius: 4px; padding: 8px; margin-bottom: 10px; background: #ffffff; page-break-inside: avoid; }
          .card-title { font-size: 10pt; font-weight: 700; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin-bottom: 5px; display: flex; justify-content: space-between; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 3px; }
          th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 3px 5px; border: 1px solid #94a3b8; }
          td { padding: 3px 5px; border: 1px solid #cbd5e1; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f1f5f9 !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 5px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 42px; width: auto; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">REPORTE DE ANÁLISIS MENSUAL CLASIFICADO</div>
                <div class="brand-logo-sub">Sistema de Análisis Contable de Extractos Oficiales • Confección y Venta de Uniformes</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
              <div><strong>Meses Evaluados:</strong> ${resumenes.length} períodos</div>
            </div>
          </div>

          ${resumenes.map((m) => `
            <div class="card-box">
              <div class="card-title">
                <span>PERÍODO: ${m.periodoTexto} (${m.totalTransacciones} MOVS)</span>
                <span style="font-weight: 700;">BALANCE MES: ${m.balanceMesBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</span>
              </div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div>
                  <strong style="color: #0f172a; font-size: 9.5pt;">INGRESOS CLASIFICADOS</strong>
                  <table>
                    <thead><tr><th>Categoría</th><th class="text-right">Movs</th><th class="text-right">Monto</th><th class="text-right">%</th></tr></thead>
                    <tbody>
                      ${m.ingresosPorCategoria.map((cat) => `
                        <tr>
                          <td>${cat.icono} ${cat.nombreVisible}</td>
                          <td class="text-right">${cat.cantidad}</td>
                          <td class="text-right" style="font-weight: 600;">${cat.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                          <td class="text-right">${cat.pctDelTotal}%</td>
                        </tr>
                      `).join('') || '<tr><td colspan="4" class="text-center">Sin ingresos</td></tr>'}
                    </tbody>
                  </table>
                </div>
                <div>
                  <strong style="color: #0f172a; font-size: 9.5pt;">EGRESOS CLASIFICADOS</strong>
                  <table>
                    <thead><tr><th>Categoría</th><th class="text-right">Movs</th><th class="text-right">Monto</th><th class="text-right">%</th></tr></thead>
                    <tbody>
                      ${m.egresosPorCategoria.map((cat) => `
                        <tr>
                          <td>${cat.icono} ${cat.nombreVisible}</td>
                          <td class="text-right">${cat.cantidad}</td>
                          <td class="text-right" style="font-weight: 600;">${cat.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                          <td class="text-right">${cat.pctDelTotal}%</td>
                        </tr>
                      `).join('') || '<tr><td colspan="4" class="text-center">Sin egresos</td></tr>'}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          `).join('')}

          <div class="footer">Reporte de Análisis Mensual • MAYAKI • ${fechaHoy}</div>
        </div>
      </body>
      </html>
    `;
    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 3. PDF Tab 3: Anomalías Detectadas
bankRoutes.get('/imprimir-anomalias-pdf', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const anomalias = obtenerMovimientosFiltrados({ anomaloOnly: true, fechaInicio: desde, fechaFin: hasta, limit: 100 }).data;
    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte de Auditoría y Detección de Anomalías - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
          .brand-logo-box { display: flex; align-items: center; gap: 10px; }
          .brand-logo-title { font-size: 11.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
          .brand-logo-sub { font-size: 8.5pt; color: #475569; margin-top: 1px; }
          .meta-info { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.3; }
          table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 6px; }
          th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 4px 5px; border: 1px solid #94a3b8; }
          td { padding: 4px 5px; border: 1px solid #cbd5e1; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f1f5f9 !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 5px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 42px; width: auto; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">REPORTE DE AUDITORÍA Y VIGILANCIA DE ANOMALÍAS</div>
                <div class="brand-logo-sub">Sistema de Análisis Contable de Extractos Oficiales • Confección y Venta de Uniformes</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
              <div><strong>Total Hallazgos:</strong> ${anomalias.length} alertas</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Fecha / Hora</th>
                <th>Mi Cuenta</th>
                <th>Banco Cliente / Receptor</th>
                <th>Tipo</th>
                <th>Contraparte / Origen</th>
                <th class="text-right">Monto</th>
                <th>Glosa / Motivo de Alerta</th>
              </tr>
            </thead>
            <tbody>
              ${anomalias.map((a) => `
                <tr>
                  <td>${a.fechaTexto} ${a.hora !== '00:00:00' ? a.hora : ''}</td>
                  <td><strong>${a.banco}</strong></td>
                  <td><span style="color: #0284c7; font-weight: 600;">${a.contraparteBanco || 'Traspaso Directo'}</span></td>
                  <td style="font-weight: 700;">${a.tipo}</td>
                  <td><strong>${a.contraparteNombre}</strong></td>
                  <td class="text-right" style="font-weight: 800;">${a.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td>${a.motivoAnomalia || a.glosaDetalle}</td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="text-center">Sin anomalías detectadas en este lapso.</td></tr>'}
            </tbody>
          </table>

          <div class="footer">Reporte de Auditoría de Transacciones Anómalas • MAYAKI • ${fechaHoy}</div>
        </div>
      </body>
      </html>
    `;
    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// PDF: Transacciones Grandes y Anomalías (Sugerencias Rápida)
bankRoutes.get('/imprimir-sugerencias-pdf', (c) => {
  try {
    const dataSug = obtenerSugerenciasClasificacion();
    let list = dataSug.sugerenciasGrandesAnomalas || [];

    const tipo = c.req.query('tipo');
    const search = c.req.query('search');

    if (tipo && tipo !== 'TODOS') {
      list = list.filter((item) => item.tipo === tipo);
    }

    if (search && search.trim() !== '') {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (item) =>
          item.contraparteNombre.toLowerCase().includes(q) ||
          (item.contraparteBanco || '').toLowerCase().includes(q) ||
          item.banco.toLowerCase().includes(q) ||
          (item.glosaEjemplo || '').toLowerCase().includes(q) ||
          String(item.totalMontoBs).includes(q)
      );
    }

    const totalIngresos = list.filter((i) => i.tipo === 'INGRESO').reduce((acc, i) => acc + i.totalMontoBs, 0);
    const totalEgresos = list.filter((i) => i.tipo === 'EGRESO').reduce((acc, i) => acc + i.totalMontoBs, 0);
    const totalAnomalias = list.filter((i) => i.esAnomalo).length;
    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte - Transacciones Grandes y Anomalías (Pendientes) - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
          .brand-logo-box { display: flex; align-items: center; gap: 10px; }
          .brand-logo-title { font-size: 11.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
          .brand-logo-sub { font-size: 8.5pt; color: #475569; margin-top: 1px; }
          .meta-info { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.3; }
          .summary-bar { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 12px; margin-bottom: 12px; font-size: 8.5pt; }
          .summary-item { text-align: center; }
          .summary-val { font-weight: 800; font-size: 10pt; margin-top: 2px; }
          table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 6px; }
          th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 5px 6px; border: 1px solid #94a3b8; }
          td { padding: 4px 6px; border: 1px solid #cbd5e1; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f8fafc !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .badge { display: inline-block; padding: 2px 5px; border-radius: 3px; font-size: 7.5pt; font-weight: 700; }
          .badge-ingreso { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
          .badge-egreso { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
          .badge-anomalo { background: #ffedd5; color: #9a3412; border: 1px solid #fdba74; }
          .footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 5px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 42px; width: auto; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">REPORTE DE TRANSACCIONES GRANDES Y ANOMALÍAS</div>
                <div class="brand-logo-sub">Clasificación Rápida por Persona y Banco Origen • Sistema MAYAKI</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
              <div><strong>Pendientes de Clasificar:</strong> ${list.length} registros</div>
            </div>
          </div>

          <div class="summary-bar">
            <div class="summary-item">
              <div style="color: #64748b; font-weight: 600;">Registros Pendientes</div>
              <div class="summary-val" style="color: #ea580c;">${list.length}</div>
            </div>
            <div class="summary-item">
              <div style="color: #64748b; font-weight: 600;">Total Ingresos</div>
              <div class="summary-val" style="color: #166534;">Bs. ${totalIngresos.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="summary-item">
              <div style="color: #64748b; font-weight: 600;">Total Egresos</div>
              <div class="summary-val" style="color: #991b1b;">Bs. ${totalEgresos.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</div>
            </div>
            <div class="summary-item">
              <div style="color: #64748b; font-weight: 600;">Anomalías Flag</div>
              <div class="summary-val" style="color: #0284c7;">${totalAnomalias}</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Persona / Contraparte</th>
                <th>Banco Origen</th>
                <th>Mi Cuenta</th>
                <th>Tipo</th>
                <th class="text-right">Monto Total (Bs.)</th>
                <th class="text-right">Movs</th>
                <th>Glosa / Motivo de Alerta</th>
              </tr>
            </thead>
            <tbody>
              ${list.map((item) => `
                <tr>
                  <td><strong>${item.contraparteNombre}</strong></td>
                  <td><span style="color: #0284c7; font-weight: 600;">${item.contraparteBanco || 'Mismo Banco'}</span></td>
                  <td>${item.banco}</td>
                  <td><span class="badge ${item.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${item.tipo}</span></td>
                  <td class="text-right" style="font-weight: 800; color: ${item.tipo === 'INGRESO' ? '#166534' : '#991b1b'};">
                    Bs. ${item.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                  </td>
                  <td class="text-right" style="font-weight: 700;">${item.cantidadMovimientos}</td>
                  <td style="font-size: 8.5pt;">${item.glosaEjemplo || item.motivoEjemplo}</td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="text-center">No hay transacciones grandes ni anomalías pendientes.</td></tr>'}
            </tbody>
          </table>

          <div class="footer">Reporte de Transacciones Grandes y Anomalías (Pendientes) • MAYAKI • ${fechaHoy}</div>
        </div>
      </body>
      </html>
    `;
    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 4. PDF Tab 4: Cuentas Recurrentes (Clientes y Proveedores)
bankRoutes.get('/imprimir-recurrentes-pdf', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const recIngresos = obtenerRecurrentes('INGRESO', 15, desde, hasta);
    const recEgresos = obtenerRecurrentes('EGRESO', 15, desde, hasta);
    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte Ranking de Cuentas Recurrentes - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
          .brand-logo-box { display: flex; align-items: center; gap: 10px; }
          .brand-logo-title { font-size: 11.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
          .brand-logo-sub { font-size: 8.5pt; color: #475569; margin-top: 1px; }
          .meta-info { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.3; }
          h3 { color: #0f172a; font-size: 10pt; margin: 10px 0 5px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 10px; }
          th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 3px 5px; border: 1px solid #94a3b8; }
          td { padding: 3px 5px; border: 1px solid #cbd5e1; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f1f5f9 !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 5px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 42px; width: auto; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">RANKING DE CONTRAPARTES RECURRENTES</div>
                <div class="brand-logo-sub">Sistema de Análisis Contable de Extractos Oficiales • Confección y Venta de Uniformes</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: start;">
            <div>
              <h3>TOP CLIENTES (INGRESOS)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Cliente / Originante</th>
                    <th>Banco Cliente / Origen</th>
                    <th>Mi Cuenta</th>
                    <th class="text-right">Movs</th>
                    <th class="text-right">Total Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  ${recIngresos.map((c) => `
                    <tr>
                      <td><strong>${c.contraparteNombre}</strong></td>
                      <td><span style="color: #0284c7; font-weight: 600;">${c.contraparteBanco || 'Mismo Banco'}</span></td>
                      <td>${c.banco}</td>
                      <td class="text-right">${c.cantidadTransacciones}</td>
                      <td class="text-right" style="font-weight: 700;">${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <div>
              <h3>TOP PROVEEDORES (EGRESOS)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Proveedor / Beneficiario</th>
                    <th>Banco Cliente / Destino</th>
                    <th>Mi Cuenta</th>
                    <th class="text-right">Movs</th>
                    <th class="text-right">Total Acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  ${recEgresos.map((c) => `
                    <tr>
                      <td><strong>${c.contraparteNombre}</strong></td>
                      <td><span style="color: #0284c7; font-weight: 600;">${c.contraparteBanco || 'Mismo Banco'}</span></td>
                      <td>${c.banco}</td>
                      <td class="text-right">${c.cantidadTransacciones}</td>
                      <td class="text-right" style="font-weight: 700;">${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="footer">Reporte Ranking de Recurrentes • MAYAKI • ${fechaHoy}</div>
        </div>
      </body>
      </html>
    `;
    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// 5. PDF Tab 6: Consolidado Movimientos Libro Caja/Bancos
bankRoutes.get('/imprimir-movimientos-pdf', (c) => {
  try {
    const banco = c.req.query('banco');
    const tipo = c.req.query('tipo');
    const categoria = c.req.query('categoria');
    const fechaInicio = c.req.query('desde');
    const fechaFin = c.req.query('hasta');
    const search = c.req.query('search');

    const resMovs = obtenerMovimientosFiltrados({
      banco,
      tipo,
      categoria,
      fechaInicio,
      fechaFin,
      search,
      page: 1,
      limit: 200,
    });

    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Reporte Consolidado Libro Banco - MAYAKI</title>
        <style>
          * { box-sizing: border-box; }
          @media screen {
            body { background-color: #525659; display: flex; justify-content: center; padding: 16px 8px; margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 215.9mm; min-height: 279.4mm; background: #ffffff; box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45); padding: 10mm 10mm 10mm 13mm; border-radius: 2px; }
          }
          @media print {
            @page { size: letter portrait; margin-top: 10mm; margin-right: 10mm; margin-bottom: 10mm; margin-left: 13mm; }
            body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; font-family: 'Segoe UI', Arial, sans-serif; }
            .pdf-page { width: 100% !important; box-shadow: none !important; padding: 0 !important; }
          }
          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
          .brand-logo-box { display: flex; align-items: center; gap: 10px; }
          .brand-logo-title { font-size: 11.5pt; font-weight: 800; color: #0f172a; text-transform: uppercase; }
          .brand-logo-sub { font-size: 8.5pt; color: #475569; margin-top: 1px; }
          .meta-info { text-align: right; font-size: 8.5pt; color: #475569; line-height: 1.3; }
          table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-top: 5px; }
          th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 3px 5px; border: 1px solid #94a3b8; }
          td { padding: 3px 5px; border: 1px solid #cbd5e1; color: #0f172a; }
          tbody tr:nth-child(even) { background-color: #f1f5f9 !important; }
          tbody tr:nth-child(odd) { background-color: #ffffff !important; }
          .text-right { text-align: right; }
          .footer { margin-top: 16px; border-top: 1px solid #cbd5e1; padding-top: 5px; font-size: 8.5pt; color: #64748b; text-align: center; }
        </style>
      </head>
      <body>
        <div class="pdf-page">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 42px; width: auto; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">REPORTE CONSOLIDADO LIBRO CAJA Y BANCOS</div>
                <div class="brand-logo-sub">Sistema de Análisis Contable de Extractos Oficiales • Confección y Venta de Uniformes</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
              <div><strong>Movimientos Mostrados:</strong> ${resMovs.data.length} de ${resMovs.total} totales</div>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Fecha / Hora</th>
                <th>Mi Cuenta</th>
                <th>Banco Cliente / Receptor</th>
                <th>Tipo</th>
                <th>Contraparte / Origen</th>
                <th>Categoría</th>
                <th class="text-right">Monto</th>
                <th class="text-right">Saldo</th>
                <th>Glosa Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${resMovs.data.map((m) => `
                <tr>
                  <td>${m.fechaTexto} ${m.hora !== '00:00:00' ? m.hora : ''}</td>
                  <td><strong>${m.banco}</strong></td>
                  <td><span style="color: #0284c7; font-weight: 600;">${m.contraparteBanco || 'Traspaso Directo'}</span></td>
                  <td style="font-weight: 700;">${m.tipo}</td>
                  <td><strong>${m.contraparteNombre}</strong></td>
                  <td>${m.categoria}</td>
                  <td class="text-right" style="font-weight: 700;">${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td class="text-right">${m.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                  <td style="font-size: 8.5pt;">${m.glosaDetalle}</td>
                </tr>
              `).join('') || '<tr><td colspan="9" class="text-center">No se encontraron movimientos para los filtros seleccionados.</td></tr>'}
            </tbody>
          </table>

          <div class="footer">Reporte Consolidado de Movimientos • MAYAKI • ${fechaHoy}</div>
        </div>
      </body>
      </html>
    `;
    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

// Generar Reporte PDF Imprimible del Respaldo Mensual (Estilo 12.0 Respaldo bancario)
bankRoutes.get('/imprimir-respaldo-pdf', (c) => {
  try {
    const desde = c.req.query('desde');
    const hasta = c.req.query('hasta');
    const data = obtenerRespaldoResumenCuentas(desde, hasta);
    const fechaHoy = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <title>Respaldo Bancario Resumen de Cuentas - MAYAKI</title>
        <style>
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          @media screen {
            body {
              background-color: #525659;
              display: flex;
              justify-content: center;
              padding: 16px 8px;
              margin: 0;
              font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
            }
            .pdf-page {
              width: 215.9mm;
              min-height: 279.4mm;
              background: #ffffff;
              box-shadow: 0 10px 35px rgba(0, 0, 0, 0.45);
              padding: 10mm 10mm 10mm 13mm;
              border-radius: 2px;
            }
          }
          @media print {
            @page {
              size: letter portrait;
              margin-top: 10mm;
              margin-right: 10mm;
              margin-bottom: 10mm;
              margin-left: 13mm;
            }
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }
            body {
              background: #ffffff !important;
              margin: 0 !important;
              padding: 0 !important;
              font-family: 'Segoe UI', Arial, Helvetica, sans-serif;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .pdf-page {
              width: 100% !important;
              box-shadow: none !important;
              padding: 0 !important;
            }
          }

          body { color: #0f172a; line-height: 1.3; font-size: 9.5pt; }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-bottom: 2px solid #881337;
            padding-bottom: 5px;
            margin-bottom: 8px;
          }
          .brand-logo-box {
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .brand-logo-title {
            font-size: 12pt;
            font-weight: 800;
            color: #0f172a;
            letter-spacing: -0.3px;
            text-transform: uppercase;
          }
          .brand-logo-sub {
            font-size: 9pt;
            color: #475569;
            font-weight: 500;
            margin-top: 1px;
          }
          .meta-info {
            text-align: right;
            font-size: 9pt;
            color: #475569;
            line-height: 1.3;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            font-size: 9.5pt;
            margin-top: 0;
          }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .text-center { text-align: center; }

          /* Resumen General Consolidado Styles */
          .rg-container {
            width: calc(50% - 14px);
            flex: 0 0 calc(50% - 14px);
            box-sizing: border-box;
            page-break-inside: avoid;
            margin-bottom: 12px;
          }
          .rg-header {
            background-color: #881337 !important;
            color: #ffffff !important;
            padding: 5px 8px;
            font-size: 9.5pt;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.3px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-radius: 3px 3px 0 0;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-badge {
            font-size: 7.5pt;
            background-color: #ffffff !important;
            color: #881337 !important;
            padding: 1px 5px;
            border-radius: 3px;
            font-weight: 800;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-sub {
            font-size: 8.5pt;
            color: #881337 !important;
            font-weight: 700;
            background-color: #fff1f2 !important;
            padding: 4px 6px;
            border-bottom: 1px solid #fecdd3;
            margin-bottom: 4px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-th {
            background-color: #4c0519 !important;
            color: #ffffff !important;
            font-weight: 800;
            border: 1px solid #4c0519 !important;
            padding: 3.5px 6px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-tr-even {
            background-color: #ffe4e6 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-tr-odd {
            background-color: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-td {
            border: 1px solid #fda4af !important;
            padding: 3px 6px;
            color: #0f172a;
          }
          .rg-tfoot-tr {
            background-color: #881337 !important;
            color: #ffffff !important;
            font-weight: 800;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .rg-tfoot-td {
            background-color: #881337 !important;
            color: #ffffff !important;
            font-weight: 800 !important;
            border: 1.5px solid #881337 !important;
            padding: 4.5px 6px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Tablas Bancos Styles */
          .bank-container {
            width: calc(50% - 14px);
            flex: 0 0 calc(50% - 14px);
            box-sizing: border-box;
            page-break-inside: avoid;
            margin-bottom: 12px;
          }
          .bank-title {
            font-size: 9.5pt;
            font-weight: 800;
            color: #0f172a;
            border-bottom: 1.5px solid #64748b;
            padding-bottom: 2px;
            margin-bottom: 4px;
            text-transform: uppercase;
          }
          .bank-sub {
            font-size: 8.5pt;
            color: #475569;
            margin-bottom: 5px;
            font-weight: 500;
          }
          .bank-th {
            background-color: #f1f5f9 !important;
            color: #0f172a !important;
            font-weight: 700;
            border: 1px solid #cbd5e1 !important;
            padding: 3.5px 6px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .bank-tr-even {
            background-color: #f1f5f9 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .bank-tr-odd {
            background-color: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .bank-td {
            border: 1px solid #cbd5e1 !important;
            padding: 3px 6px;
            color: #0f172a;
          }
          .bank-tfoot-tr {
            background-color: #e2e8f0 !important;
            color: #0f172a !important;
            font-weight: 800;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .bank-tfoot-td {
            background-color: #e2e8f0 !important;
            color: #0f172a !important;
            font-weight: 800 !important;
            border-top: 1.5px solid #0f172a !important;
            border-bottom: 1.5px solid #0f172a !important;
            border-left: 1px solid #cbd5e1 !important;
            border-right: 1px solid #cbd5e1 !important;
            padding: 4px 6px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .footer {
            margin-top: 12px;
            padding-top: 4px;
            font-size: 8.5pt;
            color: #64748b;
            text-align: center;
            border-top: 1px solid #cbd5e1;
          }
        </style>
      </head>
      <body>
        <div class="pdf-page" style="padding: 8mm 10mm 8mm 12mm;">
          <div class="header">
            <div class="brand-logo-box">
              <img src="${LOGO_MAYAKI_BASE64}" alt="MAYAKI" style="height: 38px; width: auto; max-width: 190px; object-fit: contain;" />
              <div>
                <div class="brand-logo-title">RESPALDO BANCARIO RESUMEN DE CUENTAS</div>
                <div class="brand-logo-sub">Análisis Contable de Extractos Bancarios Oficiales</div>
              </div>
            </div>
            <div class="meta-info">
              <div><strong>Fecha Emisión:</strong> ${fechaHoy}</div>
              <div><strong>Cuentas Evaluadas:</strong> ${data.cuentas.length} Bancos</div>
            </div>
          </div>

          <!-- Grilla de 2 columnas con amplio espaciado horizontal -->
          <div style="display: flex; flex-wrap: wrap; gap: 12px 28px; width: 100%; box-sizing: border-box; align-items: start;">
            
            ${data.resumenConsolidado ? `
              <div class="rg-container">
                <div class="rg-header">
                  <span>RESUMEN GRAL. CONSOLIDADO</span>
                  <span class="rg-badge">TODOS LOS BANCOS</span>
                </div>
                <div class="rg-sub">
                  Saldo Inicial Consolidado al ${data.resumenConsolidado.fechaInicialTexto}: <strong>Bs. ${data.resumenConsolidado.saldoInicialTotalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th class="rg-th text-left" style="width: 25%;">Mes</th>
                      <th class="rg-th text-right" style="width: 25%;">Créditos</th>
                      <th class="rg-th text-right" style="width: 25%;">Débitos</th>
                      <th class="rg-th text-right" style="width: 25%;">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.resumenConsolidado.filasMensuales.map((f, idx) => `
                      <tr class="${idx % 2 === 0 ? 'rg-tr-even' : 'rg-tr-odd'}" style="page-break-inside: avoid;">
                        <td class="rg-td" style="font-weight: 700;">${f.mesTexto}</td>
                        <td class="rg-td text-right">${f.creditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="rg-td text-right">${f.debitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="rg-td text-right" style="font-weight: 800; color: #881337;">${f.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr class="rg-tfoot-tr" style="page-break-inside: avoid;">
                      <td class="rg-tfoot-td">TOTAL</td>
                      <td class="rg-tfoot-td text-right">${data.resumenConsolidado.totalCreditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="rg-tfoot-td text-right">${data.resumenConsolidado.totalDebitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="rg-tfoot-td text-right" style="font-size: 9.5pt;">${data.resumenConsolidado.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ` : ''}

            ${data.cuentas.map((c) => `
              <div class="bank-container">
                <div class="bank-title">
                  ${c.banco} (${c.nroCuenta})
                </div>
                <div class="bank-sub">
                  ${c.titularNombre} — Saldo Inicial: <strong style="color: #0f172a;">Bs. ${c.saldoInicialBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th class="bank-th text-left" style="width: 25%;">Mes</th>
                      <th class="bank-th text-right" style="width: 25%;">Créditos</th>
                      <th class="bank-th text-right" style="width: 25%;">Débitos</th>
                      <th class="bank-th text-right" style="width: 25%;">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${c.filasMensuales.map((f, idx) => `
                      <tr class="${idx % 2 === 0 ? 'bank-tr-even' : 'bank-tr-odd'}" style="page-break-inside: avoid;">
                        <td class="bank-td" style="font-weight: 700;">${f.mesTexto}</td>
                        <td class="bank-td text-right">${c.filasMensuales[idx] ? f.creditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 }) : ''}</td>
                        <td class="bank-td text-right">${f.debitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="bank-td text-right" style="font-weight: 800;">${f.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr class="bank-tfoot-tr" style="page-break-inside: avoid;">
                      <td class="bank-tfoot-td">TOTAL</td>
                      <td class="bank-tfoot-td text-right">${c.totalCreditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="bank-tfoot-td text-right">${c.totalDebitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="bank-tfoot-td text-right">${c.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            `).join('')}
          </div>

          <div class="footer">
            Reporte de Respaldo Bancario de Cuentas • MAYAKI • Elaboración propia, basada en los extractos bancarios
          </div>
        </div>
      </body>
      </html>
    `;

    return c.html(html);
  } catch (e: any) {
    return c.json({ success: false, error: e.message }, 500);
  }
});

export default bankRoutes;
