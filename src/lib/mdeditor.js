// Markdown mode: a different kind of editor from the document editor (his decision, 8 November 2026).
//
// Here the text in the editor IS the file, character for character, as in Jot. The formatting is drawn
// on top of it: headings large, **bold** bold, lists with bullets, checklists with boxes, links as
// links, tables as tables. Unlike Jot, the marks themselves (#, **, -, [ ], the link's address) are
// never shown in the default view, and the cursor steps over them as if they weren't there. Formatting
// is added with the same buttons and keys as in the document editor, which write the marks for him.
// Nothing is ever converted or rebuilt: what isn't touched stays exactly as it was in the file.
//
// One exception to "never shown": a table shows its raw lines (with the | between cells) while the
// cursor is inside it, since a table's text can't be edited any other way; elsewhere it's drawn as a
// table. "Show plain text" shows the whole file as it is.
import { EditorState, StateField, StateEffect, Compartment, EditorSelection, RangeSet } from '@codemirror/state';
import { EditorView, Decoration, WidgetType, keymap, placeholder, drawSelection } from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { Language, defineLanguageFacet, syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { parser as baseParser, GFM } from '@lezer/markdown';
import { countWords } from './words.js';

const mdLanguage = new Language(defineLanguageFacet({}), baseParser.configure([GFM]), [], 'writ-markdown');
const tree = (state) => ensureSyntaxTree(state, state.doc.length, 400) || syntaxTree(state);

// The look: the same page as the document editor (the sheet around it is App.svelte's).
const look = EditorView.theme({
  '&': { color: 'var(--paper-ink)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', fontSize: '15px', lineHeight: '1.62', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)', minHeight: '900px' },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '1.5px solid var(--accent)' },
  '.cm-selectionLayer': { display: 'none !important' },
  '.cm-content .cm-line ::selection, .cm-content .cm-line::selection': { backgroundColor: 'var(--select) !important' },
  '.cm-placeholder': { color: 'var(--paper-muted)', opacity: '0.6', fontStyle: 'italic' },
});
const plainLook = EditorView.theme({
  '.cm-scroller': { fontFamily: "'Cascadia Mono', Consolas, ui-monospace, monospace", fontSize: '13.5px', lineHeight: '1.6' },
});

// ---------- little drawings ----------
class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'md-bullet'; s.textContent = '•'; return s; }
}
class Check extends WidgetType {
  constructor(on, at) { super(); this.on = on; this.at = at; }
  eq(o) { return o.on === this.on && o.at === this.at; }
  toDOM(view) {
    const b = document.createElement('span');
    b.className = 'md-check' + (this.on ? ' on' : '');
    b.setAttribute('role', 'checkbox');
    b.setAttribute('aria-checked', String(this.on));
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // the box is "[ ]" or "[x]": only the middle character changes
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.on ? ' ' : 'x' }, userEvent: 'input' });
    });
    return b;
  }
  ignoreEvent() { return true; }
}
class FoldMark extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'md-folded'; s.textContent = ' …'; return s; }
}
class Rule extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'md-rule'; return s; }
}

// A table, drawn: its cells from the raw lines (a click puts the cursor in it, showing its lines).
const cellsOf = (line) => {
  let t = line.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
};
const inline = (s) => {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '<a>$1</a>');
};
class TableWidget extends WidgetType {
  constructor(text, at) { super(); this.text = text; this.at = at; }
  eq(o) { return o.text === this.text && o.at === this.at; }
  toDOM(view) {
    const lines = this.text.split('\n').filter((l) => l.trim());
    // (the space around it is padding on a wrapper: CodeMirror can't measure margins on drawn blocks,
    // and clicks below the table would land on the wrong line)
    const wrap = document.createElement('div');
    wrap.className = 'md-tablewrap';
    const t = wrap.appendChild(document.createElement('table'));
    t.className = 'md-table';
    lines.forEach((l, i) => {
      if (i === 1) return; // (the line of dashes under the header)
      const tr = t.insertRow();
      for (const c of cellsOf(l)) {
        const cell = document.createElement(i === 0 ? 'th' : 'td');
        cell.innerHTML = inline(c);
        tr.appendChild(cell);
      }
    });
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.at + 2 } });
      view.focus();
    });
    return wrap;
  }
  ignoreEvent() { return true; }
}

const hide = Decoration.replace({});
const mk = (cls) => Decoration.mark({ class: cls });
const ln = (cls) => Decoration.line({ class: cls });
const M = { em: mk('md-em'), strong: mk('md-strong'), strike: mk('md-strike'), code: mk('md-code'), link: mk('md-link'), num: mk('md-num'), done: mk('md-done') };
const L = { gap: ln('md-gap'), h1: ln('md-h md-h1'), h2: ln('md-h md-h2'), h3: ln('md-h md-h3'), quote: ln('md-quote'), li: ln('md-li'), fence: ln('md-fence'), raw: ln('md-rawtable') };

// ---------- folding and finding: state kept beside the text ----------
const toggleFoldFx = StateEffect.define();
const foldField = StateField.define({
  create: () => [],
  update(folded, tr) {
    let next = tr.docChanged ? folded.map((p) => tr.changes.mapPos(p, 1)) : folded;
    for (const e of tr.effects) if (e.is(toggleFoldFx)) next = next.includes(e.value) ? next.filter((p) => p !== e.value) : [...next, e.value];
    return [...new Set(next)].filter((p) => headingAt(tr.state, p));
  },
});
const findFx = StateEffect.define();
const findField = StateField.define({
  create: () => ({ query: '', options: {}, matches: [], current: -1 }),
  update(s, tr) {
    let meta = null;
    for (const e of tr.effects) if (e.is(findFx)) meta = e.value;
    if (!meta && !tr.docChanged) return s;
    s = meta ? { ...s, ...meta } : s;
    const matches = findAll(tr.state.doc.toString(), s.query, s.options);
    let current = s.current;
    if (meta && (meta.query !== undefined || meta.options)) {
      const from = tr.state.selection.main.from;
      current = matches.findIndex((m) => m.from >= from);
      if (current < 0) current = matches.length ? 0 : -1;
    }
    if (current >= matches.length) current = matches.length - 1;
    return { ...s, matches, current };
  },
});
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function findAll(text, query, { caseSensitive = false, wholeWords = false } = {}) {
  if (!query) return [];
  const re = new RegExp(wholeWords ? `(?<![\\p{L}\\p{N}_])${escapeRe(query)}(?![\\p{L}\\p{N}_])` : escapeRe(query), `gu${caseSensitive ? '' : 'i'}`);
  return [...text.matchAll(re)].filter((m) => m[0].length).map((m) => ({ from: m.index, to: m.index + m[0].length }));
}

// ---------- the headings ----------
// A heading's level at a line start, or 0: "# …" lines (and the older underlined kind).
function headingAt(state, pos) {
  if (pos > state.doc.length) return 0;
  const line = state.doc.lineAt(pos);
  if (line.from !== pos) return 0;
  const node = tree(state).resolveInner(pos + Math.min(1, line.length), 1);
  for (let n = node; n; n = n.parent) {
    const m = /^(ATX|Setext)Heading(\d)$/.exec(n.name);
    if (m) return n.from === pos ? +m[2] : 0;
  }
  return 0;
}
export function headings(state) {
  const out = [];
  tree(state).iterate({
    enter(n) {
      const m = /^(ATX|Setext)Heading(\d)$/.exec(n.name);
      if (m) {
        let text = state.doc.sliceString(n.from, n.to);
        text = m[1] === 'ATX' ? text.replace(/^#+\s*/, '').replace(/\s+#+\s*$/, '') : text.split('\n')[0];
        out.push({ pos: n.from, level: +m[2], text: text.replace(/\*\*|__|~~|[*_`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim() });
        return false;
      }
      if (n.name === 'Blockquote' || n.name === 'ListItem' || n.name === 'FencedCode') return false;
    },
  });
  return out;
}
// Where a heading's section ends: the start of the next heading of the same or a higher level.
function sectionEnd(state, pos, list = headings(state)) {
  const i = list.findIndex((h) => h.pos === pos);
  if (i < 0) return state.doc.lineAt(pos).to;
  const next = list.slice(i + 1).find((h) => h.level <= list[i].level);
  return next ? next.pos : state.doc.length;
}

// ---------- drawing ----------
// Everything drawn over the text is worked out here, from the parsed Markdown: the hidden marks (which
// the cursor steps over), the styling, the bullets and boxes, the tables, and the folded sections.
function draw(state, plain) {
  const deco = [], hidden = [];
  const add = (from, to, d) => deco.push(d.range(from, to));
  const conceal = (from, to, d = hide) => {
    if (to <= from) return;
    deco.push(d.range(from, to));
    hidden.push(d.range(from, to));
  };
  const heads = headings(state);
  // folded sections: from the end of the heading's line to the end of its section
  const away = [];
  for (const pos of state.field(foldField)) {
    const line = state.doc.lineAt(pos);
    let end = sectionEnd(state, pos, heads);
    if (end > line.to && end < state.doc.length) end -= 1; // (keep the line break before the next heading)
    if (end > line.to) away.push([line.to, end]);
  }
  for (const [a, b] of away) conceal(a, b, Decoration.replace({ widget: new FoldMark() }));
  const isAway = (pos) => away.some(([a, b]) => pos > a && pos <= b);
  if (plain) return { deco: Decoration.set(deco, true), hidden: Decoration.set(hidden, true) };

  const sel = state.selection;
  const touches = (from, to) => sel.ranges.some((r) => r.from <= to && r.to >= from);
  const space = (at) => (state.doc.sliceString(at, at + 1) === ' ' ? at + 1 : at);

  // the blank lines between blocks are shorter than a line of text (as the space between paragraphs is
  // in the document editor), except the one the cursor is on
  const cursorLine = state.doc.lineAt(sel.main.head).number;
  for (let i = 1; i <= state.doc.lines; i++) {
    const l = state.doc.line(i);
    if (!l.length && i !== cursorLine && i > 1 && !isAway(l.from)) add(l.from, l.from, L.gap);
  }

  tree(state).iterate({
    enter(node) {
      const n = node.name;
      if (isAway(node.from)) return false;
      if (n === 'Table') {
        // drawn as a table, unless the cursor is in it (then its lines, to edit)
        const from = state.doc.lineAt(node.from).from, to = state.doc.lineAt(node.to).to;
        if (!touches(from, to)) {
          conceal(from, to, Decoration.replace({ widget: new TableWidget(state.doc.sliceString(from, to), from), block: true }));
        } else {
          for (let p = from; p <= to; ) {
            const l = state.doc.lineAt(p);
            add(l.from, l.from, L.raw);
            p = l.to + 1;
          }
        }
        return false;
      }
      if (n === 'Emphasis' || n === 'StrongEmphasis' || n === 'Strikethrough') {
        add(node.from, node.to, n === 'Emphasis' ? M.em : n === 'StrongEmphasis' ? M.strong : M.strike);
        for (let c = node.node.firstChild; c; c = c.nextSibling) if (c.name === 'EmphasisMark' || c.name === 'StrikethroughMark') conceal(c.from, c.to);
      } else if (/^ATXHeading[1-6]$/.test(n)) {
        add(node.from, node.from, L['h' + Math.min(+n.slice(-1), 3)]);
        for (let c = node.node.firstChild; c; c = c.nextSibling) {
          if (c.name !== 'HeaderMark') continue;
          if (c.from === node.from) conceal(c.from, space(c.to));
          else conceal(c.from - (state.doc.sliceString(c.from - 1, c.from) === ' ' ? 1 : 0), c.to); // closing #s
        }
      } else if (/^SetextHeading[12]$/.test(n)) {
        add(node.from, node.from, L['h' + n.slice(-1)]);
        const mark = node.node.getChild('HeaderMark');
        if (mark) conceal(state.doc.lineAt(mark.from).from - 1, mark.to);
      } else if (n === 'ListItem') {
        // each item steps in by its depth, wrapped lines hanging under its words; the spaces that nest it
        // in the file are hidden (the step does their work)
        let depth = 0;
        for (let p = node.node.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') depth++;
        const line = state.doc.lineAt(node.from);
        add(line.from, line.from, Decoration.line({ class: 'md-li', attributes: { style: `padding-left: ${(1.3 + (depth - 1) * 1.5).toFixed(2)}em` } }));
        if (depth > 1 && node.from > line.from) conceal(line.from, node.from);
      } else if (n === 'ListMark') {
        const item = node.node.parent;
        const task = item?.getChild('Task');
        const marker = task?.getChild('TaskMarker');
        if (task && marker) {
          // "- [ ] " becomes a box you can click
          conceal(node.from, space(marker.to), Decoration.replace({ widget: new Check(/x/i.test(state.doc.sliceString(marker.from, marker.to)), marker.from) }));
          if (/x/i.test(state.doc.sliceString(marker.from, marker.to))) add(space(marker.to), task.to, M.done);
        } else if (item?.parent?.name === 'BulletList') conceal(node.from, space(node.to), Decoration.replace({ widget: new Bullet() }));
        else add(node.from, node.to, M.num);
      } else if (n === 'Blockquote') {
        for (let p = node.from; p <= node.to; ) {
          const l = state.doc.lineAt(p);
          add(l.from, l.from, L.quote);
          p = l.to + 1;
        }
      } else if (n === 'QuoteMark') {
        conceal(node.from, space(node.to));
      } else if (n === 'InlineCode') {
        add(node.from, node.to, M.code);
        for (let c = node.node.firstChild; c; c = c.nextSibling) if (c.name === 'CodeMark') conceal(c.from, c.to);
      } else if (n === 'FencedCode') {
        for (let p = node.from; p <= node.to; ) {
          const l = state.doc.lineAt(p);
          add(l.from, l.from, L.fence);
          p = l.to + 1;
        }
        return false;
      } else if (n === 'Link') {
        const marks = [];
        for (let c = node.node.firstChild; c; c = c.nextSibling) if (c.name === 'LinkMark') marks.push(c);
        if (marks.length >= 2) {
          conceal(marks[0].from, marks[0].to);
          add(marks[0].to, marks[1].from, M.link);
          conceal(marks[1].from, node.to);
        }
        return false;
      } else if (n === 'Autolink' || (n === 'URL' && node.node.parent?.name !== 'Link')) {
        add(node.from, node.to, M.link);
      } else if (n === 'HorizontalRule') {
        conceal(node.from, node.to, Decoration.replace({ widget: new Rule() }));
      } else if (n === 'Escape') {
        conceal(node.from, node.from + 1);
      }
    },
  });
  return { deco: Decoration.set(deco, true), hidden: Decoration.set(hidden, true) };
}

const plainFx = StateEffect.define();
const plainField = StateField.define({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(plainFx) ? e.value : acc), v),
});
const drawField = StateField.define({
  create: (state) => draw(state, state.field(plainField)),
  update(v, tr) {
    const changed = tr.docChanged || tr.selection || tr.effects.some((e) => e.is(toggleFoldFx) || e.is(plainFx)) || syntaxTree(tr.startState) !== syntaxTree(tr.state);
    return changed ? draw(tr.state, tr.state.field(plainField)) : v;
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).hidden)],
});
// The cursor never rests in front of a hidden mark at the start of a line (the "# " of a heading, a
// list's "- ", a quote's "> "): typing there would land outside the heading or list. It's moved just
// past the mark, where the writing starts, as in the document editor. Moving left from there goes on to
// the end of the line above, as you'd expect.
const pastLineMarks = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection && !tr.docChanged) return tr;
  const st = tr.state;
  const sel = st.selection;
  if (sel.ranges.length > 1 || !sel.main.empty) return tr;
  const head = sel.main.head;
  const line = st.doc.lineAt(head);
  if (head !== line.from) return tr;
  let past = null;
  st.field(drawField).hidden.between(head, head, (from, to) => {
    if (from === head && to > past) past = to;
  });
  if (past == null || past > line.to) return tr;
  const before = tr.startState.selection.main.head;
  const target = !tr.docChanged && before === past && line.from > 0 ? line.from - 1 : past;
  return [tr, { selection: { anchor: target }, sequential: true }];
});

const findDeco = EditorView.decorations.compute([findField], (state) => {
  const s = state.field(findField);
  if (!s.matches.length) return Decoration.none;
  return Decoration.set(s.matches.map((m, i) => Decoration.mark({ class: i === s.current ? 'writ-match current' : 'writ-match' }).range(m.from, m.to)), true);
});

// ---------- formatting, by writing the marks ----------
// The node of one of these kinds around the cursor (the innermost), or null.
function around(state, names, pos = state.selection.main.head) {
  for (let n = tree(state).resolveInner(pos, -1); n; n = n.parent) if (names.includes(n.name)) return n;
  for (let n = tree(state).resolveInner(pos, 1); n; n = n.parent) if (names.includes(n.name)) return n;
  return null;
}
const MARK_NODE = { '**': 'StrongEmphasis', '*': 'Emphasis', '~~': 'Strikethrough' };
// Bold, italic, strikethrough: the marks round the chosen words (or the word at the cursor), or taken
// away again when it already has them.
function toggleInline(view, mark) {
  const { state } = view;
  const r = state.selection.main;
  const node = around(state, [MARK_NODE[mark]], r.from);
  if (node && (r.empty || (node.from <= r.from && node.to >= r.to))) {
    const kids = [];
    for (let c = node.firstChild; c; c = c.nextSibling) if (/Mark$/.test(c.name)) kids.push(c);
    const open = kids[0], close = kids[kids.length - 1];
    if (open && close && open !== close) {
      view.dispatch({ changes: [{ from: open.from, to: open.to }, { from: close.from, to: close.to }], userEvent: 'input' });
      return true;
    }
  }
  let { from, to } = r;
  if (r.empty) {
    const w = state.wordAt(r.head);
    if (w) ({ from, to } = w);
  }
  // keep spaces outside the marks ("**word** " not "**word **")
  const text = state.sliceDoc(from, to);
  from += text.length - text.trimStart().length;
  to -= text.length - text.trimEnd().length;
  if (from >= to) {
    view.dispatch({ changes: { from: r.head, insert: mark + mark }, selection: { anchor: r.head + mark.length }, userEvent: 'input' });
    return true;
  }
  view.dispatch({ changes: [{ from, insert: mark }, { from: to, insert: mark }], selection: EditorSelection.range(from + mark.length, to + mark.length), userEvent: 'input' });
  return true;
}

const PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;
const lineKind = (text) => {
  const m = PREFIX.exec(text);
  const p = m[2] || '';
  if (/^#/.test(p)) return 'h' + Math.min(p.trim().length, 3);
  if (/^>/.test(p)) return 'quote';
  if (/\[[ xX]\]/.test(p)) return 'task';
  if (/^[-*+]/.test(p)) return 'bullet';
  if (/^\d/.test(p)) return 'ordered';
  return 'p';
};
// Heading, list, checklist, quote: the mark at the start of each chosen line (or taken away).
function setLines(view, kind) {
  const { state } = view;
  const r = state.selection.main;
  const first = state.doc.lineAt(r.from).number, last = state.doc.lineAt(r.to).number;
  const lines = [];
  for (let i = first; i <= last; i++) lines.push(state.doc.line(i));
  const all = lines.every((l) => lineKind(l.text) === kind);
  const turnOff = all && kind !== 'p';
  let n = 0;
  const changes = lines.map((l) => {
    const m = PREFIX.exec(l.text);
    const indent = /^(bullet|ordered|task)$/.test(kind) && !turnOff ? m[1] : '';
    let mark = '';
    if (!turnOff) {
      if (kind === 'h1' || kind === 'h2' || kind === 'h3') mark = '#'.repeat(+kind[1]) + ' ';
      else if (kind === 'quote') mark = '> ';
      else if (kind === 'bullet') mark = '- ';
      else if (kind === 'task') mark = '- [ ] ';
      else if (kind === 'ordered') mark = `${++n}. `;
    }
    return { from: l.from, to: l.from + m[0].length, insert: (turnOff ? m[1] : indent) + mark };
  });
  view.dispatch({ changes, userEvent: 'input' });
  return true;
}

// Enter inside a list carries it on ("- ", "2. ", "- [ ] "); Enter on an empty item ends the list.
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/;
function continueList(view) {
  const st = view.state, r = st.selection.main;
  if (!r.empty) return false;
  const line = st.doc.lineAt(r.head);
  const m = LIST_RE.exec(line.text) || /^(\s*)(>)\s?()/.exec(line.text);
  if (!m || r.head < line.from + m[0].length) return false;
  if (!line.text.slice(m[0].length).trim()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' }, userEvent: 'delete' });
    return true;
  }
  let marker = m[2];
  const num = /^(\d+)([.)])$/.exec(marker);
  if (num) marker = +num[1] + 1 + num[2];
  const ins = '\n' + m[1] + marker + (m[3] ? ' [ ]' : '') + ' ';
  view.dispatch({ changes: { from: r.head, insert: ins }, selection: { anchor: r.head + ins.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}
// Tab and Shift+Tab in a list: in and out a level (two spaces)
function indentList(view, out) {
  const st = view.state, r = st.selection.main;
  const line = st.doc.lineAt(r.head);
  if (!LIST_RE.test(line.text)) return false;
  if (out) {
    const sp = /^ {1,2}|^\t/.exec(line.text);
    if (sp) view.dispatch({ changes: { from: line.from, to: line.from + sp[0].length }, userEvent: 'input' });
  } else view.dispatch({ changes: { from: line.from, insert: '  ' }, userEvent: 'input' });
  return true;
}

// ---------- the editor ----------
export function createMdEditor(parent, { text = '', onChange, onSelection, onLinkKey, onFindKey }) {
  const plainLookC = new Compartment();
  const state = EditorState.create({
    doc: text,
    extensions: [
      look,
      plainLookC.of([]),
      mdLanguage.extension,
      history(),
      drawSelection(),
      plainField,
      foldField,
      drawField,
      pastLineMarks,
      findField,
      findDeco,
      placeholder('Start writing…'),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      keymap.of([
        { key: 'Enter', run: continueList },
        { key: 'Tab', run: (v) => indentList(v, false) },
        { key: 'Shift-Tab', run: (v) => indentList(v, true) },
        { key: 'Mod-b', run: (v) => toggleInline(v, '**') },
        { key: 'Mod-i', run: (v) => toggleInline(v, '*') },
        { key: 'Mod-u', run: () => true }, // (Markdown has no underline)
        { key: 'Mod-Shift-x', run: (v) => toggleInline(v, '~~') },
        { key: 'Mod-Alt-1', run: (v) => setLines(v, 'h1') },
        { key: 'Mod-Alt-2', run: (v) => setLines(v, 'h2') },
        { key: 'Mod-Alt-3', run: (v) => setLines(v, 'h3') },
        { key: 'Mod-Alt-0', run: (v) => setLines(v, 'p') },
        { key: 'Mod-Shift-8', run: (v) => setLines(v, 'bullet') },
        { key: 'Mod-Shift-7', run: (v) => setLines(v, 'ordered') },
        { key: 'Mod-Shift-9', run: (v) => setLines(v, 'task') },
        { key: 'Mod-Shift-b', run: (v) => setLines(v, 'quote') },
        { key: 'Mod-k', run: () => (onLinkKey?.(), true) },
        { key: 'Mod-f', run: () => (onFindKey?.(false), true) },
        { key: 'Mod-h', run: () => (onFindKey?.(true), true) },
        ...historyKeymap,
        // (CodeMirror's own Ctrl+M is left out: Ctrl+M and Ctrl+Shift+M are the page's, for Markdown mode
        // and the plain text)
        ...defaultKeymap.filter((b) => !/^(Ctrl|Mod)-m$/i.test(b.key || '')),
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange?.();
        if (u.selectionSet || u.docChanged || u.transactions.some((t) => t.effects.length)) onSelection?.();
      }),
    ],
  });
  const view = new EditorView({ state, parent });
  return mdAdapter(view, plainLookC);
}

// ---------- the same handles the page uses for the document editor ----------
function mdAdapter(view, plainLookC) {
  const st = () => view.state;
  const text = () => view.state.doc.toString();
  const linkAt = () => around(st(), ['Link']);
  return {
    kind: 'md',
    view,
    text,
    snapshot: text,
    focus: (where) => {
      if (where === 'start') view.dispatch({ selection: { anchor: 0 } });
      if (where === 'end') view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    },
    destroy: () => view.destroy(),
    replace: (t) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t }, selection: { anchor: Math.min(view.state.selection.main.head, t.length) } }),
    selectedText: () => {
      const r = st().selection.main;
      return st().sliceDoc(r.from, r.to);
    },
    title: () => (headings(st())[0]?.text || text().split('\n').map((l) => l.replace(/^[#>\-*+\s\d.[\]x]+/, '').trim()).find(Boolean) || ''),
    plain: () => st().field(plainField),
    setPlain: (on) => view.dispatch({ effects: [plainFx.of(on), plainLookC.reconfigure(on ? plainLook : [])] }),
    // what the toolbar shows: on, off, or unavailable (null) in Markdown
    active() {
      const s = st();
      const has = (names) => !!around(s, names);
      const kind = lineKind(s.doc.lineAt(s.selection.main.head).text);
      return {
        style: /^h\d$/.test(kind) ? kind : 'p',
        bold: has(['StrongEmphasis']),
        italic: has(['Emphasis']),
        underline: null,
        strike: has(['Strikethrough']),
        bullet: kind === 'bullet',
        ordered: kind === 'ordered',
        task: kind === 'task',
        quote: kind === 'quote',
        link: has(['Link']),
        table: has(['Table']),
        undo: undoDepth(s) > 0,
        redo: redoDepth(s) > 0,
      };
    },
    run(cmd) {
      const map = {
        bold: () => toggleInline(view, '**'),
        italic: () => toggleInline(view, '*'),
        strike: () => toggleInline(view, '~~'),
        bullet: () => setLines(view, 'bullet'),
        ordered: () => setLines(view, 'ordered'),
        task: () => setLines(view, 'task'),
        quote: () => setLines(view, 'quote'),
        undo: () => undo(view),
        redo: () => redo(view),
      };
      map[cmd]?.();
      view.focus();
    },
    setStyle(v) {
      setLines(view, v === 'p' ? 'p' : v);
      view.focus();
    },
    linkHref() {
      const l = linkAt();
      const url = l?.getChild('URL');
      return url ? st().sliceDoc(url.from, url.to) : '';
    },
    setLink(href) {
      const s = st();
      const l = linkAt();
      if (l) {
        const url = l.getChild('URL');
        if (url) view.dispatch({ changes: { from: url.from, to: url.to, insert: href }, userEvent: 'input' });
      } else {
        const r = s.selection.main;
        const words = r.empty ? href.replace(/^mailto:/, '') : s.sliceDoc(r.from, r.to);
        view.dispatch({ changes: { from: r.from, to: r.to, insert: `[${words}](${href})` }, selection: { anchor: r.from + words.length + href.length + 4 }, userEvent: 'input' });
      }
      view.focus();
    },
    removeLink() {
      const l = linkAt();
      if (!l) return;
      const marks = [];
      for (let c = l.firstChild; c; c = c.nextSibling) if (c.name === 'LinkMark') marks.push(c);
      if (marks.length >= 2) view.dispatch({ changes: [{ from: l.from, to: marks[0].to }, { from: marks[1].from, to: l.to }], userEvent: 'input' });
      view.focus();
    },
    insertTable() {
      const s = st();
      const line = s.doc.lineAt(s.selection.main.head);
      const before = line.text.trim() ? '\n\n' : line.from > 0 && s.doc.lineAt(line.from - 1).text.trim() ? '\n' : '';
      const at = line.text.trim() ? line.to : line.from;
      const t = `${before}| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n|  |  |  |\n`;
      view.dispatch({ changes: { from: at, insert: t }, selection: { anchor: at + before.length + 2, head: at + before.length + 10 }, userEvent: 'input' });
      view.focus();
    },
    // the outline, the counts
    outline() {
      const s = st();
      const folded = s.field(foldField);
      const list = headings(s);
      return list.map((h) => ({ ...h, folded: folded.includes(h.pos), hasSection: sectionEnd(s, h.pos, list) > s.doc.lineAt(h.pos).to + 1 }));
    },
    currentHeading() {
      const s = st();
      let at = null;
      for (const h of headings(s)) if (h.pos <= s.selection.main.head) at = h.pos;
      return at;
    },
    counts() {
      const s = st();
      const clean = (t) => t.replace(/\]\([^)]*\)/g, ']').replace(/\[[ xX]\]/g, '');
      const all = countWords(clean(s.doc.toString()));
      const head = this.currentHeading();
      const section = head == null ? null : countWords(clean(s.sliceDoc(head, sectionEnd(s, head))));
      const r = s.selection.main;
      return { words: all, section, chosen: r.empty ? 0 : countWords(clean(s.sliceDoc(r.from, r.to))) };
    },
    toggleFold(pos) {
      view.dispatch({ effects: toggleFoldFx.of(pos) });
      view.focus();
    },
    moveSection(from, target) {
      const s = st();
      let to = sectionEnd(s, from);
      if (target != null && target >= from && target <= to) return false;
      let block = s.sliceDoc(from, to);
      if (!block.endsWith('\n')) block += '\n';
      const changes = [{ from, to }];
      const at = target == null ? s.doc.length : target;
      // at the very end, after a last line without a line break: start a new line first
      const lead = at === s.doc.length && s.doc.length && !s.doc.sliceString(s.doc.length - 1).endsWith('\n') ? '\n' : '';
      changes.push({ from: at, insert: lead + block });
      const tr = s.update({ changes, userEvent: 'move' });
      const pos = tr.changes.mapPos(at, -1) + lead.length;
      view.dispatch(tr);
      view.dispatch({ selection: { anchor: Math.min(pos + 2, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
      return true;
    },
    goTo(pos) {
      const line = st().doc.lineAt(pos);
      const m = /^#+\s*/.exec(line.text);
      view.dispatch({ selection: { anchor: line.from + (m ? m[0].length : 0) }, effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 24 }) });
      view.focus();
    },
    // find and replace
    setFind(query, options) {
      view.dispatch({ effects: findFx.of({ query, options }) });
      this.revealFind();
    },
    clearFind() {
      view.dispatch({ effects: findFx.of({ query: '', current: -1 }) });
    },
    findState() {
      const s = st().field(findField);
      return { count: s.matches.length, current: s.current };
    },
    revealFind() {
      const s = st().field(findField);
      const m = s.matches[s.current];
      if (!m) return;
      for (const pos of st().field(foldField)) if (m.from > pos && m.from < sectionEnd(st(), pos)) view.dispatch({ effects: toggleFoldFx.of(pos) });
      view.dispatch({ effects: EditorView.scrollIntoView(m.from, { y: 'center' }) });
    },
    findStep(dir) {
      const s = st().field(findField);
      if (!s.matches.length) return;
      view.dispatch({ effects: findFx.of({ current: (s.current + dir + s.matches.length) % s.matches.length }) });
      this.revealFind();
    },
    replaceCurrent(t) {
      const s = st().field(findField);
      const m = s.matches[s.current];
      if (m) view.dispatch({ changes: { from: m.from, to: m.to, insert: t }, userEvent: 'input' });
      this.revealFind();
    },
    replaceAll(t) {
      const s = st().field(findField);
      if (!s.matches.length) return 0;
      view.dispatch({ changes: s.matches.map((m) => ({ from: m.from, to: m.to, insert: t })), userEvent: 'input' });
      return s.matches.length;
    },
  };
}
