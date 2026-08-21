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
    'tab-reglas': { title: 'Configuración de Personas Conocidas y Reglas', sub: 'Exclusión de anomalías y categorización de personas o entidades recurrentes' },
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

      if (tabId === 'tab-analisis') {
        cargarInfoGlobal();
        cargarResumenMensual();
      }
      if (tabId === 'tab-anomalias') cargarAnomalias();
      if (tabId === 'tab-recurrentes') cargarRecurrentes();
      if (tabId === 'tab-respaldo') cargarRespaldoResumen();
      if (tabId === 'tab-movimientos') cargarMovimientos(1);
      if (tabId === 'tab-reglas') cargarReglas();
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

  function obtenerRangoFechasGlobal() {
    const dIn = document.getElementById('global-filter-desde');
    const hIn = document.getElementById('global-filter-hasta');
    const desde = dIn ? dIn.value.trim() : '';
    const hasta = hIn ? hIn.value.trim() : '';
    return { desde, hasta };
  }

  function construirUrlConFiltroGlobal(urlBase) {
    const { desde, hasta } = obtenerRangoFechasGlobal();
    if (!desde && !hasta) return urlBase;
    const separator = urlBase.includes('?') ? '&' : '?';
    const params = [];
    if (desde) params.push(`desde=${encodeURIComponent(desde)}`);
    if (hasta) params.push(`hasta=${encodeURIComponent(hasta)}`);
    return `${urlBase}${separator}${params.join('&')}`;
  }

  function refrescarTodoElSistema() {
    cargarInfoGlobal();
    cargarResumenMensual();
    cargarAnomalias();
    cargarRecurrentes();
    cargarRespaldoResumen();
    cargarMovimientos(1);
  }

  // Cargar KPIs Globales e Información
  async function cargarInfoGlobal() {
    try {
      const res = await fetch(construirUrlConFiltroGlobal(`${API_BASE}/info`));
      const json = await res.json();

      if (json.success && json.data) {
        const d = json.data;

        const kpiIngresos = document.getElementById('kpi-total-ingresos');
        const kpiEgresos = document.getElementById('kpi-total-egresos');
        const kpiBalance = document.getElementById('kpi-balance-neto');
        const kpiAnomalias = document.getElementById('kpi-total-anomalias');

        const balanceNeto = d.totalIngresosBs - d.totalEgresosBs;

        const kpiSubIngresos = document.getElementById('kpi-sub-ingresos');
        const kpiSubEgresos = document.getElementById('kpi-sub-egresos');

        if (kpiSubIngresos) kpiSubIngresos.textContent = `${(d.totalMovimientosIngreso || 0).toLocaleString()} movimientos de abono`;
        if (kpiSubEgresos) kpiSubEgresos.textContent = `${(d.totalMovimientosEgreso || 0).toLocaleString()} movimientos de débito`;

        if (kpiIngresos) kpiIngresos.textContent = `Bs. ${d.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
        if (kpiEgresos) kpiEgresos.textContent = `Bs. ${d.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
        if (kpiBalance) {
          kpiBalance.textContent = `Bs. ${balanceNeto.toLocaleString('es-BO', { minimumFractionDigits: 2 })}`;
          kpiBalance.style.color = balanceNeto >= 0 ? '#60a5fa' : '#f87171';
        }
        if (kpiAnomalias) kpiAnomalias.textContent = `${d.totalAnomalias}`;

        const filesBox = document.getElementById('bank-files-info');
        if (filesBox) {
          if (d.totalMovimientos > 0) {
            filesBox.innerHTML = `
              <div style="font-size: 0.9rem; line-height: 1.6;">
                <div><strong>Bancos Detectados:</strong> <span class="badge badge-banco">${d.bancosDetectados.join(', ')}</span></div>
                <div><strong>Rango de Fechas:</strong> ${d.fechaMin} al ${d.fechaMax}</div>
                <div><strong>Total Movimientos:</strong> ${d.totalMovimientos.toLocaleString()} registros procesados</div>
                <div><strong>Archivos Procesados:</strong> ${d.archivosCargados.join(', ') || 'Archivos de extractos'}</div>
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
              <td class="text-right" style="font-weight: 600; color: #94a3b8;">${c.saldoInicialBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-right" style="font-weight: 600; color: #4ade80;">${c.totalIngresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-right" style="font-weight: 600; color: #f87171;">${c.totalEgresosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-right" style="font-weight: 700; color: ${c.balanceNetoBs >= 0 ? '#60a5fa' : '#f87171'};">
                ${c.balanceNetoBs >= 0 ? '+' : ''}${c.balanceNetoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </td>
              <td class="text-right" style="font-weight: 800; color: #38bdf8;">${c.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
              <td class="text-center">
                ${c.conciliadoOk 
                  ? '<span class="badge badge-ingreso">Conciliado (Ok)</span>' 
                  : '<span class="badge badge-anomalo">Descalce</span>'}
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
      const res = await fetch(construirUrlConFiltroGlobal(`${API_BASE}/resumen-mensual`));
      const json = await res.json();

      if (json.success && json.data && json.data.length > 0) {
        container.innerHTML = json.data.map((m, mIdx) => {
          const renderCatRow = (cat, catIdx, typeStr) => {
            const rowId = `cat-detail-${mIdx}-${typeStr}-${catIdx}`;
            const isAnomalia = cat.categoria === 'TRANSACCION_ANOMALA';
            const hasDetails = cat.detalles && cat.detalles.length > 0;

            const detallesHtml = hasDetails ? cat.detalles.map((d) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(15, 23, 42, 0.7); border-radius: 6px; margin-bottom: 4px; font-size: 0.78rem; border-left: 3px solid ${isAnomalia ? '#fb923c' : '#38bdf8'};">
                <div style="flex: 1; padding-right: 10px;">
                  <div style="color: #fff; font-weight: 600;">${d.contraparteNombre || 'Sin nombre registrado'} <span style="color: var(--text-muted); font-size: 0.72rem;">(Mi Cuenta: ${d.banco} | Banco Cliente/Origen: ${d.contraparteBanco || 'Traspaso Directo'} • ${d.fechaTexto})</span></div>
                  <div style="color: ${isAnomalia ? '#fb923c' : 'var(--text-muted)'}; font-size: 0.74rem;">${d.motivo || 'Movimiento registrado'}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <strong style="color: ${typeStr === 'ing' ? '#4ade80' : '#f87171'}; font-size: 0.85rem;">Bs. ${d.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong>
                  ${d.contraparteNombre ? `<button class="btn btn-secondary btn-quick-rule" data-name="${d.contraparteNombre.replace(/"/g, '&quot;')}" title="Agregar a Personas Conocidas" style="padding: 2px 7px; font-size: 0.7rem; border-color: rgba(56,189,248,0.4); background: rgba(56,189,248,0.15); color: #38bdf8;">Marcar Conocido</button>` : ''}
                </div>
              </div>
            `).join('') : '<div style="font-size: 0.75rem; color: var(--text-muted); padding: 4px;">Sin detalles registrados.</div>';

            return `
              <div style="border-bottom: 1px dashed rgba(255,255,255,0.06); padding: 6px 0;">
                <div class="cat-row-header" data-target="${rowId}" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;" title="Haz clic para desplegar/ocultar a quién y por qué motivo">
                  <span style="${isAnomalia ? 'color: #fb923c; font-weight: 700;' : ''}">
                    <strong>${cat.nombreVisible}</strong> (${cat.cantidad} movs) ${hasDetails ? '<span style="font-size: 0.72rem; color: #38bdf8; margin-left: 4px;">(Ver quién y por qué)</span>' : ''}
                  </span>
                  <span style="color: ${typeStr === 'ing' ? '#4ade80' : '#f87171'}; font-weight: 600;">
                    Bs. ${cat.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })} (${cat.pctDelTotal}%)
                  </span>
                </div>
                <div id="${rowId}" class="cat-detail-panel" style="display: ${isAnomalia ? 'block' : 'none'}; margin-top: 8px; padding: 8px; background: rgba(0, 0, 0, 0.25); border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
                  <div style="font-size: 0.74rem; color: #38bdf8; font-weight: 600; margin-bottom: 6px;">Desglose de Operaciones (${cat.nombreVisible}):</div>
                  ${detallesHtml}
                </div>
              </div>
            `;
          };

          const ingresosHtml = m.ingresosPorCategoria.map((cat, idx) => renderCatRow(cat, idx, 'ing')).join('') 
            || '<div style="font-size: 0.8rem; color: var(--text-muted);">Sin ingresos en este período</div>';

          const egresosHtml = m.egresosPorCategoria.map((cat, idx) => renderCatRow(cat, idx, 'egr')).join('') 
            || '<div style="font-size: 0.8rem; color: var(--text-muted);">Sin egresos en este período</div>';

          return `
            <div class="glass-card" style="background: rgba(11, 17, 32, 0.7); border: 1px solid rgba(255,255,255,0.08);">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 14px;">
                <h4 style="font-size: 1.1rem; color: #fff;">Período: ${m.periodoTexto}</h4>
                <div style="font-size: 0.9rem; font-weight: 700; color: ${m.balanceMesBs >= 0 ? '#60a5fa' : '#f87171'};">
                  Balance Mes: Bs. ${m.balanceMesBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                </div>
              </div>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div>
                  <h5 style="color: #4ade80; font-size: 0.88rem; margin-bottom: 8px;">Ingresos Clasificados (Origen de Fondos)</h5>
                  ${ingresosHtml}
                </div>

                <div>
                  <h5 style="color: #f87171; font-size: 0.88rem; margin-bottom: 8px;">Egresos Clasificados (Destino / Propósito)</h5>
                  ${egresosHtml}
                </div>
              </div>
            </div>
          `;
        }).join('');

        // Event listener para conmutar detalle de panel (toggle panel)
        container.querySelectorAll('.cat-row-header').forEach((hdr) => {
          hdr.addEventListener('click', (evt) => {
            if (evt.target.closest('.btn-quick-rule')) return;
            const targetId = hdr.getAttribute('data-target');
            if (targetId) {
              const panel = document.getElementById(targetId);
              if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
              }
            }
          });
        });

        // Event listener para botón rápido "+ Marcar Conocido"
        container.querySelectorAll('.btn-quick-rule').forEach((btn) => {
          btn.addEventListener('click', async (evt) => {
            evt.stopPropagation();
            const name = btn.getAttribute('data-name');
            if (!name) return;

            try {
              const res = await fetch(`${API_BASE}/reglas`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyword: name, accion: 'EXCLUIR_ANOMALIA', tipoTransaccion: 'TODOS', nota: 'Agregado desde Resumen Mensual' }),
              });

              const json = await res.json();
              if (json.success) {
                cargarInfoGlobal();
                cargarResumenMensual();
                cargarAnomalias();
                cargarMovimientos(1);
                cargarReglas();
              }
            } catch (err) {
              console.error('Error al agregar regla rápida:', err);
            }
          });
        });
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
      const res = await fetch(construirUrlConFiltroGlobal(`${API_BASE}/anomalias`));
      const json = await res.json();

      if (json.success && json.data && json.data.length > 0) {
        tableBody.innerHTML = json.data.map((m) => `
          <tr>
            <td>${m.fechaTexto} ${m.hora !== '00:00:00' ? m.hora : ''}</td>
            <td><span class="badge badge-banco">${m.banco}</span></td>
            <td><span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">${m.contraparteBanco || 'Traspaso Directo'}</span></td>
            <td><span class="badge ${m.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${m.tipo}</span></td>
            <td><strong>${m.contraparteNombre}</strong></td>
            <td class="text-right" style="font-weight: 700; color: ${m.tipo === 'INGRESO' ? '#4ade80' : '#f87171'};">
              ${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
            </td>
            <td><span class="badge badge-anomalo">${m.motivoAnomalia || m.glosaDetalle}</span></td>
          </tr>
        `).join('');
      } else {
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center" style="color: var(--text-muted);">No se detectaron transacciones atípicas o abultadas.</td></tr>';
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
      const resIng = await fetch(construirUrlConFiltroGlobal(`${API_BASE}/recurrentes?tipo=INGRESO&limit=10`));
      const jsonIng = await resIng.json();
      if (jsonIng.success && bodyIngresos) {
        bodyIngresos.innerHTML = jsonIng.data.map((c) => `
          <tr>
            <td><strong>${c.contraparteNombre}</strong><br><span style="font-size: 0.75rem; color: var(--text-muted);">${c.banco}</span></td>
            <td class="text-right">${c.cantidadTransacciones} dep.</td>
            <td class="text-right">${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
            <td class="text-right" style="font-weight: 700; color: #4ade80;">${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
          </tr>
        `).join('');
      }

      const resEgr = await fetch(construirUrlConFiltroGlobal(`${API_BASE}/recurrentes?tipo=EGRESO&limit=10`));
      const jsonEgr = await resEgr.json();
      if (jsonEgr.success && bodyEgresos) {
        bodyEgresos.innerHTML = jsonEgr.data.map((c) => `
          <tr>
            <td><strong>${c.contraparteNombre}</strong><br><span style="font-size: 0.75rem; color: var(--text-muted);">${c.banco}</span></td>
            <td class="text-right">${c.cantidadTransacciones} pag.</td>
            <td class="text-right">${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
            <td class="text-right" style="font-weight: 700; color: #f87171;">${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
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
      let url = construirUrlConFiltroGlobal(`${API_BASE}/movimientos?page=${page}&limit=25`);
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
              <td><span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">${m.contraparteBanco || 'Traspaso Directo'}</span></td>
              <td><span class="badge ${m.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${m.tipo}</span></td>
              <td><strong>${m.contraparteNombre}</strong></td>
              <td><span class="badge badge-secondary" style="font-size: 0.75rem;">${m.categoria}</span></td>
              <td class="text-right" style="font-weight: 700; color: ${m.tipo === 'INGRESO' ? '#4ade80' : '#f87171'};">
                ${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
              </td>
              <td class="text-right" style="color: var(--text-muted);">${m.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
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
          tableBody.innerHTML = '<tr><td colspan="9" class="text-center" style="color: var(--text-muted);">No se encontraron movimientos para los filtros seleccionados.</td></tr>';
          if (pagination) pagination.innerHTML = '';
        }
      }
    } catch (e) {
      console.error('Error al cargar movimientos:', e);
    }
  }



  // Cargar Respaldo Resumen Cuentas Bancarias (Pestaña Respaldo Mensual)
  async function cargarRespaldoResumen() {
    const container = document.getElementById('container-respaldo-cuentas') || document.getElementById('respaldo-resumen-container');
    if (!container) return;

    const urlRespaldo = construirUrlConFiltroGlobal(`${API_BASE}/respaldo-resumen-cuentas`);
    const urlExcel = construirUrlConFiltroGlobal(`${API_BASE}/exportar-respaldo-excel`);

    // Actualizar enlace de exportación Excel con el rango de fechas seleccionado
    const linkExcel = document.getElementById('link-exportar-respaldo-excel');
    if (linkExcel) {
      linkExcel.href = urlExcel;
    }

    container.innerHTML = '<div class="glass-card text-center" style="color: var(--text-muted);">Cargando respaldo mensual de cuentas...</div>';

    try {
      const res = await fetch(urlRespaldo);
      const json = await res.json();

      if (json.success && json.data) {
        const { cuentas, resumenConsolidado } = json.data;

        if ((!cuentas || cuentas.length === 0) && !resumenConsolidado) {
          container.innerHTML = '<div class="glass-card text-center" style="color: var(--text-muted);">No hay extractos bancarios cargados para generar el respaldo mensual.</div>';
          return;
        }

        let html = '';

        if (resumenConsolidado && resumenConsolidado.filasMensuales && resumenConsolidado.filasMensuales.length > 0) {
          html += `
            <div class="glass-card">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
                <div>
                  <h4 style="font-size: 1.05rem; font-weight: 700; color: #fff;">
                    Resumen General Consolidado (Todos los Bancos)
                  </h4>
                  <p style="font-size: 0.78rem; color: var(--text-muted); margin-top: 1px;">Consolidado Acumulado de Cuentas Bancarias</p>
                </div>
                <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-color); padding: 5px 12px; border-radius: 6px; font-size: 0.82rem;">
                  <span style="color: var(--text-muted);">Saldo Inicial Consolidado:</span>
                  <strong style="color: #38bdf8; font-size: 0.92rem; margin-left: 6px;">Bs. ${resumenConsolidado.saldoInicialTotalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong>
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
                    ${resumenConsolidado.filasMensuales.map((f) => `
                      <tr>
                        <td><strong>${f.mesTexto}</strong></td>
                        <td class="text-right" style="color: #4ade80; font-weight: 600;">${f.creditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="text-right" style="color: #f87171; font-weight: 600;">${f.debitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="text-right" style="color: #38bdf8; font-weight: 700;">${f.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="background: rgba(15, 23, 42, 0.9); font-weight: 800;">
                      <td>TOTAL GENERAL CONSOLIDADO ACUMULADO</td>
                      <td class="text-right" style="color: #4ade80;">${resumenConsolidado.totalCreditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="text-right" style="color: #f87171;">${resumenConsolidado.totalDebitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="text-right" style="color: #38bdf8; font-size: 1.05rem;">${resumenConsolidado.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          `;
        }

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
                      <th class="text-right">Créditos (Bs.)</th>
                      <th class="text-right">Débitos (Bs.)</th>
                      <th class="text-right">Saldo (Bs.)</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${c.filasMensuales.map((f) => `
                      <tr>
                        <td><strong>${f.mesTexto}</strong></td>
                        <td class="text-right" style="color: #4ade80; font-weight: 600;">${f.creditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="text-right" style="color: #f87171; font-weight: 600;">${f.debitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                        <td class="text-right" style="color: #38bdf8; font-weight: 700;">${f.saldoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                  <tfoot>
                    <tr style="background: rgba(15, 23, 42, 0.9); font-weight: 800;">
                      <td>TOTAL ACUMULADO CUENTA</td>
                      <td class="text-right" style="color: #4ade80;">${c.totalCreditosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="text-right" style="color: #f87171;">${c.totalDebitosBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                      <td class="text-right" style="color: #38bdf8; font-size: 1.05rem;">${c.saldoFinalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          `;
        });
        container.innerHTML = html;
      }
    } catch (e) {
      console.error('Error al cargar respaldo resumen:', e);
      container.innerHTML = `<div class="glass-card text-center" style="color: #f87171;">Error al generar el respaldo de cuentas: ${e.message}</div>`;
    }
  }

  // Toggle Sidebar Nav (Menú Hamburguesa)
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const sidebarNav = document.getElementById('sidebar-nav');
  if (btnToggleSidebar && sidebarNav) {
    btnToggleSidebar.addEventListener('click', () => {
      sidebarNav.classList.toggle('collapsed');
    });
  }

  // Global Date Filter Buttons
  const btnAplicarGlobal = document.getElementById('btn-aplicar-global-filtro');
  if (btnAplicarGlobal) btnAplicarGlobal.addEventListener('click', () => refrescarTodoElSistema());

  const btnResetGlobal = document.getElementById('btn-reset-global-filtro');
  if (btnResetGlobal) {
    btnResetGlobal.addEventListener('click', () => {
      const dIn = document.getElementById('global-filter-desde');
      const hIn = document.getElementById('global-filter-hasta');
      if (dIn) dIn.value = '2025-07-01';
      if (hIn) hIn.value = '2026-07-31';
      refrescarTodoElSistema();
    });
  }

  const btnAllTimeGlobal = document.getElementById('btn-alltime-global-filtro');
  if (btnAllTimeGlobal) {
    btnAllTimeGlobal.addEventListener('click', () => {
      const dIn = document.getElementById('global-filter-desde');
      const hIn = document.getElementById('global-filter-hasta');
      if (dIn) dIn.value = '';
      if (hIn) hIn.value = '';
      refrescarTodoElSistema();
    });
  }

  // Filter Button para Movimientos
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

  // Control de Modal de Vista Previa PDF
  const modalPdf = document.getElementById('modal-pdf-preview');
  const iframePdf = document.getElementById('iframe-pdf-preview');
  const modalPdfTitle = document.getElementById('pdf-modal-title');
  const btnModalPrint = document.getElementById('btn-modal-print-action');
  const btnModalClose = document.getElementById('btn-modal-close-action');

  let currentObjectBlobUrl = null;

  async function abrirModalPdfPreview(url, titulo = 'Vista Previa de Reporte PDF') {
    if (!modalPdf || !iframePdf) return;
    if (modalPdfTitle) modalPdfTitle.textContent = titulo;
    modalPdf.style.display = 'flex';

    if (currentObjectBlobUrl) {
      URL.revokeObjectURL(currentObjectBlobUrl);
      currentObjectBlobUrl = null;
    }

    iframePdf.removeAttribute('srcdoc');
    iframePdf.src = url;
  }

  function cerrarModalPdfPreview() {
    if (!modalPdf || !iframePdf) return;
    modalPdf.style.display = 'none';
    if (currentObjectBlobUrl) {
      URL.revokeObjectURL(currentObjectBlobUrl);
      currentObjectBlobUrl = null;
    }
    iframePdf.removeAttribute('srcdoc');
    iframePdf.src = 'about:blank';
  }

  if (btnModalClose) btnModalClose.addEventListener('click', cerrarModalPdfPreview);
  if (modalPdf) {
    modalPdf.addEventListener('click', (e) => {
      if (e.target === modalPdf) cerrarModalPdfPreview();
    });
  }

  if (iframePdf) {
    iframePdf.addEventListener('load', () => {
      try {
        if (iframePdf.contentWindow) {
          iframePdf.contentWindow.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
              cerrarModalPdfPreview();
            }
          });
        }
      } catch (err) {}
    });
  }

  // Cerrar modal al presionar ESC
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      cerrarModalPdfPreview();
    }
  });

  if (btnModalPrint && iframePdf) {
    btnModalPrint.addEventListener('click', () => {
      if (iframePdf.contentWindow) {
        iframePdf.contentWindow.focus();
        iframePdf.contentWindow.print();
      }
    });
  }

  // 1. PDF Tab 1: Estado de Saldos
  const btnPdfSaldos = document.getElementById('btn-pdf-tab-saldos');
  if (btnPdfSaldos) {
    btnPdfSaldos.addEventListener('click', () => {
      const url = construirUrlConFiltroGlobal(`${API_BASE}/imprimir-saldos-pdf`);
      abrirModalPdfPreview(url, 'Vista Previa — Estado de Saldos & Conciliación por Banco');
    });
  }

  // 2. PDF Tab 2: Análisis por Mes
  const btnPdfAnalisis = document.getElementById('btn-pdf-tab-analisis');
  if (btnPdfAnalisis) {
    btnPdfAnalisis.addEventListener('click', () => {
      const url = construirUrlConFiltroGlobal(`${API_BASE}/imprimir-analisis-pdf`);
      abrirModalPdfPreview(url, 'Vista Previa — Análisis Mensual Clasificado');
    });
  }

  // 3. PDF Tab 3: Detección de Anomalías
  const btnPdfAnomalias = document.getElementById('btn-pdf-tab-anomalias');
  if (btnPdfAnomalias) {
    btnPdfAnomalias.addEventListener('click', () => {
      const url = construirUrlConFiltroGlobal(`${API_BASE}/imprimir-anomalias-pdf`);
      abrirModalPdfPreview(url, 'Vista Previa — Auditoría de Transacciones Anómalas');
    });
  }

  // PDF Tab Sugerencias y Transacciones Grandes
  const btnPdfSugerencias = document.getElementById('btn-pdf-tab-sugerencias');
  if (btnPdfSugerencias) {
    btnPdfSugerencias.addEventListener('click', () => {
      const url = construirUrlConFiltroGlobal(`${API_BASE}/imprimir-sugerencias-pdf`);
      abrirModalPdfPreview(url, 'Vista Previa — Transacciones Grandes y Anomalías (Pendientes)');
    });
  }

  // 4. PDF Tab 4: Ranking Recurrentes
  const btnPdfRecurrentes = document.getElementById('btn-pdf-tab-recurrentes');
  if (btnPdfRecurrentes) {
    btnPdfRecurrentes.addEventListener('click', () => {
      const url = construirUrlConFiltroGlobal(`${API_BASE}/imprimir-recurrentes-pdf`);
      abrirModalPdfPreview(url, 'Vista Previa — Ranking de Clientes y Proveedores Recurrentes');
    });
  }

  // 5. PDF Tab 5: Respaldo Mensual Estilo 12.0
  const btnPreviewRespaldoPdf = document.getElementById('btn-preview-respaldo-pdf');
  if (btnPreviewRespaldoPdf) {
    btnPreviewRespaldoPdf.addEventListener('click', () => {
      const url = construirUrlConFiltroGlobal(`${API_BASE}/imprimir-respaldo-pdf`);
      abrirModalPdfPreview(url, 'Vista Previa — Respaldo Bancario Resumen de Cuentas (Mensual)');
    });
  }

  // 6. PDF Tab 6: Consolidado Movimientos Libro Caja/Bancos
  const btnPdfMovimientos = document.getElementById('btn-pdf-tab-movimientos');
  if (btnPdfMovimientos) {
    btnPdfMovimientos.addEventListener('click', () => {
      const banco = document.getElementById('filter-bank-banco')?.value || '';
      const tipo = document.getElementById('filter-bank-tipo')?.value || '';
      const categoria = document.getElementById('filter-bank-categoria')?.value || '';
      const search = document.getElementById('filter-bank-search')?.value || '';

      const { desde, hasta } = obtenerRangoFechasGlobal();
      const params = new URLSearchParams();
      if (banco) params.set('banco', banco);
      if (tipo) params.set('tipo', tipo);
      if (categoria) params.set('categoria', categoria);
      if (search) params.set('search', search);
      if (desde) params.set('desde', desde);
      if (hasta) params.set('hasta', hasta);

      const url = `${API_BASE}/imprimir-movimientos-pdf?${params.toString()}`;
      abrirModalPdfPreview(url, '📜 Vista Previa — Reporte Consolidado Libro Caja/Bancos');
    });
  }

  let categoriasCache = [];
  let sugerenciasCache = null;
  let sugerenciasPillFilter = 'TODOS';
  let sugerenciasSortField = 'totalMontoBs';
  let sugerenciasSortDir = 'desc';
  let sugerenciasCheckedIndexes = new Set();
  let listSugFilteredCache = [];

  // Cargar Categorías para Selects
  async function cargarCategoriasEnSelects() {
    try {
      const res = await fetch(`${API_BASE}/categorias`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        categoriasCache = json.data;
        
        const reglaSelect = document.getElementById('regla-categoria-select');
        const filterCatSelect = document.getElementById('filter-bank-categoria');

        const optionsHtml = categoriasCache.map(
          (c) => `<option value="${c.id}">${c.nombreVisible} ${c.esCustom ? '(Custom)' : ''}</option>`
        ).join('');

        if (reglaSelect) {
          reglaSelect.innerHTML = `<option value="">(Sin categoría específica - Auto)</option>` + optionsHtml;
        }

        if (filterCatSelect) {
          filterCatSelect.innerHTML = `<option value="">Todas las categorías</option>` + optionsHtml;
        }
      }
    } catch (e) {
      console.error('Error cargando categorías:', e);
    }
  }

  // Actualizar indicadores KPI de Sugerencias
  function actualizarKpisSugerencias(allSug) {
    const elCount = document.getElementById('kpi-sug-count');
    const elIngresos = document.getElementById('kpi-sug-ingresos');
    const elEgresos = document.getElementById('kpi-sug-egresos');
    const elAnomalias = document.getElementById('kpi-sug-anomalias');

    if (!elCount || !allSug) return;

    const count = allSug.length;
    const ingresos = allSug.filter((s) => s.tipo === 'INGRESO').reduce((acc, s) => acc + (s.totalMontoBs || 0), 0);
    const egresos = allSug.filter((s) => s.tipo === 'EGRESO').reduce((acc, s) => acc + (s.totalMontoBs || 0), 0);
    const anomalias = allSug.filter((s) => s.esAnomalo).length;

    elCount.textContent = count;
    elIngresos.textContent = `Bs. ${ingresos.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    elEgresos.textContent = `Bs. ${egresos.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    elAnomalias.textContent = `${anomalias} contrapartes`;
  }

  // Actualizar barra de acciones masivas
  function actualizarBulkBarSugerencias() {
    const bulkBar = document.getElementById('bulk-sugerencias-bar');
    const bulkInfo = document.getElementById('bulk-sugerencias-info');
    const bulkSelect = document.getElementById('bulk-sugerencias-select-cat');
    if (!bulkBar || !bulkInfo || !bulkSelect) return;

    if (sugerenciasCheckedIndexes.size > 0) {
      let totalSuma = 0;
      let totalMovs = 0;
      sugerenciasCheckedIndexes.forEach((idx) => {
        const item = listSugFilteredCache[idx];
        if (item) {
          totalSuma += item.totalMontoBs || 0;
          totalMovs += item.cantidadMovimientos || 0;
        }
      });

      bulkInfo.innerHTML = `⚡ <strong>${sugerenciasCheckedIndexes.size}</strong> seleccionados (${totalMovs} movs) | <strong>Suma Total: Bs. ${totalSuma.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>`;

      if (bulkSelect.children.length <= 1 && categoriasCache.length > 0) {
        const optionsHtml = categoriasCache.map(
          (c) => `<option value="${c.id}">${c.icono} ${c.nombreVisible}</option>`
        ).join('');
        bulkSelect.innerHTML = `<option value="">-- Seleccionar Categoría --</option>` + optionsHtml;
      }

      bulkBar.style.display = 'flex';
    } else {
      bulkBar.style.display = 'none';
    }
  }

  // Render de Tabla de Sugerencias con Filtro, Pills, Ordenamiento y Checkboxes
  function renderSugerenciasTabla(filtroText = '') {
    const tableSugerencias = document.querySelector('#table-sugerencias-clasificacion tbody');
    if (!tableSugerencias || !sugerenciasCache) return;

    const allSug = sugerenciasCache.sugerenciasGrandesAnomalas || [];
    actualizarKpisSugerencias(allSug);

    let listSug = [...allSug];

    // 1. Filtrado por pastillas (Pills)
    if (sugerenciasPillFilter === 'INGRESO') {
      listSug = listSug.filter((s) => s.tipo === 'INGRESO');
    } else if (sugerenciasPillFilter === 'EGRESO') {
      listSug = listSug.filter((s) => s.tipo === 'EGRESO');
    } else if (sugerenciasPillFilter === 'ANOMALO') {
      listSug = listSug.filter((s) => s.esAnomalo);
    } else if (sugerenciasPillFilter === 'MAYOR_5K') {
      listSug = listSug.filter((s) => s.totalMontoBs >= 5000);
    }

    // 2. Filtrado por búsqueda de texto
    const textQuery = (filtroText || document.getElementById('search-sugerencias-input')?.value || '').trim().toLowerCase();
    if (textQuery !== '') {
      listSug = listSug.filter((s) =>
        s.contraparteNombre.toLowerCase().includes(textQuery) ||
        (s.banco && s.banco.toLowerCase().includes(textQuery)) ||
        (s.contraparteBanco && s.contraparteBanco.toLowerCase().includes(textQuery)) ||
        (s.glosaEjemplo && s.glosaEjemplo.toLowerCase().includes(textQuery)) ||
        (s.motivoEjemplo && s.motivoEjemplo.toLowerCase().includes(textQuery)) ||
        String(s.totalMontoBs).includes(textQuery)
      );
    }

    // 3. Ordenamiento por campo y dirección
    listSug.sort((a, b) => {
      let valA = a[sugerenciasSortField];
      let valB = b[sugerenciasSortField];
      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sugerenciasSortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sugerenciasSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    listSugFilteredCache = listSug;

    // Actualizar encabezados de columna ordenables
    const headers = document.querySelectorAll('#table-sugerencias-clasificacion .sortable-header');
    headers.forEach((h) => {
      const field = h.getAttribute('data-sort');
      const icon = h.querySelector('.sort-icon');
      if (icon) {
        if (field === sugerenciasSortField) {
          icon.textContent = sugerenciasSortDir === 'asc' ? '↑' : '↓';
          h.style.color = '#38bdf8';
        } else {
          icon.textContent = '↕';
          h.style.color = '';
        }
      }
    });

    // 4. Renderizado de filas
    if (listSug.length > 0) {
      tableSugerencias.innerHTML = listSug.map((s, idx) => {
        const isChecked = sugerenciasCheckedIndexes.has(idx);
        const optionsHtml = categoriasCache.map(
          (c) => `<option value="${c.id}">${c.nombreVisible}</option>`
        ).join('');

        const tagMotivo = s.esAnomalo
          ? `<span class="badge badge-anomalo" style="font-size: 0.7rem; padding: 2px 6px;">Anomalía</span>`
          : `<span class="badge" style="background: rgba(234,179,8,0.15); color: #facc15; border: 1px solid rgba(234,179,8,0.3); font-size: 0.7rem; padding: 2px 6px;">Monto Abultado</span>`;

        return `
          <tr style="${isChecked ? 'background: rgba(56, 189, 248, 0.08);' : ''}">
            <td style="text-align: center;">
              <input type="checkbox" class="chk-sug-item" data-idx="${idx}" ${isChecked ? 'checked' : ''} style="cursor: pointer;">
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <strong style="color: #fff; font-size: 0.86rem;">${s.contraparteNombre}</strong>
                ${tagMotivo}
              </div>
              <span style="font-size: 0.73rem; color: var(--text-muted); display: block; margin-top: 2px; text-overflow: ellipsis; overflow: hidden; max-width: 260px; white-space: nowrap;" title="${s.glosaEjemplo}">
                Glosa: ${s.glosaEjemplo || s.motivoEjemplo}
              </span>
            </td>
            <td>
              <span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">
                ${s.contraparteBanco || 'Mismo Banco'}
              </span>
            </td>
            <td>
              <span class="badge badge-banco">${s.banco}</span>
            </td>
            <td>
              <span class="badge ${s.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">
                ${s.tipo === 'INGRESO' ? 'INGRESO' : 'EGRESO'}
              </span>
            </td>
            <td class="text-right" style="font-weight: 700; font-size: 0.9rem; color: ${s.tipo === 'INGRESO' ? '#4ade80' : '#f87171'}; font-family: monospace;">
              Bs. ${s.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </td>
            <td>
              <span class="badge badge-banco" style="font-weight: 600;">${s.cantidadMovimientos} movs</span>
            </td>
            <td>
              <select class="form-control select-sug-cat" data-idx="${idx}" style="font-size: 0.78rem; padding: 4px 8px; background: rgba(15,23,42,0.95); border: 1px solid var(--border-color); color: #fff; border-radius: 6px; width: 100%;">
                ${optionsHtml}
              </select>
            </td>
            <td class="text-right" style="white-space: nowrap;">
              <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                <button class="btn btn-secondary btn-ver-historial-sug" data-sidx="${idx}" style="padding: 4px 8px; font-size: 0.74rem; border-color: #38bdf8; color: #38bdf8; font-weight: 600;" title="Ver todas las fechas y movimientos">
                  Historial
                </button>
                <button class="btn btn-primary btn-save-sug" data-name="${s.contraparteNombre.replace(/"/g, '&quot;')}" data-banco="${s.banco}" data-bancocontraparte="${(s.contraparteBanco || '').replace(/"/g, '&quot;')}" data-tipo="${s.tipo}" data-idx="${idx}" style="padding: 4px 10px; font-size: 0.78rem; font-weight: 600; background: #0284c7;" title="Clasificar todo e ignorar futuras alertas">
                  Clasificar
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      tableSugerencias.innerHTML = `
        <tr>
          <td colspan="9" class="text-center" style="padding: 24px; color: var(--text-muted);">
            <div style="font-size: 1.2rem; margin-bottom: 4px;">🎉</div>
            <strong>¡Excelente! No hay transacciones grandes ni anomalías pendientes por clasificar.</strong>
            <p style="font-size: 0.78rem; margin-top: 4px; color: var(--text-muted);">Tus reglas de personas conocidas están al día.</p>
          </td>
        </tr>
      `;
    }

    // Actualizar estado del checkbox "Seleccionar Todo"
    const chkSelectAll = document.getElementById('chk-sug-select-all');
    if (chkSelectAll) {
      chkSelectAll.checked = listSug.length > 0 && sugerenciasCheckedIndexes.size === listSug.length;
    }

    actualizarBulkBarSugerencias();
  }

  const inputSearchSug = document.getElementById('search-sugerencias-input');
  if (inputSearchSug) {
    inputSearchSug.addEventListener('input', (e) => {
      renderSugerenciasTabla(e.target.value);
    });
  }

  // Pastillas de filtro para Sugerencias
  const pillsContainer = document.getElementById('pills-sugerencias-container');
  if (pillsContainer) {
    pillsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.pill-btn');
      if (!btn) return;
      pillsContainer.querySelectorAll('.pill-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sugerenciasPillFilter = btn.getAttribute('data-filter') || 'TODOS';
      sugerenciasCheckedIndexes.clear();
      renderSugerenciasTabla();
    });
  }

  // Ordenar columnas en la tabla de Sugerencias
  const tableSugHeader = document.querySelector('#table-sugerencias-clasificacion thead');
  if (tableSugHeader) {
    tableSugHeader.addEventListener('click', (e) => {
      const th = e.target.closest('.sortable-header');
      if (!th) return;
      const field = th.getAttribute('data-sort');
      if (!field) return;

      if (sugerenciasSortField === field) {
        sugerenciasSortDir = sugerenciasSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sugerenciasSortField = field;
        sugerenciasSortDir = 'desc';
      }
      renderSugerenciasTabla();
    });
  }

  // Checkbox Seleccionar Todo en Sugerencias
  const chkSugSelectAll = document.getElementById('chk-sug-select-all');
  if (chkSugSelectAll) {
    chkSugSelectAll.addEventListener('change', (e) => {
      if (e.target.checked) {
        listSugFilteredCache.forEach((_, idx) => sugerenciasCheckedIndexes.add(idx));
      } else {
        sugerenciasCheckedIndexes.clear();
      }
      renderSugerenciasTabla();
    });
  }

  // Guardar Lote de Sugerencias Rápida
  const btnBulkSaveSug = document.getElementById('btn-bulk-save-sug');
  if (btnBulkSaveSug) {
    btnBulkSaveSug.addEventListener('click', async () => {
      if (sugerenciasCheckedIndexes.size === 0) return;
      const bulkSelectCat = document.getElementById('bulk-sugerencias-select-cat');
      const categoriaDestino = bulkSelectCat ? bulkSelectCat.value : '';

      if (!categoriaDestino) {
        alert('Por favor selecciona una categoría a asignar para las contrapartes seleccionadas.');
        return;
      }

      const reglasAInsertar = [];
      sugerenciasCheckedIndexes.forEach((idx) => {
        const item = listSugFilteredCache[idx];
        if (item) {
          reglasAInsertar.push({
            keyword: item.contraparteNombre,
            banco: 'TODOS',
            bancoContraparte: item.contraparteBanco || undefined,
            accion: 'EXCLUIR_ANOMALIA',
            categoriaDestino,
            tipoTransaccion: item.tipo || 'TODOS',
            nota: `Clasificación en lote (${item.cantidadMovimientos} movs)`,
          });
        }
      });

      if (reglasAInsertar.length === 0) return;

      try {
        btnBulkSaveSug.disabled = true;
        btnBulkSaveSug.textContent = 'Procesando...';

        const res = await fetch(`${API_BASE}/reglas/lote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reglas: reglasAInsertar }),
        });

        const json = await res.json();
        if (json.success) {
          sugerenciasCheckedIndexes.clear();
          cargarInfoGlobal();
          cargarResumenMensual();
          cargarAnomalias();
          cargarMovimientos(1);
          cargarReglas();
          await cargarSugerencias();
        } else {
          alert(json.error || 'Error al procesar el lote.');
        }
      } catch (err) {
        console.error('Error procesando lote de sugerencias:', err);
      } finally {
        btnBulkSaveSug.disabled = false;
        btnBulkSaveSug.textContent = '⚡ Clasificar Seleccionados en 1-Clic';
      }
    });
  }

  // Render de Tabla de Contrapartes Frecuentes con Filtro
  function renderFrecuentesTabla(filtro = '') {
    const tableHistorial = document.querySelector('#table-contrapartes-historial tbody');
    if (!tableHistorial || !sugerenciasCache) return;

    let listFrec = sugerenciasCache.contrapartesFrecuentes || [];
    if (filtro && filtro.trim() !== '') {
      const query = filtro.trim().toLowerCase();
      listFrec = listFrec.filter((c) =>
        c.contraparteNombre.toLowerCase().includes(query) ||
        c.banco.toLowerCase().includes(query) ||
        (c.contraparteBanco && c.contraparteBanco.toLowerCase().includes(query)) ||
        String(c.totalMontoBs).includes(query)
      );
    }

    if (listFrec.length > 0) {
      tableHistorial.innerHTML = listFrec.map((c, fIdx) => `
        <tr>
          <td><strong>👤 ${c.contraparteNombre}</strong></td>
          <td><span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">${c.contraparteBanco || 'Mismo Banco'}</span></td>
          <td><span class="badge badge-banco">${c.banco}</span></td>
          <td><span class="badge ${c.tipo === 'INGRESO' ? 'badge-ingreso' : 'badge-egreso'}">${c.tipo}</span></td>
          <td><span class="badge badge-banco">${c.cantidadTransacciones} transacciones</span></td>
          <td class="text-right" style="font-weight: 700; color: ${c.tipo === 'INGRESO' ? '#4ade80' : '#f87171'};">
            Bs. ${c.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
          </td>
          <td class="text-right" style="font-size: 0.8rem; color: var(--text-muted);">
            Bs. ${c.promedioBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
          </td>
          <td class="text-right">
            <button class="btn btn-secondary btn-ver-historial-persona" data-fidx="${fIdx}" style="padding: 4px 10px; font-size: 0.78rem; border-color: #38bdf8; color: #38bdf8; font-weight: 600;">
              📅 Ver Historial (${c.cantidadTransacciones} movs)
            </button>
          </td>
        </tr>
      `).join('');
    } else {
      tableHistorial.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted);">No se encontraron contrapartes recurrentes.</td></tr>';
    }
  }

  const inputSearchFrec = document.getElementById('search-frecuentes-input');
  if (inputSearchFrec) {
    inputSearchFrec.addEventListener('input', (e) => {
      renderFrecuentesTabla(e.target.value);
    });
  }

  // Cargar Sugerencias Rápida e Historial por Persona
  async function cargarSugerencias() {
    try {
      const res = await fetch(`${API_BASE}/sugerencias-clasificacion`);
      const json = await res.json();

      if (json.success && json.data) {
        sugerenciasCache = json.data;
        sugerenciasCheckedIndexes.clear();

        // Render Sugerencias Rápida
        const searchValSug = document.getElementById('search-sugerencias-input')?.value || '';
        renderSugerenciasTabla(searchValSug);

        // Render Contrapartes Frecuentes
        const searchValFrec = document.getElementById('search-frecuentes-input')?.value || '';
        renderFrecuentesTabla(searchValFrec);
      }
    } catch (e) {
      console.error('Error cargando sugerencias:', e);
    }
  }

  // Listener para guardar sugerencia de clasificación rápida y abrir historial
  const tableSugerencias = document.getElementById('table-sugerencias-clasificacion');
  const modalHistorial = document.getElementById('modal-historial-persona');
  const modalHistorialNombre = document.getElementById('modal-historial-nombre');
  const modalHistorialSub = document.getElementById('modal-historial-sub');
  const tableModalHistorialBody = document.querySelector('#table-modal-historial tbody');
  const btnCerrarHistorial = document.getElementById('btn-cerrar-modal-historial');

  if (tableSugerencias) {
    // Escuchar eventos de cambio en checkboxes individuales de fila
    tableSugerencias.addEventListener('change', (e) => {
      const chk = e.target.closest('.chk-sug-item');
      if (chk) {
        const idx = parseInt(chk.getAttribute('data-idx') || '0', 10);
        if (chk.checked) {
          sugerenciasCheckedIndexes.add(idx);
        } else {
          sugerenciasCheckedIndexes.delete(idx);
        }
        actualizarBulkBarSugerencias();
        const chkSelectAll = document.getElementById('chk-sug-select-all');
        if (chkSelectAll) {
          chkSelectAll.checked = listSugFilteredCache.length > 0 && sugerenciasCheckedIndexes.size === listSugFilteredCache.length;
        }
        const row = chk.closest('tr');
        if (row) {
          row.style.background = chk.checked ? 'rgba(56, 189, 248, 0.08)' : '';
        }
      }
    });

    tableSugerencias.addEventListener('click', async (e) => {
      // Ver historial desde Sugerencias Rápida
      const btnHist = e.target.closest('.btn-ver-historial-sug');
      if (btnHist) {
        const sIdx = parseInt(btnHist.getAttribute('data-sidx') || '0', 10);
        const item = listSugFilteredCache[sIdx];
        if (item) {
          if (modalHistorialNombre) modalHistorialNombre.textContent = `📅 Historial Completo — 👤 ${item.contraparteNombre}`;
          if (modalHistorialSub) modalHistorialSub.textContent = `Total Transacciones Grandes/Anómalas: ${item.cantidadMovimientos} | Suma Total: Bs. ${item.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })} (${item.banco})`;

          if (tableModalHistorialBody) {
            tableModalHistorialBody.innerHTML = item.movimientos.map((m) => {
              const tipoMov = m.tipo || item.tipo;
              const esIngreso = tipoMov === 'INGRESO';
              return `
                <tr>
                  <td>${m.fechaTexto} ${m.hora && m.hora !== '00:00:00' ? m.hora : ''}</td>
                  <td><span class="badge badge-banco">${m.banco}</span></td>
                  <td><span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">${m.contraparteBanco || 'Mismo Banco'}</span></td>
                  <td><span class="badge ${esIngreso ? 'badge-ingreso' : 'badge-egreso'}">${tipoMov}</span></td>
                  <td class="text-right" style="font-weight: 700; color: ${esIngreso ? '#4ade80' : '#f87171'}; font-family: monospace;">
                    Bs. ${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                  </td>
                  <td>${m.glosaDetalle}</td>
                  <td><span class="badge">${m.motivoAnomalia || 'Sin clasificar'}</span></td>
                </tr>
              `;
            }).join('');
          }

          if (modalHistorial) modalHistorial.style.display = 'flex';
        }
        return;
      }

      // Guardar clasificación individual desde Sugerencias Rápida
      const btn = e.target.closest('.btn-save-sug');
      if (!btn) return;
      const name = btn.getAttribute('data-name');
      const banco = btn.getAttribute('data-banco');
      const bancoContraparte = btn.getAttribute('data-bancocontraparte');
      const tipo = btn.getAttribute('data-tipo');
      const idx = btn.getAttribute('data-idx');

      const select = tableSugerencias.querySelector(`.select-sug-cat[data-idx="${idx}"]`);
      const categoriaDestino = select ? select.value : undefined;

      try {
        btn.disabled = true;
        btn.textContent = 'Procesando...';

        const res = await fetch(`${API_BASE}/reglas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyword: name,
            banco: 'TODOS',
            bancoContraparte: bancoContraparte || undefined,
            accion: 'EXCLUIR_ANOMALIA',
            categoriaDestino,
            tipoTransaccion: tipo || 'TODOS',
            nota: `Clasificado desde Sugerencias Rápida`,
          }),
        });

        const json = await res.json();
        if (json.success) {
          cargarInfoGlobal();
          cargarResumenMensual();
          cargarAnomalias();
          cargarMovimientos(1);
          cargarReglas();
          cargarSugerencias();
        }
      } catch (err) {
        console.error('Error al guardar sugerencia:', err);
      }
    });
  }

  // Listener para ver historial de una persona desde Contrapartes Frecuentes
  const tableHistorial = document.getElementById('table-contrapartes-historial');
  if (tableHistorial) {
    tableHistorial.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-ver-historial-persona');
      if (!btn) return;
      const fIdx = parseInt(btn.getAttribute('data-fidx') || '0', 10);

      const searchVal = document.getElementById('search-frecuentes-input')?.value || '';
      let listFrec = sugerenciasCache ? (sugerenciasCache.contrapartesFrecuentes || []) : [];
      if (searchVal.trim() !== '') {
        const query = searchVal.trim().toLowerCase();
        listFrec = listFrec.filter((c) =>
          c.contraparteNombre.toLowerCase().includes(query) ||
          c.banco.toLowerCase().includes(query) ||
          String(c.totalMontoBs).includes(query)
        );
      }

      const item = listFrec[fIdx];
      if (item) {
        if (modalHistorialNombre) modalHistorialNombre.textContent = `📅 Historial Completo — 👤 ${item.contraparteNombre}`;
        if (modalHistorialSub) modalHistorialSub.textContent = `Total Transacciones: ${item.cantidadTransacciones} | Suma Total: Bs. ${item.totalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })} (${item.banco})`;

        if (tableModalHistorialBody) {
          tableModalHistorialBody.innerHTML = item.movimientos.map((m) => {
            const tipoMov = m.tipo || item.tipo;
            const esIngreso = tipoMov === 'INGRESO';
            return `
              <tr>
                <td>${m.fechaTexto} ${m.hora && m.hora !== '00:00:00' ? m.hora : ''}</td>
                <td><span class="badge badge-banco">${m.banco}</span></td>
                <td><span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">${m.contraparteBanco || 'Mismo Banco'}</span></td>
                <td><span class="badge ${esIngreso ? 'badge-ingreso' : 'badge-egreso'}">${tipoMov}</span></td>
                <td class="text-right" style="font-weight: 700; color: ${esIngreso ? '#4ade80' : '#f87171'};">
                  Bs. ${m.montoBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                </td>
                <td>${m.glosaDetalle}</td>
                <td><span class="badge">${m.categoria || 'Sin clasificar'}</span></td>
              </tr>
            `;
          }).join('');
        }

        if (modalHistorial) modalHistorial.style.display = 'flex';
      }
    });
  }

  if (btnCerrarHistorial && modalHistorial) {
    btnCerrarHistorial.addEventListener('click', () => {
      modalHistorial.style.display = 'none';
    });
  }

  // Modal Nueva Categoría Custom
  const modalNuevaCat = document.getElementById('modal-nueva-categoria');
  const btnAbrirModalCat = document.getElementById('btn-abrir-modal-categoria');
  const btnCerrarModalCat = document.getElementById('btn-cerrar-modal-cat');
  const btnCancelarModalCat = document.getElementById('btn-cancelar-modal-cat');
  const formCrearCat = document.getElementById('form-crear-categoria-custom');

  if (btnAbrirModalCat && modalNuevaCat) {
    btnAbrirModalCat.addEventListener('click', () => {
      modalNuevaCat.style.display = 'flex';
    });
  }

  const cerrarModalCat = () => {
    if (modalNuevaCat) modalNuevaCat.style.display = 'none';
  };

  if (btnCerrarModalCat) btnCerrarModalCat.addEventListener('click', cerrarModalCat);
  if (btnCancelarModalCat) btnCancelarModalCat.addEventListener('click', cerrarModalCat);

  if (formCrearCat) {
    formCrearCat.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombreVisible = document.getElementById('custom-cat-nombre')?.value;
      const tipo = document.getElementById('custom-cat-tipo')?.value;
      const icono = document.getElementById('custom-cat-icono')?.value;

      try {
        const res = await fetch(`${API_BASE}/categorias`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombreVisible, tipo, icono }),
        });

        const json = await res.json();
        if (json.success) {
          formCrearCat.reset();
          cerrarModalCat();
          await cargarCategoriasEnSelects();
          await cargarSugerencias();
        }
      } catch (err) {
        console.error('Error al crear categoría:', err);
      }
    });
  }

  // Cargar y Gestionar Reglas de Personas Conocidas
  async function cargarReglas() {
    const tableBody = document.querySelector('#table-reglas tbody');
    if (!tableBody) return;

    try {
      const res = await fetch(`${API_BASE}/reglas`);
      const json = await res.json();

      if (json.success && json.data && json.data.length > 0) {
        tableBody.innerHTML = json.data.map((r) => {
          const accionTxt = r.accion === 'EXCLUIR_ANOMALIA' 
            ? 'Excluir de Anomalías' 
            : 'Clasificar como Conocido';
          const catMeta = r.categoriaDestino ? (categoriasCache.find(c => c.id === r.categoriaDestino)?.nombreVisible || r.categoriaDestino) : 'Automática';
          const fechaStr = r.creadoEn ? new Date(r.creadoEn).toLocaleDateString('es-BO') : '-';

          return `
            <tr>
              <td><strong>${r.keyword}</strong></td>
              <td><span class="badge badge-banco">${r.banco || 'TODOS'}</span></td>
              <td><span class="badge badge-banco" style="background: rgba(56, 189, 248, 0.15); border-color: #38bdf8; color: #38bdf8;">${r.bancoContraparte || 'Todos los Bancos'}</span></td>
              <td><span class="badge badge-banco">${catMeta}</span></td>
              <td><span class="badge">${accionTxt}</span></td>
              <td>${r.nota || '-'}</td>
              <td>${fechaStr}</td>
              <td class="text-right">
                <button class="btn btn-danger btn-eliminar-regla" data-id="${r.id}" style="padding: 3px 8px; font-size: 0.75rem;">Eliminar</button>
              </td>
            </tr>
          `;
        }).join('');
      } else {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted);">No hay reglas de personas conocidas configuradas. Usa el formulario de arriba o las sugerencias para agregar.</td></tr>';
      }
    } catch (e) {
      console.error('Error al cargar reglas:', e);
    }
  }

  // Formulario de Agregar Regla
  const formAgregarRegla = document.getElementById('form-agregar-regla');
  if (formAgregarRegla) {
    formAgregarRegla.addEventListener('submit', async (e) => {
      e.preventDefault();
      const keyword = document.getElementById('regla-keyword')?.value;
      const banco = document.getElementById('regla-banco-select')?.value;
      const bancoContraparte = document.getElementById('regla-banco-contraparte')?.value;
      const categoriaDestino = document.getElementById('regla-categoria-select')?.value;
      const accion = document.getElementById('regla-accion')?.value;
      const nota = document.getElementById('regla-nota')?.value;

      try {
        const res = await fetch(`${API_BASE}/reglas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword, banco, bancoContraparte, accion, categoriaDestino, nota }),
        });

        const json = await res.json();
        if (json.success) {
          formAgregarRegla.reset();
          cargarReglas();
          cargarSugerencias();
          cargarInfoGlobal();
          cargarResumenMensual();
          cargarAnomalias();
          cargarMovimientos(1);
        }
      } catch (err) {
        console.error('Error al conectar con el servidor:', err);
      }
    });
  }

  // Eliminar Regla (Sin popups ni confirmaciones molestas)
  const tableReglas = document.getElementById('table-reglas');
  if (tableReglas) {
    tableReglas.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-eliminar-regla');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;

      try {
        const res = await fetch(`${API_BASE}/reglas/${id}`, { method: 'DELETE' });
        const json = await res.json();
        if (json.success) {
          cargarReglas();
          cargarSugerencias();
          cargarInfoGlobal();
          cargarResumenMensual();
          cargarAnomalias();
          cargarMovimientos(1);
        }
      } catch (err) {
        console.error('Error al eliminar regla:', err);
      }
    });
  }

  // Vaciar Datos sin popups molestas
  const btnVaciar = document.getElementById('btn-vaciar-bank');
  if (btnVaciar) {
    btnVaciar.addEventListener('click', async () => {
      try {
        const res = await fetch(`${API_BASE}/limpiar`, { method: 'POST' });
        const json = await res.json();
        if (json.success) {
          if (importStatus) importStatus.innerHTML = '<span style="color: #38bdf8;">🗑️ Base de datos de extractos bancarios vaciada exitosamente.</span>';
          cargarInfoGlobal();
          cargarResumenMensual();
          cargarAnomalias();
          cargarRecurrentes();
          cargarMovimientos(1);
          cargarReglas();
          cargarSugerencias();
        }
      } catch (e) {
        if (importStatus) importStatus.innerHTML = `<span style="color: #f87171;">❌ Error: ${e.message}</span>`;
      }
    });
  }

  async function refrescarTodoElSistema() {
    await cargarCategoriasEnSelects();
    cargarInfoGlobal();
    cargarResumenMensual();
    cargarAnomalias();
    cargarRecurrentes();
    cargarRespaldoResumen();
    cargarMovimientos(1);
    cargarReglas();
    cargarSugerencias();
  }

  // Inicializar todo el sistema al cargar la página
  refrescarTodoElSistema();
});
