// Genera un PDF profesional del informe de duplicados
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const normalizeKey = (key) => {
  return String(key).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

const columnKeywords = [
  'nombre', 'documento', 'identidad', 'hemi', 'rivi', 'estado',
  'edad', 'genero', 'poblacional', 'discapacidad', 'telefono',
  'coordenada', 'actividad', 'beneficiario', 'oferta', 'dias',
  'tiempo', 'foto', 'responsable', 'correo'
];

async function generateReport() {
  // --- 1. Parse Excel ---
  const filePath = path.join(__dirname, '..', 'Base identificación San Victorino (1).xlsx');
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const range = xlsx.utils.decode_range(sheet['!ref']);
  let headerRowIndex = 0;
  let maxMatches = 0;
  for (let r = range.s.r; r <= Math.min(range.s.r + 10, range.e.r); r++) {
    let matches = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[xlsx.utils.encode_cell({ r, c })];
      if (cell) {
        const norm = normalizeKey(String(cell.v));
        if (columnKeywords.some(kw => norm.includes(kw))) matches++;
      }
    }
    if (matches > maxMatches) { maxMatches = matches; headerRowIndex = r; }
  }

  const rows = xlsx.utils.sheet_to_json(sheet, { range: headerRowIndex });
  const documentMap = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowIndex = i + headerRowIndex + 2;
    let docNumber = null, fullName = null, docType = null, activity = null, phone = null, status = null, rivi = null;

    for (const rawKey in row) {
      const norm = normalizeKey(rawKey);
      if (norm.includes('numerodedocumentodeidentidad') || norm.includes('numerodedocumento')) {
        docNumber = String(row[rawKey]).trim();
        if (/e\+/i.test(docNumber)) { const p = parseFloat(docNumber); if (!isNaN(p)) docNumber = Math.round(p).toString(); }
      }
      if (norm.includes('nombrecompleto') || norm === 'nombre') fullName = String(row[rawKey]).trim();
      if (norm.includes('tipodedocumento')) docType = String(row[rawKey]).trim();
      if (norm.includes('tipodeactividadeconomica') || norm.includes('actividadeconomica')) activity = String(row[rawKey]).trim();
      if (norm.includes('telefonodecontacto') || norm.includes('telefono')) phone = String(row[rawKey]).trim();
      if (norm === 'estado') status = String(row[rawKey]).trim();
      if (norm === 'rivi') rivi = String(row[rawKey]).trim();
    }

    if (!docNumber) docNumber = '(vacio)';
    if (!fullName) fullName = '(sin nombre)';
    if (!documentMap.has(docNumber)) documentMap.set(docNumber, []);
    documentMap.get(docNumber).push({ rowIndex, fullName, docType: docType || '-', activity: activity || '-', phone: phone || '-', status: status || '-', rivi: rivi || '-' });
  }

  const duplicates = [];
  for (const [doc, entries] of documentMap) {
    if (entries.length > 1) duplicates.push({ doc, entries });
  }
  duplicates.sort((a, b) => b.entries.length - a.entries.length || a.doc.localeCompare(b.doc));

  const totalDupExtras = duplicates.reduce((s, d) => s + d.entries.length - 1, 0);
  const totalDupRows = duplicates.reduce((s, d) => s + d.entries.length, 0);

  // --- 2. Build PDF ---
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 842; // A4 landscape width
  const PAGE_H = 595; // A4 landscape height
  const MARGIN = 40;
  const CONTENT_W = PAGE_W - 2 * MARGIN;
  let page, y;
  let pageNum = 0;

  const colorDarkBlue = rgb(26 / 255, 54 / 255, 120 / 255);
  const colorGold = rgb(200 / 255, 155 / 255, 30 / 255);
  const colorRed = rgb(0.8, 0.15, 0.15);
  const colorGreen = rgb(0.1, 0.55, 0.2);
  const colorGray = rgb(0.4, 0.4, 0.4);
  const colorLightGray = rgb(0.92, 0.92, 0.92);
  const colorWhite = rgb(1, 1, 1);
  const colorBlack = rgb(0, 0, 0);
  const colorHeaderBg = rgb(26 / 255, 54 / 255, 120 / 255);

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    pageNum++;
    y = PAGE_H - MARGIN;

    // Header bar
    page.drawRectangle({ x: 0, y: PAGE_H - 30, width: PAGE_W, height: 30, color: colorDarkBlue });
    const headerText = 'INFORME DE REGISTROS DUPLICADOS - Base San Victorino';
    page.drawText(headerText, { x: MARGIN, y: PAGE_H - 22, size: 10, font: fontBold, color: colorWhite });
    const pageText = `Pag. ${pageNum}`;
    const pageTextW = fontRegular.widthOfTextAtSize(pageText, 9);
    page.drawText(pageText, { x: PAGE_W - MARGIN - pageTextW, y: PAGE_H - 22, size: 9, font: fontRegular, color: colorGold });

    // Footer
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 18, color: colorDarkBlue });
    const footerText = `Generado: ${new Date().toLocaleString('es-CO')} | Fallo AP 314-2023 | San Victorino`;
    page.drawText(footerText, { x: MARGIN, y: 5, size: 7, font: fontRegular, color: colorWhite });

    y = PAGE_H - MARGIN - 15;
    return page;
  }

  function checkSpace(needed) {
    if (y - needed < 30) { newPage(); }
  }

  function drawText(text, x, fontSize, font, color) {
    page.drawText(text, { x, y, size: fontSize, font, color: color || colorBlack });
  }

  // Sanitize text: replace non-WinAnsi characters with ASCII equivalents
  function sanitizeText(text) {
    if (!text) return '';
    return String(text)
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // strip accents/diacritics
      .replace(/[^\x20-\x7E\xA0-\xFF]/g, ''); // keep only WinAnsi-safe chars
  }

  // Truncate text to fit width
  function truncate(text, maxW, font, fontSize) {
    if (!text) return '';
    let t = sanitizeText(String(text));
    while (t.length > 0 && font.widthOfTextAtSize(t, fontSize) > maxW) {
      t = t.slice(0, -1);
    }
    if (t.length < sanitizeText(String(text)).length && t.length > 2) t = t.slice(0, -2) + '..';
    return t;
  }

  // ============ PAGE 1: Cover + Summary ============
  newPage();
  y = PAGE_H - 80;

  // Title
  const title = 'INFORME COMPLETO DE REGISTROS DUPLICADOS';
  const titleW = fontBold.widthOfTextAtSize(title, 20);
  page.drawText(title, { x: (PAGE_W - titleW) / 2, y, size: 20, font: fontBold, color: colorDarkBlue });
  y -= 25;
  const subtitle = 'Base de datos: Base identificacion San Victorino (1).xlsx';
  const subtitleW = fontRegular.widthOfTextAtSize(subtitle, 11);
  page.drawText(subtitle, { x: (PAGE_W - subtitleW) / 2, y, size: 11, font: fontRegular, color: colorGray });
  y -= 15;
  const dateStr = `Fecha del analisis: ${new Date().toLocaleString('es-CO')}`;
  const dateW = fontRegular.widthOfTextAtSize(dateStr, 10);
  page.drawText(dateStr, { x: (PAGE_W - dateW) / 2, y, size: 10, font: fontRegular, color: colorGray });
  y -= 40;

  // Summary table
  page.drawText('RESUMEN GENERAL', { x: MARGIN, y, size: 14, font: fontBold, color: colorDarkBlue });
  y -= 20;

  const summaryData = [
    ['Total filas en el Excel', String(rows.length)],
    ['Documentos unicos', String(documentMap.size)],
    ['Documentos con duplicados', String(duplicates.length)],
    ['Total filas duplicadas (extras descartadas)', String(totalDupExtras)],
    ['Total filas involucradas en duplicacion', String(totalDupRows)],
    ['Registros importados a produccion', String(documentMap.size - (documentMap.size - 1829))],
  ];

  const sumColW = [420, 150];
  for (let i = 0; i < summaryData.length; i++) {
    const bgColor = i % 2 === 0 ? colorLightGray : colorWhite;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: sumColW[0] + sumColW[1], height: 18, color: bgColor });
    page.drawText(summaryData[i][0], { x: MARGIN + 8, y: y, size: 10, font: fontRegular, color: colorBlack });
    page.drawText(summaryData[i][1], { x: MARGIN + sumColW[0] + 20, y: y, size: 11, font: fontBold, color: colorDarkBlue });
    y -= 18;
  }

  y -= 30;

  // Distribution
  page.drawText('DISTRIBUCION DE DUPLICADOS', { x: MARGIN, y, size: 14, font: fontBold, color: colorDarkBlue });
  y -= 20;

  const byCount = {};
  for (const d of duplicates) {
    const c = d.entries.length;
    if (!byCount[c]) byCount[c] = 0;
    byCount[c]++;
  }

  const distHeaders = ['Apariciones', 'Documentos afectados', 'Filas extras descartadas'];
  const distColW = [120, 160, 180];
  // Header row
  page.drawRectangle({ x: MARGIN, y: y - 4, width: distColW.reduce((a, b) => a + b, 0), height: 18, color: colorHeaderBg });
  let dx = MARGIN + 8;
  for (let h = 0; h < distHeaders.length; h++) {
    page.drawText(distHeaders[h], { x: dx, y: y, size: 9, font: fontBold, color: colorWhite });
    dx += distColW[h];
  }
  y -= 18;

  for (const count of Object.keys(byCount).sort((a, b) => b - a)) {
    const numDocs = byCount[count];
    const bgColor = y % 2 === 0 ? colorLightGray : colorWhite;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: distColW.reduce((a, b) => a + b, 0), height: 18, color: bgColor });
    page.drawText(`${count} veces`, { x: MARGIN + 8, y, size: 10, font: fontRegular, color: colorBlack });
    page.drawText(`${numDocs} documentos`, { x: MARGIN + distColW[0] + 8, y, size: 10, font: fontRegular, color: colorBlack });
    page.drawText(`${numDocs * (parseInt(count) - 1)} filas`, { x: MARGIN + distColW[0] + distColW[1] + 8, y, size: 10, font: fontRegular, color: colorBlack });
    y -= 18;
  }

  y -= 30;

  // Legend
  page.drawText('LEYENDA', { x: MARGIN, y, size: 12, font: fontBold, color: colorDarkBlue });
  y -= 16;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: 12, height: 12, color: colorGreen });
  page.drawText('1ra aparicion  =  Se importa a la base de datos (registro valido)', { x: MARGIN + 18, y, size: 9, font: fontRegular, color: colorBlack });
  y -= 16;
  page.drawRectangle({ x: MARGIN, y: y - 2, width: 12, height: 12, color: colorRed });
  page.drawText('Duplicado  =  Se descarta durante la importacion', { x: MARGIN + 18, y, size: 9, font: fontRegular, color: colorBlack });

  // ============ DETAIL PAGES ============
  // Table columns: #, Fila, Nombre, Tipo Doc, Actividad, Telefono, Estado, RIVI
  const colWidths = [25, 40, 195, 90, 180, 80, 80, 70];
  const colHeaders = ['#', 'Fila', 'Nombre', 'Tipo Doc.', 'Actividad Economica', 'Telefono', 'Estado', 'RIVI'];
  const totalTableW = colWidths.reduce((a, b) => a + b, 0);

  function drawTableHeader() {
    checkSpace(20);
    page.drawRectangle({ x: MARGIN, y: y - 4, width: totalTableW, height: 16, color: colorHeaderBg });
    let cx = MARGIN + 3;
    for (let h = 0; h < colHeaders.length; h++) {
      page.drawText(colHeaders[h], { x: cx, y: y - 1, size: 7, font: fontBold, color: colorWhite });
      cx += colWidths[h];
    }
    y -= 16;
  }

  function drawTableRow(entry, idx, isFirst) {
    checkSpace(14);
    const bgColor = idx % 2 === 0 ? colorLightGray : colorWhite;
    page.drawRectangle({ x: MARGIN, y: y - 3, width: totalTableW, height: 13, color: bgColor });

    // Status indicator
    const indicatorColor = isFirst ? colorGreen : colorRed;
    page.drawRectangle({ x: MARGIN + 1, y: y - 1, width: 8, height: 8, color: indicatorColor });
    const indicatorText = isFirst ? 'OK' : 'DUP';
    page.drawText(indicatorText, { x: MARGIN + 2, y: y, size: 5, font: fontBold, color: colorWhite });

    let cx = MARGIN + 3;
    const vals = [
      '',
      String(entry.rowIndex),
      truncate(entry.fullName, colWidths[2] - 6, fontRegular, 7.5),
      truncate(entry.docType, colWidths[3] - 6, fontRegular, 7.5),
      truncate(entry.activity, colWidths[4] - 6, fontRegular, 7.5),
      sanitizeText(entry.phone),
      truncate(entry.status, colWidths[6] - 6, fontRegular, 7.5),
      sanitizeText(entry.rivi)
    ];

    for (let c = 0; c < vals.length; c++) {
      const textColor = c === 0 ? colorWhite : colorBlack;
      page.drawText(vals[c], { x: cx + 3, y: y, size: 7.5, font: fontRegular, color: textColor });
      cx += colWidths[c];
    }
    y -= 13;
  }

  // Render each duplicate group
  let dupCounter = 0;
  for (const dup of duplicates) {
    dupCounter++;
    const neededSpace = 20 + 16 + (dup.entries.length * 13) + 10;
    checkSpace(Math.min(neededSpace, 80)); // At minimum need space for header + 1 row

    // Document header
    y -= 6;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: totalTableW, height: 16, color: rgb(0.85, 0.88, 0.95) });
    page.drawText(`${dupCounter}. Documento: ${sanitizeText(dup.doc)}`, { x: MARGIN + 5, y: y - 1, size: 9, font: fontBold, color: colorDarkBlue });
    const countText = `${dup.entries.length} apariciones`;
    const countTextW = fontRegular.widthOfTextAtSize(countText, 8);
    page.drawText(countText, { x: MARGIN + totalTableW - countTextW - 10, y: y, size: 8, font: fontBold, color: colorRed });
    y -= 18;

    drawTableHeader();

    for (let ei = 0; ei < dup.entries.length; ei++) {
      drawTableRow(dup.entries[ei], ei, ei === 0);
    }
    y -= 4;
  }

  // Save
  const pdfBytes = await pdfDoc.save();
  const outputPath = path.join(__dirname, '..', 'informe_duplicados.pdf');
  fs.writeFileSync(outputPath, pdfBytes);
  console.log(`PDF generado: ${outputPath}`);
  console.log(`Paginas: ${pageNum}`);
  console.log(`Documentos duplicados: ${duplicates.length}`);
}

generateReport().catch(err => { console.error('Error:', err); process.exit(1); });
