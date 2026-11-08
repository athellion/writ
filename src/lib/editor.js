// The document editor: TipTap (built on ProseMirror). While you write, the editor keeps the document
// as a description of its parts ("a heading", "a list", "these words in bold"), which is what a Word
// file is too. The page around it (App.svelte) adds the toolbar, the outline and the status line.
//
// Besides TipTap's own parts, three small helpers live here:
//   - folding: a heading can be folded in the outline, hiding its section on the page (nothing is
//     removed; the words are only out of sight, and are saved as always);
//   - find and replace: matches are marked on the page; replacing changes only what's found;
//   - the outline and the counts: the headings, where the cursor is, words in the whole document and
//     in the section the cursor is in.
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Strike from '@tiptap/extension-strike';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { TableKit } from '@tiptap/extension-table';
import { countWords } from './words.js';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// ---------- folding ----------
const foldKey = new PluginKey('writ-fold');

// Where a top-level heading's section ends: at the next heading of the same or a higher level, or at
// the end of the document. (Positions are ProseMirror's: a count of steps through the document.)
export function sectionEnd(doc, pos) {
  const head = doc.nodeAt(pos);
  if (!head || head.type.name !== 'heading') return pos + (head?.nodeSize || 0);
  let end = doc.content.size;
  let found = false;
  doc.forEach((node, offset) => {
    if (found || offset <= pos) return;
    if (node.type.name === 'heading' && node.attrs.level <= head.attrs.level) {
      end = offset;
      found = true;
    }
  });
  return end;
}

const Folding = Extension.create({
  name: 'writFolding',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: foldKey,
        state: {
          init: () => [],
          // the folded headings' positions move along as the document changes
          apply(tr, folded) {
            const meta = tr.getMeta(foldKey);
            let next = folded
              .map((p) => tr.mapping.mapResult(p))
              .filter((r) => !r.deleted)
              .map((r) => r.pos)
              .filter((p) => tr.doc.nodeAt(p)?.type.name === 'heading');
            if (meta?.toggle != null) next = next.includes(meta.toggle) ? next.filter((p) => p !== meta.toggle) : [...next, meta.toggle];
            if (meta?.clear) next = [];
            return [...new Set(next)];
          },
        },
        props: {
          decorations(state) {
            const folded = foldKey.getState(state);
            if (!folded.length) return null;
            const decos = [];
            for (const pos of folded) {
              const head = state.doc.nodeAt(pos);
              if (!head) continue;
              decos.push(Decoration.node(pos, pos + head.nodeSize, { class: 'writ-folded-head' }));
              const end = sectionEnd(state.doc, pos);
              state.doc.forEach((node, offset) => {
                if (offset > pos && offset < end) decos.push(Decoration.node(offset, offset + node.nodeSize, { class: 'writ-hidden' }));
              });
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// ---------- find and replace ----------
const findKey = new PluginKey('writ-find');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function findAll(doc, query, { caseSensitive = false, wholeWords = false } = {}) {
  if (!query) return [];
  const re = new RegExp(wholeWords ? `(?<![\\p{L}\\p{N}_])${escape(query)}(?![\\p{L}\\p{N}_])` : escape(query), `gu${caseSensitive ? '' : 'i'}`);
  const found = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // the block's text, with where each character sits in the document
    let text = '';
    const at = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) at.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        at.push(pos + 1 + offset);
        text += '\n';
      }
    });
    for (const m of text.matchAll(re)) {
      if (!m[0].length) continue;
      found.push({ from: at[m.index], to: at[m.index + m[0].length - 1] + 1 });
    }
    return false;
  });
  return found;
}

const Find = Extension.create({
  name: 'writFind',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: findKey,
        state: {
          init: () => ({ query: '', options: {}, matches: [], current: -1 }),
          apply(tr, old, _o, state) {
            const meta = tr.getMeta(findKey);
            let s = meta ? { ...old, ...meta } : old;
            if (meta || tr.docChanged) {
              const matches = findAll(state.doc, s.query, s.options);
              let current = s.current;
              if (meta?.query !== undefined || meta?.options) {
                // start from the first match at or after the cursor
                const from = state.selection.from;
                current = matches.findIndex((m) => m.from >= from);
                if (current < 0) current = matches.length ? 0 : -1;
              }
              if (current >= matches.length) current = matches.length - 1;
              s = { ...s, matches, current };
            }
            return s;
          },
        },
        props: {
          decorations(state) {
            const s = findKey.getState(state);
            if (!s.matches.length) return null;
            return DecorationSet.create(
              state.doc,
              s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'writ-match current' : 'writ-match' })),
            );
          },
        },
      }),
    ];
  },
});

// ---------- keys that the page around the editor handles ----------
function Keys(hooks) {
  return Extension.create({
    name: 'writKeys',
    addKeyboardShortcuts() {
      return {
        'Mod-k': () => (hooks.onLink?.(), true),
        'Mod-f': () => (hooks.onFind?.(false), true),
        'Mod-h': () => (hooks.onFind?.(true), true),
      };
    },
  });
}

// Strikethrough on Ctrl+Shift+X (TipTap's own Ctrl+Shift+S is Save as in Writ, as everywhere else).
const WritStrike = Strike.extend({
  addKeyboardShortcuts() {
    return { 'Mod-Shift-x': () => this.editor.commands.toggleStrike() };
  },
});

// ---------- the editor ----------
export function createEditor(element, { html = '', onChange, onSelection, onTransaction, onLinkKey, onFindKey, onOpenLink, placeholder = 'Start writing…' }) {
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: null, target: null } },
      }),
      WritStrike,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false, HTMLAttributes: { class: 'writ-table' } } }),
      Placeholder.configure({ placeholder, showOnlyWhenEditable: true, showOnlyCurrent: true }),
      Folding,
      Find,
      Keys({ onLink: onLinkKey, onFind: onFindKey }),
    ],
    content: html,
    editorProps: {
      attributes: { class: 'writ-doc', spellcheck: 'false' },
      // Ctrl+click on a link opens it in the browser (a plain click just places the cursor, for editing)
      handleClick(view, pos, event) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const a = event.target.closest?.('a[href]');
        if (a) {
          onOpenLink?.(a.getAttribute('href'));
          return true;
        }
        return false;
      },
    },
    onUpdate: () => onChange?.(),
    onSelectionUpdate: () => onSelection?.(),
    onTransaction: ({ transaction }) => {
      onTransaction?.();
      if (transaction.getMeta(foldKey) || transaction.getMeta(findKey)) onSelection?.();
    },
  });
  return editor;
}

// ---------- the outline ----------
// The document's top-level headings, in order: { pos, level, text, folded, hasSection }.
export function outline(editor) {
  const { doc } = editor.state;
  const folded = foldKey.getState(editor.state) || [];
  const items = [];
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return;
    items.push({ pos, level: node.attrs.level, text: node.textContent.trim(), folded: folded.includes(pos), hasSection: sectionEnd(doc, pos) > pos + node.nodeSize });
  });
  return items;
}

// The heading whose section the cursor is in (its position), or null above the first heading.
export function currentHeading(editor) {
  const { doc, selection } = editor.state;
  let at = null;
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading' && pos <= selection.from) at = pos;
  });
  return at;
}


export function counts(editor) {
  const { doc, selection } = editor.state;
  const all = doc.textBetween(0, doc.content.size, ' ', ' ');
  const head = currentHeading(editor);
  let section = null;
  if (head != null) {
    const end = sectionEnd(doc, head);
    section = countWords(doc.textBetween(head, end, ' ', ' '));
  }
  const chosen = selection.empty ? 0 : countWords(doc.textBetween(selection.from, selection.to, ' ', ' '));
  return { words: countWords(all), section, chosen };
}

export function toggleFold(editor, pos, focus = false) {
  editor.view.dispatch(editor.state.tr.setMeta(foldKey, { toggle: pos }));
  if (focus) editor.view.focus();
}

// Moves a heading with its whole section (subheadings included) so it starts where `target` is
// (a top-level position), or to the end of the document when target is null.
export function moveSection(editor, from, target) {
  const { state } = editor;
  const to = sectionEnd(state.doc, from);
  if (target != null && target >= from && target <= to) return false; // (into itself: nothing to do)
  const slice = state.doc.slice(from, to);
  let tr = state.tr.delete(from, to);
  let at = target == null ? tr.doc.content.size : tr.mapping.map(target);
  tr = tr.insert(at, slice.content);
  tr.setSelection(TextSelection.create(tr.doc, Math.min(at + 1, tr.doc.content.size)));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

// Places the cursor at the start of a heading and brings it to the top of the page.
export function goTo(editor, pos) {
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, pos + 1)));
  const dom = view.nodeDOM(pos);
  dom?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  view.focus();
}

// ---------- find and replace ----------
export function findState(editor) {
  const s = findKey.getState(editor.state);
  return { count: s.matches.length, current: s.current };
}
export function setFind(editor, query, options) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query, options }));
  revealCurrent(editor);
}
export function clearFind(editor) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '', current: -1 }));
}
function revealCurrent(editor) {
  const s = findKey.getState(editor.state);
  const m = s.matches[s.current];
  if (!m) return;
  // a match inside a folded section unfolds it, so it can be seen
  const folded = foldKey.getState(editor.state);
  for (const pos of folded) {
    if (m.from > pos && m.from < sectionEnd(editor.state.doc, pos)) toggleFold(editor, pos);
  }
  const { node } = editor.view.domAtPos(m.from);
  const el = node.nodeType === 3 ? node.parentElement : node;
  el?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
}
export function findStep(editor, dir) {
  const s = findKey.getState(editor.state);
  if (!s.matches.length) return;
  const current = (s.current + dir + s.matches.length) % s.matches.length;
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { current }));
  revealCurrent(editor);
}
export function replaceCurrent(editor, text) {
  const s = findKey.getState(editor.state);
  const m = s.matches[s.current];
  if (!m) return;
  const tr = editor.state.tr.insertText(text, m.from, m.to);
  editor.view.dispatch(tr);
  revealCurrent(editor);
}
export function replaceAll(editor, text) {
  const s = findKey.getState(editor.state);
  if (!s.matches.length) return 0;
  let tr = editor.state.tr;
  for (const m of [...s.matches].reverse()) tr = tr.insertText(text, m.from, m.to);
  editor.view.dispatch(tr);
  return s.matches.length;
}

// ---------- the same handles the page uses for Markdown mode (mdeditor.js) ----------
export function createDocEditor(element, hooks) {
  const editor = createEditor(element, hooks);
  const chain = () => editor.chain().focus();
  return {
    kind: 'docx',
    editor,
    json: () => editor.getJSON(),
    html: () => editor.getHTML(),
    snapshot: () => JSON.stringify(editor.getJSON()),
    focus: (where) => editor.commands.focus(where || undefined),
    destroy: () => editor.destroy(),
    replace: (html) => editor.commands.setContent(html, { emitUpdate: false }),
    selectedText: () => {
      const { from, to, empty } = editor.state.selection;
      return empty ? '' : editor.state.doc.textBetween(from, to, ' ');
    },
    title: () => {
      let t = '';
      editor.state.doc.forEach((n) => {
        if (!t && n.textContent.trim()) t = n.textContent.trim();
      });
      return t;
    },
    active() {
      const e = editor;
      return {
        style: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        task: e.isActive('taskList'),
        quote: e.isActive('blockquote'),
        link: e.isActive('link'),
        table: e.isActive('table'),
        undo: e.can().undo(),
        redo: e.can().redo(),
      };
    },
    run(cmd) {
      const map = {
        bold: () => chain().toggleBold().run(),
        italic: () => chain().toggleItalic().run(),
        underline: () => chain().toggleUnderline().run(),
        strike: () => chain().toggleStrike().run(),
        bullet: () => chain().toggleBulletList().run(),
        ordered: () => chain().toggleOrderedList().run(),
        task: () => chain().toggleTaskList().run(),
        quote: () => chain().toggleBlockquote().run(),
        undo: () => chain().undo().run(),
        redo: () => chain().redo().run(),
        // tables
        rowAbove: () => chain().addRowBefore().run(),
        rowBelow: () => chain().addRowAfter().run(),
        colLeft: () => chain().addColumnBefore().run(),
        colRight: () => chain().addColumnAfter().run(),
        delRow: () => chain().deleteRow().run(),
        delCol: () => chain().deleteColumn().run(),
        delTable: () => chain().deleteTable().run(),
        headerRow: () => chain().toggleHeaderRow().run(),
      };
      map[cmd]?.();
    },
    setStyle(v) {
      if (v === 'p') chain().setParagraph().run();
      else chain().setHeading({ level: Number(v[1]) }).run();
    },
    linkHref: () => editor.getAttributes('link').href || '',
    setLink(href) {
      if (editor.state.selection.empty && !editor.isActive('link')) {
        chain().insertContent({ type: 'text', text: href.replace(/^mailto:/, ''), marks: [{ type: 'link', attrs: { href } }] }).run();
      } else chain().extendMarkRange('link').setLink({ href }).run();
    },
    removeLink: () => chain().extendMarkRange('link').unsetLink().run(),
    insertTable: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    outline: () => outline(editor),
    currentHeading: () => currentHeading(editor),
    counts: () => counts(editor),
    toggleFold: (pos) => toggleFold(editor, pos, true),
    moveSection: (from, to) => moveSection(editor, from, to),
    goTo: (pos) => goTo(editor, pos),
    setFind: (q, o) => setFind(editor, q, o),
    clearFind: () => clearFind(editor),
    findState: () => findState(editor),
    findStep: (d) => findStep(editor, d),
    replaceCurrent: (t) => replaceCurrent(editor, t),
    replaceAll: (t) => replaceAll(editor, t),
  };
}
