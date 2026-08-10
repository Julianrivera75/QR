const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const xlsx = require('xlsx');
const { dbRun, dbAll, dbGet } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Multer storage configuration for photos
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'photos');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'photo-' + uniqueSuffix + ext);
  }
});

const uploadPhoto = multer({
  storage: photoStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (jpeg, jpg, png)'));
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Multer storage for imports (temporary storage)
const importStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'imports');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'import-' + Date.now() + path.extname(file.originalname));
  }
});
const uploadImportFile = multer({ storage: importStorage });

// Helper to log audit events
async function logAuditEvent(userId, beneficiaryId, action, fieldsChangedObj) {
  try {
    const fieldsChangedStr = fieldsChangedObj ? JSON.stringify(fieldsChangedObj) : null;
    await dbRun(
      'INSERT INTO audit_logs (user_id, beneficiary_id, action, fields_changed) VALUES (?, ?, ?, ?)',
      [userId, beneficiaryId, action, fieldsChangedStr]
    );
  } catch (error) {
    console.error('Failed to log audit event:', error);
  }
}

// GET /api/beneficiaries - List with advanced filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      search,
      document_type,
      status,
      registered_hemi,
      rivi,
      economic_activity,
      ipes_beneficiary,
      offer_type,
      days_per_week,
      permanence_time,
      limit = 50,
      offset = 0
    } = req.query;

    let sql = 'SELECT * FROM beneficiaries WHERE 1=1';
    const params = [];

    if (search) {
      sql += ' AND (full_name LIKE ? OR document_number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (document_type) {
      sql += ' AND document_type = ?';
      params.push(document_type);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (registered_hemi) {
      sql += ' AND registered_hemi = ?';
      params.push(registered_hemi);
    }
    if (rivi === 'yes') {
      sql += " AND rivi IS NOT NULL AND rivi != ''";
    } else if (rivi === 'no') {
      sql += " AND (rivi IS NULL OR rivi = '')";
    }
    if (economic_activity) {
      sql += ' AND economic_activity = ?';
      params.push(economic_activity);
    }
    if (ipes_beneficiary) {
      sql += ' AND ipes_beneficiary = ?';
      params.push(ipes_beneficiary);
    }
    if (offer_type) {
      sql += ' AND offer_type = ?';
      params.push(offer_type);
    }
    if (days_per_week) {
      sql += ' AND days_per_week = ?';
      params.push(parseInt(days_per_week));
    }
    if (permanence_time) {
      sql += ' AND permanence_time = ?';
      params.push(permanence_time);
    }

    // Get total count for pagination
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
    const totalRow = await dbGet(countSql, params);

    // Add sorting and pagination
    sql += ' ORDER BY full_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const rows = await dbAll(sql, params);

    // Get statistics
    const statsSql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'Activo' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'Inactivo' THEN 1 ELSE 0 END) as inactive,
        SUM(CASE WHEN status = 'Revocado' THEN 1 ELSE 0 END) as revoked
      FROM beneficiaries
    `;
    const stats = await dbGet(statsSql);

    return res.json({
      success: true,
      data: rows,
      total: totalRow.count,
      stats
    });
  } catch (error) {
    console.error('Error fetching beneficiaries:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener beneficiarios.' });
  }
});

// GET /api/beneficiaries/unique-values - For filter options
router.get('/unique-values', authenticateToken, async (req, res) => {
  try {
    const activities = await dbAll('SELECT DISTINCT economic_activity FROM beneficiaries WHERE economic_activity IS NOT NULL AND economic_activity != "" ORDER BY economic_activity ASC');
    const offers = await dbAll('SELECT DISTINCT offer_type FROM beneficiaries WHERE offer_type IS NOT NULL AND offer_type != "" ORDER BY offer_type ASC');
    const permanence = await dbAll('SELECT DISTINCT permanence_time FROM beneficiaries WHERE permanence_time IS NOT NULL AND permanence_time != "" ORDER BY permanence_time ASC');

    return res.json({
      success: true,
      activities: activities.map(r => r.economic_activity),
      offers: offers.map(r => r.offer_type),
      permanence: permanence.map(r => r.permanence_time)
    });
  } catch (error) {
    console.error('Error fetching unique values:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener valores para filtros.' });
  }
});

// GET /api/beneficiaries/:id - Retrieve single beneficiary details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [req.params.id]);
    if (!row) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    // Get audit history for this beneficiary
    const audits = await dbAll(`
      SELECT a.*, u.full_name as user_name 
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.beneficiary_id = ?
      ORDER BY a.timestamp DESC
    `, [req.params.id]);

    return res.json({
      success: true,
      data: row,
      audits
    });
  } catch (error) {
    console.error('Error fetching beneficiary details:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener detalles.' });
  }
});

// POST /api/beneficiaries - Create a beneficiary
router.post('/', authenticateToken, uploadPhoto.single('photo'), async (req, res) => {
  try {
    const {
      full_name,
      document_type,
      document_number,
      registered_hemi,
      rivi,
      status = 'Activo',
      age,
      gender,
      population_group,
      disability,
      phone,
      latitude,
      longitude,
      economic_activity,
      ipes_beneficiary,
      offer_type,
      days_per_week,
      permanence_time
    } = req.body;

    // Validate required fields
    if (!full_name || !document_type || !document_number || !registered_hemi || !age || !gender || !population_group || !disability || !economic_activity || !ipes_beneficiary || !days_per_week || !permanence_time) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios en el formulario.' });
    }

    // Check duplicate document
    const exists = await dbGet('SELECT id FROM beneficiaries WHERE document_number = ?', [document_number]);
    if (exists) {
      return res.status(400).json({ success: false, message: 'El número de documento ya está registrado.' });
    }

    const uuid = crypto.randomUUID();
    const photoPath = req.file ? `/uploads/photos/${req.file.filename}` : '';

    await dbRun(`
      INSERT INTO beneficiaries (
        uuid, full_name, document_type, document_number, registered_hemi, rivi, status,
        age, gender, population_group, disability, phone, latitude, longitude,
        economic_activity, ipes_beneficiary, offer_type, days_per_week, permanence_time, photo_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      uuid, full_name, document_type, document_number, registered_hemi, rivi || '', status,
      parseInt(age), gender, population_group, disability, phone || '',
      latitude ? parseFloat(latitude) : null, longitude ? parseFloat(longitude) : null,
      economic_activity, ipes_beneficiary, offer_type || '', parseInt(days_per_week), permanence_time, photoPath
    ]);

    const inserted = await dbGet('SELECT id FROM beneficiaries WHERE uuid = ?', [uuid]);
    const newId = inserted ? inserted.id : null;

    // Log audit
    await logAuditEvent(req.user.id, newId, 'CREATE', null);

    return res.status(201).json({
      success: true,
      message: 'Beneficiario registrado exitosamente.',
      id: newId,
      uuid
    });

  } catch (error) {
    console.error('Error creating beneficiary:', error);
    return res.status(500).json({ success: false, message: 'Error al registrar beneficiario.' });
  }
});

// PUT /api/beneficiaries/:id - Update beneficiary
router.put('/:id', authenticateToken, uploadPhoto.single('photo'), async (req, res) => {
  try {
    const id = req.params.id;
    const oldRecord = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [id]);

    if (!oldRecord) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    const {
      full_name,
      document_type,
      document_number,
      registered_hemi,
      rivi,
      status,
      age,
      gender,
      population_group,
      disability,
      phone,
      latitude,
      longitude,
      economic_activity,
      ipes_beneficiary,
      offer_type,
      days_per_week,
      permanence_time
    } = req.body;

    // Validate duplicate document
    if (document_number && document_number !== oldRecord.document_number) {
      const exists = await dbGet('SELECT id FROM beneficiaries WHERE document_number = ? AND id != ?', [document_number, id]);
      if (exists) {
        return res.status(400).json({ success: false, message: 'El número de documento ya pertenece a otro registro.' });
      }
    }

    // Photo updates
    let photoPath = oldRecord.photo_path;
    if (req.file) {
      // Remove old photo if exists
      if (oldRecord.photo_path) {
        const oldFile = path.join(__dirname, '..', oldRecord.photo_path);
        if (fs.existsSync(oldFile)) {
          fs.unlinkSync(oldFile);
        }
      }
      photoPath = `/uploads/photos/${req.file.filename}`;
    }

    const updatedData = {
      full_name: full_name || oldRecord.full_name,
      document_type: document_type || oldRecord.document_type,
      document_number: document_number || oldRecord.document_number,
      registered_hemi: registered_hemi || oldRecord.registered_hemi,
      rivi: rivi !== undefined ? rivi : oldRecord.rivi,
      status: status || oldRecord.status,
      age: age ? parseInt(age) : oldRecord.age,
      gender: gender || oldRecord.gender,
      population_group: population_group || oldRecord.population_group,
      disability: disability || oldRecord.disability,
      phone: phone !== undefined ? phone : oldRecord.phone,
      latitude: latitude ? parseFloat(latitude) : oldRecord.latitude,
      longitude: longitude ? parseFloat(longitude) : oldRecord.longitude,
      economic_activity: economic_activity || oldRecord.economic_activity,
      ipes_beneficiary: ipes_beneficiary || oldRecord.ipes_beneficiary,
      offer_type: offer_type !== undefined ? offer_type : oldRecord.offer_type,
      days_per_week: days_per_week ? parseInt(days_per_week) : oldRecord.days_per_week,
      permanence_time: permanence_time || oldRecord.permanence_time,
      photo_path: photoPath,
      updated_at: new Date().toISOString()
    };

    // Calculate changes for audit
    const diff = {};
    for (const key in updatedData) {
      if (key === 'updated_at') continue;
      
      let oldVal = oldRecord[key];
      let newVal = updatedData[key];
      
      // Standardize null/empty comparisons
      if (oldVal === null) oldVal = '';
      if (newVal === null) newVal = '';

      if (String(oldVal) !== String(newVal)) {
        diff[key] = { old: oldRecord[key], new: updatedData[key] };
      }
    }

    await dbRun(`
      UPDATE beneficiaries SET
        full_name = ?, document_type = ?, document_number = ?, registered_hemi = ?, 
        rivi = ?, status = ?, age = ?, gender = ?, population_group = ?, 
        disability = ?, phone = ?, latitude = ?, longitude = ?, economic_activity = ?, 
        ipes_beneficiary = ?, offer_type = ?, days_per_week = ?, permanence_time = ?, 
        photo_path = ?, updated_at = ?
      WHERE id = ?
    `, [
      updatedData.full_name, updatedData.document_type, updatedData.document_number, updatedData.registered_hemi,
      updatedData.rivi, updatedData.status, updatedData.age, updatedData.gender, updatedData.population_group,
      updatedData.disability, updatedData.phone, updatedData.latitude, updatedData.longitude, updatedData.economic_activity,
      updatedData.ipes_beneficiary, updatedData.offer_type, updatedData.days_per_week, updatedData.permanence_time,
      updatedData.photo_path, updatedData.updated_at, id
    ]);

    // Log changes if any
    if (Object.keys(diff).length > 0) {
      await logAuditEvent(req.user.id, id, 'UPDATE', diff);
    }

    return res.json({
      success: true,
      message: 'Beneficiario actualizado exitosamente.',
      data: updatedData
    });

  } catch (error) {
    console.error('Error updating beneficiary:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar beneficiario.' });
  }
});

// DELETE /api/beneficiaries/:id - Delete record
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const record = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [id]);

    if (!record) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    // Delete photo from filesystem
    if (record.photo_path) {
      const photoFile = path.join(__dirname, '..', record.photo_path);
      if (fs.existsSync(photoFile)) {
        fs.unlinkSync(photoFile);
      }
    }

    // Delete database entries (scan_logs cascade, but we need to log audit first)
    // To preserve audit history of a deleted beneficiary, we log it before deletion
    await logAuditEvent(req.user.id, id, 'DELETE', { full_name: record.full_name, document: record.document_number });

    await dbRun('DELETE FROM beneficiaries WHERE id = ?', [id]);

    return res.json({ success: true, message: 'Beneficiario eliminado permanentemente.' });
  } catch (error) {
    console.error('Error deleting beneficiary:', error);
    return res.status(500).json({ success: false, message: 'Error al eliminar beneficiario.' });
  }
});

// POST /api/beneficiaries/:id/regenerate-qr - Re-generates token/UUID (revoking old printed code)
router.post('/:id/regenerate-qr', authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    const record = await dbGet('SELECT uuid, full_name FROM beneficiaries WHERE id = ?', [id]);

    if (!record) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    const newUuid = crypto.randomUUID();
    await dbRun('UPDATE beneficiaries SET uuid = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newUuid, id]);

    // Log audit
    await logAuditEvent(req.user.id, id, 'REGENERATE_QR', { old_uuid: record.uuid, new_uuid: newUuid });

    return res.json({
      success: true,
      message: 'Código QR regenerado exitosamente. Los códigos anteriores quedan invalidados.',
      uuid: newUuid
    });
  } catch (error) {
    console.error('Error regenerating QR:', error);
    return res.status(500).json({ success: false, message: 'Error al regenerar código QR.' });
  }
});

// POST /api/beneficiaries/import - Bulk import from CSV/Excel
router.post('/import', authenticateToken, uploadImportFile.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No se ha subido ningún archivo.' });
  }

  const filePath = req.file.path;
  try {
    // Read file using xlsx (handles xls, xlsx, csv)
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    
    // Read sheet as raw 2D array to scan for header row
    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (rawRows.length === 0) {
      return res.status(400).json({ success: false, message: 'El archivo está vacío.' });
    }

    // Helper map of columns matching Spanish request to database fields
    const columnsMap = {
      'Nombre completo': 'full_name',
      'Tipo de documento': 'document_type',
      'Número de documento de identidad': 'document_number',
      'Numero de documento de identidad': 'document_number',
      'Número de documento': 'document_number',
      'Numero de documento': 'document_number',
      'Registrado en HEMI': 'registered_hemi',
      'RIVI': 'rivi',
      'Estado': 'status',
      'Edad': 'age',
      'Género': 'gender',
      'Grupo poblacional o comunidad a la que pertenece o con la que se identifica': 'population_group',
      'Grupo poblacional': 'population_group',
      'Es o se reconoce como parte de alguno de los siguientes grupos poblacionales o comunidades': 'population_group',
      'Presenta alguna discapacidad': 'disability',
      'Teléfono de contacto': 'phone',
      'Coordenadas del punto de ubicación': 'coordinates',
      'Tipo de actividad económica': 'economic_activity',
      'Beneficiario de alguna oferta del IPES': 'ipes_beneficiary',
      'Tipo de oferta': 'offer_type',
      'Cantidad de días por semana que se ubica en la zona': 'days_per_week',
      'Cuantos días de la semana se ubica en la zona': 'days_per_week',
      'Tiempo de permanencia en la zona': 'permanence_time',
      'Hace cuánto tiempo está en la zona': 'permanence_time',
      'Foto': 'photo_url',
      'foto': 'photo_url',
      'Fotografía': 'photo_url',
      
      // Database/English column name fallbacks
      'full_name': 'full_name',
      'document_type': 'document_type',
      'document_number': 'document_number',
      'registered_hemi': 'registered_hemi',
      'rivi': 'rivi',
      'status': 'status',
      'age': 'age',
      'gender': 'gender',
      'population_group': 'population_group',
      'disability': 'disability',
      'phone': 'phone',
      'coordinates': 'coordinates',
      'economic_activity': 'economic_activity',
      'ipes_beneficiary': 'ipes_beneficiary',
      'offer_type': 'offer_type',
      'days_per_week': 'days_per_week',
      'permanence_time': 'permanence_time'
    };

    // Helper function to normalize text (lowercase, trimmed, strip accents)
    const normalizeKey = (str) => {
      if (!str) return '';
      return String(str)
        .toLowerCase()
        .trim()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""); // strip accents/tildes
    };

    // Create a normalized map for matching
    const normalizedColumnsMap = {};
    for (const key in columnsMap) {
      normalizedColumnsMap[normalizeKey(key)] = columnsMap[key];
    }

    // Expected column keys normalized
    const expectedKeysNormalized = {};
    for (const key in columnsMap) {
      expectedKeysNormalized[normalizeKey(key)] = true;
    }

    // Find the row that contains the most expected headers
    let headerRowIndex = 0;
    let maxMatches = 0;
    
    for (let r = 0; r < Math.min(rawRows.length, 15); r++) {
      const rowCells = rawRows[r];
      if (!Array.isArray(rowCells)) continue;
      
      let matches = 0;
      for (const cell of rowCells) {
        if (cell !== undefined && cell !== null) {
          const normCell = normalizeKey(cell);
          if (expectedKeysNormalized[normCell]) {
            matches++;
          }
        }
      }
      
      if (matches > maxMatches) {
        maxMatches = matches;
        headerRowIndex = r;
      }
    }

    console.log(`Cabecera detectada en fila ${headerRowIndex + 1} con ${maxMatches} columnas coincidentes.`);

    // Convert sheet to JSON starting from the detected header row range
    const rows = xlsx.utils.sheet_to_json(sheet, { range: headerRowIndex });

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'El archivo está vacío después del análisis de cabeceras.' });
    }

    let importedCount = 0;
    let errorCount = 0;
    const errorsList = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const index = i + headerRowIndex + 2; // row index in sheet (header is row 1 relative to range)

      // Map row keys
      const data = {};
      for (const rawKey in row) {
        const normKey = normalizeKey(rawKey);
        const mappedField = normalizedColumnsMap[normKey];
        if (mappedField) {
          data[mappedField] = String(row[rawKey]).trim();
        }
      }

      // Helper to check if a value is empty/undefined/null
      const isEmpty = (val) => {
        if (val === undefined || val === null) return true;
        const s = String(val).trim().toLowerCase();
        return s === '' || s === 'undefined' || s === 'null';
      };

      // Check minimum critical identification fields
      const required = ['full_name', 'document_number'];
      const missing = required.filter(field => isEmpty(data[field]));

      const spanishFieldsMap = {
        'full_name': 'Nombre completo',
        'document_number': 'Número de documento de identidad'
      };

      if (missing.length > 0) {
        errorCount++;
        const missingSpanish = missing.map(f => spanishFieldsMap[f] || f);
        const rowKeys = Object.keys(row).join(', ');
        console.log(`Fila ${index} falló. Columnas detectadas: [${rowKeys}]`);
        errorsList.push(`Fila ${index}: Campos requeridos faltantes (${missingSpanish.join(', ')}). Columnas encontradas: [${rowKeys}]`);
        continue;
      }

      // Assign defaults for missing or empty optional/auxiliary fields
      if (isEmpty(data.document_type)) data.document_type = 'CC';
      if (isEmpty(data.registered_hemi)) data.registered_hemi = 'No';
      if (isEmpty(data.age)) data.age = '30';
      if (isEmpty(data.gender)) data.gender = 'Otro';
      if (isEmpty(data.population_group)) data.population_group = 'Ninguno';
      if (isEmpty(data.disability)) data.disability = 'No';
      if (isEmpty(data.economic_activity)) data.economic_activity = 'Otro';
      if (isEmpty(data.ipes_beneficiary)) data.ipes_beneficiary = 'No';
      if (isEmpty(data.days_per_week)) data.days_per_week = '5';
      if (isEmpty(data.permanence_time)) data.permanence_time = 'No especifica';

      // Normalize and validate data constraints
      
      // 1. Document Type normalization (e.g., Cédula Ciudadanía, C.C., cc -> CC)
      let docType = String(data.document_type || '').trim();
      const cleanDoc = docType.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (cleanDoc.includes('ciudadania') || cleanDoc === 'cc') {
        docType = 'CC';
      } else if (cleanDoc.includes('extranjeria') || cleanDoc === 'ce') {
        docType = 'CE';
      } else if (cleanDoc.includes('especial de permanencia') || cleanDoc === 'pep') {
        docType = 'PEP';
      } else if (cleanDoc.includes('proteccion temporal') || cleanDoc === 'ppt') {
        docType = 'PPT';
      } else if (cleanDoc.includes('pasaporte')) {
        docType = 'Pasaporte';
      } else {
        docType = 'CC'; // default fallback
      }
      data.document_type = docType;

      // 2. Yes/No Fields normalization (e.g., si, SI, yes, 1 -> Sí)
      const normalizeYesNo = (val) => {
        if (!val) return 'No';
        const clean = String(val).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (clean === 'si' || clean === 's' || clean === 'yes' || clean === 'y' || clean === '1' || clean === 'true') {
          return 'Sí';
        }
        return 'No';
      };
      
      data.registered_hemi = normalizeYesNo(data.registered_hemi);
      data.disability = normalizeYesNo(data.disability);
      data.ipes_beneficiary = normalizeYesNo(data.ipes_beneficiary);

      // 3. Gender normalization (e.g., M, hombre -> Masculino, F, mujer -> Femenino)
      const normalizeGender = (val) => {
        if (!val) return 'Otro';
        const clean = String(val).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (clean === 'masculino' || clean === 'm' || clean === 'hombre') return 'Masculino';
        if (clean === 'femenino' || clean === 'f' || clean === 'mujer') return 'Femenino';
        return 'Otro';
      };
      
      data.gender = normalizeGender(data.gender);

      // 4. Age normalization (strip letters/spaces, e.g. "30 años" -> 30)
      const ageCleaned = String(data.age || '').replace(/\D/g, '');
      let ageVal = parseInt(ageCleaned);
      if (isNaN(ageVal) || ageVal <= 0) {
        ageVal = 30; // sensible default instead of failing
      }

      // 5. Days per week normalization (strip letters/spaces, e.g. "5 días" -> 5)
      const daysCleaned = String(data.days_per_week || '').replace(/\D/g, '');
      let daysVal = parseInt(daysCleaned);
      if (isNaN(daysVal) || daysVal < 1 || daysVal > 7) {
        daysVal = 5; // sensible default instead of failing
      }

      // Normalize document_number: Excel may convert large numbers to scientific notation
      let docNumber = String(data.document_number || '').trim();
      // Convert scientific notation (e.g. 1.03E+10) to integer string
      if (/e\+/i.test(docNumber)) {
        const parsed = parseFloat(docNumber);
        if (!isNaN(parsed)) docNumber = Math.round(parsed).toString();
      }

      // Check duplicate document number in DB
      const existingDoc = await dbGet('SELECT id, photo_path FROM beneficiaries WHERE document_number = ?', [docNumber]);
      if (existingDoc) {
        // If we have a photo URL and the record doesn't have one yet, update it
        if (data.photo_url && !existingDoc.photo_path) {
          await dbRun('UPDATE beneficiaries SET photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [data.photo_url, existingDoc.id]);
          importedCount++;
        } else if (data.photo_url && existingDoc.photo_path !== data.photo_url) {
          // Always update to the new photo URL if it's different
          await dbRun('UPDATE beneficiaries SET photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [data.photo_url, existingDoc.id]);
          importedCount++;
        } else {
          errorCount++;
          errorsList.push(`Fila ${index}: El documento '${docNumber}' ya está registrado (sin cambios).`);
        }
        continue;
      }

      // Parse coordinates
      let lat = null;
      let lng = null;
      if (data.coordinates) {
        const parts = data.coordinates.split(',');
        if (parts.length === 2) {
          lat = parseFloat(parts[0].trim());
          lng = parseFloat(parts[1].trim());
          if (isNaN(lat) || isNaN(lng)) {
            lat = null;
            lng = null;
          }
        }
      }

      // Normalize status field (Excel may say 'Vigente' instead of 'Activo')
      const normalizeStatus = (val) => {
        if (!val) return 'Activo';
        const clean = String(val).toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (clean === 'activo' || clean === 'vigente' || clean === 'active' || clean === '1') return 'Activo';
        if (clean === 'inactivo' || clean === 'inactive' || clean === '0') return 'Inactivo';
        if (clean === 'revocado' || clean === 'revoked') return 'Revocado';
        return 'Activo'; // default
      };
      const status = normalizeStatus(data.status);

      // Insert record
      const uuid = crypto.randomUUID();

      try {
        await dbRun(`
          INSERT INTO beneficiaries (
            uuid, full_name, document_type, document_number, registered_hemi, rivi, status,
            age, gender, population_group, disability, phone, latitude, longitude,
            economic_activity, ipes_beneficiary, offer_type, days_per_week, permanence_time, photo_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          uuid, data.full_name, data.document_type, docNumber, data.registered_hemi, data.rivi || '', status,
          ageVal, data.gender, data.population_group, data.disability, data.phone || '', lat, lng,
          data.economic_activity, data.ipes_beneficiary, data.offer_type || '', daysVal, data.permanence_time, data.photo_url || ''
        ]);

        importedCount++;
        
        // Log individual audit
        const inserted = await dbGet('SELECT id FROM beneficiaries WHERE uuid = ?', [uuid]);
        const insertedId = inserted ? inserted.id : null;
        await logAuditEvent(req.user.id, insertedId, 'CREATE', { imported_via: 'BULK_IMPORT' });

      } catch (insertError) {
        console.error('Insert error during import row:', insertError);
        errorCount++;
        // Extract a cleaner error message from SQLite constraint errors
        let errMsg = insertError.message || 'Error desconocido';
        if (errMsg.includes('UNIQUE constraint')) {
          errMsg = 'El número de documento ya existe en la base de datos (duplicado).';
        } else if (errMsg.includes('CHECK constraint')) {
          const match = errMsg.match(/CHECK constraint failed: (.+)/);
          errMsg = match ? `Valor no permitido en campo: ${match[1]}` : 'Valor no permitido en un campo.';
        }
        errorsList.push(`Fila ${index}: Error al insertar — ${errMsg}`);
      }
    }

    // Clean up file
    fs.unlinkSync(filePath);

    return res.json({
      success: true,
      message: `Importación finalizada. Procesados: ${importedCount}, Errores: ${errorCount}`,
      importedCount,
      errorCount,
      errors: errorsList.slice(0, 100),
      errorsNote: errorsList.length > 100 ? `... y ${errorsList.length - 100} registros más sin cambios (mostrando solo los primeros 100).` : null
    });

  } catch (error) {
    console.error('Error importing file:', error);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.status(500).json({ success: false, message: 'Error crítico al procesar el archivo.' });
  }
});

module.exports = router;
