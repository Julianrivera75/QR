// Envío MANUAL de carnés desde el buzón institucional abierto en el navegador.
// Flujo: preparar (crea el registro y el enlace personal) → el operador envía en
// Outlook → marcar enviado. La descarga por el enlace marca la recepción.
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { publicHost } = require('../utils/host');
const { buildManualMessage, isValidEmail } = require('../utils/manualMessage');

router.use(authenticateToken);

const baseUrlFrom = (req) => {
  const host = publicHost(req);
  const protocol = host && host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${host}`;
};

const operador = (req) => (req.user && (req.user.username || req.user.id)) || 'admin';

async function audit(req, beneficiaryId, action, data) {
  try {
    await dbRun(
      'INSERT INTO audit_logs (user_id, beneficiary_id, action, fields_changed) VALUES (?, ?, ?, ?)',
      [req.user ? req.user.id : null, beneficiaryId, action, JSON.stringify(data)]
    );
  } catch (err) {
    console.error('No se pudo registrar auditoría de envío manual:', err.message);
  }
}

// GET /api/emails/manual/overview - todos los vendedores con el estado de su último envío
router.get('/overview', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT b.id, b.full_name, b.document_type, b.document_number, b.email,
             el.id AS log_id, el.status AS log_status, el.sent_at, el.opened_at,
             el.recipient_email, el.smtp_message_id, el.error_message
      FROM beneficiaries b
      LEFT JOIN email_logs el ON el.id = (
        SELECT MAX(e2.id) FROM email_logs e2
        WHERE e2.beneficiary_id = b.id
      )
      ORDER BY b.full_name
    `);

    const data = rows.map((r) => {
      let estado;
      const mismoCorreo = r.recipient_email && String(r.email || '').trim() === r.recipient_email;
      if (r.log_status === 'failed' && mismoCorreo) estado = 'rebotado';
      else if (r.log_status === 'opened' || r.opened_at) estado = 'descargado';
      else if (r.log_status === 'sent') estado = 'enviado';
      else if (!isValidEmail(r.email)) estado = 'sin_correo';
      else if (r.log_status === 'prepared') estado = 'preparado';
      else estado = 'pendiente';
      return {
        id: r.id,
        full_name: r.full_name,
        document_type: r.document_type,
        document_number: r.document_number,
        email: r.email ? String(r.email).trim() : '',
        estado,
        log_id: r.log_id,
        sent_at: r.log_status === 'prepared' ? null : r.sent_at,
        error: r.log_status === 'failed' ? r.error_message : null,
        opened_at: r.opened_at,
        manual: String(r.smtp_message_id || '').startsWith('manual:')
      };
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error en resumen de envíos manuales:', error);
    return res.status(500).json({ success: false, message: 'Error al cargar el estado de envíos.' });
  }
});

// POST /api/emails/manual/prepare/:id - crea (o reutiliza) el registro y devuelve el mensaje
router.post('/prepare/:id', async (req, res) => {
  try {
    const b = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [req.params.id]);
    if (!b) return res.status(404).json({ success: false, message: 'Vendedor no encontrado.' });
    const email = b.email ? String(b.email).trim() : '';
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'El vendedor no tiene un correo electrónico válido.' });
    }

    // Reutiliza un borrador anterior al mismo correo para no generar enlaces duplicados
    let log = await dbGet(
      "SELECT * FROM email_logs WHERE beneficiary_id = ? AND status = 'prepared' AND recipient_email = ? ORDER BY id DESC LIMIT 1",
      [b.id, email]
    );
    const token = log ? log.tracking_token : crypto.randomUUID();
    const msg = buildManualMessage(b, baseUrlFrom(req), token);

    if (!log) {
      await dbRun(
        `INSERT INTO email_logs (beneficiary_id, recipient_email, subject, status, sent_at, tracking_token)
         VALUES (?, ?, ?, 'prepared', CURRENT_TIMESTAMP, ?)`,
        [b.id, email, msg.subject.slice(0, 255), token]
      );
      log = await dbGet('SELECT * FROM email_logs WHERE tracking_token = ?', [token]);
    }

    return res.json({ success: true, logId: log.id, to: email, subject: msg.subject, body: msg.body });
  } catch (error) {
    console.error('Error preparando envío manual:', error);
    return res.status(500).json({ success: false, message: 'Error al preparar el correo.' });
  }
});

// POST /api/emails/manual/mark-sent/:logId - el operador confirma que lo envió
router.post('/mark-sent/:logId', async (req, res) => {
  try {
    const log = await dbGet('SELECT * FROM email_logs WHERE id = ?', [req.params.logId]);
    if (!log) return res.status(404).json({ success: false, message: 'Registro no encontrado.' });
    const marca = `manual:${operador(req)}`.slice(0, 255);

    if (log.status === 'prepared') {
      await dbRun(
        "UPDATE email_logs SET status = 'sent', sent_at = CURRENT_TIMESTAMP, smtp_message_id = ? WHERE id = ? AND status = 'prepared'",
        [marca, log.id]
      );
    } else if (log.status === 'opened' && !log.smtp_message_id) {
      // Ya lo descargó antes de que se marcara: solo se deja constancia del operador
      await dbRun('UPDATE email_logs SET smtp_message_id = ? WHERE id = ?', [marca, log.id]);
    } else if (log.status !== 'sent' && log.status !== 'opened') {
      return res.status(400).json({ success: false, message: 'Este registro no se puede marcar como enviado.' });
    }

    await audit(req, log.beneficiary_id, 'EMAIL_MANUAL_SENT', { correo: log.recipient_email, registro: log.id });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error marcando envío manual:', error);
    return res.status(500).json({ success: false, message: 'Error al registrar el envío.' });
  }
});

// POST /api/emails/manual/bounce/:logId - el correo rebotó (la cuenta no existe, buzón lleno...)
router.post('/bounce/:logId', async (req, res) => {
  try {
    const log = await dbGet('SELECT * FROM email_logs WHERE id = ?', [req.params.logId]);
    if (!log) return res.status(404).json({ success: false, message: 'Registro no encontrado.' });
    if (!['sent', 'opened'].includes(log.status)) {
      return res.status(400).json({ success: false, message: 'Solo se registra rebote de un correo enviado.' });
    }
    const motivo = String((req.body && req.body.motivo) || 'Rebote: el servidor de destino rechazó el correo').slice(0, 500);
    // Un rebote anula cualquier "apertura": nadie recibió el mensaje
    await dbRun("UPDATE email_logs SET status = 'failed', opened_at = NULL, error_message = ? WHERE id = ?", [motivo, log.id]);
    await audit(req, log.beneficiary_id, 'EMAIL_BOUNCE', { correo: log.recipient_email, registro: log.id, motivo });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error registrando rebote:', error);
    return res.status(500).json({ success: false, message: 'Error al registrar el rebote.' });
  }
});

// POST /api/emails/manual/unmark/:logId - corrige una marca hecha por error (si no hay descarga)
router.post('/unmark/:logId', async (req, res) => {
  try {
    const log = await dbGet('SELECT * FROM email_logs WHERE id = ?', [req.params.logId]);
    if (!log) return res.status(404).json({ success: false, message: 'Registro no encontrado.' });
    if (log.status !== 'sent' || log.opened_at || !String(log.smtp_message_id || '').startsWith('manual:')) {
      return res.status(400).json({ success: false, message: 'Solo se puede deshacer un envío manual que aún no se ha descargado.' });
    }
    await dbRun("UPDATE email_logs SET status = 'prepared', smtp_message_id = NULL WHERE id = ?", [log.id]);
    await audit(req, log.beneficiary_id, 'EMAIL_MANUAL_UNMARK', { correo: log.recipient_email, registro: log.id });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deshaciendo envío manual:', error);
    return res.status(500).json({ success: false, message: 'Error al deshacer la marca.' });
  }
});

module.exports = router;
