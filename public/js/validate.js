document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const uuid = urlParams.get('uuid');

  const stateLoading = document.getElementById('state-loading');
  const stateSuccess = document.getElementById('state-success');
  const stateError = document.getElementById('state-error');
  const errorMessage = document.getElementById('error-message');

  // Elements to populate
  const nameEl = document.getElementById('beneficiary-name');
  const docEl = document.getElementById('beneficiary-doc');
  const riviEl = document.getElementById('beneficiary-rivi');
  const activityEl = document.getElementById('beneficiary-activity');
  const photoEl = document.getElementById('beneficiary-photo');
  const photoPlaceholder = document.getElementById('photo-placeholder');
  const statusBadge = document.getElementById('beneficiary-status-badge');
  const statusBanner = document.getElementById('status-banner');
  const bannerText = document.getElementById('banner-text');
  const statusIconHolder = document.getElementById('status-icon-holder');
  const scanTimeEl = document.getElementById('scan-time');

  // Set current scan time
  const now = new Date();
  const options = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
  scanTimeEl.textContent = `Fecha de consulta: ${now.toLocaleDateString('es-CO', options)}`;

  if (!uuid) {
    showError('Código de validación ausente en el enlace.');
    return;
  }

  // Request validation from public api
  fetch(`/api/public/validate/${uuid}`)
    .then(response => response.json().then(data => ({ status: response.status, data })))
    .then(({ status, data }) => {
      stateLoading.classList.add('hidden');

      if (status !== 200 || !data.success) {
        showError(data.message || 'El carné no pudo ser verificado.');
        return;
      }

      // Populate data
      const b = data.data;
      nameEl.textContent = b.full_name.toUpperCase();
      docEl.textContent = `${b.document_type} ${b.document_number}`;
      riviEl.textContent = b.rivi || 'No Registra';
      activityEl.textContent = b.economic_activity;

      // Handle photograph rendering
      if (b.photo_path) {
        photoEl.onload = () => {
          photoEl.classList.remove('hidden');
          photoPlaceholder.classList.add('hidden');
        };
        photoEl.onerror = () => {
          photoEl.classList.add('hidden');
          photoPlaceholder.classList.remove('hidden');
        };
        photoEl.src = b.photo_path;
      } else {
        photoEl.classList.add('hidden');
        photoPlaceholder.classList.remove('hidden');
      }

      // Configure visual elements based on active status
      configureStatusUI(b.status);

      // Show success container
      stateSuccess.classList.remove('hidden');
    })
    .catch(err => {
      console.error('Fetch error during validation:', err);
      stateLoading.classList.add('hidden');
      showError('No se pudo establecer conexión con el servidor de validación.');
    });

  function showError(msg) {
    errorMessage.textContent = msg;
    stateError.classList.remove('hidden');
  }

  // Format ISO date (YYYY-MM-DD) to DD/MM/YYYY
  function formatDate(isoDate) {
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
  }

  function configureStatusUI(status) {
    // Reset banner classes
    statusBanner.className = 'validation-status-banner';
    statusBadge.className = 'status-badge';

    let iconSvg = '';
    
    if (status === 'Activo') {
      statusBanner.classList.add('banner-active');
      statusBadge.classList.add('badge-success');
      statusBadge.textContent = 'Activo';
      bannerText.textContent = 'CARNÉ ACTIVO Y AUTÉNTICO';
      
      // Success checkmark SVG
      iconSvg = `
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;
    } else if (status === 'Vencido') {
      statusBanner.classList.add('banner-inactive');
      statusBadge.classList.add('badge-warning');
      statusBadge.textContent = 'Vencido';
      bannerText.textContent = 'CARNÉ VENCIDO - FUERA DE VIGENCIA';

      // Clock/expired SVG
      iconSvg = `
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
      `;
    } else if (status === 'Inactivo') {
      statusBanner.classList.add('banner-inactive');
      statusBadge.classList.add('badge-warning');
      statusBadge.textContent = 'Inactivo';
      bannerText.textContent = 'CARNÉ INACTIVO / VENCIDO';

      // Warning exclamation SVG
      iconSvg = `
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      `;
    } else {
      // Revoked status
      statusBanner.classList.add('banner-revoked');
      statusBadge.classList.add('badge-danger');
      statusBadge.textContent = 'Revocado';
      bannerText.textContent = 'CARNÉ INVALIDADO / REVOCADO';

      // Red X mark SVG
      iconSvg = `
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
    }

    statusIconHolder.innerHTML = iconSvg;
  }
});
