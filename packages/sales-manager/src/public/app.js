document.addEventListener('DOMContentLoaded', () => {
  const API_BASE = '/api/sales';

  // State
  let chartUnidades = null;
  let chartMonto = null;
  let ultimaProyeccion = null;

  // Tabs navigation
  const navBtns = document.querySelectorAll('.nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const tabTitle = document.getElementById('current-tab-title');
  const tabSub = document.getElementById('current-tab-subtitle');

  const tabInfo = {
    'tab-importar': { title: 'Importador de Ventas & Productos', sub: 'Carga los archivos Excel exportados del POS para alimentar las métricas' },
    'tab-analisis': { title: 'Análisis Histórico de Ventas', sub: 'Métricas mensuales y trimestrales desglosadas por colegio, prenda y talla' },
    'tab-proyeccion': { title: 'Proyección Inteligente entre Colegios', sub: 'Simulación de ventas cruzadas (ej. San Marcos → Cambridge)' },
    'tab-simulador': { title: 'Simulador & Exportación en Excel', sub: 'Generador de reportes de ventas simuladas en formato idéntico a sales_export_*.xlsx' },
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

        colegios.forEach((c) => {
          montoTotalGlobal += c.totalVentaBs || 0;
          unidadesTotalGlobal += c.totalUnidades || 0;
        });

        // Actualizar tarjetas KPI
        const topColegio = colegios[0]?.colegioGrupo || '-';
        document.getElementById('kpi-total-monto').textContent = `Bs. ${Math.round(montoTotalGlobal).toLocaleString()}`;
        document.getElementById('kpi-top-colegio').textContent = topColegio;
        document.getElementById('kpi-total-unidades').textContent = `${Math.round(unidadesTotalGlobal).toLocaleString()} u.`;

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
            const precioProm = c.totalUnidades > 0 ? Math.round((c.totalVentaBs / c.totalUnidades) * 100) / 100 : 0;

            return `
              <tr>
                <td><strong>${c.colegioGrupo}</strong></td>
                <td><strong style="color: var(--accent-green); font-size: 15px;">Bs. ${c.totalVentaBs.toLocaleString()}</strong></td>
                <td><span class="badge badge-blue">${pct}%</span></td>
                <td><span class="badge badge-green">${c.totalUnidades} u.</span></td>
                <td>Bs. ${precioProm}</td>
                <td>${c.totalFilas} registros</td>
              </tr>
            `;
          }).join('');
        }
      } else {
        if (container) container.innerHTML = '<p class="text-muted">No hay ventas cargadas aún. Sube tu archivo sales_export_*.xlsx arriba.</p>';
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No hay datos de ventas registrados para los filtros seleccionados</td></tr>';
        document.getElementById('kpi-total-monto').textContent = 'Bs. 0';
        document.getElementById('kpi-top-colegio').textContent = '-';
        document.getElementById('kpi-total-unidades').textContent = '0 u.';
      }
    } catch (e) {
      if (container) container.innerHTML = '<p class="text-muted">Error al cargar colegios.</p>';
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
    let url = `${API_BASE}/ventas-prenda?colegio=${encodeURIComponent(colegio || '')}`;
    if (anio) url += `&anio=${anio}`;

    try {
      const res = await fetch(url);
      const data = await res.json();

      if (data.success && data.data.length > 0) {
        tableBody.innerHTML = data.data.map((p) => {
          const tallasStr = Object.entries(p.desgloseTallas)
            .map(([t, c]) => `<span class="badge badge-blue">Talla ${t}: ${c}u</span>`)
            .join(' ');

          return `
            <tr>
              <td><strong>${p.nombreLimpio}</strong></td>
              <td><span class="badge badge-purple" style="font-size: 11px;">${p.colegioGrupo}</span></td>
              <td><span class="badge badge-green">${p.totalUnidades} u.</span></td>
              <td><strong style="color: var(--accent-green); font-size: 14px;">Bs. ${p.totalVentaBs.toLocaleString()}</strong></td>
              <td>${tallasStr}</td>
            </tr>
          `;
        }).join('');
      } else {
        tableBody.innerHTML = '<tr><td colspan="5" class="text-center">No se encontraron productos para los filtros seleccionados</td></tr>';
      }
    } catch (e) {
      console.error(e);
      if (tableBody) tableBody.innerHTML = '<tr><td colspan="5" class="text-center">Error al cargar prendas</td></tr>';
    }
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

    const tableBody = document.querySelector('#table-proyeccion-mapeos tbody');
    tableBody.innerHTML = p.mapeos.map((m) => {
      const tallasStr = Object.entries(m.tallasDesglose)
        .map(([t, c]) => `<span class="badge badge-green">Talla ${t}: ${c} u.</span>`)
        .join(' ');

      return `
        <tr>
          <td><strong>${m.prendaOrigen}</strong></td>
          <td><span style="color: var(--accent-secondary); font-weight: 600;">${m.prendaDestino}</span></td>
          <td><span class="badge badge-blue">${m.similaridadPct}% similitud</span></td>
          <td>${m.unidadesHistoricasOrigen} u.</td>
          <td>Bs. ${m.precioEstDestino}</td>
          <td>${tallasStr}</td>
        </tr>
      `;
    }).join('');
  }

  // 4. Exportador de Ventas Simuladas Excel
  document.getElementById('btn-exportar-excel-simulado').addEventListener('click', async () => {
    const colegioOrigen = document.getElementById('proj-colegio-origen').value;
    const colegioDestino = document.getElementById('proj-colegio-destino').value;
    const anio = document.getElementById('proj-anio').value;
    const trimestre = document.getElementById('proj-trimestre').value;

    const vendedorNombre = document.getElementById('sim-vendedor').value;
    const nPedidoInicial = document.getElementById('sim-npedido').value;
    const fechaInicioIso = document.getElementById('sim-fecha-inicio').value;
    const fechaFinIso = document.getElementById('sim-fecha-fin').value;

    const btn = document.getElementById('btn-exportar-excel-simulado');
    btn.disabled = true;
    btn.textContent = '⏳ Generando Excel Simulado...';

    try {
      const res = await fetch(`${API_BASE}/exportar-ventas-simuladas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colegioOrigen,
          colegioDestino,
          anio,
          trimestre,
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
      btn.disabled = false;
      btn.textContent = '📥 Descargar sales_export_simulado.xlsx';
    }
  });

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

  // Botón Actualizar
  document.getElementById('btn-refresh-stats').addEventListener('click', () => {
    cargarResumenColegios();
    cargarAnalytics();
  });

  // Inicial
  cargarResumenColegios();
  cargarAnalytics();
});
