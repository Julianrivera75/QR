const express = require('express');
const router = express.Router();
const { dbAll } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/audit/logs - Get all administrative logs
router.get('/logs', authenticateToken, async (req, res) => {
  try {
    const logs = await dbAll(`
      SELECT 
        al.id, 
        al.action, 
        al.fields_changed, 
        al.timestamp,
        u.username as user_username, 
        u.full_name as user_full_name,
        b.full_name as beneficiary_name, 
        b.document_number as beneficiary_document
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN beneficiaries b ON al.beneficiary_id = b.id
      ORDER BY al.timestamp DESC
      LIMIT 100
    `);

    return res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener registros de auditoría.' });
  }
});

// GET /api/audit/scans - Get all QR code scan tracking logs
router.get('/scans', authenticateToken, async (req, res) => {
  try {
    const logs = await dbAll(`
      SELECT 
        sl.id, 
        sl.scanned_at, 
        sl.ip_address, 
        sl.user_agent, 
        sl.status_at_scan,
        b.full_name as beneficiary_name, 
        b.document_number as beneficiary_document,
        b.uuid as beneficiary_uuid
      FROM scan_logs sl
      LEFT JOIN beneficiaries b ON sl.beneficiary_id = b.id
      ORDER BY sl.scanned_at DESC
      LIMIT 100
    `);

    // Get daily scans count for stats (last 7 days)
    const chartData = await dbAll(`
      SELECT 
        date(scanned_at) as scan_date,
        COUNT(*) as scan_count
      FROM scan_logs
      WHERE scanned_at >= date('now', '-7 days')
      GROUP BY scan_date
      ORDER BY scan_date ASC
    `);

    return res.json({
      success: true,
      data: logs,
      stats: chartData
    });
  } catch (error) {
    console.error('Error fetching scan logs:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener registros de escaneo.' });
  }
});

module.exports = router;
