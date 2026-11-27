// Las fuentes estándar de pdf-lib (Helvetica) solo codifican WinAnsi. Un carácter
// fuera de ese juego (p. ej. "Ń" en un nombre mal digitado) hace fallar todo el PDF.
// toWinAnsi() lo reemplaza por el equivalente más cercano y safeFont() lo aplica a
// todo texto que se dibuje o mida con la fuente.

const EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const MAP = { 'Ń': 'Ñ', 'ń': 'ñ', 'Ǹ': 'Ñ', 'ǹ': 'ñ' };

function encodable(c) {
  const code = c.charCodeAt(0);
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || c === '\n' || EXTRA.includes(c);
}

function toWinAnsi(text) {
  return Array.from(String(text ?? ''))
    .map((c) => {
      if (encodable(c)) return c;
      if (MAP[c]) return MAP[c];
      const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (base && Array.from(base).every(encodable)) return base;
      return '?';
    })
    .join('');
}

function safeFont(font) {
  const encode = font.encodeText.bind(font);
  const width = font.widthOfTextAtSize.bind(font);
  font.encodeText = (text) => encode(toWinAnsi(text));
  font.widthOfTextAtSize = (text, size) => width(toWinAnsi(text), size);
  return font;
}

module.exports = { toWinAnsi, safeFont };
