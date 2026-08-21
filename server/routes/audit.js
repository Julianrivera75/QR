const express = require('express');
const router = express.Router();
const { dbAll } = require('../db');
const { authenticateToken } = require('../middleware/auth');

const monthShortNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const monthFullNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

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

// GET /api/audit/scans - Get all QR code scan tracking logs with flexible filters
router.get('/scans', authenticateToken, async (req, res) => {
  try {
    const isPostgres = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgres');
    const selectedYear = req.query.year || new Date().getFullYear().toString();
    const selectedMonth = req.query.month || 'all'; // '7days', 'all', or '1'-'12'

    // Fetch latest 100 scan events for table
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

    // Fetch available years in scan_logs for dynamic year filter
    let availableYears = [new Date().getFullYear().toString()];
    try {
      const yearQuery = isPostgres 
        ? "SELECT DISTINCT TO_CHAR(scanned_at, 'YYYY') as yr FROM scan_logs WHERE scanned_at IS NOT NULL ORDER BY yr DESC"
        : "SELECT DISTINCT strftime('%Y', scanned_at) as yr FROM scan_logs WHERE scanned_at IS NOT NULL ORDER BY yr DESC";
      const yearRows = await dbAll(yearQuery);
      if (yearRows && yearRows.length > 0) {
        const yrs = yearRows.map(r => r.yr).filter(Boolean);
        if (yrs.length > 0) availableYears = Array.from(new Set([...yrs, new Date().getFullYear().toString()]));
      }
    } catch (yrErr) {
      console.warn('Could not fetch distinct scan years:', yrErr.message);
    }

    let chartData = [];
    let totalPeriodScans = 0;

    // Mode 1: Last 7 Days
    if (selectedMonth === '7days') {
      const last7Days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const mIdx = d.getMonth();
        last7Days.push({
          key: `${yyyy}-${mm}-${dd}`,
          label: `${dd} ${monthShortNames[mIdx]}`,
          fullLabel: `${dd} de ${monthFullNames[mIdx]} ${yyyy}`
        });
      }

      const q7 = isPostgres
        ? `SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') as scan_key, COUNT(*)::int as scan_count 
           FROM scan_logs WHERE scanned_at >= NOW() - INTERVAL '7 days' 
           GROUP BY TO_CHAR(scanned_at, 'YYYY-MM-DD')`
        : `SELECT date(scanned_at) as scan_key, COUNT(*) as scan_count 
           FROM scan_logs WHERE scanned_at >= date('now', '-7 days') 
           GROUP BY date(scanned_at)`;
      
      const rows7 = await dbAll(q7);
      const map7 = {};
      rows7.forEach(r => { map7[r.scan_key] = parseInt(r.scan_count, 10) || 0; });

      chartData = last7Days.map(item => {
        const count = map7[item.key] || 0;
        totalPeriodScans += count;
        return {
          scan_date: item.key,
          label: item.label,
          full_label: item.fullLabel,
          scan_count: count
        };
      });

    // Mode 2: Specific Month in a Year (e.g. Month 8, Year 2026)
    } else if (selectedMonth !== 'all') {
      const mNum = parseInt(selectedMonth, 10);
      const yrNum = selectedYear === 'all' ? new Date().getFullYear() : parseInt(selectedYear, 10);
      const daysInMonth = new Date(yrNum, mNum, 0).getDate();
      const monthDays = [];

      for (let day = 1; day <= daysInMonth; day++) {
        const dd = String(day).padStart(2, '0');
        const mm = String(mNum).padStart(2, '0');
        monthDays.push({
          key: `${yrNum}-${mm}-${dd}`,
          label: `${dd} ${monthShortNames[mNum - 1]}`,
          fullLabel: `${dd} de ${monthFullNames[mNum - 1]} de ${yrNum}`
        });
      }

      const mmStr = String(mNum).padStart(2, '0');
      const qMonth = isPostgres
        ? `SELECT TO_CHAR(scanned_at, 'YYYY-MM-DD') as scan_key, COUNT(*)::int as scan_count 
           FROM scan_logs 
           WHERE TO_CHAR(scanned_at, 'YYYY-MM') = ?
           GROUP BY TO_CHAR(scanned_at, 'YYYY-MM-DD')`
        : `SELECT date(scanned_at) as scan_key, COUNT(*) as scan_count 
           FROM scan_logs 
           WHERE strftime('%Y-%m', scanned_at) = ?
           GROUP BY date(scanned_at)`;

      const rowsMonth = await dbAll(qMonth, [`${yrNum}-${mmStr}`]);
      const mapMonth = {};
      rowsMonth.forEach(r => { mapMonth[r.scan_key] = parseInt(r.scan_count, 10) || 0; });

      chartData = monthDays.map(item => {
        const count = mapMonth[item.key] || 0;
        totalPeriodScans += count;
        return {
          scan_date: item.key,
          label: item.label,
          full_label: item.fullLabel,
          scan_count: count
        };
      });

    // Mode 3: All Months of a Year (or All Time by Month)
    } else {
      if (selectedYear === 'all') {
        // Group by all Year-Month entries
        const qAll = isPostgres
          ? `SELECT TO_CHAR(scanned_at, 'YYYY-MM') as scan_key, COUNT(*)::int as scan_count 
             FROM scan_logs 
             WHERE scanned_at IS NOT NULL
             GROUP BY TO_CHAR(scanned_at, 'YYYY-MM')
             ORDER BY scan_key ASC`
          : `SELECT strftime('%Y-%m', scanned_at) as scan_key, COUNT(*) as scan_count 
             FROM scan_logs 
             WHERE scanned_at IS NOT NULL
             GROUP BY strftime('%Y-%m', scanned_at)
             ORDER BY scan_key ASC`;

        const rowsAll = await dbAll(qAll);
        if (rowsAll.length === 0) {
          // Default to 12 months of current year
          const currYr = new Date().getFullYear();
          for (let m = 0; m < 12; m++) {
            chartData.push({
              scan_date: `${currYr}-${String(m + 1).padStart(2, '0')}`,
              label: `${monthShortNames[m]}`,
              full_label: `${monthFullNames[m]} ${currYr}`,
              scan_count: 0
            });
          }
        } else {
          rowsAll.forEach(r => {
            const parts = (r.scan_key || '').split('-');
            const yr = parts[0];
            const m = parseInt(parts[1], 10) || 1;
            const count = parseInt(r.scan_count, 10) || 0;
            totalPeriodScans += count;
            chartData.push({
              scan_date: r.scan_key,
              label: `${monthShortNames[m - 1]} '${yr.slice(2)}`,
              full_label: `${monthFullNames[m - 1]} ${yr}`,
              scan_count: count
            });
          });
        }
      } else {
        // 12 months of specific year
        const yrNum = parseInt(selectedYear, 10);
        const yearMonths = [];
        for (let m = 0; m < 12; m++) {
          const mm = String(m + 1).padStart(2, '0');
          yearMonths.push({
            key: `${yrNum}-${mm}`,
            label: monthShortNames[m],
            fullLabel: `${monthFullNames[m]} ${yrNum}`
          });
        }

        const qYear = isPostgres
          ? `SELECT TO_CHAR(scanned_at, 'YYYY-MM') as scan_key, COUNT(*)::int as scan_count 
             FROM scan_logs 
             WHERE TO_CHAR(scanned_at, 'YYYY') = ?
             GROUP BY TO_CHAR(scanned_at, 'YYYY-MM')`
          : `SELECT strftime('%Y-%m', scanned_at) as scan_key, COUNT(*) as scan_count 
             FROM scan_logs 
             WHERE strftime('%Y', scanned_at) = ?
             GROUP BY strftime('%Y-%m', scanned_at)`;

        const rowsYear = await dbAll(qYear, [String(yrNum)]);
        const mapYear = {};
        rowsYear.forEach(r => { mapYear[r.scan_key] = parseInt(r.scan_count, 10) || 0; });

        chartData = yearMonths.map(item => {
          const count = mapYear[item.key] || 0;
          totalPeriodScans += count;
          return {
            scan_date: item.key,
            label: item.label,
            full_label: item.fullLabel,
            scan_count: count
          };
        });
      }
    }

    return res.json({
      success: true,
      data: logs,
      stats: chartData,
      total_scans_period: totalPeriodScans,
      available_years: availableYears,
      filters: {
        year: selectedYear,
        month: selectedMonth
      }
    });
  } catch (error) {
    console.error('Error fetching scan logs and stats:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener registros de escaneo.' });
  }
});

module.exports = router;
