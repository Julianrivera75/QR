const express = require('express');
const router = express.Router();
const { dbGet, dbAll, dbRun } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { sendCarnetEmail } = require('../utils/mailer');
const { generateSendCertificatePdf, generateOpenCertificatePdf } = require('../utils/certificates');
const { generateCardPdf } = require('./pdf');
const { publicHost } = require('../utils/host');

// 1x1 Transparent GIF Buffer for tracking pixel
const TRANSPARENT_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// GET /api/emails/logs - Get all email logs with beneficiary details
router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const logs = await dbAll(`
      SELECT 
        el.id,
        el.beneficiary_id,
        el.recipient_email,
        el.subject,
        el.status,
        el.sent_at,
        el.opened_at,
        el.smtp_message_id,
        el.tracking_token,
        el.pdf_hash,
        el.error_message,
        b.full_name as beneficiary_name,
        b.document_type as beneficiary_doc_type,
        b.document_number as beneficiary_document,
        b.uuid as beneficiary_uuid
      FROM email_logs el
      LEFT JOIN beneficiaries b ON el.beneficiary_id = b.id
      WHERE el.status <> 'prepared'
      ORDER BY el.sent_at DESC
      LIMIT 5000
    `);

    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching email logs:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener historial de correos.' });
  }
});

// POST /api/emails/send/:id - Send carnet to a single beneficiary
router.post('/send/:id', authenticateToken, async (req, res) => {
  const beneficiaryId = req.params.id;

  try {
    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [beneficiaryId]);
    if (!beneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    if (!beneficiary.email || !beneficiary.email.trim() || !beneficiary.email.includes('@')) {
      return res.status(400).json({ success: false, message: 'El beneficiario no tiene un correo electrónico registrado válido.' });
    }

    const host = publicHost(req);
    const result = await sendCarnetEmail(beneficiary, host);

    // Insert into email_logs
    await dbRun(`
      INSERT INTO email_logs (
        beneficiary_id, recipient_email, subject, status, sent_at,
        smtp_message_id, tracking_token, pdf_hash
      ) VALUES (?, ?, ?, 'sent', CURRENT_TIMESTAMP, ?, ?, ?)
    `, [
      beneficiary.id, result.recipientEmail, result.subject,
      result.messageId, result.trackingToken, result.pdfHash
    ]);

    const inserted = await dbGet('SELECT id FROM email_logs WHERE tracking_token = ?', [result.trackingToken]);

    return res.json({
      success: true,
      message: `Carné enviado exitosamente a ${result.recipientEmail}`,
      logId: inserted ? inserted.id : null,
      trackingToken: result.trackingToken
    });

  } catch (error) {
    console.error('Error sending single email:', error);

    // Log failure in database if beneficiary exists
    try {
      const b = await dbGet('SELECT id, email FROM beneficiaries WHERE id = ?', [beneficiaryId]);
      if (b && b.email) {
        const crypto = require('crypto');
        await dbRun(`
          INSERT INTO email_logs (
            beneficiary_id, recipient_email, subject, status, sent_at,
            tracking_token, error_message
          ) VALUES (?, ?, 'Carné Oficial', 'failed', CURRENT_TIMESTAMP, ?, ?)
        `, [b.id, b.email, crypto.randomUUID(), error.message]);
      }
    } catch (logErr) {
      console.error('Error logging email failure:', logErr);
    }

    return res.status(500).json({ success: false, message: `Error al enviar correo: ${error.message}` });
  }
});

// POST /api/emails/send-bulk - Send carnets to multiple beneficiaries
router.post('/send-bulk', authenticateToken, async (req, res) => {
  const { ids } = req.body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs válida.' });
  }

  try {
    const placeholders = ids.map(() => '?').join(',');
    const beneficiaries = await dbAll(`SELECT * FROM beneficiaries WHERE id IN (${placeholders})`, ids);

    if (beneficiaries.length === 0) {
      return res.status(404).json({ success: false, message: 'No se encontraron beneficiarios coincidentes.' });
    }

    const host = publicHost(req);
    let sentCount = 0;
    let failedCount = 0;
    const errors = [];

    for (const b of beneficiaries) {
      if (!b.email || !b.email.trim() || !b.email.includes('@')) {
        failedCount++;
        errors.push(`${b.full_name} (${b.document_number}): Sin correo electrónico`);
        continue;
      }

      try {
        const result = await sendCarnetEmail(b, host);
        await dbRun(`
          INSERT INTO email_logs (
            beneficiary_id, recipient_email, subject, status, sent_at,
            smtp_message_id, tracking_token, pdf_hash
          ) VALUES (?, ?, ?, 'sent', CURRENT_TIMESTAMP, ?, ?, ?)
        `, [
          b.id, result.recipientEmail, result.subject,
          result.messageId, result.trackingToken, result.pdfHash
        ]);
        sentCount++;
      } catch (err) {
        failedCount++;
        errors.push(`${b.full_name} (${b.document_number}): ${err.message}`);
      }
    }

    return res.json({
      success: true,
      message: `Proceso completado. Enviados: ${sentCount}, No enviados: ${failedCount}`,
      sentCount,
      failedCount,
      errors
    });

  } catch (error) {
    console.error('Error in bulk email sending:', error);
    return res.status(500).json({ success: false, message: 'Error general en el envío masivo de correos.' });
  }
});

// Enlace personal de descarga. El GET solo muestra una página con un botón: los
// filtros de seguridad del correo (Safe Links, antivirus) abren los enlaces de forma
// automática y no deben contar como recepción. La descarga real es el POST del botón.
async function findValidConfirmLog(token) {
  const log = await dbGet('SELECT * FROM email_logs WHERE tracking_token = ?', [token]);
  if (!log || log.status === 'failed') return { error: 404 };
  // Links expire after CONFIRM_LINK_TTL_DAYS (default 30); admins can resend the card
  const ttlDays = parseInt(process.env.CONFIRM_LINK_TTL_DAYS, 10) || 30;
  const sentAt = new Date(log.sent_at);
  if (!isNaN(sentAt) && Date.now() - sentAt.getTime() > ttlDays * 24 * 60 * 60 * 1000) return { error: 410 };
  return { log };
}

const confirmPage = (inner) => `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex">
<title>Carné de identificación - San Victorino</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f9;margin:0;padding:24px 16px;color:#1e293b}
.box{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden}
.top{background:#162b63;color:#fff;padding:22px;text-align:center;border-bottom:4px solid #f2bd2b}
.top h1{margin:0;font-size:18px}.top p{margin:6px 0 0;color:#f2bd2b;font-size:13px}
.in{padding:24px;text-align:center;font-size:15px;line-height:1.5}
button{background:#162b63;color:#fff;border:2px solid #f2bd2b;border-radius:8px;padding:14px 26px;font-size:16px;font-weight:700;cursor:pointer}
small{display:block;margin-top:18px;color:#64748b;font-size:12px}</style></head>
<body><div class="box"><div class="top"><h1>Carné de identificación</h1><p>Fallo Sentencia A.P. 314-2023 | San Victorino</p></div>
<div class="in">${inner}</div></div></body></html>`;

const EXPIRED = 'Este enlace ha expirado. Solicite un nuevo envío del carné a la Alcaldía Local de Santa Fe.';

// GET /api/emails/confirm/:token - página con el botón de descarga (no registra nada)
router.get('/confirm/:token', async (req, res) => {
  try {
    const { error } = await findValidConfirmLog(req.params.token);
    res.setHeader('Cache-Control', 'no-store');
    if (error === 410) return res.status(410).send(confirmPage(EXPIRED));
    if (error) return res.status(404).send(confirmPage('Enlace no válido. Verifique el enlace recibido en su correo.'));
    const token = encodeURIComponent(req.params.token);
    return res.send(confirmPage(`<p>Su carné de identificación está listo.</p>
<form method="POST" action="/api/emails/confirm/${token}"><button type="submit">Descargar mi carné</button></form>
<small>Al descargarlo queda registrada la recepción de su carné.</small>`));
  } catch (error) {
    console.error('Error showing confirm page:', error);
    return res.status(500).send('Error al procesar el enlace del carné.');
  }
});

// POST /api/emails/confirm/:token - descarga real: registra la recepción y entrega el PDF
router.post('/confirm/:token', async (req, res) => {
  try {
    const { log, error } = await findValidConfirmLog(req.params.token);
    if (error === 410) return res.status(410).send(confirmPage(EXPIRED));
    if (error) return res.status(404).send(confirmPage('Enlace no válido.'));

    await dbRun(`
      UPDATE email_logs
      SET status = 'opened', opened_at = CURRENT_TIMESTAMP
      WHERE id = ? AND opened_at IS NULL
    `, [log.id]);

    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [log.beneficiary_id]);
    if (!beneficiary) return res.status(404).send(confirmPage('Vendedor no encontrado.'));

    const host = publicHost(req);
    const pdfBytes = await generateCardPdf(beneficiary, host);
    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=carnet-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error confirming email read:', error);
    return res.status(500).send('Error al procesar la confirmación del carné.');
  }
});

// GET /api/emails/track/:token - Tracking Pixel
router.get('/track/:token', async (req, res) => {
  const { token } = req.params;

  try {
    await dbRun(`
      UPDATE email_logs 
      SET status = 'opened', opened_at = CURRENT_TIMESTAMP 
      WHERE tracking_token = ? AND opened_at IS NULL
    `, [token]);
  } catch (err) {
    // Silent fail on pixel tracking
  }

  res.contentType('image/gif');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  // Allow webmail clients on other origins to load the tracking pixel
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(TRANSPARENT_GIF);
});

// GET /api/emails/certificate/:id/send - Download Delivery Certificate
router.get('/certificate/:id/send', authenticateToken, async (req, res) => {
  try {
    const log = await dbGet('SELECT * FROM email_logs WHERE id = ?', [req.params.id]);
    if (!log || log.status === 'prepared' || log.status === 'failed') {
      return res.status(404).json({ success: false, message: 'Registro de envío no encontrado.' });
    }

    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [log.beneficiary_id]);
    if (!beneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    const host = publicHost(req);
    const certBytes = await generateSendCertificatePdf(log, beneficiary, host);

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificado-envio-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(certBytes));

  } catch (error) {
    console.error('Error generating send certificate:', error);
    return res.status(500).json({ success: false, message: 'Error al generar certificado de envío.' });
  }
});

// GET /api/emails/certificate/:id/open - Download Open/Read Certificate
router.get('/certificate/:id/open', authenticateToken, async (req, res) => {
  try {
    const log = await dbGet('SELECT * FROM email_logs WHERE id = ?', [req.params.id]);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Registro de envío no encontrado.' });
    }

    if (log.status !== 'opened' && !log.opened_at) {
      return res.status(400).json({ success: false, message: 'El correo aún no ha sido abierto o confirmado por el destinatario.' });
    }

    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [log.beneficiary_id]);
    if (!beneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    const host = publicHost(req);
    const certBytes = await generateOpenCertificatePdf(log, beneficiary, host);

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificado-apertura-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(certBytes));

  } catch (error) {
    console.error('Error generating open certificate:', error);
    return res.status(500).json({ success: false, message: 'Error al generar certificado de apertura.' });
  }
});

// GET /api/emails/certificate/beneficiary/:beneficiaryId/send - Download Delivery Certificate by Beneficiary ID
router.get('/certificate/beneficiary/:beneficiaryId/send', authenticateToken, async (req, res) => {
  try {
    const beneficiaryId = req.params.beneficiaryId;
    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [beneficiaryId]);
    if (!beneficiary) {
      return res.status(404).send('Beneficiario no encontrado.');
    }

    const log = await dbGet("SELECT * FROM email_logs WHERE beneficiary_id = ? AND status IN ('sent', 'opened') ORDER BY sent_at DESC LIMIT 1", [beneficiaryId]);
    if (!log) {
      return res.status(404).send(`No se registra ningún envío de correo previo para el vendedor ${beneficiary.full_name}. Debe enviarle el carné por correo primero.`);
    }

    const host = publicHost(req);
    const certBytes = await generateSendCertificatePdf(log, beneficiary, host);

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificado-envio-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(certBytes));

  } catch (error) {
    console.error('Error generating send certificate by beneficiary:', error);
    return res.status(500).send('Error al generar certificado de envío.');
  }
});

// GET /api/emails/certificate/beneficiary/:beneficiaryId/open - Download Open Certificate by Beneficiary ID
router.get('/certificate/beneficiary/:beneficiaryId/open', authenticateToken, async (req, res) => {
  try {
    const beneficiaryId = req.params.beneficiaryId;
    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [beneficiaryId]);
    if (!beneficiary) {
      return res.status(404).send('Beneficiario no encontrado.');
    }

    const log = await dbGet("SELECT * FROM email_logs WHERE beneficiary_id = ? AND status IN ('sent', 'opened') ORDER BY sent_at DESC LIMIT 1", [beneficiaryId]);
    if (!log) {
      return res.status(404).send(`No se registra ningún envío de correo previo para el vendedor ${beneficiary.full_name}.`);
    }

    if (log.status !== 'opened' && !log.opened_at) {
      return res.status(400).send(`El vendedor ${beneficiary.full_name} aún no ha abierto ni confirmado la recepción de su carné.`);
    }

    const host = publicHost(req);
    const certBytes = await generateOpenCertificatePdf(log, beneficiary, host);

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificado-apertura-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(certBytes));

  } catch (error) {
    console.error('Error generating open certificate by beneficiary:', error);
    return res.status(500).send('Error al generar certificado de apertura.');
  }
});

module.exports = router;
