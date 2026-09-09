// Script completo: genera informe de TODOS los registros duplicados del Excel
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const filePath = path.join(__dirname, '..', 'Base identificación San Victorino (1).xlsx');
const workbook = xlsx.readFile(filePath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

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

const rows = xlsx.utils.sheet_to_json(sheet, { range: headerRowIndex });

// Collect all rows keyed by document number
const documentMap = new Map(); // doc -> [{rowIndex, name, docType, activity, phone, ...}]

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const rowIndex = i + headerRowIndex + 2;

  let docNumber = null;
  let fullName = null;
  let docType = null;
  let activity = null;
  let phone = null;
  let status = null;
  let rivi = null;

  for (const rawKey in row) {
    const norm = normalizeKey(rawKey);
    if (norm.includes('numerodedocumentodeidentidad') || norm.includes('numerodedocumento') || norm.includes('documentoidentidad')) {
      docNumber = String(row[rawKey]).trim();
      if (/e\+/i.test(docNumber)) {
        const parsed = parseFloat(docNumber);
        if (!isNaN(parsed)) docNumber = Math.round(parsed).toString();
      }
    }
    if (norm.includes('nombrecompleto') || norm === 'nombre') {
      fullName = String(row[rawKey]).trim();
    }
    if (norm.includes('tipodedocumento') || norm === 'tipodocumento') {
      docType = String(row[rawKey]).trim();
    }
    if (norm.includes('tipodeactividadeconomica') || norm.includes('actividadeconomica')) {
      activity = String(row[rawKey]).trim();
    }
    if (norm.includes('telefonodecontacto') || norm.includes('telefono')) {
      phone = String(row[rawKey]).trim();
    }
    if (norm === 'estado') {
      status = String(row[rawKey]).trim();
    }
    if (norm === 'rivi') {
      rivi = String(row[rawKey]).trim();
    }
  }

  if (!docNumber) docNumber = '(vacío)';
  if (!fullName) fullName = '(sin nombre)';

  if (!documentMap.has(docNumber)) {
    documentMap.set(docNumber, []);
  }
  documentMap.get(docNumber).push({
    rowIndex,
    fullName,
    docType: docType || '-',
    activity: activity || '-',
    phone: phone || '-',
    status: status || '-',
    rivi: rivi || '-'
  });
}

// Filter only duplicates
const duplicates = [];
for (const [doc, entries] of documentMap) {
  if (entries.length > 1) {
    duplicates.push({ doc, entries });
  }
}

// Sort by number of appearances (desc), then by doc number
duplicates.sort((a, b) => b.entries.length - a.entries.length || a.doc.localeCompare(b.doc));

// Generate markdown report
let md = `# Informe Completo de Registros Duplicados\n\n`;
md += `**Archivo analizado:** Base identificación San Victorino (1).xlsx\n`;
md += `**Fecha del análisis:** ${new Date().toLocaleString('es-CO')}\n\n`;
md += `---\n\n`;
md += `## Resumen General\n\n`;
md += `| Concepto | Cantidad |\n`;
md += `|----------|----------|\n`;
md += `| Total filas en el Excel | ${rows.length} |\n`;
md += `| Documentos únicos | ${documentMap.size} |\n`;
md += `| Documentos con duplicados | ${duplicates.length} |\n`;
md += `| Total filas duplicadas (extras) | ${duplicates.reduce((s, d) => s + d.entries.length - 1, 0)} |\n`;
md += `| Total filas involucradas en duplicación | ${duplicates.reduce((s, d) => s + d.entries.length, 0)} |\n\n`;

md += `---\n\n`;
md += `## Detalle por Número de Apariciones\n\n`;

// Group by count
const byCount = {};
for (const d of duplicates) {
  const c = d.entries.length;
  if (!byCount[c]) byCount[c] = [];
  byCount[c].push(d);
}

for (const count of Object.keys(byCount).sort((a, b) => b - a)) {
  const group = byCount[count];
  md += `### Documentos que aparecen ${count} veces (${group.length} documentos)\n\n`;

  for (const dup of group) {
    md += `#### Documento: \`${dup.doc}\`\n\n`;
    md += `| # | Fila Excel | Nombre | Tipo Doc | Actividad Económica | Teléfono | Estado | RIVI |\n`;
    md += `|---|-----------|--------|----------|---------------------|----------|--------|------|\n`;
    dup.entries.forEach((e, idx) => {
      const marker = idx === 0 ? '✅' : '🔴';
      md += `| ${marker} | ${e.rowIndex} | ${e.fullName} | ${e.docType} | ${e.activity} | ${e.phone} | ${e.status} | ${e.rivi} |\n`;
    });
    md += `\n`;
  }
}

md += `---\n\n`;
md += `## Leyenda\n\n`;
md += `- ✅ = Primera aparición (se importa a la base de datos)\n`;
md += `- 🔴 = Duplicado (se descarta durante la importación)\n\n`;
md += `## Recomendaciones\n\n`;
md += `1. Revisar si los duplicados son realmente la misma persona o si hay errores de digitación en el número de documento.\n`;
md += `2. En caso de que sean la misma persona, verificar cuál fila tiene los datos más actualizados.\n`;
md += `3. Los 4 registros con documento \`No tiene\` requieren asignación de un identificador único.\n`;

// Write the report
const outputPath = path.join(__dirname, '..', 'scratch', 'informe_duplicados.md');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, md, 'utf-8');
console.log(`Informe generado en: ${outputPath}`);
console.log(`Total documentos duplicados: ${duplicates.length}`);
console.log(`Total filas involucradas: ${duplicates.reduce((s, d) => s + d.entries.length, 0)}`);
