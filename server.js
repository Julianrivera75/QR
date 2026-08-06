const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Global Middlewares
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());


// Static Files serving
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Mount API routes
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api/beneficiaries', require('./server/routes/beneficiaries'));
app.use('/api/pdf', require('./server/routes/pdf'));
app.use('/api/audit', require('./server/routes/audit'));
app.use('/api/public', require('./server/routes/public'));

// Fallback to index.html for undefined frontend routes (SPA client-side routing fallback)
app.get('*', (req, res, next) => {
  // If requesting api routes, don't serve HTML
  if (req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled server error:', err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Ocurrió un error inesperado en el servidor.'
  });
});

const { dbReady } = require('./server/db');

// Start Server after DB is ready
dbReady.then(() => {
  app.listen(PORT, () => {
    console.log(`========================================================`);
    console.log(` Server running at: http://localhost:${PORT}`);
    console.log(` Mode: ${process.env.NODE_ENV || 'development'}`);
    console.log(`========================================================`);
  });
}).catch(err => {
  console.error('Failed to initialize database. Server cannot start:', err);
});

module.exports = app;
