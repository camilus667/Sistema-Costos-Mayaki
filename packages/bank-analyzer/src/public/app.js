document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = '/api/bank';

  // Navigation Tabs
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const tabTitle = document.getElementById('current-tab-title');
  const tabSub = document.getElementById('current-tab-subtitle');

  const tabInfo = {
    'tab-importar': { title: 'Importador de Extractos Bancarios', sub: 'Carga los archivos Excel (.xls / .xlsx) de BNB, Banco Bisa y Banco Unión' },
    'tab-analisis': { title: 'Análisis de Ingresos y Egresos por Mes', sub: 'Desglose mensual clasificado por origen de fondos y propósito de gastos' },
    'tab-anomalias': { title: 'Detección de Transacciones Anómalas', sub: 'Alertas de montos abultados, depósitos atípicos y retiros inusuales' },
    'tab-recurrentes': { title: 'Contrapartes y Cuentas Recurrentes', sub: 'Ranking de principales clientes (ingresos) y proveedores de insumos (egresos)' },
    'tab-respaldo': { title: 'Respaldo Bancario Resumen de Cuentas (Mensual)', sub: 'Reporte estructurado réplica exacta de 12.0 Respaldo bancario resumen de cuentas.xlsx' },
    'tab-movimientos': { title: 'Consolidado General de Movimientos', sub: 'Listado completo de movimientos ordenados cronológicamente' },
  };

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');

      navBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(tabId);
      if (pane) pane.classList.add('active');

      if (tabTitle && tabSub && tabInfo[tabId]) {
        tabTitle.textContent = tabInfo[tabId].title;
        tabSub.textContent = tabInfo[tabId].sub;
      }

      if (tabId === 'tab-analisis') cargarResumenMensual();
      if (tabId === 'tab-anomalias') cargarAnomalias();
      if (tabId === 'tab-recurrentes') cargarRecurrentes();
      if (tabId === 'tab-respaldo') cargarRespaldoResumen();
      if (tabId === 'tab-movimientos') cargarMovimientos(1);
    });
  });

  // Dropzone & File Upload
  const dropzone = document.getElementById('dropzone-bank');
  const fileInput = document.getElementById('input-file-bank');
  const importStatus = document.getElementById('import-status-bank');

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        subirArchivoExtracto(e.dataTransfer.files[0]);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        subirArchivoExtracto(e.target.files[0]);
      }
    });
  }

  async function subirArchivoExtracto(file) {
    if (!importStatus) return;
    const formData = new FormData();
    formData.append('archivo', file);

    importStatus.innerHTML = '<span style="color: #60a5fa;">⏳ Procesando y parseando extracto bancario...</span>';

    try {
      const res = await fetch(`${API_BASE}/importar`, { method: 'POST', body: formData });
      const json = await res.json();

      if (json.success) {
        importStatus.innerHTML = `<span style="color: #4ade80;">✅ ${json.message}</span>`;
        cargarInfoGlobal();
      } else {
        importStatus.innerHTML = `<span style="color: #f87171;">❌ Error: ${json.error}</span>`;
      }
    } catch (e) {
      importStatus.innerHTML = `<span style="color: #f87171;">❌ Error de conexión: ${e.message}</span>`;
    }
  }

  // Cargar KPIs Globales e Información
  async function cargarInfoGlobal() {
    try {
      const res = await fetch(`${API_BASE}/info`);
      const json = await res.json();

      if (json.success && json.data) {
        const d = json.data;

        const kpiIngresos = document.getElementById('kpi-total-ingresos');
        const kpiEgresos = document.getElementById('kpi-total-egresos');
        const kpiBalance = document.getElementById('kpi-balance-neto');
        const kpiAnomalias = document.getElementById('kpi-total-anomalias');

        const balanceNeto = d.totalIngresosBs - d.totalEgresosBs;

        if (kpiIngresos) kpiIngresos.textContent = `Bs. ${d.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
        if (kpiEgresos) kpiEgresos.textContent = `Bs. ${d.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
        if (kpiBalance) {
          kpiBalance.textContent = `Bs. ${balanceNeto.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
          kpiBalance.style.color = balanceNeto >= 0 ? '#60a5fa' : '#f87171';
        }
        if (kpiAnomalias) kpiAnomalias.textContent = `${d.totalAnomalias} 🚩`;

        const filesBox = document.getElementById('bank-files-info');
        if (filesBox) {
          if (d.totalMovimientos > 0) {
            filesBox.innerHTML = `
              <div style="font-size: 0.9rem; line-height: 1.6;">
                <div>🟢 <strong>Bancos Detectados:</strong> <span class="badge badge-banco">${d.bancosDetectados.join(', ')}</span></div>
                <div>📅 <strong>Rango de Fechas:</strong> ${d.fechaMin} al ${d.fechaMax}</div>
                <div>📊 <strong>Total Movimientos:</strong> ${d.totalMovimientos.toLocaleString()} registros procesados</div>
                <div>📁 <strong>Archivos Procesados:</strong> ${d.archivosCargados.join(', ') || 'Archivos de _extractos'}</div>
              </div>
            `;
          } else {
            filesBox.innerHTML = '<span style="color: var(--text-muted);">No hay extractos bancarios cargados en la base de datos.</span>';
          }
        }

        // Renderizar Tabla de Saldos Conciliados por Banco
        const tableSaldosBody = document.querySelector('#table-saldos-bancos tbody');
        if (tableSaldosBody && d.cuentasDetalle && d.cuentasDetalle.length > 0) {
          tableSaldosBody.innerHTML = d.cuentasDetalle.map((c) => `
            <tr>
              <td><span class="badge badge-banco">${c.banco}</span></td>
              <td><strong>${c.nroCuenta}</strong><br><span style="font-size: 0.75rem; color: var(--text-muted);">${c.titularNombre}</span></td>
              <td class="text-right" style="font-weight: 600; color: #94a3b8;">Bs. ${c.saldoInicialBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-right" style="font-weight: 600; color: #4ade80;">Bs. ${c.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-right" style="font-weight: 600; color: #f87171;">Bs. ${c.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-right" style="font-weight: 700; color: ${c.balanceNetoBs >= 0 ? '#60a5fa' : '#f87171'};">
                ${c.balanceNetoBs >= 0 ? '+' : ''}Bs. ${c.balanceNetoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </td>
              <td class="text-right" style="font-weight: 800; color: #38bdf8;">Bs. ${c.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-center">
                ${c.conciliadoOk 
                  ? '<span class="badge badge-ingreso">✅ Conciliado (Ok)</span>' 
                  : '<span class="badge badge-anomalo">⚠️ Descalce</span>'}
              </td>
            </tr>
          `).join('');
        } else if (tableSaldosBody) {
          tableSaldosBody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted);">Sin datos de saldos.</td></tr>';
        }
      }
    } catch (e) {
      console.error('Error al cargar info global:', e);
    }
  }

  // Cargar Resumen Mensual Clasificado
  async function cargarResumenMensual() {
    const container = document.getElementById('cards-resumen-mensual');
    if (!container) return;

    container.innerHTML = '<div style="color: var(--text-muted);">Cargando análisis mensual...</div>';

    try {
      const res = await fetch(`${API_BASE}/resumen-mensual`);
      const json = await res.json();

      if (json.success && json.data && json.data.length > 0) {
        container.innerHTML = json.data.map((m) => {
          const ingresosHtml = m.ingresosPorCategoria.map((cat) => `
            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed rgba(255,255,255,0.06); font-size: 0.83rem;">
              <span>${cat.icono} <strong>${cat.nombreVisible}</strong> (${cat.cantidad} movs)</span>
              <span style="color: #4ade80; font-weight: 600;">Bs. ${cat.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })} (${cat.pctDelTotal}%)</span>
            </div>
          `).join('') || '<div style="font-size: 0.8rem; color: var(--text-muted);">Sin ingresos en este período</div>';

          const egresosHtml = m.egresosPorCategoria.map((cat) => `
            <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed rgba(255,255,255,0.06); font-size: 0.83rem;">
              <span>${cat.icono} <strong>${cat.nombreVisible}</strong> (${cat.cantidad} movs)</span>
              <span style="color: #f87171; font-weight: 600;">Bs. ${cat.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })} (${cat.pctDelTotal}%)</span>
            </div>
          `).join('') || '<div style="font-size: 0.8rem; color: var(--text-muted);">Sin egresos en este período</div>';

          return `
            <div class="glass-card" style="background: rgba(11, 17, 32, 0.7); border: 1px solid rgba(255,255,255,0.08);">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 14px;">
                <h4 style="font-size: 1.1rem; color: #fff;">🗓️ Período: ${m.periodoTexto}</h4>
                <div style="font-size: 0.9rem; font-weight: 700; color: ${m.balanceMesBs >= 0 ? '#60a5fa' : '#f87171'};">
                  Balance Mes: Bs. ${m.balanceMesBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                  <h5 style="color: #4ade80; font-size: 0.88rem; margin-bottom: 8px;">🟢 Ingresos Clasificados (Origen de Fondos)</h5>
                  ${ingresosHtml}
                </div>

                <div>
                  <h5 style="color: #f87171; font-size: 0.88rem; margin-bottom: 8px;">🔴 Egresos Clasificados (Destino / Propósito)</h5>
                  ${egresosHtml}
                </div>
              </div>
            </div>
          `;
        }).join('');
      } else {
        container.innerHTML = '<div style="color: var(--text-muted);">No hay datos mensuales registrados.</div>';
      }
    } catch (e) {
      console.error('Error cargando resumen mensual:', e);
      container.innerHTML = '<div style="color: #f87171;">Error al obtener resumen mensual.</div>';
    }
  }

  // Cargar Anomalías
  async function cargarAnomalias() {
    const tableBody = document.querySelector('#table-anomalias tbody');
    if (!tableBody) return;

    try {
      const res = await fetch(`${API_BASE}/anomalias`);
      const json = await res.json();

      if (json.success && json.data && json.data.length > 0) {
        tableBody.innerHTML = json.data.map((m) => `
          <tr>
            <td>${m.fechaTexto} ${m.hora !== '00:00:00' ? m.hora : ''}</td>
            <td><span class="badge badge-banco">${m.banco}</span></td>
            <td><span class="badge ${m.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${m.tipo}</span></td>
            <td><strong>${m.contraparteNombre}</strong></td>
            <td class="text-right" style="font-weight: 700; color: ${m.tipo === 'INGRESO' ? '#4ade80' : '#f87171'};">
              Bs. ${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
            </td>
            <td><span class="badge badge-anomalo">${m.motivoAnomalia || m.glosaDetalle}</span></td>
          </tr>
        `).join('');
      } else {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center" style="color: var(--text-muted);">No se detectaron transacciones atípicas o abultadas.</td></tr>';
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Cargar Recurrentes
  async function cargarRecurrentes() {
    const bodyIngresos = document.querySelector('#table-recurrentes-ingresos tbody');
    const bodyEgresos = document.querySelector('#table-recurrentes-egresos tbody');

    try {
      const resIng = await fetch(`${API_BASE}/recurrentes?tipo=INGRESO&limit=10`);
      const jsonIng = await resIng.json();
      if (jsonIng.success && bodyIngresos) {
        bodyIngresos.innerHTML = jsonIng.data.map((c) => `
          <tr>
            <td><strong>${c.contraparteNombre}</strong><br><span style="font-size: 0.75rem; color: var(--text-muted);">${c.banco}</span></td>
            <td class="text-right">${c.cantidadTransacciones} dep.</td>
            <td class="text-right">Bs. ${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
            <td class="text-right" style="font-weight: 700; color: #4ade80;">Bs. ${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
          </tr>
        `).join('');
      }

      const resEgr = await fetch(`${API_BASE}/recurrentes?tipo=EGRESO&limit=10`);
      const jsonEgr = await resEgr.json();
      if (jsonEgr.success && bodyEgresos) {
        bodyEgresos.innerHTML = jsonEgr.data.map((c) => `
          <tr>
            <td><strong>${c.contraparteNombre}</strong><br><span style="font-size: 0.75rem; color: var(--text-muted);">${c.banco}</span></td>
            <td class="text-right">${c.cantidadTransacciones} pag.</td>
            <td class="text-right">Bs. ${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
            <td class="text-right" style="font-weight: 700; color: #f87171;">Bs. ${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
          </tr>
        `).join('');
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Cargar Movimientos
  let paginaActualMovs = 1;

  async function cargarMovimientos(page = 1) {
    paginaActualMovs = page;
    const tableBody = document.querySelector('#table-movimientos-consolidado tbody');
    const lblTotal = document.getElementById('lbl-total-movimientos');
    const pagination = document.getElementById('pagination-bank-controls');
    if (!tableBody) return;

    const banco = document.getElementById('filter-bank-banco')?.value || '';
    const tipo = document.getElementById('filter-bank-tipo')?.value || '';
    const categoria = document.getElementById('filter-bank-categoria')?.value || '';
    const search = document.getElementById('filter-bank-search')?.value || '';

    try {
      let url = `${API_BASE}/movimientos?page=${page}&limit=25`;
      if (banco) url += `&banco=${encodeURIComponent(banco)}`;
      if (tipo) url += `&tipo=${encodeURIComponent(tipo)}`;
      if (categoria) url += `&categoria=${encodeURIComponent(categoria)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;

      const res = await fetch(url);
      const json = await res.json();

      if (json.success && json.data) {
        const { data, total, totalPages } = json.data;

        if (lblTotal) lblTotal.textContent = `${total.toLocaleString()} movimientos encontrados (Página ${page} de ${totalPages})`;

        if (data.length > 0) {
          tableBody.innerHTML = data.map((m) => `
            <tr>
              <td>${m.fechaTexto} ${m.hora !== '00:00:00' ? m.hora : ''}</td>
              <td><span class="badge badge-banco">${m.banco}</span></td>
              <td><span class="badge ${m.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${m.tipo}</span></td>
              <td><strong>${m.contraparteNombre}</strong></td>
              <td><span class="badge badge-secondary" style="font-size: 0.75rem;">${m.categoria}</span></td>
              <td class="text-right" style="font-weight: 700; color: ${m.tipo === 'INGRESO' ? '#4ade80' : '#f87171'};">
                Bs. ${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </td>
              <td class="text-right" style="color: var(--text-muted);">Bs. ${m.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td style="font-size: 0.78rem; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${m.glosaDetalle}">
                ${m.glosaDetalle}
              </td>
            </tr>
          `).join('');

          if (pagination) {
            pagination.innerHTML = `
              <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.78rem;" ${page <= 1 ? 'disabled' : ''} id="btn-prev-bank">◀ Anterior</button>
              <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.78rem;" ${page >= totalPages ? 'disabled' : ''} id="btn-next-bank">Siguiente ▶</button>
            `;

            const btnPrev = document.getElementById('btn-prev-bank');
            const btnNext = document.getElementById('btn-next-bank');
            if (btnPrev) btnPrev.addEventListener('click', () => cargarMovimientos(page - 1));
            if (btnNext) btnNext.addEventListener('click', () => cargarMovimientos(page + 1));
          }
        } else {
          tableBody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted);">No se encontraron movimientos para los filtros seleccionados.</td></tr>';
          if (pagination) pagination.innerHTML = '';
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Cargar Respaldo Resumen Cuentas (Mensual Estilo 12.0)
  async function cargarRespaldoResumen() {
    const container = document.getElementById('container-respaldo-cuentas');
    if (!container) return;

    try {
      const res = await fetch(`${API_BASE}/respaldo-resumen-cuentas`);
      const json = await res.json();

      if (json.success && json.data) {
        const { cuentas, comparativoMeses } = json.data;

        if (cuentas.length === 0) {
          container.innerHTML = '<div class="glass-card text-center" style="color: var(--text-muted);">No hay extractos bancarios cargados para generar el respaldo mensual.</div>';
          return;
        }

        let html = '';

        // 1. Tablas por Cuenta Bancaria (Sheet 1 estilo 'ingresos')
        cuentas.forEach((c) => {
          html += `
            <div class="glass-card">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
                <div>
                  <h4 style="font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                    <span class="badge badge-banco">${c.banco}</span>
                    <span>Cuenta: <strong>${c.nroCuenta}</strong></span>
                  </h4>
                  <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Titular: <strong>${c.titularNombre}</strong></p>
                </div>
                <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 6px 14px; border-radius: 8px; font-size: 0.85rem;">
                  <span style="color: var(--text-muted);">Saldo al ${c.fechaInicialTexto}:</span>
                  <strong style="color: #38bdf8; font-size: 0.95rem; margin-left: 6px;">Bs. ${c.saldoInicialBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong>
                </div>
              </div>

              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Mes / Período</th>
                      <th class="text-right">Créditos (Ingresos)</th>
                      <th class="text-right">Débitos (Egresos)</th>
                      <th class="text-right">Saldo al Cierre</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${c.filasMensuales.map((f) => `
                      <tr>
                        <td><strong>${f.mesTexto}</strong></td>
                        <td class="text-right" style="color: #4ade80; font-weight: 600;">Bs. ${f.creditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="text-right" style="color: #f87171; font-weight: 600;">Bs. ${f.debitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="text-right" style="color: #38bdf8; font-weight: 700;">Bs. ${f.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="background: rgba(15, 23, 42, 0.9); font-weight: 800;">
                      <td>TOTAL GENERAL ACUMULADO</td>
                      <td class="text-right" style="color: #4ade80;">Bs. ${c.totalCreditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="text-right" style="color: #f87171;">Bs. ${c.totalDebitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="text-right" style="color: #38bdf8; font-size: 1.05rem;">Bs. ${c.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          `;
        });

        // 2. Tabla Comparativa de Egresos entre Bancos por Mes (Sheet 2 estilo 'egresos')
        if (comparativoMeses.length > 0) {
          const bancos = Array.from(new Set(cuentas.map((c) => c.banco)));
          html += `
            <div class="glass-card">
              <h4 style="font-size: 1.1rem; margin-bottom: 12px;">📊 Comparativo Mensual de Egresos por Banco</h4>
              <div class="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Mes / Período</th>
                      ${bancos.map((b) => `<th class="text-right">${b} (Egresos)</th>`).join('')}
                      <th class="text-right">Total Egresos Mensual</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${comparativoMeses.map((m) => `
                      <tr>
                        <td><strong>${m.mesTexto}</strong></td>
                        ${bancos.map((b) => `
                          <td class="text-right" style="color: #f87171;">
                            Bs. ${(m.egresosPorBanco[b] || 0).toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                          </td>
                        `).join('')}
                        <td class="text-right" style="font-weight: 800; color: #f87171;">
                          Bs. ${m.totalEgresosMensualBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        }

        container.innerHTML = html;
      }
    } catch (e) {
      console.error('Error al cargar respaldo resumen:', e);
      container.innerHTML = `<div class="glass-card text-center" style="color: #f87171;">Error al generar el respaldo de cuentas: ${e.message}</div>`;
    }
  }

  // Filter Button
  const btnFiltro = document.getElementById('btn-aplicar-filtros-bank');
  if (btnFiltro) btnFiltro.addEventListener('click', () => cargarMovimientos(1));

  // Refresh Button
  const btnRefresh = document.getElementById('btn-refresh-bank');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      cargarInfoGlobal();
      cargarResumenMensual();
      cargarAnomalias();
      cargarRecurrentes();
      cargarRespaldoResumen();
      cargarMovimientos(1);
    });
  }

  // Imprimir PDF
  const btnImprimir = document.getElementById('btn-imprimir-reporte-bank');
  if (btnImprimir) {
    btnImprimir.addEventListener('click', () => {
      const url = `${API_BASE}/imprimir-reporte`;
      let iframe = document.getElementById('hidden-bank-print-frame');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'hidden-bank-print-frame';
        iframe.style.display = 'none';
        document.body.appendChild(iframe);
      }
      iframe.onload = () => {
        setTimeout(() => {
          if (iframe.contentWindow) {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          }
        }, 350);
      };
      iframe.src = url;
    });
  }

  // Vaciar Datos
  const btnVaciar = document.getElementById('btn-vaciar-bank');
  if (btnVaciar) {
    btnVaciar.addEventListener('click', async () => {
      if (!confirm('⚠️ ¿Estás seguro de vaciar todos los datos de extractos bancarios cargados?')) return;
      try {
        const res = await fetch(`${API_BASE}/limpiar`, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          alert('✅ Base de datos de extractos vaciada con éxito.');
          cargarInfoGlobal();
          cargarResumenMensual();
          cargarAnomalias();
          cargarRecurrentes();
          cargarMovimientos(1);
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    });
  }

  // Inicializar
  cargarInfoGlobal();
});
