// Writ end to end: the real app (Electron), driven like a person would.
// Run: npx vite build && xvfb-run -a -s "-screen 0 1600x1000x24" node tests/e2e.cjs
// Screenshots go to /tmp/writ-shots/; look at them.
const { _electron } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { readDocx } = require('../electron/docx-read.cjs');

let fails = 0;
const check = (what, cond, got = '') => {
  console.log((cond ? 'ok   ' : 'FAIL ') + what + (cond || got === '' ? '' : `  (got ${JSON.stringify(got)})`));
  if (!cond) fails++;
};
const shots = '/tmp/writ-shots';
fs.mkdirSync(shots, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writ-e2e-'));
  const docs = path.join(root, 'Documents');
  fs.mkdirSync(docs);
  const data = path.join(root, 'data');
  const env = { ...process.env, WRIT_E2E: '1', WRIT_USER_DATA: data, WRIT_SAVE_AS: docs };
  const launch = (files = []) => _electron.launch({ args: [path.join(__dirname, '..'), '--no-sandbox', ...files], env });
  const errs = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errs.push(String(e.stack || e)));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  };

  let app = await launch();
  const all = () => app.evaluate(() => globalThis.writ.docs());
  let w = await app.firstWindow();
  watch(w);
  await w.waitForSelector('.ProseMirror');
  await w.setViewportSize({ width: 1280, height: 860 });
  await wait(300);
  let d = (await all())[0];
  check('starting with nothing opens one new, empty document', (await all()).length === 1 && !d.path && !d.dirty);
  check('…called "Untitled"', (await w.locator('.top .name').innerText()).trim() === 'Untitled');
  check('…written in Literata on a sheet of paper', (await w.evaluate(() => getComputedStyle(document.querySelector('.writ-doc')).fontFamily)).includes('Literata') && (await w.locator('.sheet').boundingBox()).width === 794);
  check('…with a quiet hint where to start', (await w.locator('.writ-doc p.is-editor-empty').getAttribute('data-placeholder')) === 'Start writing…');
  check('…and the outline beside it, empty for now', (await w.locator('.outline .empty').count()) === 1);
  await w.screenshot({ path: `${shots}/01-empty.png` });

  // ---- writing, with the Markdown typing shortcuts ----
  const type = (s) => w.keyboard.type(s, { delay: 5 });
  await type('# Styremøte\n');
  await type('Agenda for the **annual** meeting, in *short*.\n');
  await type('## Saker\n');
  await type('- Budget\nRoof\n\n');
  await type('1. First\nSecond\n\n');
  await type('[ ] Send the invitation\n\n');
  await type('> Quiet minds, clear books.\n\n');
  await type('## Eventuelt\n');
  await type('Nothing more.');
  await wait(500);
  const html = await w.evaluate(() => window.__writ.html());
  check('"# " makes a heading 1 and "## " a heading 2', /<h1>Styremøte<\/h1>/.test(html) && /<h2>Saker<\/h2>/.test(html), html);
  check('"**…**" makes bold and "*…*" italic as you type', /<strong>annual<\/strong>/.test(html) && /<em>short<\/em>/.test(html));
  check('"- " makes a bulleted list, Enter continues it', /<ul><li><p>Budget<\/p><\/li><li><p>Roof<\/p><\/li><\/ul>/.test(html), html);
  check('"1. " makes a numbered list', /<ol><li><p>First<\/p><\/li><li><p>Second<\/p><\/li><\/ol>/.test(html));
  check('"[ ] " makes a checklist', /data-type="taskList"/.test(html) && /Send the invitation/.test(html));
  check('"> " makes a quote', /<blockquote><p>Quiet minds, clear books\.<\/p><\/blockquote>/.test(html));
  d = (await all())[0];
  check('typing marks it unsaved (a dot, and in the window title)', (await w.locator('.top .dot').count()) === 1 && d.dirty && d.title.startsWith('• Untitled'));
  check('the outline lists the headings', (await w.locator('.outline .row .tx').allInnerTexts()).join('|') === 'Styremøte|Saker|Eventuelt');
  check('…and marks the section the cursor is in', (await w.locator('.outline .row.on .tx').innerText()) === 'Eventuelt');
  const status = await w.locator('.status').innerText();
  check('the status line counts the words, and the words in this section', status.includes('23 words') && status.includes('3 words in this section'), status);
  await w.screenshot({ path: `${shots}/02-written.png` });

  // ---- the toolbar ----
  await w.keyboard.press('Shift+Home');
  await w.locator('.tool[aria-label="Bold"]').click();
  await wait(50);
  const hb = await w.evaluate(() => window.__writ.html());
  check('the Bold button makes the chosen words bold, and shows it is on', /<strong>Nothing more\.<\/strong>/.test(hb) && (await w.locator('.tool[aria-label="Bold"]').getAttribute('aria-pressed')) === 'true', hb.slice(-120));
  await w.keyboard.press('Control+u');
  await w.keyboard.press('Control+Shift+x');
  let h2 = await w.evaluate(() => window.__writ.html());
  check('Ctrl+U underlines and Ctrl+Shift+X strikes through', /<u>/.test(h2) && /<s>/.test(h2), h2);
  await w.keyboard.press('Control+z');
  await w.keyboard.press('Control+z');
  await w.keyboard.press('Control+z');
  check('undo takes them back one at a time', !/Nothing more\.<\/(strong|u|s)>/.test(await w.evaluate(() => window.__writ.html())));
  await w.locator('select.style').selectOption('h3');
  await wait(250);
  check('the style list turns a line into a heading 3', /<h3>Nothing more\.<\/h3>/.test(await w.evaluate(() => window.__writ.html())));
  check('…and the outline follows', (await w.locator('.outline .row .tx').allInnerTexts()).includes('Nothing more.'));
  await w.locator('select.style').selectOption('p');
  // a link
  await w.keyboard.press('End');
  await w.keyboard.press('Shift+Home');
  await w.keyboard.press('Control+k');
  await w.locator('.linkbox input').fill('example.com');
  await w.keyboard.press('Enter');
  check('Ctrl+K links the chosen words (https:// added)', /<a href="https:\/\/example\.com">Nothing more\.<\/a>/.test(await w.evaluate(() => window.__writ.html())), await w.evaluate(() => window.__writ.html()));
  await w.keyboard.press('End');

  // ---- saving as .docx ----
  await w.keyboard.press('Control+s');
  await wait(900);
  const file = path.join(docs, 'Styremøte.docx');
  check('Ctrl+S on a new document saves it as .docx, named after its first heading', fs.existsSync(file));
  d = (await all())[0];
  check('…no longer unsaved, and the window shows its name', !d.dirty && !(await w.locator('.top .dot').count()) && d.title === 'Styremøte.docx — Writ');
  const back = await readDocx(fs.readFileSync(file));
  check('…a real Word file: headings as Word headings, lists, the quote, the link', /<h1>Styremøte<\/h1>/.test(back.html) && /<h2>Saker<\/h2>/.test(back.html) && /<ul><li>Budget/.test(back.html) && /<ol><li>First/.test(back.html) && /<blockquote>/.test(back.html) && /href="https:\/\/example.com"/.test(back.html), back.html);
  check('…with nothing reported missing when read back', back.left.length === 0, back.left);
  const before = await w.evaluate(() => JSON.stringify(window.__writ.json()));

  // ---- the round trip: open it again in a fresh Writ and compare ----
  await app.close();
  app = await launch([file]);
  w = await app.firstWindow();
  watch(w);
  await w.waitForSelector('.ProseMirror');
  await w.setViewportSize({ width: 1280, height: 860 });
  await wait(400);
  const after = await w.evaluate(() => JSON.stringify(window.__writ.json()));
  check('saving and reopening gives back exactly the same document', after === before, after.length + ' vs ' + before.length);
  d = (await all())[0];
  check('…opened unchanged (not marked unsaved)', !d.dirty && d.path === file);
  await w.screenshot({ path: `${shots}/03-reopened.png` });

  // ---- the outline: jump, fold, move ----
  await w.locator('.outline .row .tx', { hasText: 'Saker' }).click();
  await wait(250);
  check('clicking a heading in the outline puts the cursor there', (await w.locator('.outline .row.on .tx').innerText()) === 'Saker');
  await w.locator('.outline .row', { hasText: 'Saker' }).locator('.tw').click();
  await wait(150);
  check('folding a heading hides its section on the page', !(await w.locator('.writ-doc li', { hasText: 'Budget' }).isVisible()) && (await w.locator('.writ-doc .writ-folded-head').count()) === 1);
  check('…but nothing is removed (still not unsaved)', !(await all())[0].dirty && /Budget/.test(await w.evaluate(() => window.__writ.html())));
  await w.screenshot({ path: `${shots}/04-folded.png` });
  await w.locator('.outline .row', { hasText: 'Saker' }).locator('.tw').click();
  check('…and unfolding shows it again', await w.locator('.writ-doc li', { hasText: 'Budget' }).isVisible());
  await w.locator('.outline .row', { hasText: 'Eventuelt' }).dragTo(w.locator('.outline .row', { hasText: 'Saker' }));
  await wait(200);
  const order = await w.evaluate(() => [...document.querySelectorAll('.writ-doc h1, .writ-doc h2')].map((h) => h.textContent).join('|'));
  check('dragging a heading in the outline moves its whole section', order === 'Styremøte|Eventuelt|Saker', order);
  const moved = await w.evaluate(() => window.__writ.html());
  check('…with its words along with it', /<h2>Eventuelt<\/h2><p><a[^>]*>Nothing more/.test(moved) && moved.indexOf('Nothing more') < moved.indexOf('Budget'), moved);
  check('…and the document is now unsaved', (await all())[0].dirty);
  await w.keyboard.press('Control+z');
  await wait(100);
  check('…undo puts it back', (await w.evaluate(() => [...document.querySelectorAll('.writ-doc h2')].map((h) => h.textContent).join('|'))) === 'Saker|Eventuelt');

  // ---- find and replace ----
  await w.keyboard.press('Control+f');
  await w.locator('.find input[data-role=find]').fill('the');
  await wait(100);
  const first = await w.locator('.find .count').innerText();
  check('Ctrl+F finds every match and marks them on the page', / of 2$/.test(first) && (await w.locator('.writ-match').count()) === 2 && (await w.locator('.writ-match.current').count()) === 1, first);
  await w.keyboard.press('Enter');
  const second = await w.locator('.find .count').innerText();
  check('…Enter goes to the next one', / of 2$/.test(second) && second !== first, second);
  await w.locator('.find input[data-role=find]').fill('eventuel');
  await wait(100);
  const partly = await w.locator('.find .count').innerText();
  await w.locator('.find .opts label', { hasText: 'Whole words' }).click();
  check('…"Whole words" finds only whole words', partly === '1 of 1' && (await w.locator('.find .count').innerText()) === 'None');
  await w.locator('.find .opts label', { hasText: 'Whole words' }).click();
  await w.keyboard.press('Escape');
  await w.keyboard.press('Control+h');
  await w.locator('.find input[data-role=find]').fill('Budget');
  await w.locator('.find input[data-role=replace]').fill('Budsjett');
  await w.locator('.find .txt', { hasText: 'Replace all' }).click();
  check('Ctrl+H replaces', /Budsjett/.test(await w.evaluate(() => window.__writ.html())) && !/Budget/.test(await w.evaluate(() => window.__writ.html())));
  await w.screenshot({ path: `${shots}/05-replace.png` });
  await w.keyboard.press('Escape');
  check('Esc closes the find card and the marks go', (await w.locator('.find').count()) === 0 && (await w.locator('.writ-match').count()) === 0);

  // ---- closing with unsaved changes asks ----
  await w.evaluate(() => window.writ.requestClose());
  await wait(300);
  check('closing an unsaved document asks first', (await w.locator('.dialog h2').innerText()).includes('Save changes to “Styremøte.docx”?'));
  await w.locator('.dialog .btn', { hasText: 'Cancel' }).click();
  check('…Cancel keeps it open', (await all()).length === 1);
  check('Windows shutting down with an unsaved document is held, and asked about', await app.evaluate(() => globalThis.writ.shutdown()));
  await wait(200);
  await w.locator('.dialog .btn', { hasText: 'Cancel' }).click();

  // ---- the file changed by another program ----
  const other = path.join(docs, 'other.docx');
  fs.copyFileSync(file, other);
  const oid = await app.evaluate((_e, f) => globalThis.writ.open(f), other);
  await wait(1200);
  const ow = (await app.windows()).find((x) => x !== w);
  watch(ow);
  await ow.waitForSelector('.ProseMirror');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'word-like.docx'), other);
  await wait(1500);
  check('a file changed by another program is reloaded quietly when nothing is unsaved', /Årsmøte 2026/.test(await ow.evaluate(() => window.__writ.html())));
  await ow.evaluate(() => window.writ.close()).catch(() => {});
  await wait(400);
  void oid;

  // ---- a Word document with things Writ can't show ----
  const word = path.join(docs, 'Årsmøte.docx');
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'word-like.docx'), word);
  const wordHash = sha(word);
  await app.evaluate((_e, f) => globalThis.writ.open(f), word);
  await wait(1200);
  const ww = (await app.windows()).find((x) => x !== w && !x.isClosed());
  watch(ww);
  await ww.waitForSelector('.ProseMirror');
  await ww.setViewportSize({ width: 1280, height: 860 });
  const wh = await ww.evaluate(() => window.__writ.html());
  check('a Word document opens with its headings, lists, bold and italic', /<h1>Årsmøte 2026<\/h1>/.test(wh) && /<h2>Økonomi<\/h2>/.test(wh) && /<strong>Skårerløkka<\/strong>/.test(wh) && /<em>årsmøte<\/em>/.test(wh) && /<ol><li><p>Ett/.test(wh), wh);
  check('…a Word heading 4 comes in as a heading 3', /<h3>Detaljer<\/h3>/.test(wh));
  check('…a table\'s text is kept', /Strøm/.test(wh) && /1200/.test(wh));
  const notice = await ww.locator('.notice').innerText();
  check('…and Writ says plainly what it couldn\'t bring in', /tables/.test(notice) && /pictures/.test(notice) && /comments/.test(notice) && /tracked changes/.test(notice) && /headers and footers/.test(notice), notice);
  await ww.screenshot({ path: `${shots}/06-word-document.png` });
  await ww.locator('.writ-doc h2').first().click();
  await ww.keyboard.press('End');
  await ww.keyboard.type(' (oppdatert)');
  await ww.keyboard.press('Control+s');
  await wait(400);
  check('saving over it asks first, offering a copy', (await ww.locator('.dialog h2').innerText()).includes('Save over “Årsmøte.docx”?'));
  await ww.screenshot({ path: `${shots}/07-save-over.png` });
  await ww.locator('.dialog .btn', { hasText: 'Save a copy' }).click();
  await wait(900);
  const copy = path.join(docs, 'Årsmøte (copy).docx');
  check('…"Save a copy" saves beside it and leaves the original untouched', fs.existsSync(copy) && sha(word) === wordHash);
  check('…and the window now holds the copy, with nothing missing', (await ww.locator('.top .name').innerText()).trim() === 'Årsmøte (copy).docx' && (await ww.locator('.notice').count()) === 0);
  await ww.evaluate(() => window.writ.close()).catch(() => {});
  await wait(300);

  // ---- showing ----
  await w.bringToFront();
  await w.keyboard.press('Control+Equal');
  check('Ctrl+= zooms the page, and the status line says so', (await w.locator('.status .zoom').innerText()) === '110 %');
  await w.keyboard.press('Control+0');
  await w.keyboard.press('Control+Backslash');
  await wait(200);
  check('Ctrl+\\ hides the outline', (await w.locator('.outline').count()) === 0);
  check('…and remembers it', JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8')).outline === false);
  await w.keyboard.press('Control+Backslash');
  await w.keyboard.press('Control+Slash');
  check('Ctrl+/ shows the keyboard shortcuts', await w.locator('[aria-label="Keyboard shortcuts"]').isVisible());
  await w.screenshot({ path: `${shots}/08-shortcuts.png` });
  await w.keyboard.press('Escape');
  await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = 'dark'));
  await wait(400);
  check('dark when Windows is dark', (await w.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  await w.screenshot({ path: `${shots}/09-dark.png` });
  await app.evaluate(({ nativeTheme }) => (nativeTheme.themeSource = 'system'));

  // ---- closing: Don't save ----
  await w.evaluate(() => window.writ.requestClose());
  await wait(300);
  const closed = app.waitForEvent('close').catch(() => {});
  await w.locator('.dialog .btn', { hasText: 'Don’t save' }).click();
  await closed;
  check('"Don’t save" closes it, and Writ ends with its last window', true);
  check('the saved file was left as it was', (await readDocx(fs.readFileSync(file))).html.includes('Budget'));

  check('no errors on any page', errs.length === 0, errs);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
