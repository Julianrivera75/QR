const jwt = require('jsonwebtoken');

const crypto = require('crypto');

// Without JWT_SECRET a random per-process secret is used: sessions end on restart
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.warn('JWT_SECRET no definido o menor a 32 caracteres. Se usa un secreto temporal; las sesiones se cerrarán al reiniciar.');
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
}

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
