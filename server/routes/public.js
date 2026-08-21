const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { dbGet, dbRun } = require('../db');

// Helper to fetch a URL and return as Buffer, following redirects
function fetchUrl(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 6) return Promise.reject(new Error('Demasiadas redirecciones'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 12000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`HTTP ${res.statusCode} al descargar foto`));
      }
      const contentType = res.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        res.destroy();
        return reject(new Error('La foto no es pública o requiere autenticación'));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout descargando foto')); });
  });
}

// Helper to download image from URL (converts Google Drive links and follows redirects)
function downloadImageFromUrl(url) {
  const gdriveFileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (gdriveFileMatch) {
    url = `https://drive.google.com/uc?export=download&id=${gdriveFileMatch[1]}`;
  } else {
    const gdriveOpenMatch = url.match(/drive\.google\.com.*[?&]id=([a-zA-Z0-9_-]+)/);
    if (gdriveOpenMatch) {
      url = `https://drive.google.com/uc?export=download&id=${gdriveOpenMatch[1]}`;
    }
  }
  return fetchUrl(url);
}

// GET /api/public/photo/:uuid - Proxy and serve beneficiary photo
router.get('/photo/:uuid', async (req, res) => {
  const { uuid } = req.params;
  if (!uuid) return res.status(400).send('UUID requerido');

  try {
    const beneficiary = await dbGet('SELECT photo_path FROM beneficiaries WHERE uuid = ?', [uuid]);
    if (!beneficiary || !beneficiary.photo_path || !beneficiary.photo_path.trim()) {
      return res.status(404).send('Foto no encontrada');
    }

    const photoPath = beneficiary.photo_path.trim();

    // 1. If it's a local uploaded file (e.g. /uploads/photos/photo-xxx.jpg)
    if (!photoPath.startsWith('http')) {
      const localFilePath = path.join(__dirname, '..', photoPath);
      if (fs.existsSync(localFilePath)) {
        return res.sendFile(localFilePath);
      }
      return res.status(404).send('Archivo local no encontrado');
    }

    // 2. If it's a remote URL (Google Drive), check local cache first
    const driveCacheDir = path.join(__dirname, '..', 'uploads', 'photos');
    if (!fs.existsSync(driveCacheDir)) {
      fs.mkdirSync(driveCacheDir, { recursive: true });
    }
    const cacheFilename = `photo-drive-${uuid}.jpg`;
    const localCachePath = path.join(driveCacheDir, cacheFilename);

    if (fs.existsSync(localCachePath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.contentType('image/jpeg');
      return res.sendFile(localCachePath);
    }

    // Download from remote URL and cache it
    const imageBytes = await downloadImageFromUrl(photoPath);
    fs.writeFileSync(localCachePath, imageBytes);

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.contentType('image/jpeg');
    return res.send(imageBytes);

  } catch (error) {
    console.error(`Error sirviendo foto para UUID ${uuid}:`, error.message);
    return res.status(404).send('Error al cargar la foto');
  }
});

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

    // Validity period: 24/08/2026 - 24/08/2028
    const validityStart = '2026-08-24';
    const validityEnd = '2028-08-24';
    const now = new Date();
    const endDate = new Date(validityEnd + 'T23:59:59');

    // If current date is past validity end, override status to 'Vencido'
    let effectiveStatus = beneficiary.status;
    if (now > endDate && beneficiary.status === 'Activo') {
      effectiveStatus = 'Vencido';
    }

    // Photo URL route
    const photoUrl = (beneficiary.photo_path && beneficiary.photo_path.trim()) 
      ? `/api/public/photo/${beneficiary.uuid}` 
      : null;

    // Return only public non-sensitive data
    return res.json({
      success: true,
      data: {
        full_name: beneficiary.full_name,
        document_type: beneficiary.document_type,
        document_number: maskedDoc,
        rivi: beneficiary.rivi || 'No Registra',
        status: effectiveStatus,
        economic_activity: beneficiary.economic_activity,
        photo_path: photoUrl,
        validity_start: validityStart,
        validity_end: validityEnd
      }
    });

  } catch (error) {
    console.error('Error during public card validation:', error);
    return res.status(500).json({ success: false, message: 'Error interno al validar el carné.' });
  }
});

module.exports = router;
