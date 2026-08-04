document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = '/api/sales';

  // State
  let chartUnidades = null;
  let chartMonto = null;
  let ultimaProyeccion = null;

  // Sidebar Toggle & Persistence
  const appContainer = document.querySelector('.app-container');
  const toggleBtn = document.getElementById('btn-toggle-sidebar');
  const toggleTopBtn = document.getElementById('btn-toggle-sidebar-top');

  function toggleSidebar() {
    appContainer.classList.toggle('sidebar-collapsed');
    const isCollapsed = appContainer.classList.contains('sidebar-collapsed');
    localStorage.setItem('sales_sidebar_collapsed', isCollapsed ? 'true' : 'false');
  }

  if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar);
  if (toggleTopBtn) toggleTopBtn.addEventListener('click', toggleSidebar);

  const savedState = localStorage.getItem('sales_sidebar_collapsed');
  if (savedState === 'true' || savedState === null) {
    appContainer.classList.add('sidebar-collapsed');
  }

  // Tabs navigation
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const tabTitle = document.getElementById('current-tab-title');
  const tabSub = document.getElementById('current-tab-subtitle');

  const tabInfo = {
    'tab-importar': { title: 'Importador de Ventas & Productos', sub: 'Carga los archivos Excel exportados del POS para alimentar las métricas' },
    'tab-analisis': { title: 'Análisis Histórico de Ventas', sub: 'Métricas mensuales y trimestrales desglosadas por colegio, prenda y talla' },
    'tab-consolidado': { title: 'Registro Consolidado de Ventas', sub: 'Listado completo de ventas ordenado cronológicamente (de la más antigua a la más nueva)' },
    'tab-proyeccion': { title: 'Análisis de Tendencias', sub: 'Comparativa de ventas cruzadas entre colegios' },
    'tab-simulador': { title: 'Exportación de Datos en Excel', sub: 'Generador de reportes en formato compatible con Excel' },
  };

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');

      navBtns.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      document.getElementById(tabId).classList.add('active');

      if (tabInfo[tabId]) {
        tabTitle.textContent = tabInfo[tabId].title;
        tabSub.textContent = tabInfo[tabId].sub;
      }

      if (tabId === 'tab-analisis') cargarAnalytics();
      if (tabId === 'tab-consolidado') cargarRegistroConsolidado();
      if (tabId === 'tab-importar') cargarResumenColegios();
    });
  });

  // 1. File Upload Dropzone
  const dropzone = document.getElementById('dropzone-sales');
  const fileInput = document.getElementById('input-file-sales');
  const importStatus = document.getElementById('import-status');

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
      subirArchivo(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      subirArchivo(e.target.files[0]);
    }
  });

  async function subirArchivo(file) {
    const formData = new FormData();
    formData.append('archivo', file);

    importStatus.innerHTML = '<span style="color: var(--accent-secondary);">⏳ Procesando e importando ventas en la BD...</span>';

    try {
      const res = await fetch(`${API_BASE}/importar`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        importStatus.innerHTML = `<span style="color: var(--accent-green);">✅ ${data.message}</span>`;
        cargarResumenColegios();
      } else {
        importStatus.innerHTML = `<span style="color: #ef4444;">❌ Error: ${data.error}</span>`;
      }
    } catch (e) {
      importStatus.innerHTML = `<span style="color: #ef4444;">❌ Error de conexión: ${e.message}</span>`;
    }
  }

  // Cargar resumen de colegios (montos y unidades)
  async function cargarResumenColegios(colegioFiltro = '', anioFiltro = '') {
    const container = document.getElementById('colegios-list');
    const tableBody = document.querySelector('#table-montos-colegios tbody');
    const tableFoot = document.querySelector('#table-montos-colegios tfoot');

    try {
      let url = `${API_BASE}/colegios`;
      const params = new URLSearchParams();
      if (colegioFiltro) params.append('colegio', colegioFiltro);
      if (anioFiltro) params.append('anio', anioFiltro);
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.success && data.data.length > 0) {
        const colegios = data.data;

        // Calcular totales globales
        let montoTotalGlobal = 0;
        let unidadesTotalGlobal = 0;
        let filasTotalGlobal = 0;

        colegios.forEach((c) => {
          montoTotalGlobal += c.totalVentaBs || 0;
          unidadesTotalGlobal += c.totalUnidades || 0;
          filasTotalGlobal += c.totalFilas || 0;
        });

        // Actualizar tarjetas KPI
        const topColegio = colegios[0]?.colegioGrupo || '-';
        document.getElementById('kpi-total-monto').textContent = `Bs. ${Math.round(montoTotalGlobal).toLocaleString()}`;
        document.getElementById('kpi-top-colegio').textContent = topColegio;
        document.getElementById('kpi-total-unidades').textContent = `${Math.round(unidadesTotalGlobal).toLocaleString()} u.`;

        // Poblar dinámicamente selects de colegios
        poblarSelectsColegios(colegios);

        // Renderizar lista en Tab Importar
        if (container) {
          container.innerHTML = colegios.map((c) => `
            <div class="summary-item">
              <div>
                <strong>${c.colegioGrupo}</strong>
                <div style="font-size: 11px; color: var(--text-muted);">${c.totalFilas} registros de ventas</div>
              </div>
              <div style="text-align: right;">
                <span class="badge badge-green">${c.totalUnidades} u.</span>
                <div style="font-size: 12px; font-weight: 600; margin-top: 2px;">Bs. ${c.totalVentaBs.toLocaleString()}</div>
              </div>
            </div>
          `).join('');
        }

        // Renderizar Tabla de Montos por Colegio en Tab Análisis
        if (tableBody) {
          tableBody.innerHTML = colegios.map((c) => {
            const pct = montoTotalGlobal > 0 ? Math.round((c.totalVentaBs / montoTotalGlobal) * 1000) / 10 : 0;

            return `
              <tr>
                <td><strong>${c.colegioGrupo}</strong></td>
                <td><strong style="color: var(--accent-green); font-size: 13px;">Bs. ${c.totalVentaBs.toLocaleString()}</strong></td>
                <td><span class="badge badge-blue">${pct}%</span></td>
                <td><span class="badge badge-green">${c.totalUnidades} u.</span></td>
              </tr>
            `;
          }).join('');
        }

        // Renderizar Totalizados en tfoot
        if (tableFoot) {
          tableFoot.innerHTML = `
            <tr class="totals-row">
              <td><span class="totals-label-badge">TOTAL GENERAL</span></td>
              <td><strong style="color: var(--accent-green); font-size: 13.5px;">Bs. ${montoTotalGlobal.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
              <td><span class="badge badge-blue" style="font-size: 11px; font-weight: 700;">100%</span></td>
              <td><span class="badge badge-green" style="font-size: 11px; font-weight: 700;">${unidadesTotalGlobal.toLocaleString()} u.</span></td>
            </tr>
          `;
        }
      } else {
        if (container) container.innerHTML = '<p class="text-muted">No hay ventas cargadas aún. Sube tu archivo sales_export_*.xlsx arriba.</p>';
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="4" class="text-center">No hay datos de ventas registrados para los filtros seleccionados</td></tr>';
        if (tableFoot) tableFoot.innerHTML = '';
        document.getElementById('kpi-total-monto').textContent = 'Bs. 0';
        document.getElementById('kpi-top-colegio').textContent = '-';
        document.getElementById('kpi-total-unidades').textContent = '0 u.';
      }
    } catch (e) {
      if (container) container.innerHTML = '<p class="text-muted">Error al cargar colegios.</p>';
    }
  }

  function poblarSelectsColegios(colegios) {
    if (!Array.isArray(colegios) || colegios.length === 0) return;
    const listaNombres = colegios.map((c) => c.colegioGrupo).filter(Boolean);

    const selectFiltro = document.getElementById('filter-colegio-analisis');
    const selectOrigen = document.getElementById('proj-colegio-origen');
    const selectDestino = document.getElementById('proj-colegio-destino');

    if (selectFiltro) {
      const valActual = selectFiltro.value;
      selectFiltro.innerHTML = '<option value="">Todos los Colegios</option>' +
        listaNombres.map((n) => `<option value="${n}">${n}</option>`).join('');
      if (valActual && listaNombres.includes(valActual)) selectFiltro.value = valActual;
    }

    if (selectOrigen) {
      const valOrigen = selectOrigen.value || 'Cambridge';
      selectOrigen.innerHTML = listaNombres.map((n) => `<option value="${n}">${n}</option>`).join('');
      if (listaNombres.includes(valOrigen)) {
        selectOrigen.value = valOrigen;
      } else if (listaNombres.includes('Cambridge')) {
        selectOrigen.value = 'Cambridge';
      }
    }

    if (selectDestino) {
      const valDestino = selectDestino.value || 'Saint Jude';
      selectDestino.innerHTML = listaNombres.map((n) => `<option value="${n}">${n}</option>`).join('');
      if (listaNombres.includes(valDestino)) {
        selectDestino.value = valDestino;
      } else if (listaNombres.length > 1) {
        selectDestino.value = listaNombres[1];
      }
    }
  }

  // 2. Analytics & Chart Rendering
  document.getElementById('btn-aplicar-filtros-analisis').addEventListener('click', cargarAnalytics);

  async function cargarAnalytics() {
    const agrupacion = document.getElementById('filter-agrupacion').value;
    const colegio = document.getElementById('filter-colegio-analisis').value;
    const anio = document.getElementById('filter-anio-analisis').value;

    // Actualizar KPIs y tabla de montos por colegio
    cargarResumenColegios(colegio, anio);

    // Actualizar gráficos de período
    let url = `${API_BASE}/resumen-periodo?agrupacion=${agrupacion}`;
    if (colegio) url += `&colegio=${encodeURIComponent(colegio)}`;
    if (anio) url += `&anio=${anio}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        renderGraficos(data.data);
      }
    } catch (e) {
      console.error(e);
    }

    // Actualizar desglose por prendas y tallas
    cargarVentasPrenda(colegio, anio);
  }

  function renderGraficos(items) {
    const labels = Array.from(new Set(items.map((i) => i.periodo)));
    const colegios = Array.from(new Set(items.map((i) => i.colegioGrupo)));

    const datasetsUnidades = colegios.map((c, idx) => {
      const colors = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
      const color = colors[idx % colors.length];

      return {
        label: c,
        data: labels.map((p) => {
          const match = items.find((i) => i.periodo === p && i.colegioGrupo === c);
          return match ? match.totalUnidades : 0;
        }),
        backgroundColor: color,
        borderRadius: 6,
      };
    });

    const datasetsMonto = colegios.map((c, idx) => {
      const colors = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6'];
      const color = colors[idx % colors.length];

      return {
        label: c,
        data: labels.map((p) => {
          const match = items.find((i) => i.periodo === p && i.colegioGrupo === c);
          return match ? match.totalVentaBs : 0;
        }),
        backgroundColor: color,
        borderRadius: 6,
      };
    });

    // Chart Unidades
    const ctxU = document.getElementById('chart-ventas-unidades').getContext('2d');
    if (chartUnidades) chartUnidades.destroy();
    chartUnidades = new Chart(ctxU, {
      type: 'bar',
      data: { labels, datasets: datasetsUnidades },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8' } } } },
    });

    // Chart Monto
    const ctxM = document.getElementById('chart-ventas-monto').getContext('2d');
    if (chartMonto) chartMonto.destroy();
    chartMonto = new Chart(ctxM, {
      type: 'bar',
      data: { labels, datasets: datasetsMonto },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8' } } } },
    });
  }

  async function cargarVentasPrenda(colegio = '', anio = '') {
    const tableBody = document.querySelector('#table-ventas-prenda tbody');
    const tableFoot = document.querySelector('#table-ventas-prenda tfoot');
    let url = `${API_BASE}/ventas-prenda?colegio=${encodeURIComponent(colegio || '')}`;
    if (anio) url += `&anio=${anio}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.success && data.data.length > 0) {
        tableBody.innerHTML = data.data.map((p) => {
          const tallasBadges = Object.entries(p.desgloseTallas)
            .map(([t, c]) => {
              const tClean = t.replace(/^Talla\s*/i, '');
              return `<span class="badge-talla-compact" title="Talla ${t}: ${c} unidades"><strong>${tClean}</strong>:${c}u</span>`;
            })
            .join('');
          const tallasHtml = `<div class="tallas-badges-wrap">${tallasBadges}</div>`;

          return `
            <tr>
              <td><strong>${p.nombreLimpio}</strong></td>
              <td><span class="badge badge-purple" style="font-size: 11px;">${p.colegioGrupo}</span></td>
              <td><span class="badge badge-green">${p.totalUnidades} u.</span></td>
              <td><strong style="color: var(--accent-green); font-size: 13px;">Bs. ${p.totalVentaBs.toLocaleString()}</strong></td>
              <td>${tallasHtml}</td>
            </tr>
          `;
        }).join('');

        // Renderizar Totalizados en tfoot
        if (tableFoot) {
          let totalUnidadesPrendas = 0;
          let totalMontoPrendas = 0;
          const desgloseGlobalTallas = {};

          data.data.forEach((p) => {
            totalUnidadesPrendas += p.totalUnidades || 0;
            totalMontoPrendas += p.totalVentaBs || 0;
            Object.entries(p.desgloseTallas || {}).forEach(([t, c]) => {
              desgloseGlobalTallas[t] = (desgloseGlobalTallas[t] || 0) + (c || 0);
            });
          });

          const tallasGlobalBadges = Object.entries(desgloseGlobalTallas)
            .map(([t, c]) => {
              const tClean = t.replace(/^Talla\s*/i, '');
              return `<span class="badge-talla-compact" title="Talla ${t}: ${c} unidades"><strong>${tClean}</strong>:${c}u</span>`;
            })
            .join('');
          const tallasGlobalHtml = `<div class="tallas-badges-wrap">${tallasGlobalBadges}</div>`;

          tableFoot.innerHTML = `
            <tr class="totals-row">
              <td><span class="totals-label-badge">∑ TOTALES GLOBAL</span></td>
              <td><span class="badge badge-purple" style="font-size: 11px; font-weight: 700;">${data.data.length} prendas</span></td>
              <td><span class="badge badge-green" style="font-size: 11px; font-weight: 700;">${totalUnidadesPrendas.toLocaleString()} u.</span></td>
              <td><strong style="color: var(--accent-green); font-size: 13.5px;">Bs. ${totalMontoPrendas.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
              <td>${tallasGlobalHtml}</td>
            </tr>
          `;
        }
      } else {
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No se encontraron productos para los filtros seleccionados</td></tr>';
        if (tableFoot) tableFoot.innerHTML = '';
      }
    } catch (e) {
      console.error(e);
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Error al cargar prendas</td></tr>';
      if (tableFoot) tableFoot.innerHTML = '';
    }
  }

  // Impresión Directa a PDF/Impresora sin Modales ni Nuevas Pestañas
  function imprimirDirecto(url) {
    let printFrame = document.getElementById('hidden-print-iframe');
    if (!printFrame) {
      printFrame = document.createElement('iframe');
      printFrame.id = 'hidden-print-iframe';
      printFrame.style.display = 'none';
      document.body.appendChild(printFrame);
    }

    printFrame.onload = function() {
      setTimeout(() => {
        try {
          if (printFrame.contentWindow) {
            printFrame.contentWindow.focus();
            printFrame.contentWindow.print();
          }
        } catch (e) {
          console.error('Error al lanzar impresión:', e);
        }
      }, 350);
    };

    printFrame.src = url;
  }

  const btnPdfColegios = document.getElementById('btn-pdf-colegios');
  if (btnPdfColegios) {
    btnPdfColegios.addEventListener('click', () => {
      const colegio = document.getElementById('filter-colegio-analisis')?.value || '';
      const anio = document.getElementById('filter-anio-analisis')?.value || '';
      let url = `${API_BASE}/imprimir-colegios?colegio=${encodeURIComponent(colegio)}`;
      if (anio) url += `&anio=${anio}`;
      imprimirDirecto(url);
    });
  }

  const btnPdfPrendas = document.getElementById('btn-pdf-prendas');
  if (btnPdfPrendas) {
    btnPdfPrendas.addEventListener('click', () => {
      const colegio = document.getElementById('filter-colegio-analisis')?.value || '';
      const anio = document.getElementById('filter-anio-analisis')?.value || '';
      let url = `${API_BASE}/imprimir-prendas?colegio=${encodeURIComponent(colegio)}`;
      if (anio) url += `&anio=${anio}`;
      imprimirDirecto(url);
    });
  }

  // 3. Proyección Inteligente
  document.getElementById('btn-calcular-proyeccion').addEventListener('click', async () => {
    const colegioOrigen = document.getElementById('proj-colegio-origen').value;
    const colegioDestino = document.getElementById('proj-colegio-destino').value;
    const anio = document.getElementById('proj-anio').value;
    const trimestre = document.getElementById('proj-trimestre').value;
    const factorEscalaAlumnos = document.getElementById('proj-factor-escala').value;
    const factorCrecimientoPct = document.getElementById('proj-factor-crecimiento').value;

    const btn = document.getElementById('btn-calcular-proyeccion');
    btn.disabled = true;
    btn.textContent = '⏳ Calculando Similitud y Proyección...';

    try {
      const res = await fetch(`${API_BASE}/proyectar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colegioOrigen,
          colegioDestino,
          anio,
          trimestre,
          factorEscalaAlumnos,
          factorCrecimientoPct,
        }),
      });

      const data = await res.json();
      if (data.success) {
        ultimaProyeccion = data.data;
        mostrarResultadosProyeccion(data.data);
      } else {
        alert('Error: ' + data.error);
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '🚀 Calcular Proyección Inteligente';
    }
  });

  function mostrarResultadosProyeccion(p) {
    document.getElementById('projection-results').classList.remove('hidden');

    document.getElementById('val-unidades-origen').textContent = `${p.totalUnidadesOrigen} u.`;
    document.getElementById('val-unidades-proyectadas').textContent = `${p.totalUnidadesProyectadas} u.`;
    document.getElementById('val-monto-proyectado').textContent = `Bs. ${p.totalVentaBsProyectada.toLocaleString()}`;

    // Actualizar caja informativa en Tab Simulador
    const infoBox = document.getElementById('sim-proyeccion-info');
    if (infoBox) {
      infoBox.innerHTML = `
        <span style="color: var(--accent-green);">🟢 <strong>Simulación Activa Lista:</strong> Tomando proyección calculada de <strong>${p.colegioOrigen} ➔ ${p.colegioDestino}</strong> (${p.totalUnidadesProyectadas.toLocaleString()} u. proyectadas en ${p.mapeos.length} prendas).</span>
      `;
    }

    const tableBody = document.querySelector('#table-proyeccion-mapeos tbody');
    tableBody.innerHTML = p.mapeos.map((m) => {
      const tallasBadges = Object.entries(m.tallasDesglose)
        .map(([t, c]) => {
          const tClean = t.replace(/^Talla\s*/i, '');
          return `<span class="badge-talla-compact" title="Talla ${t}: ${c} unidades"><strong>${tClean}</strong>:${c}u</span>`;
        })
        .join('');
      const tallasHtml = `<div class="tallas-badges-wrap">${tallasBadges}</div>`;

      return `
        <tr>
          <td><strong>${m.prendaOrigen}</strong></td>
          <td><span style="color: var(--accent-secondary); font-weight: 600;">${m.prendaDestino}</span></td>
          <td><span class="badge badge-blue">${m.similaridadPct}% similitud</span></td>
          <td>${m.unidadesHistoricasOrigen} u.</td>
          <td>Bs. ${m.precioEstDestino}</td>
          <td>${tallasHtml}</td>
        </tr>
      `;
    }).join('');
  }

  async function ejecutarExportacionExcel() {
    const colegioOrigen = document.getElementById('proj-colegio-origen').value;
    const colegioDestino = document.getElementById('proj-colegio-destino').value;
    const anio = document.getElementById('proj-anio').value;
    const trimestre = document.getElementById('proj-trimestre').value;
    const factorEscalaAlumnos = document.getElementById('proj-factor-escala').value;
    const factorCrecimientoPct = document.getElementById('proj-factor-crecimiento').value;

    const vendedorNombre = document.getElementById('sim-vendedor').value;
    const nPedidoInicial = document.getElementById('sim-npedido').value;
    const fechaInicioIso = document.getElementById('sim-fecha-inicio').value;
    const fechaFinIso = document.getElementById('sim-fecha-fin').value;

    const btns = [
      document.getElementById('btn-exportar-excel-simulado'),
      document.getElementById('btn-exportar-proyeccion-excel')
    ].filter(Boolean);

    btns.forEach((b) => {
      b.disabled = true;
      b.textContent = '⏳ Generando Excel Simulado...';
    });

    try {
      const res = await fetch(`${API_BASE}/exportar-ventas-simuladas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proyeccion: ultimaProyeccion || undefined,
          colegioOrigen,
          colegioDestino,
          anio,
          trimestre,
          factorEscalaAlumnos,
          factorCrecimientoPct,
          vendedorNombre,
          nPedidoInicial,
          fechaInicioIso,
          fechaFinIso,
        }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sales_export_simulado_${colegioDestino}_${vendedorNombre.replace(/\s+/g, '_')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const err = await res.json();
        alert('Error al generar Excel: ' + err.error);
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    } finally {
      const b1 = document.getElementById('btn-exportar-excel-simulado');
      if (b1) {
        b1.disabled = false;
        b1.textContent = '📥 Descargar sales_export_simulado.xlsx';
      }
      const b2 = document.getElementById('btn-exportar-proyeccion-excel');
      if (b2) {
        b2.disabled = false;
        b2.textContent = '📥 Exportar esta Simulación a Excel (.xlsx)';
      }
    }
  }

  // Event Listeners para exportación a Excel
  const btnExportarSim = document.getElementById('btn-exportar-excel-simulado');
  if (btnExportarSim) btnExportarSim.addEventListener('click', ejecutarExportacionExcel);

  const btnExportarProy = document.getElementById('btn-exportar-proyeccion-excel');
  if (btnExportarProy) btnExportarProy.addEventListener('click', ejecutarExportacionExcel);

  // Botón Vaciar Datos
  document.getElementById('btn-vaciar-datos').addEventListener('click', async () => {
    if (!confirm('⚠️ ¿Estás seguro de vaciar todos los registros de ventas importados de la base de datos?')) {
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/limpiar`, { method: 'POST' });
      const rawText = await res.text();
      let data = {};
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        data = { success: res.ok, message: rawText };
      }

      if (data.success || res.ok) {
        alert('✅ Base de datos de ventas vaciada con éxito.');
        cargarResumenColegios();
        cargarAnalytics();
      } else {
        alert('Error al vaciar: ' + (data.error || data.message || rawText));
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    }
  });

  // 4. REGISTRO CONSOLIDADO DE VENTAS
  let paginaActualConsolidado = 1;

  async function cargarRegistroConsolidado(colegioFiltro, anioFiltro, page = 1) {
    paginaActualConsolidado = page;
    const tableBody = document.querySelector('#table-registro-consolidado tbody');
    const tableFoot = document.querySelector('#table-registro-consolidado tfoot');
    const lblTotal = document.getElementById('lbl-total-filas-consolidado');
    const paginationControls = document.getElementById('pagination-controls-consolidado');
    const limitSelect = document.getElementById('select-limit-consolidado');

    const colegio = colegioFiltro !== undefined ? colegioFiltro : (document.getElementById('filter-colegio-consolidado')?.value || '');
    const anio = anioFiltro !== undefined ? anioFiltro : (document.getElementById('filter-anio-consolidado')?.value || '2026');
    const limit = limitSelect ? parseInt(limitSelect.value, 10) : 25;

    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="11" class="text-center">Cargando página...</td></tr>';

    try {
      let url = `${API_BASE}/consolidado?colegio=${encodeURIComponent(colegio)}&page=${page}&limit=${limit}`;
      if (anio) url += `&anio=${anio}`;

      const res = await fetch(url);
      const data = await res.json();

      if (data.success && data.data && data.data.length > 0) {
        if (lblTotal) lblTotal.textContent = `${data.count} registros (Página ${data.page} de ${data.totalPages})`;

        tableBody.innerHTML = data.data.map((v) => `
          <tr>
            <td class="text-center"><strong>${v.nPedido}</strong></td>
            <td><span class="badge badge-green">${v.estado}</span></td>
            <td style="white-space: nowrap;">${v.fecha}</td>
            <td>${v.usuario}</td>
            <td>${v.cliente}</td>
            <td>${v.nroDoc}</td>
            <td><strong>${v.nombreProducto}</strong></td>
            <td class="text-right">${String(Math.round(v.cantidad)).padStart(2, '0')}</td>
            <td class="text-right">Bs. ${v.precioUnitario.toFixed(1)}</td>
            <td class="text-right">Bs. ${v.totalDescuento.toFixed(1)}</td>
            <td class="text-right"><strong style="color: var(--accent-green);">Bs. ${v.totalCobrado.toFixed(1)}</strong></td>
          </tr>
        `).join('');

        if (tableFoot) {
          tableFoot.innerHTML = `
            <tr class="totals-row">
              <td colspan="7"><strong>TOTAL GENERAL (${data.count} registros)</strong></td>
              <td class="text-right"><strong>${data.totales.totalUnidades} u.</strong></td>
              <td class="text-right">-</td>
              <td class="text-right"><strong>Bs. ${data.totales.totalDescuento.toFixed(1)}</strong></td>
              <td class="text-right"><strong style="color: var(--accent-green); font-size: 13.5px;">Bs. ${data.totales.totalCobrado.toLocaleString('es-BO', { minimumFractionDigits: 2 })}</strong></td>
            </tr>
          `;
        }

        // Renderizar controles de paginación
        if (paginationControls) {
          const prevDisabled = data.page <= 1 ? 'disabled' : '';
          const nextDisabled = data.page >= data.totalPages ? 'disabled' : '';

          paginationControls.innerHTML = `
            <button class="btn btn-sm btn-secondary" id="btn-prev-consolidado" ${prevDisabled}>◀ Anterior</button>
            <span style="font-size: 13px; font-weight: 600; padding: 0 8px; color: var(--text-primary);">Página ${data.page} de ${data.totalPages}</span>
            <button class="btn btn-sm btn-secondary" id="btn-next-consolidado" ${nextDisabled}>Siguiente ▶</button>
          `;

          const btnPrev = document.getElementById('btn-prev-consolidado');
          if (btnPrev && !prevDisabled) {
            btnPrev.addEventListener('click', () => {
              cargarRegistroConsolidado(colegio, anio, data.page - 1);
            });
          }

          const btnNext = document.getElementById('btn-next-consolidado');
          if (btnNext && !nextDisabled) {
            btnNext.addEventListener('click', () => {
              cargarRegistroConsolidado(colegio, anio, data.page + 1);
            });
          }
        }
      } else {
        if (lblTotal) lblTotal.textContent = '0 registros';
        tableBody.innerHTML = '<tr><td colspan="11" class="text-center">No hay registros de ventas para los filtros seleccionados</td></tr>';
        if (tableFoot) tableFoot.innerHTML = '';
        if (paginationControls) paginationControls.innerHTML = '';
      }
    } catch (e) {
      tableBody.innerHTML = `<tr><td colspan="11" class="text-center text-muted">Error al cargar consolidado: ${e.message}</td></tr>`;
    }
  }

  const limitSelectConsolidado = document.getElementById('select-limit-consolidado');
  if (limitSelectConsolidado) {
    limitSelectConsolidado.addEventListener('change', () => {
      const colegio = document.getElementById('filter-colegio-consolidado')?.value || '';
      const anio = document.getElementById('filter-anio-consolidado')?.value || '';
      cargarRegistroConsolidado(colegio, anio, 1);
    });
  }

  const btnFiltroConsolidado = document.getElementById('btn-aplicar-filtros-consolidado');
  if (btnFiltroConsolidado) {
    btnFiltroConsolidado.addEventListener('click', () => {
      const colegio = document.getElementById('filter-colegio-consolidado')?.value || '';
      const anio = document.getElementById('filter-anio-consolidado')?.value || '';
      cargarRegistroConsolidado(colegio, anio, 1);
    });
  }

  const btnExcelConsolidado = document.getElementById('btn-excel-consolidado');
  if (btnExcelConsolidado) {
    btnExcelConsolidado.addEventListener('click', () => {
      const colegio = document.getElementById('filter-colegio-consolidado')?.value || '';
      const anio = document.getElementById('filter-anio-consolidado')?.value || '';
      let url = `${API_BASE}/exportar-consolidado-excel?colegio=${encodeURIComponent(colegio)}`;
      if (anio) url += `&anio=${anio}`;
      window.location.href = url;
    });
  }

  const btnPdfConsolidado = document.getElementById('btn-pdf-consolidado');
  if (btnPdfConsolidado) {
    btnPdfConsolidado.addEventListener('click', () => {
      const colegio = document.getElementById('filter-colegio-consolidado')?.value || '';
      const anio = document.getElementById('filter-anio-consolidado')?.value || '';
      let url = `${API_BASE}/imprimir-consolidado?colegio=${encodeURIComponent(colegio)}`;
      if (anio) url += `&anio=${anio}`;
      imprimirDirecto(url);
    });
  }

  const btnPdfResumenMensual = document.getElementById('btn-pdf-resumen-mensual');
  if (btnPdfResumenMensual) {
    btnPdfResumenMensual.addEventListener('click', () => {
      const anio = document.getElementById('filter-anio-consolidado')?.value || '2026';
      let url = `${API_BASE}/imprimir-resumen-mensual?anio=${anio}`;
      imprimirDirecto(url);
    });
  }

  // Liquidación de Pagos a Confeccionistas
  async function cargarLiquidacionTalleristas() {
    const talleristaSelect = document.getElementById('filter-tallerista');
    const origenSelect = document.getElementById('filter-tallerista-origen');
    const tableBody = document.querySelector('#table-talleristas tbody');
    const tableFoot = document.querySelector('#table-talleristas tfoot');
    const lblUnidades = document.getElementById('lbl-talleristas-unidades');
    const lblMontoBs = document.getElementById('lbl-talleristas-monto-bs');
    const lblCount = document.getElementById('lbl-talleristas-count');
    const lblCriterioSub = document.getElementById('lbl-talleristas-criterio-sub');

    const tallerista = talleristaSelect ? talleristaSelect.value : 'todos';
    const origen = origenSelect ? origenSelect.value : 'total';

    if (lblCriterioSub) {
      lblCriterioSub.textContent = origen === 'total' ? 'Total (Ventas + Stock)' : (origen === 'ventas' ? 'Solo Unidades Vendidas' : 'Solo Stock Actual');
    }

    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="9" class="text-center">Cargando liquidación de confeccionistas...</td></tr>';

    try {
      const res = await fetch(`${API_BASE}/talleristas?tallerista=${encodeURIComponent(tallerista)}&origen=${origen}&anio=2026`);
      const json = await res.json();

      if (!json.success || !json.data) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Error al cargar liquidación.</td></tr>';
        return;
      }

      if (lblUnidades) lblUnidades.textContent = (json.kpis.totalUnidadesGlobal || 0).toLocaleString() + ' u.';
      if (lblMontoBs) lblMontoBs.textContent = 'Bs. ' + (json.kpis.montoTotalGlobalBs || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (lblCount) lblCount.textContent = json.kpis.totalTalleristas || 0;

      const grupos = json.data;
      if (grupos.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="9" class="text-center">No se encontraron prendas para este confeccionista.</td></tr>';
        if (tableFoot) tableFoot.innerHTML = '';
        return;
      }

      let rowsHtml = '';
      let globalUnidades = 0;
      let globalMontoBs = 0;

      grupos.forEach((grupo) => {
        rowsHtml += `
          <tr style="background: rgba(15, 76, 129, 0.25); font-weight: 800; border-top: 2px solid var(--accent-primary);">
            <td colspan="9" style="color: var(--accent-primary); font-size: 14px; padding: 10px 12px;">
              🧵 TALLERISTA / ESPECIALIDAD: ${grupo.confeccionista.toUpperCase()} — Total: ${grupo.totalUnidades.toLocaleString()} u. | Bs. ${grupo.montoTotalBs.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
            </td>
          </tr>
        `;

        grupo.prendas.forEach((p, idx) => {
          globalUnidades += p.unidadesTotal;
          globalMontoBs += p.montoPagarBs;

          const optionsConf = [
            'Camisero',
            'Polerero / Deportivo',
            'Chamarrero',
            'Pantalonero',
            'Otros Confeccionistas'
          ].map(c => `<option value="${c}" ${p.confeccionista === c ? 'selected' : ''}>${c}</option>`).join('');

          rowsHtml += `
            <tr>
              <td class="text-center" style="font-weight:600;">${idx + 1}</td>
              <td><strong>${p.descripcion}</strong></td>
              <td><span class="badge" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-main); font-size: 11px;">${p.colegioGrupo}</span></td>
              <td>
                <select class="select-input" style="padding: 3px 6px; font-size: 12px; width: 100%; font-weight: 600;" onchange="window.reasignarConfeccionistaLive('${p.productoId}', this.value)">
                  ${optionsConf}
                </select>
              </td>
              <td class="text-right">${p.cantGrupo1} u. <small style="color:var(--text-secondary);">(Bs.${p.rateGrupo1})</small></td>
              <td class="text-right">${p.cantGrupo2} u. <small style="color:var(--text-secondary);">(Bs.${p.rateGrupo2})</small></td>
              <td class="text-right">${p.cantGrupo3} u. <small style="color:var(--text-secondary);">(Bs.${p.rateGrupo3})</small></td>
              <td class="text-right"><strong>${p.unidadesTotal}</strong></td>
              <td class="text-right text-success" style="font-weight: 800;">Bs. ${p.montoPagarBs.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
          `;
        });
      });

      tableBody.innerHTML = rowsHtml;

      if (tableFoot) {
        tableFoot.innerHTML = `
          <tr style="background: rgba(15, 76, 129, 0.35); font-weight: 800; font-size: 14px;">
            <td colspan="3">TOTAL GENERAL A CANCELAR EN COSTURA EXTERNA</td>
            <td colspan="4" class="text-right">${globalUnidades.toLocaleString()} u. confeccionadas</td>
            <td colspan="2" class="text-right text-success" style="font-size: 15px;">Bs. ${globalMontoBs.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          </tr>
        `;
      }
    } catch (err) {
      console.error('Error al cargar liquidación de confeccionistas:', err);
      tableBody.innerHTML = '<tr><td colspan="9" class="text-center text-danger">Error de conexión al obtener talleristas.</td></tr>';
    }
  }

  window.reasignarConfeccionistaLive = async function(productoId, confeccionista) {
    try {
      const res = await fetch(`${API_BASE}/talleristas/asignar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productoId, confeccionista })
      });
      const json = await res.json();
      if (json.success) {
        cargarLiquidacionTalleristas();
      } else {
        alert('Error al asignar confeccionista: ' + (json.error || 'Desconocido'));
      }
    } catch (e) {
      console.error('Error reasignando confeccionista:', e);
    }
  };

  const filterTallerista = document.getElementById('filter-tallerista');
  if (filterTallerista) filterTallerista.addEventListener('change', cargarLiquidacionTalleristas);

  const filterTalleristaOrigen = document.getElementById('filter-tallerista-origen');
  if (filterTalleristaOrigen) filterTalleristaOrigen.addEventListener('change', cargarLiquidacionTalleristas);

  const btnImprimirTalleristas = document.getElementById('btn-imprimir-talleristas');
  if (btnImprimirTalleristas) {
    btnImprimirTalleristas.addEventListener('click', () => {
      const tallerista = document.getElementById('filter-tallerista')?.value || 'todos';
      const origen = document.getElementById('filter-tallerista-origen')?.value || 'total';
      let url = `${API_BASE}/imprimir-talleristas?tallerista=${encodeURIComponent(tallerista)}&origen=${origen}&anio=2026`;
      imprimirDirecto(url);
    });
  }

  // Hook para cargar cuando se abre la pestaña de talleristas
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.getAttribute('data-tab') === 'tab-talleristas') {
        cargarLiquidacionTalleristas();
      }
    });
  });

  // Botón Actualizar
  document.getElementById('btn-refresh-stats').addEventListener('click', () => {
    cargarResumenColegios();
    cargarAnalytics();
    cargarRegistroConsolidado();
    cargarLiquidacionTalleristas();
  });

  // Inicial
  cargarResumenColegios();
  cargarAnalytics();
  cargarRegistroConsolidado();
  cargarLiquidacionTalleristas();
});
