// Reading a Word file (.docx) into Writ.
//
// mammoth turns the Word document into plain web page markup (HTML) by meaning, not by looks: Word's
// Heading 1 becomes a heading, a bulleted list becomes a list, bold stays bold. The page then loads
// that into the editor. Fonts, sizes and colours are left behind on purpose: Writ draws every
// document in its own calm type.
//
// Word can hold much that Writ can't (yet): tables, pictures, comments, tracked changes, headers and
// footers… Those are looked for in the file itself, so Writ can say plainly what it couldn't bring in,
// and protect the original from being saved over without the person knowing.
const mammoth = require('mammoth');
const JSZip = require('jszip');

const STYLE_MAP = [
  'u => u',
  "p[style-name='Title'] => h1:fresh",
  "p[style-name='Heading 4'] => h3:fresh",
  "p[style-name='Heading 5'] => h3:fresh",
  "p[style-name='Heading 6'] => h3:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
];

// Checklist items are written as paragraphs starting with ☐ or ☒ (docx-write.cjs); a run of them
// becomes a checklist again. (Boxes typed in Word with ☑ count as done too.)
function checklists(html) {
  return html.replace(/(?:<p>[☐☒☑]\s?[\s\S]*?<\/p>)+/g, (run) => {
    const items = [...run.matchAll(/<p>([☐☒☑])\s?([\s\S]*?)<\/p>/g)].map(
      ([, box, body]) => `<li data-type="taskItem" data-checked="${box !== '☐'}"><p>${body}</p></li>`,
    );
    return `<ul data-type="taskList">${items.join('')}</ul>`;
  });
}

// What's in the file that Writ can't show. Each entry is a short phrase for the notice.
async function lookInside(buffer) {
  const left = [];
  try {
    const zip = await JSZip.loadAsync(buffer);
    const read = async (name) => (zip.file(name) ? zip.file(name).async('string') : '');
    const body = await read('word/document.xml');
    const has = (re) => re.test(body);
    // (tables come in as tables since 0.2.0; a table inside a table is flattened into its cell)
    if (/<w:tbl[\s>][\s\S]*?<w:tc[\s>][\s\S]*?<w:tbl[\s>]/.test(body.replace(/<\/w:tbl>[\s\S]*?(?=<w:tbl[\s>])/g, ''))) left.push('tables inside tables');
    if (has(/<w:drawing[\s>]|<w:pict[\s>]|<v:imagedata/)) left.push('pictures');
    if (has(/<w:ins[\s>]|<w:del[\s>]|<w:moveFrom[\s>]|<w:moveTo[\s>]/)) left.push('tracked changes (shown as if accepted)');
    if (/<w:comment[\s>]/.test(await read('word/comments.xml'))) left.push('comments');
    // a real footnote (Word keeps two invisible separators in every file)
    const notes = (await read('word/footnotes.xml')).match(/<w:footnote\b(?![^>]*w:type=)/g) || [];
    const ends = (await read('word/endnotes.xml')).match(/<w:endnote\b(?![^>]*w:type=)/g) || [];
    if (notes.length || ends.length) left.push('footnotes');
    const headerFooter = Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f));
    for (const f of headerFooter) {
      if (/<w:t[\s>][^<]*\S/.test(await read(f))) {
        left.push('headers and footers');
        break;
      }
    }
    if (has(/<w:txbxContent[\s>]/)) left.push('text boxes');
    if (has(/<m:oMath[\s>]/)) left.push('equations');
    if (has(/<w:highlight\b|<w:color w:val="(?!auto|000000)[0-9A-Fa-f]{6}"/)) left.push('text colours and highlighting');
    if (has(/<w:cols\b[^>]*w:num="[2-9]"/)) left.push('columns');
  } catch {
    // (not a zip we can look into; mammoth will say if it can't read it at all)
  }
  return left;
}

async function readDocx(buffer) {
  const left = await lookInside(buffer);
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: STYLE_MAP,
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: false, // blank lines are part of how a document is laid out

      // pictures are left out for now (see `left`); an empty image is dropped by the editor
      convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    },
  );
  let html = checklists(result.value);
  html = html.replace(/<img[^>]*>/g, '');
  return { html, left };
}

module.exports = { readDocx, lookInside };
