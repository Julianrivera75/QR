// Resolves the public host used in QR codes, emails and certificates.
// BASE_URL pins it so a forged Host header cannot redirect generated links.
function publicHost(req) {
  const base = process.env.BASE_URL;
  if (base) {
    try {
      return new URL(base).host;
    } catch (err) {
      console.error('BASE_URL inválida, se usa el host de la petición:', base);
    }
  }
  return req.get('host');
}

module.exports = { publicHost };
