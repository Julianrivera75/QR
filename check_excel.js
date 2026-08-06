const xlsx = require('xlsx');
const path = require('path');

const filePath = 'C:\\Users\\jairo\\OneDrive\\Escritorio\\Codigo QR_vendedores_Informales\\Libro1.xlsx';
const wb = xlsx.readFile(filePath);
const ws = wb.Sheets[wb.SheetNames[0]];

// Get first 5 rows as arrays to see the raw header values
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

console.log('=== NOMBRES DE COLUMNAS EN LA FILA DE ENCABEZADO ===');
// Find first non-empty row with many columns (the header)
for (let i = 0; i < Math.min(15, rows.length); i++) {
  if (rows[i].length > 5) {
    console.log(`\nFila ${i + 1} (${rows[i].length} columnas):`);
    rows[i].forEach((col, idx) => {
      const preview = String(col).substring(0, 60).replace(/\n/g, ' ');
      console.log(`  [${idx}] "${preview}"`);
    });
    break;
  }
}

// Also show the value in column T (index 19) for the first data row
console.log('\n=== VALOR DE COLUMNA T (foto) EN FILA 2 ===');
for (let i = 0; i < Math.min(15, rows.length); i++) {
  if (rows[i].length > 5) {
    // First header row found, next row is data
    const dataRow = rows[i + 1];
    if (dataRow) {
      console.log('Columna T (índice 19):', JSON.stringify(dataRow[19]));
      console.log('Columna S (índice 18):', JSON.stringify(dataRow[18]));
      console.log('Columna U (índice 20):', JSON.stringify(dataRow[20]));
    }
    break;
  }
}
