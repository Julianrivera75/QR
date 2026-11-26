// Envío manual de carnés desde el buzón institucional abierto en el navegador.
// El sistema arma cada correo (destinatario, asunto, texto y enlace personal) y lo
// abre en la ventana de redacción del correo web; el operador lo envía y lo marca.
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const $ = (id) => document.getElementById(id);

  const ESTADOS = {
    pendiente: { txt: 'Pendiente', cls: 'badge-warning' },
    preparado: { txt: 'Redactado, sin confirmar', cls: 'badge-warning' },
    enviado: { txt: 'Enviado', cls: 'badge-success' },
    descargado: { txt: 'Descargado', cls: 'badge-success' },
    rebotado: { txt: 'Rebotado', cls: 'badge-danger' },
    sin_correo: { txt: 'Sin correo', cls: 'badge-danger' }
  };

  const COMPOSE = {
    outlook365: (to, s, b) => `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`,
    outlookcom: (to, s, b) => `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`,
    gmail: (to, s, b) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`
  };

  let filas = [];
  const fmt = (d) => d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const cliente = () => {
    const sel = $('envio-cliente');
    return sel && COMPOSE[sel.value] ? sel.value : 'outlook365';
  };

  function grupo(f) {
    return f.estado === 'preparado' ? 'pendiente' : f.estado;
  }

  function visibles() {
    const filtro = $('envio-filtro').value;
    const q = $('envio-buscar').value.toLowerCase().trim();
    return filas.filter((f) =>
      (filtro === 'todos' || grupo(f) === filtro) &&
      (!q || [f.full_name, f.document_number, f.email].some((x) => String(x || '').toLowerCase().includes(q)))
    );
  }

  function contadores() {
    const n = (e) => filas.filter((f) => grupo(f) === e).length;
    const conCorreo = filas.filter((f) => f.estado !== 'sin_correo').length;
    const tarjetas = [
      ['Con correo', conCorreo],
      ['Pendientes', n('pendiente')],
      ['Enviados sin descarga', n('enviado')],
      ['Descargados', n('descargado')],
      ['Rebotados', n('rebotado')],
      ['Sin correo', n('sin_correo')]
    ];
    $('envio-contadores').innerHTML = tarjetas.map(([l, v]) => `
      <div class="card-glass" style="padding:12px 14px;">
        <div style="font-size:0.75rem; color: var(--color-text-muted);">${esc(l)}</div>
        <div style="font-size:1.4rem; font-weight:700;">${esc(v.toLocaleString('es-CO'))}</div>
      </div>`).join('');
  }

  function acciones(f) {
    const b = (cls, txt, extra = '') => `<button class="btn btn-sm ${cls}" data-id="${f.id}" data-log="${f.log_id || ''}" ${extra} style="padding:4px 8px; font-size:0.75rem;">${txt}</button>`;
    switch (f.estado) {
      case 'pendiente':
        return b('btn-primary envio-redactar', '✉️ Redactar');
      case 'preparado':
        return b('btn-secondary envio-redactar', '✉️ Redactar de nuevo') + ' ' + b('btn-success envio-marcar', '✓ Marcar enviado');
      case 'enviado':
        return b('btn-secondary envio-cert-envio', '📜 Cert. envío') + ' ' + b('btn-secondary envio-rebote', 'Marcar rebote') + ' ' + (f.manual ? b('btn-secondary envio-deshacer', 'Deshacer') : '');
      case 'rebotado':
        return `<span class="text-muted" style="font-size:0.78rem;">${esc(f.error || 'Rebotado')}</span>`;
      case 'descargado':
        return b('btn-secondary envio-cert-envio', '📜 Cert. envío') + ' ' + b('btn-success envio-cert-lectura', '📖 Cert. descarga');
      default:
        return '<span class="text-muted" style="font-size:0.8rem;">Registre el correo en Beneficiarios</span>';
    }
  }

  function render() {
    contadores();
    const lista = visibles();
    const tbody = $('envio-lista');
    if (!lista.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No hay vendedores en este grupo.</td></tr>';
      return;
    }
    tbody.innerHTML = lista.map((f) => {
      const e = ESTADOS[f.estado] || ESTADOS.pendiente;
      const fechas = [f.sent_at ? `${f.estado === 'rebotado' ? 'Intento' : 'Enviado'}: ${fmt(f.sent_at)}` : '', f.opened_at ? `Descargado: ${fmt(f.opened_at)}` : ''].filter(Boolean).join('<br>');
      return `<tr>
        <td><div style="font-weight:600;">${esc(f.full_name)}</div>
            <div style="font-size:0.75rem; color: var(--color-text-muted);">${esc(f.document_type || 'CC')} ${esc(f.document_number)}</div></td>
        <td>${f.email ? `<code>${esc(f.email)}</code>` : '<span class="text-muted">—</span>'}</td>
        <td><span class="status-badge ${e.cls}">${esc(e.txt)}</span></td>
        <td style="font-size:0.78rem;">${fechas || '<span class="text-muted">—</span>'}</td>
        <td><div style="display:flex; gap:6px; flex-wrap:wrap;">${acciones(f)}</div></td>
      </tr>`;
    }).join('');
  }

  function cargar() {
    $('envio-lista').innerHTML = '<tr><td colspan="5" class="text-center py-4"><div class="spinner spinner-small" style="margin:auto;"></div></td></tr>';
    return fetch('/api/emails/manual/overview', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.success) throw new Error(d.message);
        filas = d.data || [];
        render();
      })
      .catch((err) => {
        $('envio-lista').innerHTML = `<tr><td colspan="5" class="text-center py-4 text-red">${esc(err.message || 'Error al cargar.')}</td></tr>`;
      });
  }

  const post = (url) => fetch(url, { method: 'POST', credentials: 'include' }).then((r) => r.json());

  function redactar(id) {
    // La pestaña se abre dentro del clic para que el navegador no la bloquee
    const win = window.open('about:blank', '_blank');
    post(`/api/emails/manual/prepare/${id}`)
      .then((d) => {
        if (!d.success) throw new Error(d.message);
        const url = COMPOSE[cliente()](d.to, d.subject, d.body);
        if (win) { win.opener = null; win.location.href = url; } else { window.open(url, '_blank', 'noopener'); }
        const f = filas.find((x) => String(x.id) === String(id));
        if (f) { f.estado = 'preparado'; f.log_id = d.logId; }
        render();
      })
      .catch((err) => {
        if (win) win.close();
        alert(`No se pudo preparar el correo: ${err.message}`);
      });
  }

  function marcar(logId, deshacer) {
    if (deshacer && !confirm('¿Deshacer la marca de enviado? Úselo solo si el correo no salió.')) return;
    post(`/api/emails/manual/${deshacer ? 'unmark' : 'mark-sent'}/${logId}`)
      .then((d) => {
        if (!d.success) throw new Error(d.message);
        return cargar();
      })
      .catch((err) => alert(err.message || 'Error al registrar.'));
  }

  function rebote(logId) {
    const motivo = prompt('Motivo del rebote:', 'La cuenta de correo no existe');
    if (motivo === null) return;
    fetch(`/api/emails/manual/bounce/${logId}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motivo: `Rebote: ${motivo}` })
    })
      .then((r) => r.json())
      .then((d) => { if (!d.success) throw new Error(d.message); return cargar(); })
      .catch((err) => alert(err.message || 'Error al registrar el rebote.'));
  }

  function exportar() {
    const lista = visibles();
    const celda = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const filasCsv = [['Nombre', 'Tipo documento', 'Documento', 'Correo', 'Estado', 'Fecha envío', 'Fecha descarga']]
      .concat(lista.map((f) => [f.full_name, f.document_type, f.document_number, f.email, (ESTADOS[f.estado] || {}).txt, fmt(f.sent_at), fmt(f.opened_at)]));
    const csv = '﻿' + filasCsv.map((r) => r.map(celda).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `envio-carnes-${$('envio-filtro').value}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!$('view-envio-manual')) return;
    try {
      const guardado = localStorage.getItem('envio-cliente');
      if (guardado && COMPOSE[guardado]) $('envio-cliente').value = guardado;
    } catch (e) { /* sin almacenamiento local */ }

    $('envio-cliente').addEventListener('change', (e) => {
      try { localStorage.setItem('envio-cliente', e.target.value); } catch (err) { /* ignorar */ }
    });
    $('envio-filtro').addEventListener('change', render);
    $('envio-buscar').addEventListener('input', render);
    $('envio-actualizar').addEventListener('click', cargar);
    $('envio-exportar').addEventListener('click', exportar);

    $('envio-lista').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { id, log } = btn.dataset;
      if (btn.classList.contains('envio-redactar')) redactar(id);
      else if (btn.classList.contains('envio-marcar')) marcar(log, false);
      else if (btn.classList.contains('envio-deshacer')) marcar(log, true);
      else if (btn.classList.contains('envio-rebote')) rebote(log);
      else if (btn.classList.contains('envio-cert-envio')) window.open(`/api/emails/certificate/${log}/send`, '_blank');
      else if (btn.classList.contains('envio-cert-lectura')) window.open(`/api/emails/certificate/${log}/open`, '_blank');
    });
  });

  window.cargarEnvioManual = cargar;
})();
