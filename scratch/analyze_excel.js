// Script de análisis del Excel para encontrar la discrepancia entre 2246 filas y 1829 importados
const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join(__dirname, '..', 'Base identificación San Victorino (1).xlsx');
console.log('Analizando archivo:', filePath);

const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Detect header row (same logic as import)
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
  if (matches > maxMatches) {
    maxMatches = matches;
    headerRowIndex = r;
  }
}

console.log(`\nCabecera detectada en fila Excel: ${headerRowIndex + 1} (${maxMatches} coincidencias)`);

// Parse all rows
const rows = xlsx.utils.sheet_to_json(sheet, { range: headerRowIndex });
console.log(`Total de filas de datos (después de cabecera): ${rows.length}`);

// Analyze each row
let emptyRows = 0;
let missingName = 0;
let missingDoc = 0;
let missingBoth = 0;
let validRows = 0;
const documentNumbers = new Map(); // doc -> [row indices]
const duplicateRows = [];
const missingFieldRows = [];

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const rowIndex = i + headerRowIndex + 2;

  // Check if row is completely empty
  const values = Object.values(row).map(v => String(v).trim()).filter(v => v !== '' && v !== 'undefined');
  if (values.length === 0) {
    emptyRows++;
    continue;
  }

  // Find document number and name using normalized keys
  let docNumber = null;
  let fullName = null;

  for (const rawKey in row) {
    const norm = normalizeKey(rawKey);
    if (norm.includes('numerodedocumentodeidentidad') || norm.includes('numerodedocumento') || norm.includes('documentoidentidad')) {
      docNumber = String(row[rawKey]).trim();
      // Handle scientific notation
      if (/e\+/i.test(docNumber)) {
        const parsed = parseFloat(docNumber);
        if (!isNaN(parsed)) docNumber = Math.round(parsed).toString();
      }
    }
    if (norm.includes('nombrecompleto') || norm === 'nombre') {
      fullName = String(row[rawKey]).trim();
    }
  }

  const nameEmpty = !fullName || fullName === '' || fullName.toLowerCase() === 'undefined' || fullName.toLowerCase() === 'null';
  const docEmpty = !docNumber || docNumber === '' || docNumber.toLowerCase() === 'undefined' || docNumber.toLowerCase() === 'null';

  if (nameEmpty && docEmpty) {
    missingBoth++;
    missingFieldRows.push({ row: rowIndex, reason: 'Sin nombre NI documento' });
    continue;
  }
  if (nameEmpty) {
    missingName++;
    missingFieldRows.push({ row: rowIndex, reason: 'Sin nombre', doc: docNumber });
    continue;
  }
  if (docEmpty) {
    missingDoc++;
    missingFieldRows.push({ row: rowIndex, reason: 'Sin documento', name: fullName });
    continue;
  }

  // Track duplicates
  if (documentNumbers.has(docNumber)) {
    documentNumbers.get(docNumber).push(rowIndex);
  } else {
    documentNumbers.set(docNumber, [rowIndex]);
  }

  validRows++;
}

// Count duplicates
let duplicateCount = 0;
let duplicateEntries = [];
for (const [doc, indices] of documentNumbers) {
  if (indices.length > 1) {
    duplicateCount += indices.length - 1; // Only count extras
    duplicateEntries.push({ doc, count: indices.length, rows: indices.join(', ') });
  }
}

const uniqueDocuments = documentNumbers.size;

console.log('\n====== RESUMEN DEL ANÁLISIS ======');
console.log(`Total filas de datos en Excel:     ${rows.length}`);
console.log(`Filas completamente vacías:        ${emptyRows}`);
console.log(`Filas sin nombre Y sin documento:  ${missingBoth}`);
console.log(`Filas sin nombre (tiene doc):      ${missingName}`);
console.log(`Filas sin documento (tiene nombre):${missingDoc}`);
console.log(`Filas válidas (nombre + doc):      ${validRows}`);
console.log(`Documentos únicos:                 ${uniqueDocuments}`);
console.log(`Filas duplicadas (mismo doc):      ${duplicateCount}`);
console.log(`Registros que se importarían:      ${uniqueDocuments} (sin duplicados)`);

console.log('\n====== DIFERENCIA ======');
console.log(`Excel total:       ${rows.length}`);
console.log(`En producción:     1829`);
console.log(`Diferencia:        ${rows.length - 1829}`);
console.log(`Explicación posible:`);
console.log(`  - Filas sin campos requeridos: ${emptyRows + missingBoth + missingName + missingDoc}`);
console.log(`  - Documentos duplicados:       ${duplicateCount}`);
console.log(`  - Total descartado:            ${emptyRows + missingBoth + missingName + missingDoc + duplicateCount}`);

if (duplicateEntries.length > 0) {
  console.log(`\n====== TOP 20 DOCUMENTOS DUPLICADOS ======`);
  duplicateEntries.sort((a, b) => b.count - a.count);
  duplicateEntries.slice(0, 20).forEach(d => {
    console.log(`  Doc: ${d.doc} → ${d.count} veces (filas: ${d.rows})`);
  });
  if (duplicateEntries.length > 20) {
    console.log(`  ... y ${duplicateEntries.length - 20} documentos duplicados más.`);
  }
}

if (missingFieldRows.length > 0) {
  console.log(`\n====== PRIMERAS 20 FILAS CON CAMPOS FALTANTES ======`);
  missingFieldRows.slice(0, 20).forEach(r => {
    console.log(`  Fila ${r.row}: ${r.reason}${r.doc ? ' (doc: ' + r.doc + ')' : ''}${r.name ? ' (nombre: ' + r.name + ')' : ''}`);
  });
  if (missingFieldRows.length > 20) {
    console.log(`  ... y ${missingFieldRows.length - 20} filas más con campos faltantes.`);
  }
}
