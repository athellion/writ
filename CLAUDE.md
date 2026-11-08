# Writ: working guide for Claude

Writ is Bjørnar's own writing app (named by him, 8 November 2026: a writ is a formal written
document, the kind you send to someone; Jot for notes, Writ for documents). Fuller than Jot, far
lighter than Word: basic formatting and moving around a document by its headings, saved as Word
files he can send to others. Part of the Kingfire Software Suite: `claude/FAMILY.md` and
`writ/HANDBOOK.md` in that Claude project hold the background and decisions; `writing/BRIEF.md` the
original idea and everything decided before it was built.

## His decisions (7–8 November 2026)
- **Normal mode works with .docx.** Documents must go to other people as .docx (and PDF, stage 3).
- **Markdown mode (0.2.0)** is a completely different editor, Jot's way: the text is the file, the
  marks (`#`, `**`) never shown in the default view, formatting added with the same buttons and keys,
  options Markdown can't hold greyed out, a plain-text view on request, and nothing rebuilt on save
  (untouched parts of a .md file stay exactly as they were). It switches on by itself for a .md file.
- **A sheet of paper** like The Scriptorium's: A4 width on a desk, warm dark paper at night.
- Features: outline from the headings (jump, drag a section, fold), word counts (document and
  section), find and replace, focus mode (stage 3), Markdown typing shortcuts in normal mode too,
  export to .docx and PDF from Markdown mode, a .docx switched to Markdown mode = "Save as .md" with a
  note on what won't come along, simple tables and pictures (stage 2/3).
- Look: the **sealed writ** icon (a folded document closed with a glowing wax seal) on **oxblood**
  (`#4a1d24` tile, exactly as his chosen mock-up; never shifted towards wine). UI accent `#7a2e38` /
  `#d8939c`.

## The shape
```
electron/main.cjs        windows (one per document, one Writ process), opening and saving, settings,
                         asking before closing unsaved work (and when Windows shuts down)
electron/docx-read.cjs   .docx → HTML with mammoth (by meaning: headings, lists, bold…); finds what
                         Writ can't show (tables, pictures, comments, tracked changes, headers…)
electron/docx-write.cjs  the editor's JSON → .docx with docx (Word's own Heading 1–3, Quote, lists,
                         hyperlinks; checklists as ☐/☒ paragraphs); A4, Georgia
electron/textfile.cjs    Markdown files read and written exactly as they were (Jot's: encoding, BOM,
                         line endings)
electron/preload.cjs     window.writ
src/App.svelte           one document: top bar, toolbar, notices, outline, the sheet, status line,
                         the dialogs (Save changes?, Save over the original?)
src/lib/editor.js        the document editor: TipTap 3 (ProseMirror, tables from TableKit) and Writ's
                         helpers: folding, find and replace, the outline, word counts, moving a section;
                         createDocEditor() wraps it in the handles the page uses
src/lib/mdeditor.js      Markdown mode: CodeMirror 6 over the file's text; the marks hidden (atomic, the
                         cursor steps over them, never rests before a line's mark), bullets, boxes,
                         tables drawn (their lines shown while the cursor is in one), folds, find;
                         the buttons write the marks; createMdEditor() gives the same handles
src/lib/convert.js       only when asked: editor JSON → Markdown (Save as .md; says what's lost) and
                         Markdown → HTML for the document editor (marked; Save as .docx, Export)
src/lib/words.js         the word count both editors use
src/components/          Outline, FindBar, Settings, Shortcuts (lists every key by hand), Mark
build/                   icon.svg (+ .png/.ico from scripts/icons.cjs), vestibulum.json,
                         installer.nsh ("Open with → Writ" for .docx, never the default), after-pack.cjs
```
- Settings in `%APPDATA%\Writ\settings.json` (look, outline shown); diary `writ.log`. Nothing else is
  kept: Writ opens blank and fresh, like Jot.
- **Protecting his files:** a .docx with things Writ can't show opens with a notice naming them; Save
  over it asks first (Save a copy… is the main choice). Writ never writes to a file except on Save.
- The document's own typeface in the .docx is Georgia (on every PC and Mac); Writ shows Literata.
- Strikethrough is Ctrl+Shift+X (TipTap's Ctrl+Shift+S is Save as here). No spell checking (as Jot).
- Ctrl+M: Markdown mode on or off (a new document just changes kind; a saved one is saved as the other
  kind, after a dialog saying what won't come along); Ctrl+Shift+M: Markdown mode's plain text. Both
  handled by the page (CodeMirror's own Ctrl+M is filtered out of its keymap).
- Markdown mode's drawn blocks (the table) take their space as padding, never margin: CodeMirror can't
  measure margins on block widgets, and clicks below would land on the wrong line.
- Tables: Word tables in and out (header row = Word's header row, `tableHeader` only when true);
  GFM tables in Markdown.
- Any change marks the document unsaved at once; the exact comparison runs after typing stops.

## Build and test
```sh
npm install
npx vite build && xvfb-run -a -s "-screen 0 1600x1000x24" node tests/e2e.cjs        # the document editor
xvfb-run -a -s "-screen 0 1600x1000x24" node tests/markdown.cjs                      # Markdown mode, switching, tables
CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome node scripts/icons.cjs   # icons
npm run dist:win     # electron-builder, then Vestibulum (../vestibulum cloned beside Writ)
node ../atelier/tools/card.cjs   # its card for Atelier's installers folder
```
The e2e test skips the Save/Open boxes (`WRIT_SAVE_AS`, `WRIT_OPEN`) and uses `tests/fixtures/
word-like.docx` (made with python-docx, which writes Word's own template, plus a tracked change).
Screenshots in `/tmp/writ-shots/`; look at them.

## How Bjørnar works
Not a programmer by trade: plain language, plain comments. When he has decided, don't argue for the
alternative unless asked; answer the question and stop; no closing suggestions. He notices half-pixels.
