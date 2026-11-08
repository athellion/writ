// Turning one kind of document into the other. Used only when he asks for it: switching a document to
// Markdown mode ("Save as .md"), switching back, and exporting a Markdown document as a Word file.
// (Opening and saving never convert: a .md file is edited as its own text, a .docx as a document.)
import { marked } from 'marked';

// ---------- a document (the editor's JSON) → Markdown text ----------
// Returns { text, lost }: `lost` names what Markdown can't hold (said before switching).
export function toMarkdown(json) {
  const lost = new Set();
  const escape = (s) => s.replace(/([\\`*_[\]~|])/g, '\\$1');
  const inline = (nodes = []) => {
    let out = '';
    for (const n of nodes) {
      if (n.type === 'hardBreak') {
        out += '  \n';
        continue;
      }
      if (n.type !== 'text') continue;
      let t = escape(n.text);
      const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || true]));
      if (marks.underline) lost.add('underlining');
      // spaces stay outside the marks, or Markdown wouldn't see them as marks
      const lead = /^\s*/.exec(t)[0], trail = /\s*$/.exec(t)[0];
      let core = t.slice(lead.length, t.length - trail.length);
      if (core) {
        if (marks.strike) core = `~~${core}~~`;
        if (marks.italic) core = `*${core}*`;
        if (marks.bold) core = `**${core}**`;
        if (marks.link?.href) core = `[${core}](${marks.link.href})`;
      }
      out += lead + core + trail;
    }
    // join neighbouring runs of the same mark ("**a****b**" → "**ab**")
    return out.replace(/\*\*\*\*/g, '').replace(/~~~~/g, '');
  };
  const startEscape = (s) => s.replace(/^(#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/, '\\$1');
  const blocks = (nodes = [], indent = '') => {
    const out = [];
    for (const n of nodes) {
      switch (n.type) {
        case 'paragraph':
          out.push(indent + startEscape(inline(n.content)).replace(/\n/g, '\n' + indent));
          break;
        case 'heading':
          out.push(indent + '#'.repeat(n.attrs?.level || 1) + ' ' + inline(n.content));
          break;
        case 'blockquote':
          out.push(blocks(n.content).map((b) => b.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')).join('\n>\n'));
          break;
        case 'bulletList':
        case 'orderedList':
        case 'taskList': {
          const lines = [];
          (n.content || []).forEach((item, i) => {
            const mark = n.type === 'orderedList' ? `${i + 1}. ` : n.type === 'taskList' ? `- [${item.attrs?.checked ? 'x' : ' '}] ` : '- ';
            const kids = item.content || [];
            const [first, ...rest] = kids;
            lines.push(indent + mark + (first?.type === 'paragraph' ? inline(first.content) : ''));
            const sub = ' '.repeat(n.type === 'orderedList' ? 3 : 2);
            for (const k of first?.type === 'paragraph' ? rest : kids) lines.push(...blocks([k], indent + sub));
          });
          out.push(lines.join('\n'));
          break;
        }
        case 'table': {
          const rows = (n.content || []).map((r) => (r.content || []).map((c) => (c.content || []).map((p) => inline(p.content)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')));
          if (!rows.length) break;
          const width = Math.max(...rows.map((r) => r.length));
          const row = (r) => `| ${Array.from({ length: width }, (_, i) => r[i] || '').join(' | ')} |`;
          out.push([row(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(row)].join('\n'));
          break;
        }
        default:
          if (n.content) out.push(...blocks(n.content, indent));
      }
    }
    return out;
  };
  // lists sit tight together; other blocks have a blank line between them
  const parts = blocks(json?.content || []);
  let text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  // an empty paragraph at the very end (the editor keeps one) adds nothing
  return { text: text ? text + '\n' : '', lost: [...lost] };
}

// ---------- Markdown text → web markup the document editor reads ----------
export function fromMarkdown(text) {
  const html = marked.parse(text || '', { gfm: true, breaks: false });
  // checklists: marked writes <li><input type="checkbox"> …; the editor knows them as task items
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const box of doc.querySelectorAll('li > input[type=checkbox], li > p > input[type=checkbox]')) {
    const li = box.closest('li');
    li.setAttribute('data-type', 'taskItem');
    li.setAttribute('data-checked', String(box.checked || box.hasAttribute('checked')));
    li.parentElement.setAttribute('data-type', 'taskList');
    const next = box.nextSibling;
    if (next?.nodeType === 3) next.textContent = next.textContent.replace(/^\s/, '');
    box.remove();
  }
  // code is shown as ordinary text in a Word document
  for (const pre of doc.querySelectorAll('pre')) {
    const p = doc.createElement('p');
    p.textContent = pre.textContent.replace(/\n$/, '');
    pre.replaceWith(p);
  }
  return doc.body.innerHTML;
}
