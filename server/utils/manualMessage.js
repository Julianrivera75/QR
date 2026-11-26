// Mensaje de entrega del carné para envío MANUAL desde el buzón institucional
// (Outlook web en el navegador). El buzón no permite envío automático, así que el
// sistema arma el correo y el operador lo envía; el enlace personal de descarga
// es la evidencia de recepción.

function confirmTtlDays() {
  return parseInt(process.env.CONFIRM_LINK_TTL_DAYS, 10) || 30;
}

function buildManualMessage(beneficiary, baseUrl, trackingToken) {
  const nombre = String(beneficiary.full_name || '').trim().toUpperCase();
  const link = `${baseUrl}/api/emails/confirm/${trackingToken}`;
  const subject = `Entrega de carné de identificación San Victorino - ${nombre}`;
  const body = [
    `Señor(a) ${nombre}:`,
    '',
    'Reciba un cordial saludo.',
    '',
    'En cumplimiento del Fallo Sentencia A.P. 314-2023, la Alcaldía Local de Santa Fe le hace entrega de su carné de identificación como vendedor(a) del sector de San Victorino.',
    '',
    `Descargue su carné en el siguiente enlace personal (disponible por ${confirmTtlDays()} días):`,
    link,
    '',
    'Al abrir el enlace queda registrada la recepción de su carné. Puede imprimirlo o llevarlo en su celular. El código QR del carné permite verificar su autenticidad.',
    '',
    `Documento: ${beneficiary.document_type || 'CC'} ${beneficiary.document_number}`,
    `Actividad económica: ${beneficiary.economic_activity || 'No registra'}`,
    '',
    'Nota legal: La expedición del presente carné se realiza exclusivamente en cumplimiento de lo ordenado en el Fallo Sentencia A.P. 314-2023. En ningún caso constituye permiso, autorización, licencia o reconocimiento alguno para el ejercicio de actividades de venta en el espacio público.',
    '',
    'Cordialmente,',
    '',
    'Alcaldía Local de Santa Fe',
    'Secretaría Distrital de Gobierno'
  ].join('\r\n');
  return { subject, body, link };
}

const isValidEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

module.exports = { buildManualMessage, isValidEmail, confirmTtlDays };
