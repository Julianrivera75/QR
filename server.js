const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Behind Railway's proxy: trust the first hop so req.ip and secure cookies work
app.set('trust proxy', 1);

// Domain migration: when REDIRECT_TO is set (only on the old deployment), every
// request is forwarded to the new domain keeping path and query, so QR codes and
// e-mail links that were already handed out keep working. 308 preserves the method.
if (process.env.REDIRECT_TO) {
  const target = process.env.REDIRECT_TO.replace(/\/+$/, '');
  app.use((req, res) => res.redirect(308, target + req.originalUrl));
}

// Security headers (CSP, HSTS, X-Frame-Options, nosniff, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null
    }
  }
}));

// Rate limiters
const limitMessage = (message) => ({ success: false, message });
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Demasiados intentos de inicio de sesión. Intente de nuevo en 15 minutos.')
});
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: limitMessage('Demasiadas consultas. Espere un momento e intente de nuevo.')
});

// Global Middlewares
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// Static Files serving (photos are only served through /api/public/photo/:uuid)
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth/login', loginLimiter);
app.use('/api/public', publicLimiter);
app.use('/api/emails/confirm', publicLimiter);
app.use('/api/emails/track', publicLimiter);

// Mount API routes
app.use('/api/auth', require('./server/routes/auth'));
app.use('/api/beneficiaries', require('./server/routes/beneficiaries'));
app.use('/api/pdf', require('./server/routes/pdf'));
app.use('/api/audit', require('./server/routes/audit'));
app.use('/api/public', require('./server/routes/public'));
app.use('/api/emails', require('./server/routes/emails'));

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
    message: (!isProduction && err.message) || 'Ocurrió un error inesperado en el servidor.'
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
