document.addEventListener('DOMContentLoaded', () => {
  // Escape untrusted values before interpolating into HTML templates
  const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

  // App State
  let currentUser = null;
  let beneficiariesData = [];
  let selectedBeneficiaryIds = new Set();
  let pagination = { limit: 10, offset: 0, total: 0 };
  let currentFilters = {};

  // DOM Elements
  const loginView = document.getElementById('login-view');
  const appView = document.getElementById('app-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  
  const sidebarNav = document.querySelector('.sidebar-nav');
  const navItems = document.querySelectorAll('.nav-item');
  const tabViews = document.querySelectorAll('.tab-view');
  const pageTitle = document.getElementById('page-title');
  const systemTimeEl = document.getElementById('system-time');
  const btnLogout = document.getElementById('btn-logout');

  // Stats Elements
  const statTotal = document.getElementById('stat-total');
  const statActive = document.getElementById('stat-active');
  const statInactive = document.getElementById('stat-inactive');
  const statRevoked = document.getElementById('stat-revoked');

  // Beneficiary Grid Elements
  const searchInput = document.getElementById('search-input');
  const btnToggleFilters = document.getElementById('btn-toggle-filters');
  const filtersPanel = document.getElementById('filters-panel');
  const btnClearFilters = document.getElementById('btn-clear-filters');
  const btnApplyFilters = document.getElementById('btn-apply-filters');
  const beneficiariesList = document.getElementById('beneficiaries-list');
  const paginationInfo = document.getElementById('pagination-info');
  const btnPrevPage = document.getElementById('btn-prev-page');
  const btnNextPage = document.getElementById('btn-next-page');
  const checkboxSelectAll = document.getElementById('checkbox-select-all');
  const btnBulkDownload = document.getElementById('btn-bulk-download');
  const selectedCountEl = document.getElementById('selected-count');

  // Modals Elements
  const modalBeneficiary = document.getElementById('modal-beneficiary');
  const btnAddBeneficiary = document.getElementById('btn-add-beneficiary');
  const btnCloseBeneficiaryModal = document.getElementById('btn-close-beneficiary-modal');
  const btnCancelBeneficiaryModal = document.getElementById('btn-cancel-beneficiary-modal');
  const beneficiaryForm = document.getElementById('beneficiary-form');
  const modalBeneficiaryTitle = document.getElementById('modal-beneficiary-title');
  const formAlert = document.getElementById('form-alert');

  // Form inputs
  const formId = document.getElementById('beneficiary-id');
  const formPhotoInput = document.getElementById('form-photo-input');
  const formPhotoPreview = document.getElementById('form-photo-preview');
  const formPhotoSilhouette = document.getElementById('form-photo-silhouette');

  // Import Modal Elements
  const modalImport = document.getElementById('modal-import');
  const btnImportMassive = document.getElementById('btn-import-massive');
  const btnCloseImportModal = document.getElementById('btn-close-import-modal');
  const btnCancelImportModal = document.getElementById('btn-cancel-import-modal');
  const dropzone = document.getElementById('dropzone');
  const importFileInput = document.getElementById('import-file-input');
  const importFilename = document.getElementById('import-filename');
  const btnExecuteImport = document.getElementById('btn-execute-import');
  const importProgress = document.getElementById('import-progress');
  const importResults = document.getElementById('import-results');
  const importResultsTitle = document.getElementById('import-results-title');
  const importLog = document.getElementById('import-log');

  // Audits Sub-Tabs
  const subnavItems = document.querySelectorAll('.subnav-item');
  const subtabViews = document.querySelectorAll('.subtab-view');
  const auditChangesList = document.getElementById('audit-changes-list');
  const auditScansList = document.getElementById('audit-scans-list');

  // ==================== INITIALIZATION & TICKERS ====================
  // Live clock ticker
  function updateTime() {
    const now = new Date();
    const options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };
    systemTimeEl.textContent = now.toLocaleDateString('es-CO', options);
  }
  updateTime();
  setInterval(updateTime, 60000);

  // Check user session
  checkSession();

  function checkSession() {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.user) {
          setupAppSession(data.user);
        } else {
          showLoginView();
        }
      })
      .catch(() => {
        showLoginView();
      });
  }

  function setupAppSession(user) {
    currentUser = user;
    document.getElementById('session-user-name').textContent = user.full_name;
    // Set avatar initials
    const initials = user.full_name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
    document.getElementById('user-avatar-initials').textContent = initials || 'AD';

    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    
    // Default start view
    triggerTabChange('view-dashboard');
    loadFilterOptions();
  }

  function showLoginView() {
    currentUser = null;
    appView.classList.add('hidden');
    loginView.classList.remove('hidden');
  }

  // ==================== LOGIN / LOGOUT ====================
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    
    const username = loginForm.username.value;
    const password = loginForm.password.value;

    fetch('/api/auth/login', {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success && data.user) {
        setupAppSession(data.user);
        loginForm.reset();
      } else {
        loginError.textContent = data.message || 'Error al iniciar sesión.';
        loginError.classList.remove('hidden');
      }
    })
    .catch(() => {
      loginError.textContent = 'No se pudo conectar con el servidor.';
      loginError.classList.remove('hidden');
    });
  });

  btnLogout.addEventListener('click', () => {
    fetch('/api/auth/logout', { credentials: 'include', method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showLoginView();
        }
      })
      .catch(() => showLoginView());
  });

  // ==================== NAV SWAPPING (SPA) ====================
  sidebarNav.addEventListener('click', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item) return;

    navItems.forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const target = item.dataset.target;
    triggerTabChange(target);
  });

  function triggerTabChange(viewId) {
    tabViews.forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');

    if (viewId === 'view-dashboard') {
      pageTitle.textContent = 'Panel de Estadísticas';
      loadDashboardStats();
    } else if (viewId === 'view-beneficiaries') {
      pageTitle.textContent = 'Gestión de Beneficiarios';
      loadBeneficiaries();
    } else if (viewId === 'view-audits') {
      pageTitle.textContent = 'Trazabilidad y Auditoría';
      loadAuditLogs();
      loadScanLogs();
    } else if (viewId === 'view-emails') {
      pageTitle.textContent = 'Historial y Certificados de Envío';
      loadEmailLogs();
    }
  }

  // Audits sub-tabs toggles
  subnavItems.forEach(item => {
    item.addEventListener('click', (e) => {
      subnavItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const target = item.dataset.sub;
      subtabViews.forEach(v => v.classList.add('hidden'));
      document.getElementById(target).classList.remove('hidden');
    });
  });

  // ==================== DASHBOARD LOAD & CHARTS ====================
  function loadDashboardStats() {
    fetch('/api/beneficiaries?limit=1', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.stats) {
          const s = data.stats;
          statTotal.textContent = s.total || 0;
          statActive.textContent = s.active || 0;
          statInactive.textContent = s.inactive || 0;
          statRevoked.textContent = s.revoked || 0;
        }
      });

    // Load distribution by economic activity
    fetch('/api/beneficiaries?limit=10000', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          renderActivityChart(data.data);
        }
      });

    // Load QR scan metrics with active filters
    loadScanStats();
  }

  const scanFilterYear = document.getElementById('scan-filter-year');
  const scanFilterMonth = document.getElementById('scan-filter-month');
  const scanChartPeriodLabel = document.getElementById('scan-chart-period-label');
  const scanChartTotal = document.getElementById('scan-chart-total');

  if (scanFilterYear) {
    scanFilterYear.addEventListener('change', () => loadScanStats());
  }
  if (scanFilterMonth) {
    scanFilterMonth.addEventListener('change', () => loadScanStats());
  }

  function loadScanStats() {
    const yr = scanFilterYear ? scanFilterYear.value : '2026';
    const mo = scanFilterMonth ? scanFilterMonth.value : '8';

    fetch(`/api/audit/scans?year=${encodeURIComponent(yr)}&month=${encodeURIComponent(mo)}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          // Update available years dropdown if new years exist
          if (data.available_years && data.available_years.length > 0 && scanFilterYear) {
            const currentSelected = scanFilterYear.value;
            const existingOptions = Array.from(scanFilterYear.options).map(o => o.value);
            data.available_years.forEach(y => {
              if (!existingOptions.includes(y)) {
                const opt = document.createElement('option');
                opt.value = y;
                opt.textContent = y;
                scanFilterYear.insertBefore(opt, scanFilterYear.firstChild);
              }
            });
            scanFilterYear.value = currentSelected;
          }

          // Update period text
          let periodText = 'Periodo: ';
          if (mo === '7days') {
            periodText += 'Últimos 7 días';
          } else if (mo === 'all') {
            periodText += yr === 'all' ? 'Histórico General' : `Año ${yr} (Por Meses)`;
          } else {
            const monthNames = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
            periodText += `${monthNames[parseInt(mo, 10)] || ''} ${yr === 'all' ? '' : yr}`;
          }
          if (scanChartPeriodLabel) scanChartPeriodLabel.textContent = periodText;
          if (scanChartTotal) scanChartTotal.textContent = (data.total_scans_period || 0).toLocaleString();

          renderScanChart(data.stats || []);
        }
      })
      .catch(err => {
        console.error('Error fetching scan stats:', err);
      });
  }

  function renderActivityChart(records) {
    const chartContainer = document.getElementById('activity-chart');
    chartContainer.innerHTML = '';

    if (records.length === 0) {
      chartContainer.innerHTML = '<p class="text-center text-muted">Sin datos suficientes</p>';
      return;
    }

    // Count activities
    const counts = {};
    records.forEach(r => {
      const act = r.economic_activity || 'No Definido';
      counts[act] = (counts[act] || 0) + 1;
    });

    // Sort by frequency
    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5); // top 5

    const total = records.length;

    sorted.forEach(([name, count]) => {
      const percent = Math.round((count / total) * 100);
      const row = document.createElement('div');
      row.className = 'chart-bar-row';
      row.innerHTML = `
        <div class="chart-bar-label-group">
          <span class="chart-bar-name">${esc(name)}</span>
          <span>${count} (${percent}%)</span>
        </div>
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="width: 0%"></div>
        </div>
      `;
      chartContainer.appendChild(row);

      // Trigger width animation in next frame
      setTimeout(() => {
        row.querySelector('.chart-bar-fill').style.width = `${percent}%`;
      }, 50);
    });
  }

  function renderScanChart(stats) {
    const chartContainer = document.getElementById('scan-chart');
    if (!chartContainer) return;
    chartContainer.innerHTML = '';

    if (!stats || stats.length === 0) {
      chartContainer.innerHTML = '<p class="text-center text-muted py-4">No se registran escaneos para el periodo seleccionado</p>';
      return;
    }

    // Find max value to scale heights
    const maxVal = Math.max(...stats.map(s => s.scan_count), 1);

    stats.forEach(item => {
      const label = item.label || item.scan_date;
      const fullLabel = item.full_label || label;
      const count = item.scan_count || 0;
      const heightPercent = count > 0 
        ? Math.max(14, Math.round((count / maxVal) * 100)) 
        : 4;

      const col = document.createElement('div');
      col.className = 'chart-col';
      col.innerHTML = `
        <span class="chart-col-val" title="${count} visualizaciones">${count > 0 ? count : ''}</span>
        <div class="chart-col-bar" data-val="${count}" title="${esc(count)} escaneos (${esc(fullLabel)})" style="height: 0%"></div>
        <span class="chart-col-label" title="${esc(fullLabel)}">${esc(label)}</span>
      `;
      chartContainer.appendChild(col);

      setTimeout(() => {
        const bar = col.querySelector('.chart-col-bar');
        if (bar) bar.style.height = `${heightPercent}%`;
      }, 50);
    });
  }

  // ==================== BENEFICIARIES GRID HANDLERS ====================
  btnToggleFilters.addEventListener('click', () => {
    filtersPanel.classList.toggle('hidden');
  });

  // Load unique values to filters select elements
  function loadFilterOptions() {
    fetch('/api/beneficiaries/unique-values', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const actSelect = document.getElementById('filter-activity');
          actSelect.innerHTML = '<option value="">Todas</option>';
          data.activities.forEach(act => {
            actSelect.innerHTML += `<option value="${esc(act)}">${esc(act)}</option>`;
          });
        }
      });
  }

  btnApplyFilters.addEventListener('click', () => {
    currentFilters = {
      document_type: document.getElementById('filter-doc-type').value,
      status: document.getElementById('filter-status').value,
      registered_hemi: document.getElementById('filter-hemi').value,
      rivi: document.getElementById('filter-rivi').value,
      economic_activity: document.getElementById('filter-activity').value,
      ipes_beneficiary: document.getElementById('filter-ipes').value,
    };
    pagination.offset = 0; // reset to first page
    loadBeneficiaries();
  });

  btnClearFilters.addEventListener('click', () => {
    document.getElementById('filter-doc-type').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-hemi').value = '';
    document.getElementById('filter-rivi').value = '';
    document.getElementById('filter-activity').value = '';
    document.getElementById('filter-ipes').value = '';
    
    currentFilters = {};
    pagination.offset = 0;
    loadBeneficiaries();
  });

  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      pagination.offset = 0;
      loadBeneficiaries();
    }, 400); // debounce
  });

  function loadBeneficiaries() {
    beneficiariesList.innerHTML = '<tr><td colspan="8" class="text-center py-4"><div class="spinner spinner-small" style="margin: auto;"></div></td></tr>';

    const searchQuery = searchInput.value;
    const queryParams = new URLSearchParams({
      limit: pagination.limit,
      offset: pagination.offset,
    });

    if (searchQuery) queryParams.append('search', searchQuery);
    for (const key in currentFilters) {
      if (currentFilters[key]) queryParams.append(key, currentFilters[key]);
    }

    fetch(`/api/beneficiaries?${queryParams.toString()}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          beneficiariesData = data.data;
          pagination.total = data.total;
          renderBeneficiariesTable();
        } else {
          beneficiariesList.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-red">${esc(data.message)}</td></tr>`;
        }
      })
      .catch(() => {
        beneficiariesList.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-red">Error de comunicación con el servidor.</td></tr>';
      });
  }

  function renderBeneficiariesTable() {
    beneficiariesList.innerHTML = '';
    
    if (beneficiariesData.length === 0) {
      beneficiariesList.innerHTML = '<tr><td colspan="8" class="text-center py-4 text-muted">No se encontraron beneficiarios registrados.</td></tr>';
      updatePaginationControls();
      return;
    }

    beneficiariesData.forEach(b => {
      const tr = document.createElement('tr');

      // Status badge styling
      let badgeClass = 'badge-success';
      if (b.status === 'Inactivo') badgeClass = 'badge-warning';
      else if (b.status === 'Revocado') badgeClass = 'badge-danger';

      const isChecked = selectedBeneficiaryIds.has(b.id) ? 'checked' : '';

      tr.innerHTML = `
        <td><input type="checkbox" class="beneficiary-row-checkbox" data-id="${b.id}" ${isChecked}></td>
        <td style="font-weight: 600;">${esc(b.full_name)}</td>
        <td>${esc(b.document_type)} ${esc(b.document_number)}</td>
        <td>${esc(b.registered_hemi)}</td>
        <td>${b.rivi ? esc(b.rivi) : '<span class="text-muted">-</span>'}</td>
        <td>${esc(b.economic_activity)}</td>
        <td><span class="status-badge ${badgeClass}">${esc(b.status)}</span></td>
        <td>
          <div class="table-actions">
            <button class="btn-icon-only action-view" data-id="${b.id}" title="Previsualizar Carné">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
            <button class="btn-icon-only action-email" data-id="${b.id}" data-name="${esc(b.full_name)}" data-email="${esc(b.email)}" title="${b.email ? `Enviar Carné a ${esc(b.email)}` : 'Sin correo electrónico'}">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            </button>
            <button class="btn-icon-only action-cert-send" data-id="${b.id}" title="Descargar Certificado Oficial de Envío (PDF)">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            </button>
            <button class="btn-icon-only action-cert-open" data-id="${b.id}" title="Descargar Certificado Oficial de Apertura / Lectura (PDF)">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
            </button>
            <button class="btn-icon-only action-edit" data-id="${b.id}" title="Editar Vendedor">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="btn-icon-only action-qr" data-id="${b.id}" title="Regenerar Token QR (Revoca anterior)">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <button class="btn-icon-only action-delete" data-id="${b.id}" title="Eliminar Definitivamente">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
            </button>
          </div>
        </td>
      `;
      beneficiariesList.appendChild(tr);
    });

    updatePaginationControls();
    setupTableCheckboxListeners();
  }

  function updatePaginationControls() {
    const end = Math.min(pagination.offset + pagination.limit, pagination.total);
    const start = pagination.total === 0 ? 0 : pagination.offset + 1;
    paginationInfo.textContent = `Mostrando ${start}-${end} de ${pagination.total} registros`;
    
    btnPrevPage.disabled = pagination.offset === 0;
    btnNextPage.disabled = (pagination.offset + pagination.limit) >= pagination.total;
  }

  btnPrevPage.addEventListener('click', () => {
    if (pagination.offset > 0) {
      pagination.offset -= pagination.limit;
      loadBeneficiaries();
    }
  });

  btnNextPage.addEventListener('click', () => {
    if ((pagination.offset + pagination.limit) < pagination.total) {
      pagination.offset += pagination.limit;
      loadBeneficiaries();
    }
  });

  // Table actions delegations
  beneficiariesList.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    if (btn.classList.contains('action-view')) {
      // Open card preview in a new window
      window.open(`/api/pdf/preview/${id}`, '_blank');
    } else if (btn.classList.contains('action-email')) {
      sendSingleBeneficiaryEmail(id, btn.dataset.name, btn.dataset.email);
    } else if (btn.classList.contains('action-cert-send')) {
      window.open(`/api/emails/certificate/beneficiary/${id}/send`, '_blank');
    } else if (btn.classList.contains('action-cert-open')) {
      window.open(`/api/emails/certificate/beneficiary/${id}/open`, '_blank');
    } else if (btn.classList.contains('action-edit')) {
      openEditModal(id);
    } else if (btn.classList.contains('action-qr')) {
      regenerateQr(id);
    } else if (btn.classList.contains('action-delete')) {
      deleteBeneficiary(id);
    }
  });

  // Individual Email Sending function
  function sendSingleBeneficiaryEmail(id, name, email) {
    if (!email || !email.trim() || !email.includes('@')) {
      const ask = confirm(`El vendedor "${name}" no tiene un correo electrónico registrado. ¿Deseas editar el registro para agregar su correo?`);
      if (ask) openEditModal(id);
      return;
    }

    const conf = confirm(`¿Confirmas el envío formal del carné en PDF al correo "${email}" del vendedor ${name}?`);
    if (!conf) return;

    fetch(`/api/emails/send/${id}`, { credentials: 'include', method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert(`✅ ${data.message}`);
        } else {
          alert(`❌ ${data.message || 'Error al enviar correo.'}`);
        }
      })
      .catch(() => {
        alert('❌ Error de comunicación al procesar el envío.');
      });
  }

  // ==================== CHECKBOX MULTI-SELECT & ZIP / EMAIL DOWNLOAD ====================
  const btnBulkEmail = document.getElementById('btn-bulk-email');
  const selectedEmailCountEl = document.getElementById('selected-email-count');

  function setupTableCheckboxListeners() {
    const rowCheckboxes = document.querySelectorAll('.beneficiary-row-checkbox');
    
    rowCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.id);
        if (cb.checked) {
          selectedBeneficiaryIds.add(id);
        } else {
          selectedBeneficiaryIds.delete(id);
        }
        updateBulkDownloadState();
      });
    });
  }

  checkboxSelectAll.addEventListener('change', () => {
    const rowCheckboxes = document.querySelectorAll('.beneficiary-row-checkbox');
    const checked = checkboxSelectAll.checked;

    rowCheckboxes.forEach(cb => {
      cb.checked = checked;
      const id = parseInt(cb.dataset.id);
      if (checked) {
        selectedBeneficiaryIds.add(id);
      } else {
        selectedBeneficiaryIds.delete(id);
      }
    });

    updateBulkDownloadState();
  });

  function updateBulkDownloadState() {
    const count = selectedBeneficiaryIds.size;
    selectedCountEl.textContent = count;
    if (selectedEmailCountEl) selectedEmailCountEl.textContent = count;
    
    if (count > 0) {
      btnBulkDownload.classList.remove('hidden');
      if (btnBulkEmail) btnBulkEmail.classList.remove('hidden');
    } else {
      btnBulkDownload.classList.add('hidden');
      if (btnBulkEmail) btnBulkEmail.classList.add('hidden');
      checkboxSelectAll.checked = false;
    }
  }

  btnBulkDownload.addEventListener('click', () => {
    if (selectedBeneficiaryIds.size === 0) return;

    btnBulkDownload.disabled = true;
    btnBulkDownload.innerHTML = `<div class="spinner spinner-small" style="display:inline-block; vertical-align:middle; margin-right:5px;"></div> Descargando...`;

    const idsArray = Array.from(selectedBeneficiaryIds);

    fetch('/api/pdf/download-bulk', { credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: idsArray })
    })
    .then(res => {
      if (res.status !== 200) {
        throw new Error('Fallo la generación del archivo comprimido.');
      }
      return res.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'carnes_vendedores_informales.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      
      // Reset checkboxes
      selectedBeneficiaryIds.clear();
      updateBulkDownloadState();
      checkboxSelectAll.checked = false;
      document.querySelectorAll('.beneficiary-row-checkbox').forEach(cb => cb.checked = false);
    })
    .catch(err => {
      alert(err.message || 'Error al descargar el archivo ZIP.');
    })
    .finally(() => {
      btnBulkDownload.disabled = false;
      btnBulkDownload.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        <span>Descarga Masiva (<span id="selected-count">${selectedBeneficiaryIds.size}</span>)</span>
      `;
    });
  });

  // ==================== ACTIONS (REGENERATE & DELETE) ====================
  function regenerateQr(id) {
    if (confirm('¿Está seguro de regenerar el código QR? Esta acción invalidará y revocará el carné físico impreso anteriormente.')) {
      fetch(`/api/beneficiaries/${id}/regenerate-qr`, { credentials: 'include', method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert(data.message);
            loadBeneficiaries();
          } else {
            alert(data.message || 'Error al regenerar código QR.');
          }
        });
    }
  }

  function deleteBeneficiary(id) {
    if (confirm('¿Está seguro de eliminar permanentemente a este vendedor? Esta acción borrará el registro, fotos y logs de consulta asociados. No se puede deshacer.')) {
      fetch(`/api/beneficiaries/${id}`, { credentials: 'include', method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            alert(data.message);
            // Remove from selected list if deleted
            selectedBeneficiaryIds.delete(parseInt(id));
            updateBulkDownloadState();
            loadBeneficiaries();
          } else {
            alert(data.message || 'Error al eliminar el registro.');
          }
        });
    }
  }

  // ==================== ADD / EDIT MODAL FORM ====================
  // Open add form
  btnAddNew = btnAddBeneficiary.addEventListener('click', () => {
    modalBeneficiaryTitle.textContent = 'Registrar Vendedor Informal';
    beneficiaryForm.reset();
    formId.value = '';
    
    // Reset photo upload preview
    formPhotoPreview.src = '';
    formPhotoPreview.classList.add('hidden');
    formPhotoSilhouette.classList.remove('hidden');
    formAlert.classList.add('hidden');

    modalBeneficiary.classList.remove('hidden');
  });

  // Open edit form
  function openEditModal(id) {
    modalBeneficiaryTitle.textContent = 'Editar Vendedor Informal';
    formAlert.classList.add('hidden');
    
    fetch(`/api/beneficiaries/${id}`, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const b = data.data;
          
          formId.value = b.id;
          beneficiaryForm.full_name.value = b.full_name;
          beneficiaryForm.document_type.value = b.document_type;
          beneficiaryForm.document_number.value = b.document_number;
          beneficiaryForm.age.value = b.age;
          beneficiaryForm.gender.value = b.gender;
          beneficiaryForm.disability.value = b.disability;
          beneficiaryForm.population_group.value = b.population_group;
          beneficiaryForm.phone.value = b.phone || '';
          if (beneficiaryForm.email) beneficiaryForm.email.value = b.email || '';
          beneficiaryForm.latitude.value = b.latitude || '';
          beneficiaryForm.longitude.value = b.longitude || '';
          beneficiaryForm.registered_hemi.value = b.registered_hemi;
          beneficiaryForm.rivi.value = b.rivi || '';
          beneficiaryForm.economic_activity.value = b.economic_activity;
          beneficiaryForm.ipes_beneficiary.value = b.ipes_beneficiary;
          beneficiaryForm.offer_type.value = b.offer_type || '';
          beneficiaryForm.days_per_week.value = b.days_per_week;
          beneficiaryForm.permanence_time.value = b.permanence_time;
          beneficiaryForm.status.value = b.status;

          // Render image preview
          if (b.photo_path) {
            formPhotoPreview.src = `/api/public/photo/${encodeURIComponent(b.uuid)}`;
            formPhotoPreview.classList.remove('hidden');
            formPhotoSilhouette.classList.add('hidden');
          } else {
            formPhotoPreview.src = '';
            formPhotoPreview.classList.add('hidden');
            formPhotoSilhouette.classList.remove('hidden');
          }

          modalBeneficiary.classList.remove('hidden');
        } else {
          alert('Error al consultar detalles del registro.');
        }
      });
  }

  // Handle Photo selection and preview
  formPhotoInput.addEventListener('change', () => {
    const file = formPhotoInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        formPhotoPreview.src = e.target.result;
        formPhotoPreview.classList.remove('hidden');
        formPhotoSilhouette.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }
  });

  // Modal closings
  function closeBeneficiaryModal() {
    modalBeneficiary.classList.add('hidden');
    beneficiaryForm.reset();
  }
  btnCloseBeneficiaryModal.addEventListener('click', closeBeneficiaryModal);
  btnCancelBeneficiaryModal.addEventListener('click', closeBeneficiaryModal);

  // Submit form handler
  beneficiaryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    formAlert.classList.add('hidden');

    const id = formId.value;
    const isEdit = id !== '';
    const formData = new FormData();

    // Map inputs to form data
    const inputs = beneficiaryForm.querySelectorAll('input, select');
    inputs.forEach(input => {
      if (input.type === 'file' || input.name === 'id') return;
      formData.append(input.name, input.value);
    });

    // Append file if selected
    if (formPhotoInput.files[0]) {
      formData.append('photo', formPhotoInput.files[0]);
    }

    const url = isEdit ? `/api/beneficiaries/${id}` : '/api/beneficiaries';
    const method = isEdit ? 'PUT' : 'POST';

    fetch(url, { credentials: 'include',
      method: method,
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        closeBeneficiaryModal();
        loadBeneficiaries();
      } else {
        formAlert.textContent = data.message || 'Error al guardar los datos.';
        formAlert.classList.remove('hidden');
      }
    })
    .catch(() => {
      formAlert.textContent = 'Error crítico en la comunicación con el servidor.';
      formAlert.classList.remove('hidden');
    });
  });

  // ==================== MASSIVE IMPORT LOGIC ====================
  btnImportMassive.addEventListener('click', () => {
    modalImport.classList.remove('hidden');
    importFilename.textContent = 'Ningún archivo seleccionado';
    btnExecuteImport.disabled = true;
    importProgress.classList.add('hidden');
    importResults.classList.add('hidden');
    importFileInput.value = '';
  });

  function closeImportModal() {
    modalImport.classList.add('hidden');
  }
  btnCloseImportModal.addEventListener('click', closeImportModal);
  btnCancelImportModal.addEventListener('click', closeImportModal);

  // Dropzone drag-over animations
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--color-primary)';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'rgba(255, 255, 255, 0.15)';
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      importFileInput.files = files;
      handleSelectedImportFile();
    }
  });

  dropzone.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', handleSelectedImportFile);

  function handleSelectedImportFile() {
    const file = importFileInput.files[0];
    if (file) {
      importFilename.textContent = file.name;
      btnExecuteImport.disabled = false;
    }
  }

  btnExecuteImport.addEventListener('click', () => {
    const file = importFileInput.files[0];
    if (!file) return;

    btnExecuteImport.disabled = true;
    importProgress.classList.remove('hidden');
    importResults.classList.add('hidden');

    const formData = new FormData();
    formData.append('file', file);

    fetch('/api/beneficiaries/import', { credentials: 'include',
      method: 'POST',
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      importProgress.classList.add('hidden');
      importResults.classList.remove('hidden');
      
      if (data.success) {
        importResultsTitle.innerHTML = `Importación Completada exitosamente. <br><span class="text-green">Registros importados: ${esc(data.importedCount)}</span>, <span class="text-red">Errores: ${esc(data.errorCount)}</span>`;
        
        if (data.errors && data.errors.length > 0) {
          let errHtml = data.errors.map(err => `<div>• ${esc(err)}</div>`).join('');
          if (data.errorsNote) {
            errHtml += `<div style="margin-top:8px;color:#aaa;font-style:italic;">• ${esc(data.errorsNote)}</div>`;
          }
          importLog.innerHTML = errHtml;
        } else {
          importLog.innerHTML = '<div class="text-green">• Archivo procesado sin advertencias ni errores.</div>';
        }
        
        loadBeneficiaries();
      } else {
        importResultsTitle.innerHTML = `<span class="text-red">Error en la importación</span>`;
        importLog.innerHTML = `<div>• ${esc(data.message)}</div>`;
      }
    })
    .catch(err => {
      importProgress.classList.add('hidden');
      importResults.classList.remove('hidden');
      importResultsTitle.innerHTML = `<span class="text-red">Error crítico</span>`;
      importLog.innerHTML = `<div>• No se pudo procesar el archivo. Detalle: ${esc(err.message)}</div>`;
    });
  });

  // ==================== AUDIT LOGS DISPLAY ====================
  function loadAuditLogs() {
    auditChangesList.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner spinner-small" style="margin: auto;"></div></td></tr>';

    fetch('/api/audit/logs', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          renderAuditLogsTable(data.data);
        } else {
          auditChangesList.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red">${esc(data.message)}</td></tr>`;
        }
      })
      .catch(() => {
        auditChangesList.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red">Error de comunicación.</td></tr>';
      });
  }

  function renderAuditLogsTable(logs) {
    auditChangesList.innerHTML = '';

    if (logs.length === 0) {
      auditChangesList.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No se registran cambios de auditoría.</td></tr>';
      return;
    }

    logs.forEach(log => {
      const tr = document.createElement('tr');
      
      const date = new Date(log.timestamp);
      const formattedDate = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // Action type label
      let actionBadge = `<span class="status-badge badge-success">${esc(log.action)}</span>`;
      if (log.action === 'UPDATE') actionBadge = `<span class="status-badge badge-warning">MODIFICÓ</span>`;
      else if (log.action === 'DELETE') actionBadge = `<span class="status-badge badge-danger">ELIMINÓ</span>`;
      else if (log.action === 'REGENERATE_QR') actionBadge = `<span class="status-badge badge-danger">REGENERA QR</span>`;
      else if (log.action === 'CREATE') actionBadge = `<span class="status-badge badge-success">CREÓ</span>`;

      // Parse diff comparison values
      let diffHtml = '<span class="text-muted">-</span>';
      if (log.action === 'UPDATE' && log.fields_changed) {
        try {
          const diffObj = JSON.parse(log.fields_changed);
          let diffLines = '';
          for (const field in diffObj) {
            const oldVal = diffObj[field].old !== null ? diffObj[field].old : 'vacío';
            const newVal = diffObj[field].new !== null ? diffObj[field].new : 'vacío';
            diffLines += `
              <div class="diff-line">
                <span class="diff-field">${esc(translateField(field))}:</span>
                <span class="diff-old">${esc(oldVal)}</span> → 
                <span class="diff-new">${esc(newVal)}</span>
              </div>
            `;
          }
          diffHtml = `<div class="audit-diff-box">${diffLines}</div>`;
        } catch (e) {
          diffHtml = `<span class="text-muted">Error al parsear detalles</span>`;
        }
      } else if (log.action === 'CREATE' && log.fields_changed) {
        try {
          const extra = JSON.parse(log.fields_changed);
          if (extra && extra.imported_via) {
            diffHtml = `<span class="text-green">Importación masiva Excel/CSV</span>`;
          } else {
            diffHtml = `<span class="text-green">Creación manual de registro</span>`;
          }
        } catch(e) {
          diffHtml = `<span class="text-green">Registro creado</span>`;
        }
      } else if (log.action === 'DELETE' && log.fields_changed) {
        try {
          const details = JSON.parse(log.fields_changed);
          diffHtml = `<span class="text-red">Registro eliminado: ${esc(details.full_name)} (${esc(details.document)})</span>`;
        } catch(e) {
          diffHtml = `<span class="text-red">Registro borrado permanentemente</span>`;
        }
      }

      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td style="font-weight:600;">${esc(log.user_full_name)} (${esc(log.user_username)})</td>
        <td>${log.beneficiary_name ? esc(log.beneficiary_name) : '<span class="text-muted">N/A</span>'}</td>
        <td>${log.beneficiary_document ? esc(log.beneficiary_document) : '<span class="text-muted">N/A</span>'}</td>
        <td>${actionBadge}</td>
        <td>${diffHtml}</td>
      `;
      auditChangesList.appendChild(tr);
    });
  }

  function translateField(field) {
    const dict = {
      full_name: 'Nombre',
      document_type: 'Tipo doc',
      document_number: 'Nº doc',
      registered_hemi: 'HEMI',
      rivi: 'RIVI',
      status: 'Estado',
      age: 'Edad',
      gender: 'Género',
      population_group: 'Grupo pob',
      disability: 'Discapacidad',
      phone: 'Teléfono',
      latitude: 'Latitud',
      longitude: 'Longitud',
      economic_activity: 'Actividad',
      ipes_beneficiary: 'Benef. IPES',
      offer_type: 'Oferta',
      days_per_week: 'Días zone',
      permanence_time: 'Permanencia',
      photo_path: 'Foto'
    };
    return dict[field] || field;
  }

  // ==================== QR SCAN LOGS DISPLAY ====================
  function loadScanLogs() {
    auditScansList.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner spinner-small" style="margin: auto;"></div></td></tr>';

    fetch('/api/audit/scans', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          renderScanLogsTable(data.data);
        } else {
          auditScansList.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red">${esc(data.message)}</td></tr>`;
        }
      })
      .catch(() => {
        auditScansList.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red">Error de comunicación.</td></tr>';
      });
  }

  function renderScanLogsTable(scans) {
    auditScansList.innerHTML = '';

    if (scans.length === 0) {
      auditScansList.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No se registran escaneos o validaciones.</td></tr>';
      return;
    }

    scans.forEach(scan => {
      const tr = document.createElement('tr');

      const date = new Date(scan.scanned_at);
      const formattedDate = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

      let badgeClass = 'badge-success';
      if (scan.status_at_scan === 'Inactivo') badgeClass = 'badge-warning';
      else if (scan.status_at_scan === 'Revocado') badgeClass = 'badge-danger';

      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td style="font-weight: 600;">${scan.beneficiary_name ? esc(scan.beneficiary_name) : '<span class="text-muted">Inexistente/Borrado</span>'}</td>
        <td>${scan.beneficiary_document ? esc(scan.beneficiary_document) : '<span class="text-muted">N/A</span>'}</td>
        <td><code>${esc(scan.ip_address)}</code></td>
        <td style="font-size: 0.75rem; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(scan.user_agent)}">${esc(scan.user_agent)}</td>
        <td><span class="status-badge ${badgeClass}">${esc(scan.status_at_scan)}</span></td>
      `;
      auditScansList.appendChild(tr);
    });
  }

  // ==================== BULK EMAIL SENDING MODAL ====================
  const modalBulkEmail = document.getElementById('modal-bulk-email');
  const btnCloseBulkEmailModal = document.getElementById('btn-close-bulk-email-modal');
  const btnCancelBulkEmailModal = document.getElementById('btn-cancel-bulk-email-modal');
  const btnExecuteBulkEmail = document.getElementById('btn-execute-bulk-email');
  const bulkEmailTotalSelected = document.getElementById('bulk-email-total-selected');
  const bulkEmailProgress = document.getElementById('bulk-email-progress');
  const bulkEmailResults = document.getElementById('bulk-email-results');
  const bulkEmailResultsTitle = document.getElementById('bulk-email-results-title');
  const bulkEmailLog = document.getElementById('bulk-email-log');

  if (btnBulkEmail) {
    btnBulkEmail.addEventListener('click', () => {
      if (selectedBeneficiaryIds.size === 0) return;
      bulkEmailTotalSelected.textContent = selectedBeneficiaryIds.size;
      bulkEmailResults.classList.add('hidden');
      bulkEmailProgress.classList.add('hidden');
      btnExecuteBulkEmail.disabled = false;
      btnExecuteBulkEmail.textContent = 'Iniciar Envío Masivo';
      modalBulkEmail.classList.remove('hidden');
    });
  }

  function closeBulkEmailModal() {
    if (modalBulkEmail) modalBulkEmail.classList.add('hidden');
  }
  if (btnCloseBulkEmailModal) btnCloseBulkEmailModal.addEventListener('click', closeBulkEmailModal);
  if (btnCancelBulkEmailModal) btnCancelBulkEmailModal.addEventListener('click', closeBulkEmailModal);

  if (btnExecuteBulkEmail) {
    btnExecuteBulkEmail.addEventListener('click', () => {
      if (selectedBeneficiaryIds.size === 0) return;

      btnExecuteBulkEmail.disabled = true;
      bulkEmailProgress.classList.remove('hidden');
      bulkEmailResults.classList.add('hidden');

      fetch('/api/emails/send-bulk', { credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedBeneficiaryIds) })
      })
      .then(res => res.json())
      .then(data => {
        bulkEmailProgress.classList.add('hidden');
        bulkEmailResults.classList.remove('hidden');

        if (data.success) {
          bulkEmailResultsTitle.textContent = `Proceso Finalizado — ${data.sentCount} enviados, ${data.failedCount} no enviados`;
          let html = `<p class="text-green" style="font-weight:600;">✓ Se enviaron exitosamente ${esc(data.sentCount)} correos electrónicos con el carné adjunto.</p>`;
          if (data.errors && data.errors.length > 0) {
            html += `<p class="text-red" style="margin-top:10px; font-weight:600;">Vendedores sin envío:</p><ul style="padding-left:20px; font-size:0.85rem; color:#ef4444;">`;
            data.errors.forEach(e => { html += `<li>${esc(e)}</li>`; });
            html += `</ul>`;
          }
          bulkEmailLog.innerHTML = html;
        } else {
          bulkEmailResultsTitle.textContent = 'Error en el envío masivo';
          bulkEmailLog.innerHTML = `<p class="text-red">${esc(data.message || 'Ocurrió un error inesperado.')}</p>`;
        }
      })
      .catch(() => {
        bulkEmailProgress.classList.add('hidden');
        bulkEmailResults.classList.remove('hidden');
        bulkEmailResultsTitle.textContent = 'Error de comunicación';
        bulkEmailLog.innerHTML = '<p class="text-red">No se pudo establecer conexión con el servidor.</p>';
      });
    });
  }

  // ==================== EMAIL LOGS AND CERTIFICATES ====================
  const emailsList = document.getElementById('emails-list');
  const emailSearchInput = document.getElementById('email-search-input');
  const btnRefreshEmails = document.getElementById('btn-refresh-emails');
  let cachedEmailLogs = [];

  if (btnRefreshEmails) {
    btnRefreshEmails.addEventListener('click', () => loadEmailLogs());
  }

  if (emailSearchInput) {
    emailSearchInput.addEventListener('input', () => {
      const q = emailSearchInput.value.toLowerCase().trim();
      if (!q) {
        renderEmailLogsTable(cachedEmailLogs);
        return;
      }
      const filtered = cachedEmailLogs.filter(l => 
        (l.beneficiary_name && l.beneficiary_name.toLowerCase().includes(q)) ||
        (l.beneficiary_document && l.beneficiary_document.includes(q)) ||
        (l.recipient_email && l.recipient_email.toLowerCase().includes(q))
      );
      renderEmailLogsTable(filtered);
    });
  }

  function loadEmailLogs() {
    if (!emailsList) return;
    emailsList.innerHTML = '<tr><td colspan="6" class="text-center py-4"><div class="spinner spinner-small" style="margin: auto;"></div></td></tr>';

    fetch('/api/emails/logs', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          cachedEmailLogs = data.data || [];
          renderEmailLogsTable(cachedEmailLogs);
        } else {
          emailsList.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-red">${esc(data.message)}</td></tr>`;
        }
      })
      .catch(() => {
        emailsList.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-red">Error de comunicación al cargar historial de correos.</td></tr>';
      });
  }

  function renderEmailLogsTable(logs) {
    if (!emailsList) return;
    emailsList.innerHTML = '';

    if (!logs || logs.length === 0) {
      emailsList.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No se registran envíos de correos en el sistema.</td></tr>';
      return;
    }

    logs.forEach(l => {
      const tr = document.createElement('tr');

      const sentDate = l.sent_at ? new Date(l.sent_at).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
      const openDate = l.opened_at ? new Date(l.opened_at).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '<span class="text-muted">Pendiente</span>';

      let statusBadge = '<span class="status-badge badge-info">Enviado</span>';
      if (l.status === 'opened' || l.opened_at) {
        statusBadge = '<span class="status-badge badge-success">Abierto / Confirmado</span>';
      } else if (l.status === 'failed') {
        statusBadge = '<span class="status-badge badge-danger">Fallido</span>';
      }

      const isOpen = l.status === 'opened' || Boolean(l.opened_at);

      tr.innerHTML = `
        <td>${sentDate}</td>
        <td>
          <div style="font-weight: 600;">${esc(l.beneficiary_name || 'Desconocido')}</div>
          <div style="font-size: 0.75rem; color: var(--color-text-muted);">${esc(l.beneficiary_doc_type || 'CC')} ${esc(l.beneficiary_document)}</div>
        </td>
        <td><code>${esc(l.recipient_email)}</code></td>
        <td>${statusBadge}</td>
        <td>${openDate}</td>
        <td>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button class="btn btn-secondary btn-sm btn-cert-send" data-id="${l.id}" title="Descargar Certificado Oficial de Despacho / Envío" style="padding: 4px 8px; font-size: 0.75rem;">
              📜 Cert. Envío
            </button>
            <button class="btn btn-sm btn-cert-open ${isOpen ? 'btn-success' : 'btn-secondary'}" data-id="${l.id}" ${isOpen ? '' : 'disabled'} title="${isOpen ? 'Descargar Certificado Oficial de Apertura y Lectura' : 'El destinatario aún no ha abierto el correo'}" style="padding: 4px 8px; font-size: 0.75rem;">
              📖 Cert. Lectura
            </button>
          </div>
        </td>
      `;
      emailsList.appendChild(tr);
    });
  }

  // Certificate download delegations
  if (emailsList) {
    emailsList.addEventListener('click', (e) => {
      const sendBtn = e.target.closest('.btn-cert-send');
      if (sendBtn) {
        const id = sendBtn.dataset.id;
        window.open(`/api/emails/certificate/${id}/send`, '_blank');
        return;
      }

      const openBtn = e.target.closest('.btn-cert-open');
      if (openBtn && !openBtn.disabled) {
        const id = openBtn.dataset.id;
        window.open(`/api/emails/certificate/${id}/open`, '_blank');
      }
    });
  }
});
