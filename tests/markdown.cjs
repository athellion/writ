// Writ end to end, stage 2: Markdown mode, switching between the two kinds, and tables.
// Run: npx vite build && xvfb-run -a -s "-screen 0 1600x1000x24" node tests/markdown.cjs
// Screenshots go to /tmp/writ-shots/md-*.png; look at them.
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

// A Markdown file written the way other programs write them: a BOM, Unix line endings, "*" bullets and
// "__bold__", none of which Writ would write itself; all of it must survive untouched.
const NOTES = [
  '# Garden plan',
  '',
  'This year: __raised beds__ and *more* herbs, see [the guide](https://example.com/guide).',
  '',
  '## Beds',
  '',
  '* Tomatoes',
  '* Beans',
  '  * runner beans',
  '',
  '- [ ] Order soil',
  '- [x] Measure the yard',
  '',
  '| Plant | Month |',
  '| --- | --- |',
  '| Basil | May |',
  '',
  '## Herbs',
  '',
  '> Rosemary likes it dry.',
  '',
  'Thyme, sage and mint.',
  '',
].join('\n');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'writ-md-'));
  const docs = path.join(root, 'Documents');
  fs.mkdirSync(docs);
  const env = { ...process.env, WRIT_E2E: '1', WRIT_USER_DATA: path.join(root, 'data'), WRIT_SAVE_AS: docs };
  const launch = (files = []) => _electron.launch({ args: [path.join(__dirname, '..'), '--no-sandbox', ...files], env });
  const errs = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errs.push(String(e.stack || e)));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  };
  const md = path.join(docs, 'garden.md');
  fs.writeFileSync(md, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NOTES, 'utf8')]));

  // ---- opening a Markdown file ----
  let app = await launch([md]);
  const all = () => app.evaluate(() => globalThis.writ.docs());
  let w = await app.firstWindow();
  watch(w);
  await w.waitForSelector('.cm-content');
  await w.setViewportSize({ width: 1280, height: 900 });
  await wait(500);
  check('a .md file opens in Markdown mode', (await w.evaluate(() => window.__writ.kind())) === 'md' && (await all())[0].kind === 'md');
  check('…said in the top bar and the status line, with the file\'s own encoding and line endings', (await w.locator('.top .kind').innerText()) === 'Markdown' && /Markdown · UTF-8 with BOM · Unix \(LF\)/.test((await w.locator('.status').innerText()).replace(/\n/g, ' ')), await w.locator('.status').innerText());
  const shown = await w.locator('.cm-content').innerText();
  check('the marks are never shown: no #, no **, no __, no link address, no [ ]', !/#|\*\*|__|\]\(|example\.com|\[ \]|\[x\]/.test(shown), shown);
  check('…headings are drawn as headings', (await w.locator('.cm-line.md-h1').innerText()) === 'Garden plan' && (await w.locator('.cm-line.md-h2').count()) === 2);
  check('…bold, italic and the link drawn as such', (await w.locator('.md-strong').first().innerText()) === 'raised beds' && (await w.locator('.md-em').first().innerText()) === 'more' && (await w.locator('.md-link').first().innerText()) === 'the guide');
  check('…bullets for "*" items, nested too', (await w.locator('.md-bullet').count()) === 3);
  check('…checklist boxes, one ticked', (await w.locator('.md-check').count()) === 2 && (await w.locator('.md-check.on').count()) === 1);
  check('…the table drawn as a table', (await w.locator('table.md-table th').allInnerTexts()).join('|') === 'Plant|Month' && (await w.locator('table.md-table td').allInnerTexts()).join('|') === 'Basil|May');
  check('…and the quote as a quote', (await w.locator('.cm-line.md-quote').innerText()) === 'Rosemary likes it dry.');
  check('the outline lists its headings', (await w.locator('.outline .row .tx').allInnerTexts()).join('|') === 'Garden plan|Beds|Herbs');
  check('not unsaved just from opening', !(await all())[0].dirty);
  await w.screenshot({ path: `${shots}/md-01-open.png` });

  // ---- the cursor and the hidden marks ----
  await w.keyboard.press('Control+Home');
  await w.keyboard.type('My ');
  let text = await w.evaluate(() => window.__writ.text());
  check('typing at the very start of a heading types into the heading (the cursor is past the hidden "# ")', text.startsWith('# My Garden plan\n'), text.slice(0, 30));
  await w.keyboard.press('Control+z');
  await w.locator('.md-check').first().click();
  await wait(100);
  text = await w.evaluate(() => window.__writ.text());
  check('clicking a box ticks it in the text ("[ ]" becomes "[x]")', text.includes('- [x] Order soil'));
  await w.keyboard.press('Control+z');

  // ---- formatting with the same buttons and keys ----
  await w.locator('.cm-line', { hasText: 'Thyme, sage and mint.' }).click();
  await w.keyboard.press('Home');
  await w.keyboard.press('Shift+Control+ArrowRight');
  await w.locator('.tool[aria-label="Bold"]').click();
  text = await w.evaluate(() => window.__writ.text());
  check('the Bold button writes the marks round the chosen word', text.includes('**Thyme**, sage and mint.'), text.slice(-40));
  check('…which are hidden at once, and the button shows bold is on', !(await w.locator('.cm-content').innerText()).includes('**') && (await w.locator('.tool[aria-label="Bold"]').getAttribute('aria-pressed')) === 'true');
  await w.keyboard.press('Control+b');
  check('…Ctrl+B again takes them away', (await w.evaluate(() => window.__writ.text())).includes('\nThyme, sage and mint.'));
  check('Underline is greyed out: Markdown has no underline', await w.locator('.tool[aria-label="Underline"]').isDisabled() && (await w.locator('.tool[aria-label="Underline"]').getAttribute('title')) === 'Markdown has no underline');
  await w.locator('select.style').selectOption('h3');
  text = await w.evaluate(() => window.__writ.text());
  check('the style list makes the line a heading 3 ("### ")', text.includes('\n### Thyme, sage and mint.'));
  await w.locator('select.style').selectOption('p');
  await w.keyboard.press('End');
  await w.keyboard.press('Enter');
  await w.keyboard.type('Plant **chives** soon');
  await wait(100);
  check('typing **…** makes bold as you type, and the marks vanish', (await w.locator('.md-strong', { hasText: 'chives' }).count()) === 1 && !(await w.locator('.cm-content').innerText()).includes('**'));
  await w.keyboard.press('Enter');
  await w.keyboard.type('- one');
  await w.keyboard.press('Enter');
  await w.keyboard.type('two');
  text = await w.evaluate(() => window.__writ.text());
  check('"- " starts a list and Enter carries it on', text.includes('- one\n- two'));
  check('…shown with bullets', (await w.locator('.md-bullet').count()) === 5);
  await w.screenshot({ path: `${shots}/md-02-formatting.png` });

  // ---- a table: drawn, and its lines while the cursor is in it ----
  await w.locator('table.md-table').click();
  await wait(150);
  check('clicking a table puts the cursor in it and shows its lines to edit', (await w.locator('.cm-line.md-rawtable').count()) === 3 && (await w.locator('table.md-table').count()) === 0);
  await w.screenshot({ path: `${shots}/md-03-table-lines.png` });
  await w.keyboard.press('Control+End');
  await wait(150);
  check('…and drawn again once the cursor leaves', (await w.locator('table.md-table').count()) === 1);

  // ---- plain text ----
  await w.keyboard.press('Control+Shift+m');
  await wait(150);
  const raw = await w.locator('.cm-content').innerText();
  check('Ctrl+Shift+M shows the plain text of the file, marks and all', raw.includes('# Garden plan') && raw.includes('__raised beds__') && raw.includes('| Plant | Month |'));
  check('…said in the top bar, and the toolbar rests', (await w.locator('.top .kind').innerText()) === 'Plain text' && (await w.locator('.tool[aria-label="Bold"]').isDisabled()));
  await w.screenshot({ path: `${shots}/md-04-plain.png` });
  await w.keyboard.press('Control+Shift+m');

  // ---- outline, counts and find in Markdown mode ----
  await w.locator('.outline .row', { hasText: 'Beds' }).locator('.tw').click();
  await wait(150);
  check('folding a section hides it on the page', !(await w.locator('.cm-content').innerText()).includes('Tomatoes') && (await w.locator('.md-folded').count()) === 1);
  await w.locator('.outline .row', { hasText: 'Beds' }).locator('.tw').click();
  await w.locator('.outline .row', { hasText: 'Herbs' }).dragTo(w.locator('.outline .row', { hasText: 'Beds' }));
  await wait(200);
  text = await w.evaluate(() => window.__writ.text());
  check('dragging a heading moves its section in the text', text.indexOf('## Herbs') < text.indexOf('## Beds') && text.indexOf('Rosemary') < text.indexOf('Tomatoes'), text);
  await w.keyboard.press('Control+z');
  await w.locator('.outline .row .tx', { hasText: 'Beds' }).click();
  await wait(200);
  const status = await w.locator('.status').innerText();
  check('the counts leave the marks and link addresses out', /\b(\d+) words in this section/.test(status) && !/example/.test(status), status);
  await w.keyboard.press('Control+f');
  await w.locator('.find input[data-role=find]').fill('beans');
  await wait(100);
  check('find marks the matches in Markdown mode too', (await w.locator('.find .count').innerText()).endsWith('of 2') && (await w.locator('.writ-match').count()) === 2);
  await w.keyboard.press('Escape');

  // ---- saving keeps the file exactly as it was, apart from the change ----
  await w.evaluate(() => {
    const v = window.__writ.doc.view;
    const at = v.state.doc.toString().indexOf('Thyme');
    v.dispatch({ changes: { from: at, to: at + 5, insert: 'Lemon thyme' } });
  });
  // put back what the other steps typed, so only one change is left
  await w.evaluate(() => {
    const v = window.__writ.doc.view;
    const t = v.state.doc.toString();
    const a = t.indexOf('\nPlant **chives** soon');
    if (a >= 0) v.dispatch({ changes: { from: a, to: t.indexOf('- two') + 5 } });
  });
  await w.keyboard.press('Control+s');
  await wait(600);
  const expect = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(NOTES.replace('Thyme', 'Lemon thyme'), 'utf8')]);
  const got = fs.readFileSync(md);
  check('saving changes only what was changed: BOM, Unix line endings, "*" bullets and "__bold__" all kept', got.equals(expect), got.toString('utf8').slice(0, 400));
  check('…and it\'s no longer unsaved', !(await all())[0].dirty);

  // ---- export as a Word document ----
  await w.locator('.top .btn[aria-label="Menu"]').click();
  await w.locator('.menu button', { hasText: 'Export as a Word document' }).click();
  await wait(900);
  const exported = path.join(docs, 'garden.docx');
  const ex = fs.existsSync(exported) ? await readDocx(fs.readFileSync(exported)) : { html: '' };
  check('"Export as a Word document" writes a .docx beside it', fs.existsSync(exported));
  check('…with the headings, bold, the link, the lists, the checklist and the table', /<h1>Garden plan<\/h1>/.test(ex.html) && /<strong>raised beds<\/strong>/.test(ex.html) && /href="https:\/\/example.com\/guide"/.test(ex.html) && /<ul><li>Tomatoes/.test(ex.html) && /data-type="taskList"/.test(ex.html) && /<table>/.test(ex.html) && /Basil/.test(ex.html), ex.html);
  check('…and the window stays the Markdown document', (await all())[0].path === md && (await w.evaluate(() => window.__writ.kind())) === 'md');

  // ---- a saved Markdown document switched off: Save as .docx ----
  const mdHash = sha(md);
  await w.keyboard.press('Control+m');
  await wait(200);
  check('Ctrl+M on a saved Markdown document offers to save it as a Word document', (await w.locator('.dialog h2').innerText()) === 'Save as a Word document?');
  fs.rmSync(exported);
  await w.locator('.dialog .btn.primary').click();
  await wait(1200);
  check('…which saves the .docx and opens it in the document editor', fs.existsSync(exported) && (await w.evaluate(() => window.__writ.kind())) === 'docx' && (await all())[0].path === exported);
  check('…leaving the Markdown file as it was', sha(md) === mdHash);
  check('…the table now a real table in the document editor', (await w.locator('.writ-doc table th').count()) === 2);
  await w.screenshot({ path: `${shots}/md-05-as-docx.png` });

  // ---- a saved Word document switched on: Save as .md ----
  await w.locator('.writ-doc h1').click();
  await w.keyboard.press('End');
  await w.keyboard.press('Shift+Control+ArrowLeft');
  await w.keyboard.press('Control+u');
  await w.keyboard.press('Control+s');
  await wait(700);
  const docxHash = sha(exported);
  fs.rmSync(md);
  await w.keyboard.press('Control+m');
  await wait(200);
  const sw = await w.locator('.dialog').innerText();
  check('Ctrl+M on a saved Word document offers "Save as a Markdown document", saying what won\'t come along', sw.includes('Save as a Markdown document?') && /can’t hold underlining/.test(sw), sw);
  await w.screenshot({ path: `${shots}/md-06-switch-dialog.png` });
  await w.locator('.dialog .btn.primary').click();
  await wait(1000);
  const back = fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '';
  check('…which saves the .md and opens it in Markdown mode', (await w.evaluate(() => window.__writ.kind())) === 'md' && /^# Garden plan\r?\n/.test(back), back.slice(0, 80));
  check('…as Markdown Writ writes: headings, **bold**, lists, the checklist and the table', /\*\*raised beds\*\*/.test(back) && /- Tomatoes/.test(back) && /- \[ \] Order soil/.test(back) && /\| Plant \| Month \|/.test(back), back);
  check('…and the Word document is left as it was', sha(exported) === docxHash);
  await app.close();

  // ---- a new document: switching kinds before it's saved ----
  app = await launch();
  w = await app.firstWindow();
  watch(w);
  await w.waitForSelector('.ProseMirror');
  await w.setViewportSize({ width: 1280, height: 900 });
  await w.keyboard.press('Control+m');
  await wait(200);
  check('an empty new document switches to Markdown mode at once', (await w.evaluate(() => window.__writ.kind())) === 'md' && (await w.locator('.dialog').count()) === 0);
  check('…not marked unsaved', !(await app.evaluate(() => globalThis.writ.docs()))[0].dirty);
  await w.keyboard.type('# Shopping\n\n- milk\n');
  await w.keyboard.press('Control+m');
  await wait(200);
  check('with writing in it, leaving Markdown mode asks first', (await w.locator('.dialog h2').innerText()) === 'Leave Markdown mode?');
  await w.locator('.dialog .btn.primary').click();
  await wait(300);
  const h = await w.evaluate(() => window.__writ.html());
  check('…and the writing comes along as a Word document', /<h1>Shopping<\/h1>/.test(h) && /<li><p>milk<\/p><\/li>/.test(h), h);
  check('…still unsaved, as a Word document', (await app.evaluate(() => globalThis.writ.docs()))[0].dirty && (await app.evaluate(() => globalThis.writ.docs()))[0].kind === 'docx');

  // ---- tables in the document editor ----
  await w.keyboard.press('Control+End');
  await w.locator('.tool[aria-label="Table"]').click();
  await wait(100);
  check('the Table button puts in a table (a header row and two rows)', (await w.locator('.writ-doc table tr').count()) === 3 && (await w.locator('.writ-doc table th').count()) === 3);
  await w.keyboard.type('Item');
  await w.keyboard.press('Tab');
  await w.keyboard.type('Price');
  await w.keyboard.press('Tab');
  await w.keyboard.type('Shop');
  await w.keyboard.press('Tab');
  await w.keyboard.type('Bread');
  await w.locator('.tool[aria-label="Table"]').click();
  check('in a table, the Table button gives its rows and columns', await w.locator('.tablemenu').isVisible());
  await w.locator('.tablemenu button', { hasText: 'Add a row below' }).click();
  check('…"Add a row below" adds one', (await w.locator('.writ-doc table tr').count()) === 4);
  await w.screenshot({ path: `${shots}/md-07-table.png` });
  await w.keyboard.press('Control+s');
  await wait(800);
  const shop = path.join(docs, 'Shopping.docx');
  const before = await w.evaluate(() => JSON.stringify(window.__writ.json()));
  const sr = await readDocx(fs.readFileSync(shop));
  check('a table saves as a Word table, its header row as a header', /<table><thead><tr><th><p>Item<\/p><\/th>/.test(sr.html) && /<td><p>Bread<\/p><\/td>/.test(sr.html), sr.html);
  await app.close();
  app = await launch([shop]);
  w = await app.firstWindow();
  watch(w);
  await w.waitForSelector('.ProseMirror');
  await wait(400);
  check('…and comes back exactly the same when reopened', (await w.evaluate(() => JSON.stringify(window.__writ.json()))) === before);
  await app.close();

  check('no errors on any page', errs.length === 0, errs);
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
