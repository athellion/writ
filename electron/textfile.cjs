// Reading and writing text files exactly as they were.
//
// A Markdown document comes back to disk in the same form it was read: the same character encoding (UTF-8, with or
// without the little marker at the start some programs add, UTF-16, or the old Windows Western
// encoding), and the same line endings (Windows' CR LF, or LF from other systems). Inside Writ the text
// always has plain \n line endings; the file's own are put back on saving.
const iconv = require('iconv-lite');

// What's known about how a file was written. New notes: UTF-8 without a marker, Windows line endings.
const NEW_FORM = { encoding: 'utf8', bom: false, eol: 'crlf' };

const ENCODING_NAMES = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  cp1252: 'Western (Windows 1252)',
};
const EOL_NAMES = { crlf: 'Windows (CRLF)', lf: 'Unix (LF)', cr: 'Old Mac (CR)' };

function isUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

// UTF-16 without its marker: plain Western text has a zero in every other byte.
function looksUtf16(buf) {
  if (buf.length < 4 || buf.length % 2) return null;
  const n = Math.min(buf.length, 4096);
  let evenZero = 0, oddZero = 0;
  for (let i = 0; i < n; i += 2) {
    if (buf[i] === 0) evenZero++;
    if (buf[i + 1] === 0) oddZero++;
  }
  const half = n / 2;
  if (oddZero > half * 0.4 && evenZero < half * 0.05) return 'utf16le';
  if (evenZero > half * 0.4 && oddZero < half * 0.05) return 'utf16be';
  return null;
}

// The line ending used most in the text ("crlf" when there are none: a Windows default).
function detectEol(text) {
  let crlf = 0, lf = 0, cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) { crlf++; i++; } else cr++;
    } else if (c === 10) lf++;
  }
  if (!crlf && !lf && !cr) return 'crlf';
  if (crlf >= lf && crlf >= cr) return 'crlf';
  return lf >= cr ? 'lf' : 'cr';
}

// Bytes → { text (with \n), encoding, bom, eol }
function decode(buf) {
  let encoding, bom = false, body = buf;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    encoding = 'utf8'; bom = true; body = buf.subarray(3);
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = 'utf16le'; bom = true; body = buf.subarray(2);
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    encoding = 'utf16be'; bom = true; body = buf.subarray(2);
  } else {
    encoding = looksUtf16(buf) || (isUtf8(buf) ? 'utf8' : 'cp1252');
  }
  let raw;
  if (encoding === 'utf8') raw = new TextDecoder('utf-8').decode(body);
  else if (encoding === 'utf16le') raw = iconv.decode(body, 'utf16le');
  else if (encoding === 'utf16be') raw = iconv.decode(body, 'utf16be');
  else raw = iconv.decode(body, 'win1252');
  const eol = detectEol(raw);
  const text = raw.replace(/\r\n?/g, '\n');
  return { text, encoding, bom, eol };
}

// { text (with \n), encoding, bom, eol } → bytes. A character the old Western encoding can't hold would
// be lost there, so such a note is saved as UTF-8 instead (the answer says so).
function encode(text, form = NEW_FORM) {
  let { encoding, bom, eol } = { ...NEW_FORM, ...form };
  const sep = eol === 'lf' ? '\n' : eol === 'cr' ? '\r' : '\r\n';
  const raw = text.replace(/\r\n?/g, '\n').replace(/\n/g, sep);
  let changed = null;
  if (encoding === 'cp1252' && iconv.decode(iconv.encode(raw, 'win1252'), 'win1252') !== raw) {
    encoding = 'utf8'; bom = false; changed = 'utf8';
  }
  let body;
  if (encoding === 'utf8') body = Buffer.from(raw, 'utf8');
  else if (encoding === 'utf16le') body = iconv.encode(raw, 'utf16le');
  else if (encoding === 'utf16be') body = iconv.encode(raw, 'utf16be');
  else body = iconv.encode(raw, 'win1252');
  const marks = { utf8: [0xef, 0xbb, 0xbf], utf16le: [0xff, 0xfe], utf16be: [0xfe, 0xff] };
  const head = bom && marks[encoding] ? Buffer.from(marks[encoding]) : Buffer.alloc(0);
  return { bytes: Buffer.concat([head, body]), form: { encoding, bom, eol }, changed };
}

// A short label for the status line: "UTF-8", "UTF-8 with BOM", "UTF-16 LE" …
function encodingLabel(form) {
  const name = ENCODING_NAMES[form.encoding] || form.encoding;
  return form.encoding === 'utf8' && form.bom ? 'UTF-8 with BOM' : name;
}

module.exports = { decode, encode, detectEol, encodingLabel, NEW_FORM, EOL_NAMES };
