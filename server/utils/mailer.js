const nodemailer = require('nodemailer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { generateCardPdf } = require('../routes/pdf');
const fetch = require('node-fetch');

// Helper to create Nodemailer transporter
function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = parseInt(process.env.SMTP_PORT, 10) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.warn('⚠️ SMTP_USER o SMTP_PASS no están configurados en las variables de entorno. Los correos se simularán.');
    return null;
  }

  return nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465, // true for 465, false for 587 (STARTTLS)
    auth: {
      user: user,
      pass: pass
    },
    tls: {
      ciphers: 'SSLv3',
      rejectUnauthorized: false
    }
  });
}

// Generate institutional HTML email
function generateEmailHtml({ beneficiary, confirmUrl, trackUrl }) {
  const validityText = '24/08/2026 - 24/08/2028';

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Entrega Oficial de Carné de Identificación</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background-color: #f4f6f9; margin: 0; padding: 20px; color: #1e293b; }
    .email-wrapper { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .email-header { background: #162b63; padding: 30px 25px; text-align: center; color: #ffffff; border-bottom: 4px solid #f2bd2b; }
    .email-header h1 { margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; letter-spacing: 0.5px; }
    .email-header p { margin: 6px 0 0 0; font-size: 13px; color: #f2bd2b; font-weight: 600; }
    .email-body { padding: 30px 25px; }
    .greeting { font-size: 16px; font-weight: 600; margin-bottom: 15px; color: #0f172a; }
    .intro-text { font-size: 14px; line-height: 1.6; color: #334155; margin-bottom: 20px; }
    .info-card { background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #162b63; border-radius: 6px; padding: 16px 20px; margin-bottom: 25px; }
    .info-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; }
    .info-row:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .info-label { font-weight: 600; color: #475569; }
    .info-value { font-weight: 700; color: #0f172a; text-align: right; }
    .btn-container { text-align: center; margin: 30px 0; }
    .btn-download { display: inline-block; background: #162b63; color: #ffffff !important; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 700; border-radius: 8px; box-shadow: 0 4px 10px rgba(22, 43, 99, 0.3); border: 2px solid #f2bd2b; }
    .legal-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 12px 16px; font-size: 11px; color: #92400e; line-height: 1.5; margin-bottom: 20px; }
    .email-footer { background: #0f172a; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <!-- Header -->
    <div class="email-header">
      <h1>SISTEMA DE CARNETIZACIÓN OFICIAL</h1>
      <p>Fallo Sentencia AP 314-2023 | San Victorino</p>
    </div>

    <!-- Body -->
    <div class="email-body">
      <div class="greeting">Estimado(a) ${beneficiary.full_name.toUpperCase()},</div>
      <p class="intro-text">
        Nos complace informarle que su carné de identificación para el ejercicio de su actividad en el sector de San Victorino ha sido generado exitosamente de conformidad con lo dispuesto en el fallo judicial.
      </p>

      <!-- Details Card -->
      <div class="info-card">
        <table width="100%" cellpadding="4" cellspacing="0" style="font-size: 13px;">
          <tr>
            <td style="color: #475569; font-weight: 600;">Nombre Completo:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: right;">${beneficiary.full_name.toUpperCase()}</td>
          </tr>
          <tr>
            <td style="color: #475569; font-weight: 600;">Identificación:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: right;">${beneficiary.document_type} ${beneficiary.document_number}</td>
          </tr>
          <tr>
            <td style="color: #475569; font-weight: 600;">Código RIVI:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: right;">${beneficiary.rivi || 'No Registra'}</td>
          </tr>
          <tr>
            <td style="color: #475569; font-weight: 600;">Actividad Económica:</td>
            <td style="color: #0f172a; font-weight: 700; text-align: right;">${beneficiary.economic_activity}</td>
          </tr>
          <tr>
            <td style="color: #475569; font-weight: 600;">Periodo de Vigencia:</td>
            <td style="color: #162b63; font-weight: 700; text-align: right;">${validityText}</td>
          </tr>
        </table>
      </div>

      <!-- Action Button -->
      <div class="btn-container">
        <a href="${confirmUrl}" class="btn-download" target="_blank">
          📥 Ver / Descargar mi Carné Oficial
        </a>
      </div>

      <!-- Legal disclaimer -->
      <div class="legal-box">
        <strong>Nota Legal Importante:</strong> La expedición del presente carné se realiza exclusivamente en cumplimiento de lo ordenado en el Fallo Sentencia A.P. 314-2023. En ningún caso constituye permiso, autorización, licencia o reconocimiento alguno para el ejercicio de actividades de venta en el espacio público.
      </div>

      <p style="font-size: 12px; color: #64748b; text-align: center;">
        Adjunto a este correo encontrará también el archivo PDF original de su carné listo para imprimir o portar en su dispositivo móvil.
      </p>
    </div>

    <!-- Footer -->
    <div class="email-footer">
      <p style="margin: 0 0 5px 0;">Sistema de Notificaciones Oficiales — San Victorino</p>
      <p style="margin: 0; font-size: 11px;">Bogotá D.C., Colombia</p>
    </div>
  </div>

  <!-- Tracking Pixel -->
  <img src="${trackUrl}" width="1" height="1" style="display:none !important;" alt="">
</body>
</html>
  `;
}

// Function to send carnet by email
async function sendCarnetEmail(beneficiary, host) {
  const recipientEmail = beneficiary.email ? beneficiary.email.trim() : null;

  if (!recipientEmail || !recipientEmail.includes('@')) {
    throw new Error('El beneficiario no tiene un correo electrónico válido registrado.');
  }

  const trackingToken = crypto.randomUUID();
  const protocol = (host && host.includes('localhost')) ? 'http' : 'https';
  const baseUrl = `${protocol}://${host || 'localhost:3000'}`;
  const confirmUrl = `${baseUrl}/api/emails/confirm/${trackingToken}`;
  const trackUrl = `${baseUrl}/api/emails/track/${trackingToken}`;

  // 1. Generate PDF badge
  const pdfBytes = await generateCardPdf(beneficiary, host || 'localhost:3000');
  const pdfBuffer = Buffer.from(pdfBytes);

  // 2. Compute SHA-256 hash of the attached PDF for delivery certification
  const pdfHash = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  // 3. Generate HTML body
  const htmlContent = generateEmailHtml({ beneficiary, confirmUrl, trackUrl });

  // 4. Send email
  const transporter = getTransporter();
  const fromAddress = process.env.SMTP_FROM || process.env.SMTP_USER || "\"Sistema de Carnetización - San Victorino\" <notificaciones@alcaldiabogota.gov.co>";
  const subject = `Carné Oficial de Identificación - ${beneficiary.full_name} (${beneficiary.document_number})`;

  let messageId = `simulated-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@office365.local`;

  if (transporter) {
    // Use SMTP (Nodemailer)
    const info = await transporter.sendMail({
      from: fromAddress,
      to: recipientEmail,
      subject: subject,
      html: htmlContent,
      attachments: [{
        filename: `carnet-${beneficiary.document_number}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }]
    });
    messageId = info.messageId || messageId;
    console.log(`✉️ Correo enviado exitosamente a ${recipientEmail}. MessageId: ${messageId}`);
  } else if (process.env.SENDGRID_API_KEY) {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(process.env.SENDGRID_API_KEY);
      const msg = {
        to: recipientEmail,
        from: fromAddress,
        subject: subject,
        html: htmlContent,
        attachments: [
          {
            content: pdfBuffer.toString('base64'),
            filename: `carnet-${beneficiary.document_number}.pdf`,
            type: 'application/pdf',
            disposition: 'attachment'
          }
        ]
      };
      const [response] = await sgMail.send(msg);
      messageId = response?.headers?.['x-message-id'] || messageId;
      console.log(`✉️ Correo enviado vía SendGrid a ${recipientEmail}. MessageId: ${messageId}`);

  } else if (process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET && process.env.GRAPH_TENANT_ID && process.env.GRAPH_USER) {
    // Use Microsoft Graph API
    const tokenResponse = await fetch(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GRAPH_CLIENT_ID,
        scope: 'https://graph.microsoft.com/.default',
        client_secret: process.env.GRAPH_CLIENT_SECRET,
        grant_type: 'client_credentials'
      })
    });
    const tokenData = await tokenResponse.json();
    console.log('🔐 Graph token response:', tokenResponse.status, tokenData);
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      console.error('❌ No se obtuvo token de Graph:', tokenData);
      throw new Error('Falló la autenticación con Microsoft Graph');
    }
    const graphResponse = await fetch(`https://graph.microsoft.com/v1.0/users/${process.env.GRAPH_USER}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          subject: subject,
          body: { contentType: 'HTML', content: htmlContent },
          toRecipients: [{ emailAddress: { address: recipientEmail } }],
          // from is omitted; Graph uses the authenticated user
          attachments: [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: `carnet-${beneficiary.document_number}.pdf`,
            contentBytes: pdfBuffer.toString('base64'),
            contentType: 'application/pdf'
          }]
        },
        saveToSentItems: true
      })
    });
    console.log('📤 Graph sendMail response status:', graphResponse.status);
    const graphResponseText = await graphResponse.text();
    if (graphResponse.status === 202) {
      messageId = `graph-${Date.now()}`;
      console.log(`✉️ Correo enviado vía Microsoft Graph a ${recipientEmail}.`);
    } else {
      console.error('❌ Error al enviar correo vía Graph. Status:', graphResponse.status, 'Body:', graphResponseText);
      throw new Error(`Falló el envío de correo mediante Microsoft Graph (status ${graphResponse.status})`);
    }
  } else {
    // Simulación cuando no hay credenciales ni Graph
    console.log(`[SIMULACIÓN] Correo generado para ${recipientEmail}. TrackingToken: ${trackingToken}`);
  }

  return {
    success: true,
    messageId: messageId,
    trackingToken: trackingToken,
    pdfHash: pdfHash,
    recipientEmail: recipientEmail,
    subject: subject,
    pdfBuffer: pdfBuffer
  };
}

module.exports = {
  sendCarnetEmail,
  generateEmailHtml,
  getTransporter
};
