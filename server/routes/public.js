const express = require('express');
const router = express.Router();
const { dbGet, dbRun } = require('../db');

// GET /api/public/validate/:uuid
router.get('/validate/:uuid', async (req, res) => {
  const uuid = req.params.uuid;

  if (!uuid) {
    return res.status(400).json({ success: false, message: 'Identificador único requerido.' });
  }

  try {
    // Look up beneficiary by UUID
    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE uuid = ?', [uuid]);

    if (!beneficiary) {
      return res.status(404).json({ 
        success: false, 
        message: 'Carné no encontrado o inexistente en nuestro sistema.' 
      });
    }

    // Capture requester details for scan audit logs
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Desconocido';
    const statusAtScan = beneficiary.status;

    // Log the scan event for audit and statistics
    await dbRun(`
      INSERT INTO scan_logs (beneficiary_id, ip_address, user_agent, status_at_scan)
      VALUES (?, ?, ?, ?)
    `, [beneficiary.id, ipAddress, userAgent, statusAtScan]);

    // Mask the document number to prevent exposing sensitive identity data
    let maskedDoc = '';
    const docNum = beneficiary.document_number;
    if (docNum.length > 4) {
      maskedDoc = '*'.repeat(docNum.length - 4) + docNum.slice(-4);
    } else {
      maskedDoc = '***' + docNum.slice(-1);
    }

    // Return only public non-sensitive data
    return res.json({
      success: true,
      data: {
        full_name: beneficiary.full_name,
        document_type: beneficiary.document_type,
        document_number: maskedDoc,
        rivi: beneficiary.rivi || 'No Registra',
        status: beneficiary.status,
        economic_activity: beneficiary.economic_activity,
        photo_path: beneficiary.photo_path
      }
    });

  } catch (error) {
    console.error('Error during public card validation:', error);
    return res.status(500).json({ success: false, message: 'Error interno al validar el carné.' });
  }
});

module.exports = router;
