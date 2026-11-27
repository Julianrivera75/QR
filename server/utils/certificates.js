const { safeFont } = require('./winansi');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const qr = require('qrcode');
const path = require('path');
const fs = require('fs');

// Helper to wrap text cleanly
function drawWrappedText(page, text, x, y, maxW, font, size, color, lineHeight = 1.3) {
  const words = String(text).split(' ');
  let line = '';
  let curY = y;
  
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    const testW = font.widthOfTextAtSize(testLine, size);
    if (testW > maxW && i > 0) {
      page.drawText(line.trim(), { x, y: curY, size, font, color });
      line = words[i] + ' ';
      curY -= size * lineHeight;
    } else {
      line = testLine;
    }
  }
  page.drawText(line.trim(), { x, y: curY, size, font, color });
  return curY - size * lineHeight;
}

// Generate Delivery Certificate PDF
async function generateSendCertificatePdf(emailLog, beneficiary, host) {
  const width = 595; // A4 portrait width
  const height = 842; // A4 portrait height

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([width, height]);

  const fontHelvetica = safeFont(await pdfDoc.embedFont(StandardFonts.Helvetica));
  const fontHelveticaBold = safeFont(await pdfDoc.embedFont(StandardFonts.HelveticaBold));

  const colorNavy = rgb(22 / 255, 43 / 255, 99 / 255);
  const colorGold = rgb(200 / 255, 155 / 255, 30 / 255);
  const colorDarkGray = rgb(0.15, 0.2, 0.25);
  const colorLightGray = rgb(0.95, 0.96, 0.98);
  const colorBorder = rgb(0.85, 0.88, 0.92);
  const colorGreen = rgb(0.1, 0.55, 0.2);
  const colorWhite = rgb(1, 1, 1);

  // Border frame
  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: colorNavy,
    borderWidth: 2,
    color: colorWhite
  });

  page.drawRectangle({
    x: 25,
    y: 25,
    width: width - 50,
    height: height - 50,
    borderColor: colorGold,
    borderWidth: 1
  });

  // Top header banner
  page.drawRectangle({
    x: 26,
    y: height - 100,
    width: width - 52,
    height: 74,
    color: colorNavy
  });

  page.drawText('SISTEMA OFICIAL DE NOTIFICACIÓN ELECTRÓNICA', {
    x: 45,
    y: height - 55,
    size: 14,
    font: fontHelveticaBold,
    color: colorWhite
  });

  page.drawText('Fallo Sentencia Judicial AP 314-2023 | San Victorino', {
    x: 45,
    y: height - 75,
    size: 10,
    font: fontHelvetica,
    color: colorGold
  });

  let y = height - 130;

  // Title
  const title = 'CERTIFICADO DE TRANSMISIÓN Y ENVÍO DE CREDENCIAL';
  const titleW = fontHelveticaBold.widthOfTextAtSize(title, 13);
  page.drawText(title, {
    x: (width - titleW) / 2,
    y: y,
    size: 13,
    font: fontHelveticaBold,
    color: colorNavy
  });

  y -= 25;

  // Certification statement
  const certText = `El Sistema Oficial de Notificaciones y Carnetización certifica mediante este documento que se ha efectuado la transmisión electrónica y despacho del carné de identificación oficial al correo registrado del vendedor informal, en cumplimiento estricto del fallo judicial y los lineamientos de acreditación institucional.`;
  y = drawWrappedText(page, certText, 45, y, width - 90, fontHelvetica, 9.5, colorDarkGray, 1.4);

  y -= 15;

  // Beneficiary Section Card
  page.drawRectangle({
    x: 45,
    y: y - 110,
    width: width - 90,
    height: 110,
    color: colorLightGray,
    borderColor: colorBorder,
    borderWidth: 1
  });

  page.drawText('1. DATOS DEL TITULAR DE LA CREDENCIAL', {
    x: 55,
    y: y - 18,
    size: 9.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  const bRows = [
    ['Nombre Completo:', (beneficiary.full_name || '').toUpperCase()],
    ['Documento de Identidad:', `${beneficiary.document_type || 'CC'} ${beneficiary.document_number}`],
    ['Actividad Económica:', beneficiary.economic_activity || 'No Definido']
  ];

  let by = y - 36;
  bRows.forEach(([lbl, val]) => {
    page.drawText(lbl, { x: 55, y: by, size: 8.5, font: fontHelveticaBold, color: colorDarkGray });
    page.drawText(val, { x: 220, y: by, size: 8.5, font: fontHelvetica, color: colorDarkGray });
    by -= 16;
  });

  y -= 130;

  // Technical Evidence Section Card
  page.drawRectangle({
    x: 45,
    y: y - 170,
    width: width - 90,
    height: 170,
    color: colorLightGray,
    borderColor: colorBorder,
    borderWidth: 1
  });

  // Envío manual: el operador lo envió desde el buzón institucional en el navegador
  const manual = String(emailLog.smtp_message_id || '').startsWith('manual:');
  const operador = manual ? String(emailLog.smtp_message_id).slice(7) : '';

  page.drawText(manual ? '2. EVIDENCIA DE DESPACHO DESDE BUZÓN INSTITUCIONAL' : '2. EVIDENCIA TÉCNICA DE DESPACHO SMTP (OFFICE 365)', {
    x: 55,
    y: y - 18,
    size: 9.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  const sentDate = emailLog.sent_at ? new Date(emailLog.sent_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });

  const techRows = manual ? [
    ['Correo Destinatario:', emailLog.recipient_email || ''],
    ['Fecha y Hora de Envío:', sentDate],
    ['Asunto:', emailLog.subject || 'Carné Oficial'],
    ['Medio de Envío:', 'Buzón institucional (correo web), envío manual'],
    ['Envío registrado por:', operador || 'Administrador'],
    ['Identificador Único (Token):', emailLog.tracking_token || ''],
    ['Estado:', 'ENVÍO REGISTRADO POR EL OPERADOR']
  ] : [
    ['Correo Destinatario:', emailLog.recipient_email || ''],
    ['Fecha y Hora de Salida:', sentDate],
    ['Asunto de Transmisión:', emailLog.subject || 'Carné Oficial'],
    ['Servidor de Salida:', 'Microsoft Office 365 SMTP (TLS Cifrado)'],
    ['Identificador SMTP (Message-ID):', emailLog.smtp_message_id || 'Generado por servidor SMTP'],
    ['Identificador Único (Token):', emailLog.tracking_token || ''],
    ['Estado de Transmisión:', 'TRANSMISIÓN EXITOSA (ENTREGADO AL SERVIDOR)']
  ];

  let ty = y - 36;
  techRows.forEach(([lbl, val], idx) => {
    const valColor = idx === 6 ? colorGreen : colorDarkGray;
    const valFont = idx === 6 ? fontHelveticaBold : fontHelvetica;
    page.drawText(lbl, { x: 55, y: ty, size: 8, font: fontHelveticaBold, color: colorDarkGray });
    page.drawText(String(val).slice(0, 55), { x: 220, y: ty, size: 8, font: valFont, color: valColor });
    ty -= 18;
  });

  y -= 190;

  // Cryptographic Integrity Card
  page.drawRectangle({
    x: 45,
    y: y - 75,
    width: width - 90,
    height: 75,
    color: colorLightGray,
    borderColor: colorBorder,
    borderWidth: 1
  });

  page.drawText(manual ? '3. FORMA DE ENTREGA DEL CARNÉ' : '3. FIRMA CRIPTOGRÁFICA DEL DOCUMENTO ADJUNTO', {
    x: 55,
    y: y - 18,
    size: 9.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  if (manual) {
    page.drawText('El carné se entrega mediante enlace personal de descarga incluido en el mensaje.', { x: 55, y: y - 36, size: 8, font: fontHelvetica, color: colorDarkGray });
    page.drawText('La descarga por el titular queda registrada y se acredita con el certificado de lectura.', { x: 55, y: y - 50, size: 8, font: fontHelvetica, color: colorDarkGray });
  } else {
    page.drawText('Hash SHA-256 del PDF:', { x: 55, y: y - 36, size: 8, font: fontHelveticaBold, color: colorDarkGray });
    page.drawText(emailLog.pdf_hash || 'No disponible', { x: 55, y: y - 50, size: 7.5, font: fontHelvetica, color: colorNavy });
  }

  y -= 95;

  // Bottom QR and verification box
  const qrSize = 65;
  const qrX = width - 45 - qrSize;
  const qrY = 50;
  const protocol = (host && host.includes('localhost')) ? 'http' : 'https';
  const verifyUrl = `${protocol}://${host || 'localhost:3000'}/validate.html?uuid=${beneficiary.uuid}`;

  try {
    const qrDataUrl = await qr.toDataURL(verifyUrl, { margin: 1, width: 120 });
    const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  } catch (qrErr) {
    console.error('Error drawing QR on certificate:', qrErr);
  }

  // Stamp text
  page.drawText('CERTIFICACIÓN OFICIAL VÁLIDA', { x: 45, y: qrY + 45, size: 9, font: fontHelveticaBold, color: colorNavy });
  page.drawText(manual
    ? 'Registro del envío en el sistema. El mensaje consta en Elementos enviados del buzón institucional.'
    : 'Este documento constituye prueba electrónica válida de notificación y entrega según los estándares técnicos del servidor de correo institucional.', {
    x: 45,
    y: qrY + 30,
    size: 7.5,
    font: fontHelvetica,
    color: colorDarkGray
  });
  page.drawText(`Fecha de expedición del certificado: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`, {
    x: 45,
    y: qrY + 15,
    size: 7.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  return await pdfDoc.save();
}

// Generate Opening / Read Certificate PDF
async function generateOpenCertificatePdf(emailLog, beneficiary, host) {
  const width = 595;
  const height = 842;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([width, height]);

  const fontHelvetica = safeFont(await pdfDoc.embedFont(StandardFonts.Helvetica));
  const fontHelveticaBold = safeFont(await pdfDoc.embedFont(StandardFonts.HelveticaBold));

  const colorNavy = rgb(22 / 255, 43 / 255, 99 / 255);
  const colorGold = rgb(200 / 255, 155 / 255, 30 / 255);
  const colorDarkGray = rgb(0.15, 0.2, 0.25);
  const colorLightGray = rgb(0.95, 0.96, 0.98);
  const colorBorder = rgb(0.85, 0.88, 0.92);
  const colorGreen = rgb(0.1, 0.55, 0.2);
  const colorWhite = rgb(1, 1, 1);

  // Border frame
  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: colorGreen,
    borderWidth: 2,
    color: colorWhite
  });

  page.drawRectangle({
    x: 25,
    y: 25,
    width: width - 50,
    height: height - 50,
    borderColor: colorGold,
    borderWidth: 1
  });

  // Top header banner
  page.drawRectangle({
    x: 26,
    y: height - 100,
    width: width - 52,
    height: 74,
    color: colorNavy
  });

  page.drawText('SISTEMA OFICIAL DE NOTIFICACIÓN ELECTRÓNICA', {
    x: 45,
    y: height - 55,
    size: 14,
    font: fontHelveticaBold,
    color: colorWhite
  });

  page.drawText('Fallo Sentencia Judicial AP 314-2023 | San Victorino', {
    x: 45,
    y: height - 75,
    size: 10,
    font: fontHelvetica,
    color: colorGold
  });

  let y = height - 130;

  // Title
  const title = 'CERTIFICADO DE APERTURA Y CONFIRMACIÓN DE LECTURA';
  const titleW = fontHelveticaBold.widthOfTextAtSize(title, 13);
  page.drawText(title, {
    x: (width - titleW) / 2,
    y: y,
    size: 13,
    font: fontHelveticaBold,
    color: colorGreen
  });

  y -= 25;

  const certText = `El Sistema Oficial certifica que el destinatario ha recibido, abierto y confirmado la visualización o descarga de su carné de identificación oficial generado en virtud del proceso de carnetización ordenado por el fallo judicial.`;
  y = drawWrappedText(page, certText, 45, y, width - 90, fontHelvetica, 9.5, colorDarkGray, 1.4);

  y -= 15;

  // Beneficiary Section Card
  page.drawRectangle({
    x: 45,
    y: y - 110,
    width: width - 90,
    height: 110,
    color: colorLightGray,
    borderColor: colorBorder,
    borderWidth: 1
  });

  page.drawText('1. DATOS DEL TITULAR', {
    x: 55,
    y: y - 18,
    size: 9.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  const bRows = [
    ['Nombre Completo:', (beneficiary.full_name || '').toUpperCase()],
    ['Documento de Identidad:', `${beneficiary.document_type || 'CC'} ${beneficiary.document_number}`],
    ['Correo Electrónico:', emailLog.recipient_email || ''],
  ];

  let by = y - 36;
  bRows.forEach(([lbl, val]) => {
    page.drawText(lbl, { x: 55, y: by, size: 8.5, font: fontHelveticaBold, color: colorDarkGray });
    page.drawText(val, { x: 220, y: by, size: 8.5, font: fontHelvetica, color: colorDarkGray });
    by -= 16;
  });

  y -= 130;

  // Reading / Opening Evidence Card
  page.drawRectangle({
    x: 45,
    y: y - 150,
    width: width - 90,
    height: 150,
    color: colorLightGray,
    borderColor: colorBorder,
    borderWidth: 1
  });

  page.drawText('2. TRAZABILIDAD DE APERTURA Y DESCARGA', {
    x: 55,
    y: y - 18,
    size: 9.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  const sentDate = emailLog.sent_at ? new Date(emailLog.sent_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '-';
  const openDate = emailLog.opened_at ? new Date(emailLog.opened_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : 'Confirmado';

  const readRows = [
    ['Fecha y Hora de Envío:', sentDate],
    ['Fecha y Hora de Apertura/Lectura:', openDate],
    ['Método de Validación:', 'Enlace Seguro de Descarga y Confirmación'],
    ['Identificador Único (Token):', emailLog.tracking_token || ''],
    ['Estado de Lectura:', 'CONFIRMADO Y DESCARGADO POR EL DESTINATARIO']
  ];

  let ry = y - 36;
  readRows.forEach(([lbl, val], idx) => {
    const valColor = idx === 4 ? colorGreen : colorDarkGray;
    const valFont = idx === 4 ? fontHelveticaBold : fontHelvetica;
    page.drawText(lbl, { x: 55, y: ry, size: 8.5, font: fontHelveticaBold, color: colorDarkGray });
    page.drawText(String(val).slice(0, 55), { x: 220, y: ry, size: 8.5, font: valFont, color: valColor });
    ry -= 22;
  });

  y -= 170;

  // Bottom QR and verification box
  const qrSize = 65;
  const qrX = width - 45 - qrSize;
  const qrY = 50;
  const protocol = (host && host.includes('localhost')) ? 'http' : 'https';
  const verifyUrl = `${protocol}://${host || 'localhost:3000'}/validate.html?uuid=${beneficiary.uuid}`;

  try {
    const qrDataUrl = await qr.toDataURL(verifyUrl, { margin: 1, width: 120 });
    const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    const qrImage = await pdfDoc.embedPng(qrImageBytes);
    page.drawImage(qrImage, { x: qrX, y: qrY, width: qrSize, height: qrSize });
  } catch (qrErr) {
    console.error('Error drawing QR on certificate:', qrErr);
  }

  page.drawText('ACREDITACIÓN DE RECEPCIÓN EFECTIVA', { x: 45, y: qrY + 45, size: 9, font: fontHelveticaBold, color: colorGreen });
  page.drawText('El presente certificado acredita que el titular ha interactuado con el mensaje electrónico y accedido formalmente a su credencial.', {
    x: 45,
    y: qrY + 30,
    size: 7.5,
    font: fontHelvetica,
    color: colorDarkGray
  });
  page.drawText(`Certificado generado el: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`, {
    x: 45,
    y: qrY + 15,
    size: 7.5,
    font: fontHelveticaBold,
    color: colorNavy
  });

  return await pdfDoc.save();
}

module.exports = {
  generateSendCertificatePdf,
  generateOpenCertificatePdf
};
