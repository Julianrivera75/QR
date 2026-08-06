const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'plataforma-qr-secreto-super-seguro-2026';

const authenticateToken = (req, res, next) => {
  // Read token from cookies (cookies are parsed by cookie-parser middleware)
  const token = req.cookies.admin_session;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Acceso no autorizado. Inicie sesión.' });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET);
    req.user = verified; // Should contain user id, username, and full_name
    next();
  } catch (err) {
    // Clear invalid cookie
    res.clearCookie('admin_session');
    return res.status(403).json({ success: false, message: 'Sesión inválida o expirada. Por favor, vuelva a iniciar sesión.' });
  }
};

module.exports = {
  authenticateToken,
  JWT_SECRET
};
