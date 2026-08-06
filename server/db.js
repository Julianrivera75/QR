const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'database', 'platform.db');

// Ensure database directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbReadyResolve;
const dbReady = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    initializeDatabase();
  }
});

// Helper functions for promise-based queries
const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

async function initializeDatabase() {
  try {
    // Enable Foreign Keys
    await dbRun('PRAGMA foreign_keys = ON;');

    // 1. Create Users Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Create Beneficiaries Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS beneficiaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        document_type TEXT CHECK(document_type IN ('CC', 'CE', 'PEP', 'PPT', 'Pasaporte')) NOT NULL,
        document_number TEXT UNIQUE NOT NULL,
        registered_hemi TEXT CHECK(registered_hemi IN ('Sí', 'No')) NOT NULL,
        rivi TEXT,
        status TEXT CHECK(status IN ('Activo', 'Inactivo', 'Revocado')) DEFAULT 'Activo',
        age INTEGER NOT NULL,
        gender TEXT CHECK(gender IN ('Masculino', 'Femenino', 'Otro')) NOT NULL,
        population_group TEXT NOT NULL,
        disability TEXT CHECK(disability IN ('Sí', 'No')) NOT NULL,
        phone TEXT,
        latitude REAL,
        longitude REAL,
        economic_activity TEXT NOT NULL,
        ipes_beneficiary TEXT CHECK(ipes_beneficiary IN ('Sí', 'No')) NOT NULL,
        offer_type TEXT,
        days_per_week INTEGER CHECK(days_per_week BETWEEN 1 AND 7) NOT NULL,
        permanence_time TEXT NOT NULL,
        photo_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Create Audit Logs Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        beneficiary_id INTEGER,
        action TEXT NOT NULL,
        fields_changed TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE SET NULL
      );
    `);

    // 4. Create Scan Logs Table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS scan_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        beneficiary_id INTEGER NOT NULL,
        scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        status_at_scan TEXT NOT NULL,
        FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE CASCADE
      );
    `);

    console.log('Tables initialized successfully.');

    // Seed data
    await seedUsers();
    await seedBeneficiaries();

    dbReadyResolve();
  } catch (error) {
    console.error('Error initializing database tables:', error);
  }
}

async function seedUsers() {
  try {
    const row = await dbGet('SELECT COUNT(*) as count FROM users');
    if (row.count === 0) {
      console.log('Seeding default admin user...');
      const adminPasswordHash = await bcrypt.hash('admin123', 10);
      await dbRun(
        'INSERT INTO users (username, password_hash, full_name) VALUES (?, ?, ?)',
        ['admin', adminPasswordHash, 'Administrador General']
      );
      console.log('Default admin seeded successfully. (username: admin, password: admin123)');
    }
  } catch (error) {
    console.error('Error seeding users:', error);
  }
}

async function seedBeneficiaries() {
  try {
    const row = await dbGet('SELECT COUNT(*) as count FROM beneficiaries');
    if (row.count === 0) {
      console.log('Seeding mock beneficiaries...');
      const crypto = require('crypto');

      const mockData = [
        {
          uuid: crypto.randomUUID(),
          full_name: 'María Constanza Rodríguez',
          document_type: 'CC',
          document_number: '51874932',
          registered_hemi: 'Sí',
          rivi: 'RIVI-98745',
          status: 'Activo',
          age: 42,
          gender: 'Femenino',
          population_group: 'Madre Cabeza de Familia',
          disability: 'No',
          phone: '3114567890',
          latitude: 4.6097,
          longitude: -74.0817,
          economic_activity: 'Venta de Frutas y Verduras',
          ipes_beneficiary: 'Sí',
          offer_type: 'Puesto en Punto Comercial',
          days_per_week: 5,
          permanence_time: 'Más de 5 años',
          photo_path: ''
        },
        {
          uuid: crypto.randomUUID(),
          full_name: 'José Humberto Beltrán',
          document_type: 'CC',
          document_number: '79483012',
          registered_hemi: 'Sí',
          rivi: 'RIVI-23451',
          status: 'Activo',
          age: 58,
          gender: 'Masculino',
          population_group: 'Adulto Mayor',
          disability: 'No',
          phone: '3159876543',
          latitude: 4.6012,
          longitude: -74.0758,
          economic_activity: 'Venta de Ropa y Calzado',
          ipes_beneficiary: 'No',
          offer_type: '',
          days_per_week: 6,
          permanence_time: '3 a 5 años',
          photo_path: ''
        },
        {
          uuid: crypto.randomUUID(),
          full_name: 'Carlos Mario Yepes',
          document_type: 'CC',
          document_number: '1018374829',
          registered_hemi: 'No',
          rivi: '',
          status: 'Inactivo',
          age: 26,
          gender: 'Masculino',
          population_group: 'Ninguno',
          disability: 'Sí',
          phone: '3201234567',
          latitude: 4.6156,
          longitude: -74.0721,
          economic_activity: 'Artesanías y Bisutería',
          ipes_beneficiary: 'Sí',
          offer_type: 'Capacitación en Emprendimiento',
          days_per_week: 4,
          permanence_time: '1 a 2 años',
          photo_path: ''
        }
      ];

      for (const item of mockData) {
        await dbRun(`
          INSERT INTO beneficiaries (
            uuid, full_name, document_type, document_number, registered_hemi, rivi, status,
            age, gender, population_group, disability, phone, latitude, longitude,
            economic_activity, ipes_beneficiary, offer_type, days_per_week, permanence_time, photo_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          item.uuid, item.full_name, item.document_type, item.document_number, item.registered_hemi, item.rivi, item.status,
          item.age, item.gender, item.population_group, item.disability, item.phone, item.latitude, item.longitude,
          item.economic_activity, item.ipes_beneficiary, item.offer_type, item.days_per_week, item.permanence_time, item.photo_path
        ]);
      }
      console.log('Seeded mock beneficiaries successfully.');
    }
  } catch (error) {
    console.error('Error seeding beneficiaries:', error);
  }
}

module.exports = {
  db,
  dbRun,
  dbAll,
  dbGet,
  dbReady
};
