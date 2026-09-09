// Test script to verify the email system, PDF certificates, and database schema locally
const { dbReady, dbGet, dbRun, dbAll } = require('../server/db');
const { generateSendCertificatePdf, generateOpenCertificatePdf } = require('../server/utils/certificates');
const { sendCarnetEmail, generateEmailHtml } = require('../server/utils/mailer');
const fs = require('fs');
const path = require('path');

async function testSystem() {
  console.log('1. Esperando inicialización de la base de datos...');
  await dbReady;
  console.log('✓ Base de datos lista.');

  // Check beneficiaries
  let beneficiary = await dbGet('SELECT * FROM beneficiaries LIMIT 1');
  if (!beneficiary) {
    console.log('Insertando beneficiario de prueba...');
    await dbRun(`
      INSERT INTO beneficiaries (
        uuid, full_name, document_type, document_number, registered_hemi, rivi, status,
        age, gender, population_group, disability, phone, email, economic_activity,
        ipes_beneficiary, offer_type, days_per_week, permanence_time
      ) VALUES (
        '11111111-2222-3333-4444-555555555555', 'Vendedor de Prueba San Victorino', 'CC', '1099887766', 'Sí', 'RIVI-8899', 'Activo',
        35, 'Masculino', 'Ninguno', 'No', '3101234567', 'prueba.vendedor@gmail.com', 'Prendas de vestir',
        'No', '', 5, '3 a 5 años'
      )
    `);
    beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE document_number = ?', ['1099887766']);
  } else {
    // Ensure beneficiary has an email
    if (!beneficiary.email) {
      await dbRun('UPDATE beneficiaries SET email = ? WHERE id = ?', ['prueba.vendedor@gmail.com', beneficiary.id]);
      beneficiary.email = 'prueba.vendedor@gmail.com';
    }
  }

  console.log(`✓ Beneficiario de prueba: ${beneficiary.full_name} (${beneficiary.document_number}), Email: ${beneficiary.email}`);

  // Test sendCarnetEmail
  console.log('\n2. Probando generación de correo y PDF de carné adjunto...');
  const sendResult = await sendCarnetEmail(beneficiary, 'localhost:3000');
  console.log(`✓ Correo procesado:`);
  console.log(`  - MessageId: ${sendResult.messageId}`);
  console.log(`  - TrackingToken: ${sendResult.trackingToken}`);
  console.log(`  - SHA-256 Hash del Carné: ${sendResult.pdfHash}`);
  console.log(`  - PDF generado (${sendResult.pdfBuffer.length} bytes)`);

  // Insert into email_logs
  await dbRun(`
    INSERT INTO email_logs (
      beneficiary_id, recipient_email, subject, status, sent_at,
      smtp_message_id, tracking_token, pdf_hash
    ) VALUES (?, ?, ?, 'sent', CURRENT_TIMESTAMP, ?, ?, ?)
  `, [
    beneficiary.id, sendResult.recipientEmail, sendResult.subject,
    sendResult.messageId, sendResult.trackingToken, sendResult.pdfHash
  ]);

  const emailLog = await dbGet('SELECT * FROM email_logs WHERE tracking_token = ?', [sendResult.trackingToken]);
  console.log(`✓ Log registrado en BD con ID: ${emailLog.id}`);

  // Test Send Certificate Generation
  console.log('\n3. Generando Certificado Oficial de Envío en PDF...');
  const sendCertBytes = await generateSendCertificatePdf(emailLog, beneficiary, 'localhost:3000');
  const sendCertPath = path.join(__dirname, 'test_certificado_envio.pdf');
  fs.writeFileSync(sendCertPath, sendCertBytes);
  console.log(`✓ Certificado de Envío guardado en: ${sendCertPath} (${sendCertBytes.length} bytes)`);

  // Simulate email open
  await dbRun(`
    UPDATE email_logs 
    SET status = 'opened', opened_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `, [emailLog.id]);
  const updatedLog = await dbGet('SELECT * FROM email_logs WHERE id = ?', [emailLog.id]);

  // Test Open Certificate Generation
  console.log('\n4. Generando Certificado Oficial de Apertura/Lectura en PDF...');
  const openCertBytes = await generateOpenCertificatePdf(updatedLog, beneficiary, 'localhost:3000');
  const openCertPath = path.join(__dirname, 'test_certificado_apertura.pdf');
  fs.writeFileSync(openCertPath, openCertBytes);
  console.log(`✓ Certificado de Apertura guardado en: ${openCertPath} (${openCertBytes.length} bytes)`);

  console.log('\n🎉 ¡TODAS LAS PRUEBAS EN LOCAL HAN SIDO EXITOSAS!');
  process.exit(0);
}

testSystem().catch(err => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});
