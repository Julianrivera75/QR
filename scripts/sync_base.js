#!/usr/bin/env node
/**
 * Sincroniza la tabla `beneficiaries` con una base oficial en Excel.
 *
 * - Conserva uuid (QR), foto, correo, escaneos y envíos de quien siga en la base nueva.
 * - Actualiza los datos de esas personas con lo que trae el Excel.
 * - Inserta las personas nuevas.
 * - Elimina los registros cuyo documento ya no está en la base nueva (p. ej. duplicados).
 * - Documentos "No tiene" repetidos reciben un identificador provisional SD-<fila>.
 *
 * Normaliza los campos igual que POST /api/beneficiaries/import.
 *
 * Uso:
 *   DATABASE_URL=postgres://... node scripts/sync_base.js <archivo.xlsx>           (simulación, no escribe)
 *   DATABASE_URL=postgres://... node scripts/sync_base.js <archivo.xlsx> --apply   (aplica en una transacción)
 */
const crypto = require('crypto');
const xlsx = require('xlsx');
const { Client } = require('pg');

const file = process.argv[2];
const apply = process.argv.includes('--apply');
if (!file || !process.env.DATABASE_URL) {
  console.error('Uso: DATABASE_URL=... node scripts/sync_base.js <archivo.xlsx> [--apply]');
  process.exit(1);
}

const strip = (s) => String(s ?? '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
const isEmpty = (v) => v === undefined || v === null || ['', 'undefined', 'null'].includes(String(v).trim().toLowerCase());

const columnsMap = {
  'nombre completo': 'full_name',
  'tipo de documento': 'document_type',
  'numero de documento de identidad': 'document_number',
  'numero de documento': 'document_number',
  'registrado en hemi': 'registered_hemi',
  'rivi': 'rivi',
  'estado': 'status',
  'edad': 'age',
  'genero': 'gender',
  'grupo poblacional o comunidad a la que pertenece o con la que se identifica': 'population_group',
  'grupo poblacional': 'population_group',
  'es o se reconoce como parte de alguno de los siguientes grupos poblacionales o comunidades': 'population_group',
  'presenta alguna discapacidad': 'disability',
  'telefono de contacto': 'phone',
  'coordenadas del punto de ubicacion': 'coordinates',
  'tipo de actividad economica': 'economic_activity',
  'beneficiario de alguna oferta del ipes': 'ipes_beneficiary',
  'tipo de oferta': 'offer_type',
  'cantidad de dias por semana que se ubica en la zona': 'days_per_week',
  'cuantos dias de la semana se ubica en la zona': 'days_per_week',
  'tiempo de permanencia en la zona': 'permanence_time',
  'hace cuanto tiempo esta en la zona': 'permanence_time',
  'foto': 'photo_url',
  'fotografia': 'photo_url',
  'correo electronico': 'email',
  'correo': 'email',
  'email': 'email'
};

const yesNo = (v) => ['si', 's', 'yes', 'y', '1', 'true'].includes(strip(v)) ? 'Sí' : 'No';
const gender = (v) => {
  const c = strip(v);
  if (['masculino', 'm', 'hombre'].includes(c)) return 'Masculino';
  if (['femenino', 'f', 'mujer'].includes(c)) return 'Femenino';
  return 'Otro';
};
const docType = (v) => {
  const c = strip(v);
  if (c.includes('ciudadania') || c === 'cc') return 'CC';
  if (c.includes('extranjeria') || c === 'ce') return 'CE';
  if (c.includes('especial de permanencia') || c === 'pep') return 'PEP';
  if (c.includes('proteccion temporal') || c === 'ppt') return 'PPT';
  if (c.includes('pasaporte')) return 'Pasaporte';
  return 'CC';
};
const status = (v) => {
  const c = strip(v);
  if (['inactivo', 'inactive', '0'].includes(c)) return 'Inactivo';
  if (['revocado', 'revoked'].includes(c)) return 'Revocado';
  return 'Activo';
};
const intIn = (v, min, max, def) => {
  const n = parseInt(String(v ?? '').replace(/\D/g, ''));
  return isNaN(n) || n < min || n > max ? def : n;
};

function readExcel(path) {
  const wb = xlsx.readFile(path);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  let headerRow = 0, best = 0;
  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    const m = (raw[r] || []).filter((c) => columnsMap[strip(c)]).length;
    if (m > best) { best = m; headerRow = r; }
  }
  const rows = xlsx.utils.sheet_to_json(sheet, { range: headerRow });
  const records = new Map();
  const report = { rows: rows.length, missing: [], duplicates: [], provisional: [] };

  rows.forEach((row, i) => {
    const line = i + headerRow + 2;
    const d = {};
    for (const k in row) {
      const f = columnsMap[strip(k)];
      if (f) d[f] = String(row[k]).trim();
    }
    if (isEmpty(d.full_name) || isEmpty(d.document_number)) {
      report.missing.push(line);
      return;
    }
    let doc = d.document_number;
    if (/e\+/i.test(doc)) doc = Math.round(parseFloat(doc)).toString();
    if (records.has(doc)) {
      if (strip(doc).startsWith('no tiene')) {
        const prov = `SD-${line}`;
        report.provisional.push({ line, name: d.full_name, doc: prov });
        doc = prov;
      } else {
        report.duplicates.push({ line, doc, name: d.full_name, firstLine: records.get(doc).line });
        return;
      }
    }
    let lat = null, lng = null;
    const parts = (d.coordinates || '').split(',');
    if (parts.length === 2) {
      lat = parseFloat(parts[0]); lng = parseFloat(parts[1]);
      if (isNaN(lat) || isNaN(lng)) { lat = null; lng = null; }
    }
    records.set(doc, {
      line,
      full_name: d.full_name,
      document_type: docType(isEmpty(d.document_type) ? 'CC' : d.document_type),
      document_number: doc,
      registered_hemi: yesNo(d.registered_hemi),
      rivi: d.rivi || '',
      status: status(d.status),
      age: intIn(d.age, 1, 999, 30),
      gender: gender(d.gender),
      population_group: isEmpty(d.population_group) ? 'Ninguno' : d.population_group,
      disability: yesNo(d.disability),
      phone: d.phone || '',
      email: d.email || '',
      latitude: lat,
      longitude: lng,
      economic_activity: isEmpty(d.economic_activity) ? 'Otro' : d.economic_activity,
      ipes_beneficiary: yesNo(d.ipes_beneficiary),
      offer_type: d.offer_type || '',
      days_per_week: intIn(d.days_per_week, 1, 7, 5),
      permanence_time: isEmpty(d.permanence_time) ? 'No especifica' : d.permanence_time,
      photo_path: d.photo_url || ''
    });
  });
  return { records, report };
}

const DATA_FIELDS = [
  'full_name', 'document_type', 'registered_hemi', 'rivi', 'status', 'age', 'gender', 'population_group',
  'disability', 'phone', 'latitude', 'longitude', 'economic_activity', 'ipes_beneficiary', 'offer_type',
  'days_per_week', 'permanence_time'
];

(async () => {
  const { records, report } = readExcel(file);
  console.log(`Filas leídas: ${report.rows}`);
  console.log(`Sin nombre/documento (descartadas): ${report.missing.length} ${report.missing.join(', ')}`);
  console.log(`Documento repetido (se conserva la primera fila): ${report.duplicates.length}`);
  report.duplicates.forEach((d) => console.log(`  fila ${d.line} doc ${d.doc} (primera: fila ${d.firstLine})`));
  console.log(`Identificadores provisionales: ${report.provisional.map((p) => `fila ${p.line} -> ${p.doc}`).join(', ') || 'ninguno'}`);
  console.log(`CARNÉS EN LA BASE NUEVA: ${records.size}\n`);

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows: existing } = await client.query('SELECT * FROM beneficiaries');
  // Excel puede perder ceros a la izquierda (011636158 -> 11636158) o traer espacios ("52 292588"):
  // se empareja primero por documento exacto y luego por documento normalizado, para no cambiar el QR.
  const normDoc = (d) => {
    const digits = String(d).replace(/\D/g, '');
    return digits && /^[\d\s.\-]+$/.test(String(d).trim()) ? digits.replace(/^0+/, '') : String(d).trim();
  };
  const byDoc = new Map();
  const unmatched = new Map(existing.map((r) => [r.id, r]));
  for (const r of records.values()) {
    const ex = existing.find((e) => e.document_number === r.document_number);
    if (ex && unmatched.has(ex.id)) { byDoc.set(r.document_number, ex); unmatched.delete(ex.id); }
  }
  const byNorm = new Map();
  for (const e of unmatched.values()) byNorm.set(normDoc(e.document_number), e);
  for (const r of records.values()) {
    if (byDoc.has(r.document_number)) continue;
    const ex = byNorm.get(normDoc(r.document_number));
    if (ex && unmatched.has(ex.id)) {
      byDoc.set(r.document_number, ex);
      unmatched.delete(ex.id);
      // Si la BD tenía ceros a la izquierda, se conservan; si tenía espacios/puntos, se limpia
      if (String(ex.document_number).replace(/\D/g, '') !== ex.document_number) r.newDocNumber = r.document_number;
      console.log(`  Emparejado: BD '${ex.document_number}' = Excel '${r.document_number}'${r.newDocNumber ? ' (se corrige)' : ' (se conserva el de BD)'}`);
    }
  }

  const toInsert = [...records.values()].filter((r) => !byDoc.has(r.document_number));
  const toUpdate = [...records.values()].filter((r) => byDoc.has(r.document_number));
  const toDelete = [...unmatched.values()];

  console.log(`Registros actuales en BD: ${existing.length}`);
  console.log(`  Se conservan y actualizan (mismo QR): ${toUpdate.length}`);
  console.log(`  Se insertan (nuevos): ${toInsert.length}`);
  console.log(`  Se eliminan (no están en la base nueva): ${toDelete.length}`);
  if (toDelete.length) {
    const ids = toDelete.map((r) => r.id);
    const scans = await client.query('SELECT COUNT(*)::int AS n FROM scan_logs WHERE beneficiary_id = ANY($1)', [ids]);
    const mails = await client.query('SELECT COUNT(*)::int AS n FROM email_logs WHERE beneficiary_id = ANY($1)', [ids]);
    console.log(`    (con ${scans.rows[0].n} escaneos y ${mails.rows[0].n} correos asociados)`);
  }
  console.log(`Total después de sincronizar: ${toUpdate.length + toInsert.length}`);
  if (process.argv.includes('--details')) {
    console.log('\nA eliminar:');
    toDelete.forEach((r) => console.log(`  ${r.document_number} | ${r.full_name}`));
    console.log('A insertar:');
    toInsert.forEach((r) => console.log(`  fila ${r.line} | ${r.document_number} | ${r.full_name}`));
  }

  if (!apply) {
    console.log('\nSimulación: no se escribió nada. Ejecute con --apply para aplicar.');
    await client.end();
    return;
  }

  try {
    await client.query('BEGIN');
    for (const r of toDelete) {
      await client.query('DELETE FROM beneficiaries WHERE id = $1', [r.id]);
    }
    for (const r of toUpdate) {
      const old = byDoc.get(r.document_number);
      const sets = DATA_FIELDS.map((f, i) => `${f} = $${i + 1}`);
      const vals = DATA_FIELDS.map((f) => r[f]);
      // Foto y correo: solo se reemplazan si el Excel trae un valor
      vals.push(r.photo_path || old.photo_path || '');
      sets.push(`photo_path = $${vals.length}`);
      vals.push(r.email || old.email || '');
      sets.push(`email = $${vals.length}`);
      if (r.newDocNumber) {
        vals.push(r.newDocNumber);
        sets.push(`document_number = $${vals.length}`);
      }
      vals.push(old.id);
      await client.query(
        `UPDATE beneficiaries SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${vals.length}`,
        vals
      );
    }
    const cols = ['uuid', 'document_number', 'photo_path', 'email', ...DATA_FIELDS];
    for (const r of toInsert) {
      const vals = cols.map((c) => (c === 'uuid' ? crypto.randomUUID() : r[c]));
      await client.query(
        `INSERT INTO beneficiaries (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
        vals
      );
    }
    await client.query(
      `INSERT INTO audit_logs (user_id, beneficiary_id, action, fields_changed) VALUES (NULL, NULL, 'SYNC_BASE', $1)`,
      [JSON.stringify({ file: require('path').basename(file), updated: toUpdate.length, inserted: toInsert.length, deleted: toDelete.length })]
    );
    await client.query('COMMIT');
    const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM beneficiaries');
    console.log(`\nSincronización aplicada. Registros en BD: ${n}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error; se revirtió la transacción:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
