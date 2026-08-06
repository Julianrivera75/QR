// New PostgreSQL/Sequelize implementation
const { Sequelize, QueryTypes } = require('sequelize');
const bcrypt = require('bcryptjs');

// Railway provides DATABASE_URL, otherwise fallback to SQLite file for local dev
const DATABASE_URL = process.env.DATABASE_URL || `sqlite:${require('path').join(__dirname, '..', 'database', 'platform.db')}`;

const sequelize = new Sequelize(DATABASE_URL, {
  logging: false,
  dialectOptions: DATABASE_URL.startsWith('postgres') ? { ssl: { require: true, rejectUnauthorized: false } } : {}
});

// Helper wrappers using Sequelize raw queries
const dbRun = (sql, params = []) => sequelize.query(sql, { replacements: params, type: QueryTypes.RAW });
const dbAll = (sql, params = []) => sequelize.query(sql, { replacements: params, type: QueryTypes.SELECT });
const dbGet = async (sql, params = []) => {
  const rows = await sequelize.query(sql, { replacements: params, type: QueryTypes.SELECT });
  return rows[0] || null;
};

let dbReadyResolve;
const dbReady = new Promise((resolve) => { dbReadyResolve = resolve; });

async function initializeDatabase() {
  try {
    // Users table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Beneficiaries table (adjusted for PostgreSQL syntax)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS beneficiaries (
        id SERIAL PRIMARY KEY,
        uuid UUID UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        document_type VARCHAR(10) CHECK (document_type IN ('CC', 'CE', 'PEP', 'PPT', 'Pasaporte')) NOT NULL,
        document_number VARCHAR(50) UNIQUE NOT NULL,
        registered_hemi VARCHAR(3) CHECK (registered_hemi IN ('Sí', 'No')) NOT NULL,
        rivi VARCHAR(255),
        status VARCHAR(10) CHECK (status IN ('Activo', 'Inactivo', 'Revocado')) DEFAULT 'Activo',
        age INTEGER NOT NULL,
        gender VARCHAR(10) CHECK (gender IN ('Masculino', 'Femenino', 'Otro')) NOT NULL,
        population_group VARCHAR(255) NOT NULL,
        disability VARCHAR(3) CHECK (disability IN ('Sí', 'No')) NOT NULL,
        phone VARCHAR(20),
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        economic_activity VARCHAR(255) NOT NULL,
        ipes_beneficiary VARCHAR(3) CHECK (ipes_beneficiary IN ('Sí', 'No')) NOT NULL,
        offer_type VARCHAR(255),
        days_per_week INTEGER CHECK (days_per_week BETWEEN 1 AND 7) NOT NULL,
        permanence_time VARCHAR(255) NOT NULL,
        photo_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Audit logs table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        beneficiary_id INTEGER,
        action VARCHAR(255) NOT NULL,
        fields_changed TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE SET NULL
      );
    `);

    // Scan logs table
    await dbRun(`
      CREATE TABLE IF NOT EXISTS scan_logs (
        id SERIAL PRIMARY KEY,
        beneficiary_id INTEGER NOT NULL,
        scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(255),
        user_agent TEXT,
        status_at_scan VARCHAR(255) NOT NULL,
        FOREIGN KEY (beneficiary_id) REFERENCES beneficiaries(id) ON DELETE CASCADE
      );
    `);

    console.log('Tables initialized successfully.');

    // Seed data (same as before, using dbRun wrappers)
    await seedUsers();
    await seedBeneficiaries();

    dbReadyResolve();
  } catch (err) {
    console.error('Error initializing DB:', err);
  }
}

async function seedUsers() {
  const row = await dbGet('SELECT COUNT(*) as count FROM users');
  if (row.count === 0) {
    console.log('Seeding default admin user...');
    const hash = await bcrypt.hash('admin123', 10);
    await dbRun('INSERT INTO users (username, password_hash, full_name) VALUES (?, ?, ?)', ['admin', hash, 'Administrador General']);
    console.log('Default admin seeded (admin / admin123)');
  }
}

async function seedBeneficiaries() {
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
}

// Run initialization immediately
initializeDatabase();

module.exports = { db: sequelize, dbRun, dbAll, dbGet, dbReady };
dbGet,
  dbReady
};
