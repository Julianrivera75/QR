const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const qr = require('qrcode');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const JSZip = require('jszip');
const { dbGet, dbAll } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { publicHost } = require('../utils/host');

// Helper to fetch a URL and return as Buffer, following redirects
function fetchUrl(url, redirectCount) {
  redirectCount = redirectCount || 0;
  if (redirectCount > 6) return Promise.reject(new Error('Demasiadas redirecciones'));
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 10000 }, (res) => {
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
        return reject(new Error('La foto no es pública (requiere autenticación de Google)'));
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
  // Convert Google Drive URLs to direct download format
  // Format 1: /file/d/FILE_ID/...
  const gdriveFileMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (gdriveFileMatch) {
    url = `https://drive.google.com/uc?export=download&id=${gdriveFileMatch[1]}`;
  } else {
    // Format 2: /open?id=FILE_ID  or  drive.google.com with ?id=
    const gdriveOpenMatch = url.match(/drive\.google\.com.*[?&]id=([a-zA-Z0-9_-]+)/);
    if (gdriveOpenMatch) {
      url = `https://drive.google.com/uc?export=download&id=${gdriveOpenMatch[1]}`;
    }
  }
  return fetchUrl(url);
}

// Helper to wrap text
function drawTextWrapped(page, text, x, y, maxWidth, font, fontSize, color) {
  const words = String(text).split(' ');
  let line = '';
  let currentY = y;
  
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const testWidth = font.widthOfTextAtSize(testLine, fontSize);
    if (testWidth > maxWidth && n > 0) {
      page.drawText(line.trim(), { x, y: currentY, size: fontSize, font, color });
      line = words[n] + ' ';
      currentY -= fontSize * 1.25;
    } else {
      line = testLine;
    }
  }
  page.drawText(line.trim(), { x, y: currentY, size: fontSize, font, color });
  return currentY;
}

// Function to generate a single card PDF Document
async function generateCardPdf(beneficiary, host) {
  // Card dimensions in points (approx 88mm x 132mm - perfect vertical escarapela size)
  const width = 250;
  const height = 375;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([width, height]);
  
  // Standard fonts
  const fontHelvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Paleta de Colores Oficiales
  const colorDarkBlue = rgb(26 / 255, 54 / 255, 120 / 255);    // #1a3678 (Fondo principal)
  const colorNavyHeader = rgb(22 / 255, 43 / 255, 99 / 255);   // #162b63 (Fondo encabezado/acentos)
  const colorGold = rgb(242 / 255, 189 / 255, 43 / 255);       // #f2bd2b (Dorado para etiquetas)
  const colorWhite = rgb(1.0, 1.0, 1.0);

  // Load institutional logos (PNG real, provided by user)
  // bogota_ciudad_blanco.png -> esquina superior IZQUIERDA (Imagen 1)
  // bogota_blanco.png        -> esquina superior DERECHA  (Imagen 2)
  const logoIzqPath = path.join(__dirname, '..', '..', 'public', 'assets', 'bogota_ciudad_blanco.png');
  const logoDerPath = path.join(__dirname, '..', '..', 'public', 'assets', 'bogota_blanco.png');
  let logoIzq = null;
  let logoDer = null;
  try {
    if (fs.existsSync(logoIzqPath)) {
      logoIzq = await pdfDoc.embedPng(fs.readFileSync(logoIzqPath));
    }
    if (fs.existsSync(logoDerPath)) {
      logoDer = await pdfDoc.embedPng(fs.readFileSync(logoDerPath));
    }
  } catch (logoErr) {
    console.warn('No se pudieron cargar logos institucionales:', logoErr.message);
  }

  // 1. Draw Card Background
  page.drawRectangle({
    x: 0,
    y: 0,
    width: width,
    height: height,
    color: colorDarkBlue,
  });

  // 2. Draw Side Decorative Geometries (como en el PDF aprobado)
  // Rectángulos amarillos a la izquierda
  page.drawRectangle({
    x: 0,
    y: height - 130,
    width: 22,
    height: 60,
    color: colorGold,
  });
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 12,
    height: 80,
    color: colorGold,
  });
  // Línea de borde blanco decorativo a la izquierda
  page.drawRectangle({
    x: 21,
    y: height - 145,
    width: 1.5,
    height: 90,
    color: colorWhite,
  });

  // Rectángulos a la derecha
  page.drawRectangle({
    x: width - 8,
    y: height - 180,
    width: 8,
    height: 95,
    color: colorNavyHeader,
  });
  page.drawRectangle({
    x: width - 6,
    y: 0,
    width: 6,
    height: 190,
    color: colorGold,
  });
  // (Línea blanca inferior derecha eliminada por diseño aprobado)

  // 3. Draw Header Section
  // Banner superior centrado (con espacio para logos en esquinas)
  const logoSize = 30; // Tamaño de los logos en el encabezado
  page.drawRectangle({
    x: 34,
    y: height - 85,
    width: width - 68,
    height: 85,
    color: colorNavyHeader,
  });

  // Logos con proporción real para evitar distorsión
  // bogota_ciudad_blanco.png: 612x331 → ratio 1.849
  // bogota_blanco.png:        612x280 → ratio 2.186
  const logoHeight = 26; // Altura fija para ambos logos

  // Logo superior izquierdo: bogota_ciudad_blanco.png (ratio 1.849)
  if (logoIzq) {
    const izqW = Math.round(logoHeight * 1.849); // ~48 pts de ancho
    page.drawImage(logoIzq, {
      x: 2,
      y: height - logoHeight - 4,
      width: izqW,
      height: logoHeight,
    });
  }

  // Logo superior derecho: bogota_blanco.png (ratio 2.186)
  if (logoDer) {
    const derW = Math.round(logoHeight * 2.186); // ~57 pts de ancho
    page.drawImage(logoDer, {
      x: width - derW - 2,
      y: height - logoHeight - 4,
      width: derW,
      height: logoHeight,
    });
  }



  // Dibujar Icono de Trabajador en trazo dorado
  const iconX = width / 2;
  const iconY = height - 52;
  // Cabeza
  page.drawCircle({
    x: iconX,
    y: iconY + 11,
    size: 7,
    borderColor: colorGold,
    borderWidth: 1.5,
  });
  // Hombros / Cuerpo
  page.drawRectangle({
    x: iconX - 14,
    y: iconY - 8,
    width: 28,
    height: 14,
    borderColor: colorGold,
    borderWidth: 1.5,
  });
  // Tirantes del delantal (Apron straps)
  page.drawLine({
    start: { x: iconX - 8, y: iconY + 6 },
    end: { x: iconX - 4, y: iconY - 2 },
    color: colorGold,
    thickness: 1.5,
  });
  page.drawLine({
    start: { x: iconX + 8, y: iconY + 6 },
    end: { x: iconX + 4, y: iconY - 2 },
    color: colorGold,
    thickness: 1.5,
  });

  // Texto: VENDEDOR INFORMAL
  const subTitleText1 = 'VENDEDOR ';
  const subTitleText2 = 'INFORMAL';
  const size1 = 11;
  const size2 = 11;
  const w1 = fontHelveticaBold.widthOfTextAtSize(subTitleText1, size1);
  const w2 = fontHelveticaBold.widthOfTextAtSize(subTitleText2, size2);
  const totalW = w1 + w2;
  const startX = (width - totalW) / 2;

  page.drawText(subTitleText1, {
    x: startX,
    y: height - 76,
    size: size1,
    font: fontHelveticaBold,
    color: colorGold,
  });
  page.drawText(subTitleText2, {
    x: startX + w1,
    y: height - 76,
    size: size2,
    font: fontHelveticaBold,
    color: colorWhite,
  });

  // 4. Beneficiary Photo (Centered, gold/yellow border)
  const photoWidth = 74;
  const photoHeight = 92;
  const photoX = (width - photoWidth) / 2;
  const photoY = height - 180;

  // Fondo del cuadro de la foto
  page.drawRectangle({
    x: photoX,
    y: photoY,
    width: photoWidth,
    height: photoHeight,
    color: rgb(0.12, 0.2, 0.4),
    borderColor: colorGold,
    borderWidth: 2.5,
  });

  let photoEmbedded = false;

  // Try loading photo from URL first (imported from Excel) with caching
  if (!photoEmbedded && beneficiary.photo_path && beneficiary.photo_path.startsWith('http')) {
    const driveCacheDir = path.join(__dirname, '..', 'uploads', 'photos');
    if (!fs.existsSync(driveCacheDir)) {
      fs.mkdirSync(driveCacheDir, { recursive: true });
    }
    const cacheFilename = `photo-drive-${beneficiary.uuid}.jpg`;
    const localCachePath = path.join(driveCacheDir, cacheFilename);

    try {
      let photoBytes;
      if (fs.existsSync(localCachePath)) {
        photoBytes = fs.readFileSync(localCachePath);
      } else {
        photoBytes = await downloadImageFromUrl(beneficiary.photo_path);
        fs.writeFileSync(localCachePath, photoBytes);
      }

      let image;
      try {
        image = await pdfDoc.embedJpg(photoBytes);
      } catch {
        image = await pdfDoc.embedPng(photoBytes);
      }
      page.drawImage(image, {
        x: photoX + 1.5,
        y: photoY + 1.5,
        width: photoWidth - 3,
        height: photoHeight - 3,
      });
      photoEmbedded = true;
    } catch (urlErr) {
      console.warn(`No se pudo descargar/cargar foto URL para ${beneficiary.document_number}: ${urlErr.message}`);
    }
  }

  // Try loading from local filesystem
  if (!photoEmbedded && beneficiary.photo_path && !beneficiary.photo_path.startsWith('http')) {
    const fullPhotoPath = path.join(__dirname, '..', beneficiary.photo_path);
    if (fs.existsSync(fullPhotoPath)) {
      try {
        const photoBytes = fs.readFileSync(fullPhotoPath);
        let image;
        if (path.extname(fullPhotoPath).toLowerCase() === '.png') {
          image = await pdfDoc.embedPng(photoBytes);
        } else {
          image = await pdfDoc.embedJpg(photoBytes);
        }
        page.drawImage(image, {
          x: photoX + 1.5,
          y: photoY + 1.5,
          width: photoWidth - 3,
          height: photoHeight - 3,
        });
        photoEmbedded = true;
      } catch (err) {
        console.error(`Error embedding local image for ${beneficiary.document_number}:`, err);
      }
    }
  }

  // Draw silhouette fallback if no photo is loaded
  if (!photoEmbedded) {
    page.drawCircle({
      x: photoX + photoWidth / 2,
      y: photoY + photoHeight / 2 + 8,
      size: 15,
      color: rgb(0.2, 0.35, 0.65),
    });
    page.drawRectangle({
      x: photoX + photoWidth / 2 - 20,
      y: photoY + photoHeight / 2 - 25,
      width: 40,
      height: 20,
      color: rgb(0.2, 0.35, 0.65),
    });
    page.drawText('SIN FOTO', {
      x: photoX + 18,
      y: photoY + 10,
      size: 7,
      font: fontHelveticaBold,
      color: colorWhite,
    });
  }

  // 5. Draw Beneficiary Information Details (Stacked centrally below photo)
  let textY = photoY - 14;

  // Helper function to draw centered label and value
  const drawLabelValueCentered = (labelText, valueText, sizeL, sizeV) => {
    // Draw Label (Gold)
    const labelW = fontHelveticaBold.widthOfTextAtSize(labelText, sizeL);
    page.drawText(labelText, {
      x: (width - labelW) / 2,
      y: textY,
      size: sizeL,
      font: fontHelveticaBold,
      color: colorGold,
    });
    textY -= (sizeL + 2);

    // Draw Value (White)
    const valW = fontHelvetica.widthOfTextAtSize(valueText, sizeV);
    page.drawText(valueText, {
      x: (width - valW) / 2,
      y: textY,
      size: sizeV,
      font: fontHelvetica,
      color: colorWhite,
    });
    textY -= (sizeV + 4);
  };

  // Draw inline label-value for short fields (aligned side by side but centered as a group)
  const drawLabelValueInline = (labelText, valueText, size) => {
    const labelW = fontHelveticaBold.widthOfTextAtSize(labelText, size);
    const valueW = fontHelvetica.widthOfTextAtSize(valueText, size);
    const totalGroupW = labelW + valueW;
    const startGroupX = (width - totalGroupW) / 2;

    // Label (Gold)
    page.drawText(labelText, {
      x: startGroupX,
      y: textY,
      size: size,
      font: fontHelveticaBold,
      color: colorGold,
    });

    // Value (White)
    page.drawText(valueText, {
      x: startGroupX + labelW,
      y: textY,
      size: size,
      font: fontHelvetica,
      color: colorWhite,
    });
    
    textY -= (size + 5);
  };

  // 5.1 Nombre
  drawLabelValueCentered('Nombre:', beneficiary.full_name.toUpperCase(), 9, 9);

  // 5.2 C.C.
  drawLabelValueInline('C.C. ', beneficiary.document_number, 8.5);

  // 5.3 Actividad Económica
  drawLabelValueCentered('ACTIVIDAD ECONÓMICA', beneficiary.economic_activity.toUpperCase(), 8.5, 9);

  // 6. Bottom Section (Disclaimer Left, QR Right)
  const qrSize = 52;
  const qrX = width - 18 - qrSize;
  const qrY = 18;

  // 6.1 QR Code Rendering
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const validateUrl = `${protocol}://${host}/validate.html?uuid=${beneficiary.uuid}`;
  try {
    const qrDataUrl = await qr.toDataURL(validateUrl, { margin: 1, width: 120 });
    const qrImageBytes = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    const qrImage = await pdfDoc.embedPng(qrImageBytes);

    // Draw white background for QR
    page.drawRectangle({
      x: qrX - 2,
      y: qrY - 2,
      width: qrSize + 4,
      height: qrSize + 4,
      color: colorWhite,
    });

    page.drawImage(qrImage, {
      x: qrX,
      y: qrY,
      width: qrSize,
      height: qrSize,
    });
  } catch (qrErr) {
    console.error('Error generating QR code for PDF:', qrErr);
  }

  // Label "ESCANEE PARA VERIFICAR AUTENTICIDAD"
  const qrLabelText = 'ESCANEE PARA';
  const qrLabelText2 = 'VERIFICAR AUTENTICIDAD';
  const qrLabelSize = 5.5;
  
  const qrLabelW1 = fontHelveticaBold.widthOfTextAtSize(qrLabelText, qrLabelSize);
  const qrLabelW2 = fontHelveticaBold.widthOfTextAtSize(qrLabelText2, qrLabelSize);
  
  page.drawText(qrLabelText, {
    x: qrX + (qrSize / 2) - (qrLabelW1 / 2),
    y: qrY - 8,
    size: qrLabelSize,
    font: fontHelveticaBold,
    color: colorWhite,
  });
  page.drawText(qrLabelText2, {
    x: qrX + (qrSize / 2) - (qrLabelW2 / 2),
    y: qrY - 14,
    size: qrLabelSize,
    font: fontHelveticaBold,
    color: colorWhite,
  });

  // 6.2 Legal Text Disclaimer (separado del QR, alineado a la derecha del centro)
  const disclaimerText = 'La expedición del presente carné se realiza exclusivamente en cumplimiento de lo ordenado en el Fallo Sentencia A.P. 314-2023. En ningún caso constituye permiso, autorización, licencia o reconocimiento alguno para el ejercicio de actividades de venta en el espacio público.';

  // El disclaimer ocupa el espacio entre las barras laterales y el QR
  // Se coloca entre x=14 y x=(qrX - 10) para separarse del QR
  const disclaimerX = 14;
  const disclaimerMaxW = qrX - disclaimerX - 10; // 10 pts de margen derecho antes del QR
  const disclaimerY = qrY + qrSize - 4;
  const disclaimerFontSize = 4.7;
  const disclaimerLineHeight = disclaimerFontSize * 1.4;

  // Dibujado con justificación simulada (palabra a palabra)
  const dWords = disclaimerText.split(' ');
  let dLine = '';
  let dCurrentY = disclaimerY;
  const dLines = [];

  for (let i = 0; i < dWords.length; i++) {
    const testLine = dLine + dWords[i] + ' ';
    const testWidth = fontHelvetica.widthOfTextAtSize(testLine, disclaimerFontSize);
    if (testWidth > disclaimerMaxW && dLine.length > 0) {
      dLines.push(dLine.trim());
      dLine = dWords[i] + ' ';
    } else {
      dLine = testLine;
    }
  }
  if (dLine.trim()) dLines.push(dLine.trim());

  // Render each line
  for (let li = 0; li < dLines.length; li++) {
    const lineText = dLines[li];
    const isLastLine = li === dLines.length - 1;
    const lineW = fontHelvetica.widthOfTextAtSize(lineText, disclaimerFontSize);
    let renderX = disclaimerX;

    if (!isLastLine && lineText.indexOf(' ') !== -1) {
      // Justificar: distribuir espacios extra
      const wordsInLine = lineText.split(' ');
      const totalWordsW = wordsInLine.reduce((sum, w) => sum + fontHelvetica.widthOfTextAtSize(w, disclaimerFontSize), 0);
      const totalSpace = disclaimerMaxW - totalWordsW;
      const spacePerGap = wordsInLine.length > 1 ? totalSpace / (wordsInLine.length - 1) : 0;
      let curX = disclaimerX;
      for (let wi = 0; wi < wordsInLine.length; wi++) {
        page.drawText(wordsInLine[wi], {
          x: curX,
          y: dCurrentY,
          size: disclaimerFontSize,
          font: fontHelvetica,
          color: colorWhite,
        });
        curX += fontHelvetica.widthOfTextAtSize(wordsInLine[wi], disclaimerFontSize) + spacePerGap;
      }
    } else {
      // Última línea: alinear a la izquierda normalmente
      page.drawText(lineText, {
        x: renderX,
        y: dCurrentY,
        size: disclaimerFontSize,
        font: fontHelvetica,
        color: colorWhite,
      });
    }
    dCurrentY -= disclaimerLineHeight;
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// GET /api/pdf/preview/:id - Get live preview of a card (returns PDF content directly to viewer)
router.get('/preview/:id', authenticateToken, async (req, res) => {
  try {
    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [req.params.id]);
    if (!beneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    const host = publicHost(req);
    const pdfBytes = await generateCardPdf(beneficiary, host);

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=carnet-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error generating PDF preview:', error);
    return res.status(500).json({ success: false, message: 'Error al generar la previsualización del carné.' });
  }
});

// GET /api/pdf/download/:id - Download single PDF
router.get('/download/:id', authenticateToken, async (req, res) => {
  try {
    const beneficiary = await dbGet('SELECT * FROM beneficiaries WHERE id = ?', [req.params.id]);
    if (!beneficiary) {
      return res.status(404).json({ success: false, message: 'Beneficiario no encontrado.' });
    }

    const host = publicHost(req);
    const pdfBytes = await generateCardPdf(beneficiary, host);

    res.contentType('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=carnet-${beneficiary.document_number}.pdf`);
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Error downloading PDF:', error);
    return res.status(500).json({ success: false, message: 'Error al descargar el carné.' });
  }
});

// POST /api/pdf/download-bulk - Download batch zip
router.post('/download-bulk', authenticateToken, async (req, res) => {
  const { ids } = req.body; // Array of numeric beneficiary IDs

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'Se requiere una lista de IDs válida.' });
  }

  try {
    // Fetch all records
    const placeholders = ids.map(() => '?').join(',');
    const beneficiaries = await dbAll(`SELECT * FROM beneficiaries WHERE id IN (${placeholders})`, ids);

    if (beneficiaries.length === 0) {
      return res.status(404).json({ success: false, message: 'No se encontraron registros coincidentes.' });
    }

    const zip = new JSZip();
    const host = publicHost(req);

    for (const b of beneficiaries) {
      const pdfBytes = await generateCardPdf(b, host);
      // Clean filename
      const filename = `carnet-${b.document_number}-${b.full_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      zip.file(filename, pdfBytes);
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    res.contentType('application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=carnes_vendedores_informales.zip');
    return res.send(zipBuffer);

  } catch (error) {
    console.error('Error generating bulk ZIP PDF:', error);
    return res.status(500).json({ success: false, message: 'Error al generar la descarga masiva.' });
  }
});

router.generateCardPdf = generateCardPdf;
module.exports = router;
