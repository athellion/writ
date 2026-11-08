// Writing a Writ document as a Word file (.docx).
//
// The page sends its document as the editor's own description of it (TipTap's JSON: "this is a
// heading", "these words are bold"), and this file turns that into a real Word document with Word's
// own building blocks: the built-in Heading 1–3 styles, a Quote style, Word's numbered and bulleted
// lists, hyperlinks. So a document from Writ opens in Word looking as it does in Writ, and Word's own
// navigation pane shows its headings.
//
// What Writ has that Word has no direct counterpart for:
//   - checklists: written as paragraphs starting with ☐ (open) or ☒ (done), which Writ reads back as
//     a checklist (docx-read.cjs) and Word simply shows as the boxes.
const D = require('docx');

// The document's typeface. Georgia is on every Windows PC and every Mac, so the people the document is
// sent to see it as it was meant; it's a calm serif close to Writ's own Literata on the screen.
const FONT = 'Georgia';
const INK = '2B2522';

// A4, with 2.5 cm margins all round (Norwegian paper).
const PAGE = {
  size: { width: 11906, height: 16838 },
  margin: { top: 1418, right: 1418, bottom: 1418, left: 1418 },
};

const styles = {
  default: {
    document: { run: { font: FONT, size: 22, color: INK }, paragraph: { spacing: { after: 140, line: 300 } } },
    heading1: { run: { font: FONT, size: 36, bold: true, color: INK }, paragraph: { spacing: { before: 360, after: 120 }, keepNext: true } },
    heading2: { run: { font: FONT, size: 29, bold: true, color: INK }, paragraph: { spacing: { before: 300, after: 100 }, keepNext: true } },
    heading3: { run: { font: FONT, size: 24, bold: true, color: INK }, paragraph: { spacing: { before: 240, after: 80 }, keepNext: true } },
  },
  paragraphStyles: [
    {
      id: 'Quote',
      name: 'Quote',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: { italics: true, color: '5A504A' },
      paragraph: { indent: { left: 567 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: 'B9ACA4', space: 10 } } },
    },
  ],
};

// Bullets and numbers for nine levels of nesting, as Word does it.
const BULLETS = ['•', '◦', '▪'];
const NUMBERS = [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN];
const indent = (level) => ({ left: 720 + level * 360, hanging: 360 });
const numbering = {
  config: [
    {
      reference: 'writ-bullets',
      levels: Array.from({ length: 9 }, (_, l) => ({
        level: l,
        format: D.LevelFormat.BULLET,
        text: BULLETS[l % 3],
        alignment: D.AlignmentType.LEFT,
        style: { paragraph: { indent: indent(l) } },
      })),
    },
    {
      reference: 'writ-numbers',
      levels: Array.from({ length: 9 }, (_, l) => ({
        level: l,
        format: NUMBERS[l % 3],
        text: `%${l + 1}.`,
        alignment: D.AlignmentType.LEFT,
        style: { paragraph: { indent: indent(l) } },
      })),
    },
  ],
};

// ---------- the words ----------
// A run of text with its formatting; links become Word hyperlinks.
function runs(nodes = []) {
  const out = [];
  for (const n of nodes) {
    if (n.type === 'hardBreak') {
      out.push(new D.TextRun({ break: 1 }));
      continue;
    }
    if (n.type !== 'text') continue;
    const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]));
    const opts = {
      text: n.text,
      bold: !!marks.bold || undefined,
      italics: !!marks.italic || undefined,
      underline: marks.underline ? {} : undefined,
      strike: !!marks.strike || undefined,
    };
    if (marks.link?.href) {
      out.push(new D.ExternalHyperlink({ link: marks.link.href, children: [new D.TextRun({ ...opts, style: 'Hyperlink' })] }));
    } else out.push(new D.TextRun(opts));
  }
  return out;
}

// ---------- the blocks ----------
// Walks the document and gives Word's paragraphs, in order. `ctx` carries where we are: inside a quote,
// how deep in a list.
function blocks(nodes = [], ctx = {}, out = [], state = { lists: 0 }) {
  for (const [i, n] of nodes.entries()) {
    switch (n.type) {
      case 'paragraph':
        out.push(
          new D.Paragraph({
            children: runs(n.content),
            style: ctx.quote ? 'Quote' : undefined,
            numbering: ctx.list ? { reference: ctx.list.ref, level: ctx.list.level, instance: ctx.list.instance } : undefined,
            indent: !ctx.list && ctx.under != null ? { left: 720 + ctx.under * 360 } : undefined,
          }),
        );
        // only the first paragraph of a list item carries the bullet; any after it are indented under it
        if (ctx.list) ctx = { ...ctx, list: null, under: ctx.list.level };
        break;
      case 'heading':
        out.push(new D.Paragraph({ children: runs(n.content), heading: [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3][(n.attrs?.level || 1) - 1] }));
        break;
      case 'blockquote':
        blocks(n.content, { ...ctx, quote: true }, out, state);
        break;
      case 'bulletList':
      case 'orderedList': {
        const level = ctx.level ?? 0;
        const ref = n.type === 'bulletList' ? 'writ-bullets' : 'writ-numbers';
        // each numbered list counts from 1 (Word: its own "instance" of the numbering)
        const instance = n.type === 'orderedList' && level === 0 ? ++state.lists : ctx.instance ?? 0;
        for (const item of n.content || []) {
          const kids = item.content || [];
          blocks(kids.filter((k) => !/List$/.test(k.type)), { ...ctx, list: { ref, level, instance } }, out, state);
          for (const sub of kids.filter((k) => /List$/.test(k.type))) blocks([sub], { ...ctx, level: level + 1, instance }, out, state);
        }
        break;
      }
      case 'taskList': {
        const level = ctx.level ?? 0;
        for (const item of n.content || []) {
          const kids = item.content || [];
          const [first, ...rest] = kids.filter((k) => k.type === 'paragraph');
          const box = item.attrs?.checked ? '☒' : '☐';
          out.push(
            new D.Paragraph({
              children: [new D.TextRun({ text: `${box} ` }), ...runs(first?.content)],
              indent: { left: 360 * level },
              style: ctx.quote ? 'Quote' : undefined,
            }),
          );
          for (const p of rest) out.push(new D.Paragraph({ children: runs(p.content), indent: { left: 360 * level + 360 } }));
          for (const sub of kids.filter((k) => /List$/.test(k.type))) blocks([sub], { ...ctx, level: level + 1 }, out, state);
        }
        break;
      }
      case 'table':
        out.push(table(n));
        // (Word needs a paragraph between two tables, or they become one)
        if (nodes[i + 1]?.type === 'table') out.push(new D.Paragraph({}));
        break;
      default:
        // (anything else carries on with whatever it contains, so no words are ever dropped)
        if (n.content) blocks(n.content, ctx, out, state);
    }
  }
  return out;
}

// A table: Word's own, the full width of the page, thin lines in the paper's colour. Header cells (the
// editor's) are on a light shade, and their row repeats at the top of each printed page.
const LINE = { style: D.BorderStyle.SINGLE, size: 4, color: 'C9BDB5' };
function table(n) {
  const rows = (n.content || []).map((r) => {
    const cells = r.content || [];
    const header = cells.length > 0 && cells.every((c) => c.type === 'tableHeader');
    return new D.TableRow({
      tableHeader: header || undefined, // (written as "off" otherwise, which some readers take for a header)
      children: cells.map((c) => {
        const paras = (c.content || []).map((p) =>
          new D.Paragraph({ children: runs(p.content), spacing: { after: 0 } }),
        );
        return new D.TableCell({
          children: paras.length ? paras : [new D.Paragraph({})],
          columnSpan: c.attrs?.colspan > 1 ? c.attrs.colspan : undefined,
          rowSpan: c.attrs?.rowspan > 1 ? c.attrs.rowspan : undefined,
          shading: c.type === 'tableHeader' ? { type: D.ShadingType.CLEAR, fill: 'EFE9E4', color: 'auto' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        });
      }),
    });
  });
  return new D.Table({
    rows,
    width: { size: 100, type: D.WidthType.PERCENTAGE },
    borders: { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE },
  });
}

// Turns the page's document into the bytes of a .docx file.
async function writeDocx(json, { title } = {}) {
  const children = blocks(json?.content || []);
  if (!children.length) children.push(new D.Paragraph({}));
  const doc = new D.Document({
    creator: 'Writ',
    lastModifiedBy: 'Writ',
    title: title || undefined,
    styles,
    numbering,
    sections: [{ properties: { page: PAGE }, children }],
  });
  return D.Packer.toBuffer(doc);
}

module.exports = { writeDocx, FONT };
