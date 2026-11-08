<script>
  // One document, in its own window: the bar at the top (its name, the outline and the menu), the
  // formatting toolbar, the outline beside the page, the sheet of paper the document is written on, and
  // a quiet status line with the word counts.
  //
  // A document is one of two kinds, each with its own editor behind the same controls: a Word document
  // (the document editor, lib/editor.js) or a Markdown document (Markdown mode, lib/mdeditor.js). The
  // page talks to either through the same handles (`doc.active()`, `doc.run('bold')`, `doc.outline()`…).
  import { onMount, tick } from 'svelte';
  import { createDocEditor, createEditor } from './lib/editor.js';
  import { createMdEditor } from './lib/mdeditor.js';
  import { toMarkdown, fromMarkdown } from './lib/convert.js';
  import Mark from './components/Mark.svelte';
  import Outline from './components/Outline.svelte';
  import FindBar from './components/FindBar.svelte';
  import Settings from './components/Settings.svelte';
  import Shortcuts from './components/Shortcuts.svelte';

  const writ = window.writ;
  let host = $state();
  let desk = $state();
  let doc = $state.raw(null); // the editor's handles
  let kind = $state('docx'); // 'docx' or 'md'

  let name = $state('Untitled');
  let path = $state(null);
  let saved = ''; // the document as last saved or opened (to tell whether anything has changed)
  let dirty = $state(false);
  let left = $state([]); // what the file had that Writ couldn't bring in
  let leftShown = $state(true);
  let form = $state({ encodingLabel: 'UTF-8', eolLabel: 'Windows (CRLF)' }); // a Markdown file's own form
  let plain = $state(false); // Markdown mode: showing the plain text
  let settings = $state({ theme: 'system', outline: true, dark: false });
  let version = $state('');
  let zoom = $state(100);
  let menuOpen = $state(false);
  let tableMenu = $state(false);
  let showSettings = $state(false);
  let showShortcuts = $state(false);
  let finding = $state(null); // null, or { replace } while the find bar is open
  let asking = $state(false); // "Save changes?" when closing
  let overwrite = $state(null); // "Save over the original?" (it had things Writ couldn't bring in)
  let switching = $state(null); // "Switch to Markdown mode?" / "Save as a Word document?"
  let disk = $state(null); // the file changed on disk while there were unsaved changes
  let linking = $state(null); // the link box: { href }
  let toast = $state(null);
  let toastTimer;

  // what the toolbar shows as on, the outline and the counts: refreshed as the document changes
  let active = $state({});
  let heads = $state([]);
  let here = $state(null);
  let count = $state({ words: 0, section: null, chosen: 0 });

  function look(s) {
    document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  }
  $effect(() => look(settings));

  function say(text, ms = 2200) {
    clearTimeout(toastTimer);
    toast = text;
    toastTimer = setTimeout(() => (toast = null), ms);
  }

  // ---------- following the document ----------
  function refresh() {
    if (!doc) return;
    tools();
    heads = doc.outline();
    here = doc.currentHeading();
    count = doc.counts();
  }
  // the toolbar follows every change at once
  function tools() {
    if (doc) active = doc.active();
  }
  let refreshTimer;
  function soon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 120);
  }
  let changeTimer;
  function changed() {
    soon();
    tools();
    // any change marks the document unsaved at once (so closing straight after typing still asks);
    // a moment later it's compared with the saved document, so undoing back to it clears the mark
    if (!dirty) {
      dirty = true;
      writ.changed(true);
    }
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      const was = dirty;
      dirty = doc.snapshot() !== saved;
      if (was !== dirty) writ.changed(dirty);
      if (!path) writ.touched();
    }, 150);
  }

  // Puts the right editor on the sheet for this kind of document (replacing the one there).
  function mount(k, content) {
    doc?.destroy();
    host.innerHTML = '';
    kind = k;
    plain = false;
    const hooks = { onChange: changed, onSelection: refresh, onTransaction: tools, onLinkKey: openLink, onFindKey: (r) => openFind(r), onOpenLink: (href) => writ.openLink(href) };
    doc = k === 'md' ? createMdEditor(host, { text: content, ...hooks }) : createDocEditor(host, { html: content, ...hooks });
    window.__writ = { doc, kind: () => kind, html: () => doc.html?.(), json: () => doc.json?.(), text: () => doc.text?.() }; // (for the tests)
  }

  onMount(async () => {
    const d = await writ.init();
    name = d.name;
    path = d.path;
    left = d.left || [];
    form = d.form;
    settings = d.settings;
    version = d.version;
    look(settings);
    mount(d.kind, d.kind === 'md' ? d.text : d.html);
    saved = doc.snapshot();
    refresh();
    doc.focus('start');
    document.title = name;
  });

  writ.onSettings((s) => {
    settings = s;
  });
  writ.onAskClose(() => {
    menuOpen = false;
    asking = true;
  });
  writ.onDisk(({ html, text, left: l, replace }) => {
    const content = kind === 'md' ? text : html;
    if (replace) {
      doc.replace(content);
      saved = doc.snapshot();
      dirty = false;
      left = l;
      refresh();
      say('Updated: the file was changed by another program');
    } else disk = { content, left: l };
  });

  // ---------- saving ----------
  async function save(as = false, force = false) {
    menuOpen = false;
    // the original had things Writ couldn't bring in: saving over it would lose them, so ask first
    if (!as && !force && path && left.length) {
      overwrite = true;
      return false;
    }
    const snap = doc.snapshot();
    const r = await writ.save(kind === 'md' ? { kind, text: doc.text(), as, title: doc.title() } : { kind, json: doc.json(), as, title: doc.title() });
    if (!r.ok) {
      if (r.error) say(`Not saved: ${r.error}`, 5000);
      return false;
    }
    saved = snap;
    dirty = doc.snapshot() !== saved;
    writ.changed(dirty);
    name = r.name;
    path = r.path;
    if (r.form) form = r.form;
    left = [];
    document.title = name;
    say(r.changed ? 'Saved — as UTF-8, since some characters need it' : 'Saved', r.changed ? 4000 : 1400);
    return true;
  }
  async function overwriteAnswer(how) {
    overwrite = null;
    if (how === 'copy') await save(true);
    else if (how === 'over') await save(false, true);
    doc.focus();
    if (asking && !dirty) writ.close();
  }
  async function closeAnswer(how) {
    if (how === 'cancel') {
      asking = false;
      writ.kept(); // (if Windows was shutting down, it isn't any more: nothing else is asked about)
      doc.focus();
      return;
    }
    if (how === 'save') {
      const ok = await save();
      if (!ok) return; // (cancelled, or waiting for "save over the original?")
    }
    writ.close();
  }
  function keepTheirs() {
    doc.replace(disk.content);
    left = disk.left;
    saved = doc.snapshot();
    dirty = false;
    writ.changed(false);
    disk = null;
    refresh();
  }

  // ---------- the two kinds ----------
  // The document editor's JSON for some Markdown text (read by a hidden document editor).
  function jsonOf(text) {
    const el = document.createElement('div');
    const e = createEditor(el, { html: fromMarkdown(text) });
    const json = e.getJSON();
    e.destroy();
    return json;
  }
  // Markdown mode on or off (Ctrl+M). A new, unsaved document simply changes kind; a saved one is saved
  // as the other kind ("Save as .md" / "Save as .docx", his decision), after saying what won't come along.
  function toggleMode() {
    menuOpen = false;
    const to = kind === 'md' ? 'docx' : 'md';
    const lost = to === 'md' ? toMarkdown(doc.json()).lost : [];
    const empty = !doc.title() && !path;
    if (empty) return switchNow(to);
    switching = { to, lost, saved: !!path, left: [...left] };
  }
  async function switchNow(to) {
    const was = switching;
    switching = null;
    const content = to === 'md' ? toMarkdown(doc.json()).text : fromMarkdown(doc.text());
    const blank = !doc.title();
    if (path) {
      // saved as the other kind; the window then holds the new file
      const r = await writ.save(to === 'md' ? { kind: 'md', text: content, title: doc.title() } : { kind: 'docx', json: jsonOf(doc.text()), title: doc.title() });
      if (!r.ok) {
        if (r.error) say(`Not saved: ${r.error}`, 5000);
        return;
      }
      mount(to, content);
      saved = doc.snapshot();
      dirty = false;
      writ.changed(false);
      name = r.name;
      path = r.path;
      if (r.form) form = r.form;
      left = [];
      document.title = name;
      say(to === 'md' ? 'Saved as Markdown: now in Markdown mode' : 'Saved as a Word document');
    } else {
      mount(to, content);
      writ.setKind(to);
      saved = blank ? doc.snapshot() : '\u0000'; // (an untitled document that was written in stays unsaved)
      changed();
      say(to === 'md' ? 'Markdown mode' : 'Back to a Word document');
    }
    refresh();
    doc.focus();
    void was;
  }
  function togglePlain() {
    if (kind !== 'md') return;
    menuOpen = false;
    plain = !plain;
    doc.setPlain(plain);
    doc.focus();
  }
  async function exportDocx() {
    menuOpen = false;
    const r = await writ.exportDocx(jsonOf(doc.text()), doc.title());
    if (r.ok) say(`Exported: ${r.name}`, 2600);
    else if (r.error) say(`Not exported: ${r.error}`, 5000);
  }

  // ---------- formatting ----------
  const run = (cmd) => {
    doc.run(cmd);
    tools();
  };
  function setStyle(v) {
    doc.setStyle(v);
    tools();
  }
  // the link box: the address of the link at the cursor, or a new one for the chosen words
  async function openLink() {
    menuOpen = false;
    linking = { href: doc.linkHref() };
    await tick();
    document.querySelector('.linkbox input')?.select();
  }
  function applyLink(e) {
    e?.preventDefault();
    let href = linking.href.trim();
    linking = null;
    if (!href) return doc.removeLink();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) href = /@/.test(href) && !/\//.test(href) ? `mailto:${href}` : `https://${href}`;
    doc.setLink(href);
  }
  function removeLink() {
    linking = null;
    doc.removeLink();
  }
  // the table button: a new table, or (in a table, in a Word document) its rows and columns
  function tableButton() {
    if (active.table && kind === 'docx') tableMenu = !tableMenu;
    else if (!active.table) {
      doc.insertTable();
      refresh();
    }
  }
  function tableAction(cmd) {
    tableMenu = false;
    run(cmd);
    refresh();
  }

  // ---------- the outline ----------
  async function toggleOutline() {
    settings = await writ.setSettings({ outline: !settings.outline });
  }

  // ---------- find ----------
  function openFind(replace = false) {
    menuOpen = false;
    finding = { replace, seed: doc.selectedText().slice(0, 80), at: Date.now() };
  }

  // ---------- keys ----------
  function key(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (asking || overwrite || switching) {
      if (e.key === 'Escape') overwrite ? overwriteAnswer('cancel') : switching ? (switching = null) : closeAnswer('cancel');
      return;
    }
    if (e.key === 'Escape' && (menuOpen || showSettings || showShortcuts || linking || finding || tableMenu)) {
      // one thing at a time: the topmost closes first
      if (menuOpen || showSettings || showShortcuts || linking || tableMenu) {
        menuOpen = showSettings = showShortcuts = tableMenu = false;
        linking = null;
      } else finding = null;
      doc?.focus();
      return;
    }
    if (!mod || e.defaultPrevented) return; // (keys the editor has already handled)
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (k === 'n') { e.preventDefault(); writ.newDoc(); }
    else if (k === 'o') { e.preventDefault(); writ.open(); }
    else if (k === 'w') { e.preventDefault(); writ.requestClose(); }
    else if (k === '=' || k === '+') { e.preventDefault(); zoom = Math.min(200, zoom + 10); }
    else if (k === '-') { e.preventDefault(); zoom = Math.max(50, zoom - 10); }
    else if (k === '0' && !e.altKey) { e.preventDefault(); zoom = 100; }
    else if (k === '\\') { e.preventDefault(); toggleOutline(); }
    else if (k === '/') { e.preventDefault(); openShortcuts(); }
    else if (k === 'f') { e.preventDefault(); openFind(false); }
    else if (k === 'h') { e.preventDefault(); openFind(true); }
    else if (k === 'm' && e.shiftKey) { e.preventDefault(); togglePlain(); }
    else if (k === 'm') { e.preventDefault(); toggleMode(); }
  }
  function wheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom = Math.max(50, Math.min(200, zoom + (e.deltaY < 0 ? 10 : -10)));
  }
  function drop(e) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    writ.dropFiles([...e.dataTransfer.files]);
  }
  // a click on the desk around the sheet puts the cursor in the document
  function deskClick(e) {
    if (e.target === desk || e.target.classList?.contains('sheet')) {
      e.preventDefault();
      const r = host.getBoundingClientRect();
      doc.focus(e.clientY > r.bottom ? 'end' : undefined);
    }
  }
  function menuItem(fn) {
    return () => {
      menuOpen = false;
      fn();
    };
  }
  function openShortcuts() {
    menuOpen = false;
    showSettings = false;
    showShortcuts = true;
  }
  function openSettings() {
    menuOpen = false;
    showShortcuts = false;
    showSettings = true;
  }
  const plural = (n, one, many) => `${n.toLocaleString('nb-NO')} ${n === 1 ? one : many}`;
  const list = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
  const NO_MD = 'Markdown has no underline';
</script>

<svelte:window onkeydown={key} onwheel={wheel} ondragover={(e) => e.preventDefault()} ondrop={drop} />

<div class="app">
  <header class="top">
    <span class="mark"><Mark size={18} /></span>
    <span class="name" title={path || 'Not saved yet'}>{name}{#if dirty}<span class="dot" title="Not saved">•</span>{/if}</span>
    {#if kind === 'md'}
      <button class="kind" class:on={plain} title={plain ? 'Showing the plain text of the file. Click (or Ctrl+Shift+M) to show it formatted again.' : 'Markdown mode: the text is the file, drawn as it reads. Click (or Ctrl+Shift+M) to see the plain text.'} onclick={togglePlain}>{plain ? 'Plain text' : 'Markdown'}</button>
    {/if}
    <span class="gap"></span>
    <button class="btn icon" class:on={settings.outline} title={settings.outline ? 'Hide the outline (Ctrl+\\)' : 'Show the outline (Ctrl+\\)'} aria-label="Outline" aria-pressed={settings.outline} onclick={toggleOutline}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7" /><path d="M9 4.5v15" stroke="currentColor" stroke-width="1.7" /><path d="M5.6 8.5h1.6M5.6 11.5h1.6M5.6 14.5h1.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
    <button class="btn icon" class:on={menuOpen} title="Menu" aria-label="Menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
      <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="18.5" cy="12" r="1.6" fill="currentColor" /></svg>
    </button>
  </header>

  <div class="tools" class:off={plain} role="toolbar" aria-label="Formatting">
    <select class="style" title="Paragraph style" aria-label="Paragraph style" value={active.style} disabled={plain} onchange={(e) => setStyle(e.currentTarget.value)}>
      <option value="p">Text</option>
      <option value="h1">Heading 1</option>
      <option value="h2">Heading 2</option>
      <option value="h3">Heading 3</option>
    </select>
    <span class="sep"></span>
    <button class="tool" class:on={active.bold} disabled={plain} title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={active.bold} onclick={() => run('bold')}><b>B</b></button>
    <button class="tool" class:on={active.italic} disabled={plain} title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={active.italic} onclick={() => run('italic')}><i class="serif">I</i></button>
    <button class="tool" class:on={active.underline} disabled={plain || active.underline === null} title={active.underline === null ? NO_MD : 'Underline (Ctrl+U)'} aria-label="Underline" aria-pressed={!!active.underline} onclick={() => run('underline')}><u>U</u></button>
    <button class="tool" class:on={active.strike} disabled={plain} title="Strikethrough (Ctrl+Shift+X)" aria-label="Strikethrough" aria-pressed={active.strike} onclick={() => run('strike')}><s>S</s></button>
    <span class="sep"></span>
    <button class="tool" class:on={active.bullet} disabled={plain} title="Bulleted list (Ctrl+Shift+8)" aria-label="Bulleted list" aria-pressed={active.bullet} onclick={() => run('bullet')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="7" r="1.5" fill="currentColor" /><circle cx="5.5" cy="12" r="1.5" fill="currentColor" /><circle cx="5.5" cy="17" r="1.5" fill="currentColor" /><path d="M10 7h10M10 12h10M10 17h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
    <button class="tool" class:on={active.ordered} disabled={plain} title="Numbered list (Ctrl+Shift+7)" aria-label="Numbered list" aria-pressed={active.ordered} onclick={() => run('ordered')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><text x="2.6" y="9.2" font-size="6.6" font-family="Inter Variable, sans-serif" font-weight="600" fill="currentColor">1</text><text x="2.6" y="14.7" font-size="6.6" font-family="Inter Variable, sans-serif" font-weight="600" fill="currentColor">2</text><text x="2.6" y="20.2" font-size="6.6" font-family="Inter Variable, sans-serif" font-weight="600" fill="currentColor">3</text><path d="M10 7h10M10 12.5h10M10 18h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
    <button class="tool" class:on={active.task} disabled={plain} title="Checklist (Ctrl+Shift+9)" aria-label="Checklist" aria-pressed={active.task} onclick={() => run('task')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4.5" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M4.9 7.6l1.3 1.3 2.2-2.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /><rect x="3.5" y="13.5" width="6" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M13 7.5h7.5M13 16.5h7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
    <button class="tool" class:on={active.quote} disabled={plain} title="Quote (Ctrl+Shift+B)" aria-label="Quote" aria-pressed={active.quote} onclick={() => run('quote')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.7" /><path d="M10 8h10M10 12h10M10 16h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
    <span class="sep"></span>
    <button class="tool" class:on={active.link} disabled={plain} title="Link (Ctrl+K)" aria-label="Link" aria-pressed={active.link} onclick={openLink}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M10.2 13.8a3.6 3.6 0 0 0 5.1 0l3.1-3.1a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1M13.8 10.2a3.6 3.6 0 0 0-5.1 0l-3.1 3.1a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
    <button class="tool" class:on={active.table} disabled={plain || (active.table && kind === 'md')} title={active.table ? (kind === 'md' ? 'In a table: its lines are shown while the cursor is in it' : 'Rows and columns') : 'Table'} aria-label="Table" aria-pressed={!!active.table} aria-expanded={tableMenu} onclick={tableButton}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14" stroke="currentColor" stroke-width="1.4" /></svg>
    </button>
    <span class="sep"></span>
    <button class="tool" disabled={!active.undo} title="Undo (Ctrl+Z)" aria-label="Undo" onclick={() => run('undo')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5L4.5 11 9 15.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /><path d="M5 11h9a5 5 0 0 1 0 10h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>
    <button class="tool" disabled={!active.redo} title="Redo (Ctrl+Y)" aria-label="Redo" onclick={() => run('redo')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /><path d="M19 11h-9a5 5 0 0 0 0 10h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" /></svg>
    </button>

    {#if linking}
      <form class="linkbox" onsubmit={applyLink}>
        <input placeholder="Link address, e.g. example.com" bind:value={linking.href} spellcheck="false" aria-label="Link address" />
        <button type="submit" class="btn small primary">{active.link ? 'Change' : 'Add link'}</button>
        {#if active.link}<button type="button" class="btn small" onclick={removeLink}>Remove</button>{/if}
      </form>
    {/if}
    {#if tableMenu}
      <button class="scrim" aria-label="Close the table menu" onclick={() => (tableMenu = false)}></button>
      <div class="menu tablemenu" role="menu">
        <button role="menuitem" onclick={() => tableAction('rowAbove')}>Add a row above</button>
        <button role="menuitem" onclick={() => tableAction('rowBelow')}>Add a row below</button>
        <button role="menuitem" onclick={() => tableAction('colLeft')}>Add a column to the left</button>
        <button role="menuitem" onclick={() => tableAction('colRight')}>Add a column to the right</button>
        <hr />
        <button role="menuitem" onclick={() => tableAction('headerRow')}>Header row</button>
        <hr />
        <button role="menuitem" onclick={() => tableAction('delRow')}>Delete the row</button>
        <button role="menuitem" onclick={() => tableAction('delCol')}>Delete the column</button>
        <button role="menuitem" onclick={() => tableAction('delTable')}>Delete the table</button>
      </div>
    {/if}
  </div>

  {#if menuOpen}
    <button class="scrim" aria-label="Close the menu" onclick={() => (menuOpen = false)}></button>
    <div class="menu" role="menu">
      <button role="menuitem" onclick={menuItem(() => writ.newDoc())}>New document <kbd>Ctrl+N</kbd></button>
      <button role="menuitem" onclick={menuItem(() => writ.open())}>Open… <kbd>Ctrl+O</kbd></button>
      <button role="menuitem" onclick={() => save(false)}>Save <kbd>Ctrl+S</kbd></button>
      <button role="menuitem" onclick={() => save(true)}>Save as… <kbd>Ctrl+Shift+S</kbd></button>
      {#if kind === 'md'}<button role="menuitem" onclick={exportDocx}>Export as a Word document…</button>{/if}
      <hr />
      <button role="menuitem" onclick={toggleMode}>Markdown mode <span class="tick">{kind === 'md' ? '✓' : ''}</span><kbd>Ctrl+M</kbd></button>
      {#if kind === 'md'}<button role="menuitem" onclick={togglePlain}>Show plain text <span class="tick">{plain ? '✓' : ''}</span><kbd>Ctrl+Shift+M</kbd></button>{/if}
      <button role="menuitem" onclick={menuItem(toggleOutline)}>Outline <span class="tick">{settings.outline ? '✓' : ''}</span><kbd>Ctrl+\</kbd></button>
      <hr />
      <button role="menuitem" onclick={() => openFind(false)}>Find <kbd>Ctrl+F</kbd></button>
      <button role="menuitem" onclick={() => openFind(true)}>Find and replace <kbd>Ctrl+H</kbd></button>
      {#if path}<button role="menuitem" onclick={menuItem(() => writ.showInFolder())}>Show in folder</button>{/if}
      <hr />
      <button role="menuitem" onclick={openShortcuts}>Keyboard shortcuts <kbd>Ctrl+/</kbd></button>
      <button role="menuitem" onclick={openSettings}>Settings</button>
    </div>
  {/if}

  {#if left.length && leftShown}
    <div class="notice">
      <span>This document has {list(left)}, which Writ can’t show yet. The file itself is untouched; saving over it would leave them out, so Save as keeps the original safe.</span>
      <button class="btn small" onclick={() => save(true)}>Save as a copy…</button>
      <button class="btn small" onclick={() => (leftShown = false)}>OK</button>
    </div>
  {/if}
  {#if disk}
    <div class="notice">
      <span>Another program changed this file. Your unsaved changes are still here.</span>
      <button class="btn small" onclick={keepTheirs}>Load theirs</button>
      <button class="btn small" onclick={() => (disk = null)}>Keep mine</button>
    </div>
  {/if}

  <div class="body">
    {#if settings.outline}
      <Outline {heads} {here} onjump={(pos) => doc.goTo(pos)} onfold={(pos) => (doc.toggleFold(pos), refresh())} onmove={(from, to) => (doc.moveSection(from, to), refresh())} />
    {/if}
    <div class="desk" bind:this={desk} onmousedown={deskClick} role="presentation">
      {#if finding}
        {#key finding.at}
          <FindBar {doc} replace={finding.replace} seed={finding.seed} onclose={() => ((finding = null), doc.focus())} />
        {/key}
      {/if}
      <div class="sheet" class:md={kind === 'md'} class:plain style:zoom={zoom / 100}>
        <div class="text" bind:this={host}></div>
      </div>
    </div>
  </div>

  <footer class="status">
    <span>{plural(count.words, 'word', 'words')}</span>
    {#if count.section != null}<span class="sep">·</span><span title="Words in the section the cursor is in, from its heading to the next heading of the same or a higher level">{plural(count.section, 'word', 'words')} in this section</span>{/if}
    {#if count.chosen}<span class="sep">·</span><span>{plural(count.chosen, 'word', 'words')} chosen</span>{/if}
    <span class="gap"></span>
    {#if zoom !== 100}<button class="zoom" title="Back to 100 % (Ctrl+0)" onclick={() => (zoom = 100)}>{zoom} %</button><span class="sep">·</span>{/if}
    {#if kind === 'md'}
      <span title="A Markdown document: the text is the file">Markdown</span><span class="sep">·</span>
      <span title="How the file's letters are stored">{form.encodingLabel}</span><span class="sep">·</span>
      <span title="How lines end in the file">{form.eolLabel}</span>
    {:else}
      <span title="A Word document">Word document</span>
    {/if}
  </footer>

  {#if toast}<div class="toast" role="status">{toast}</div>{/if}

  {#if switching}
    <div class="veil">
      <div class="dialog" role="alertdialog" aria-label="Change the kind of document">
        {#if switching.to === 'md'}
          <h2>{switching.saved ? 'Save as a Markdown document?' : 'Switch to Markdown mode?'}</h2>
          <p>
            {switching.saved ? `Writ saves “${name}” as a Markdown file (.md) and opens that in Markdown mode. The Word document stays as it is.` : 'The document becomes Markdown text, edited in Markdown mode.'}
            {#if switching.lost.length}Markdown can’t hold {list(switching.lost)}, so it will be left out.{/if}
            {#if switching.left.length}The Word file’s {list(switching.left)} weren’t brought into Writ, so they won’t come along either.{/if}
          </p>
        {:else}
          <h2>{switching.saved ? 'Save as a Word document?' : 'Leave Markdown mode?'}</h2>
          <p>{switching.saved ? `Writ saves “${name}” as a Word document (.docx) and opens that instead. The Markdown file stays as it is.` : 'The document becomes a Word document, edited in the document editor.'}</p>
        {/if}
        <div class="row">
          <button class="btn" onclick={() => (switching = null)}>Cancel</button>
          <span class="gap"></span>
          <button class="btn primary" onclick={() => switchNow(switching.to)}>{switching.saved ? (switching.to === 'md' ? 'Save as .md…' : 'Save as .docx…') : 'Switch'}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if overwrite}
    <div class="veil">
      <div class="dialog" role="alertdialog" aria-label="Save over the original">
        <h2>Save over “{name}”?</h2>
        <p>It has {list(left)}, which Writ couldn’t bring in. Saving over it leaves them out of the file for good. Saving a copy keeps the original as it is.</p>
        <div class="row">
          <button class="btn" onclick={() => overwriteAnswer('cancel')}>Cancel</button>
          <span class="gap"></span>
          <button class="btn" onclick={() => overwriteAnswer('over')}>Save over it</button>
          <button class="btn primary" onclick={() => overwriteAnswer('copy')}>Save a copy…</button>
        </div>
      </div>
    </div>
  {/if}

  {#if asking && !overwrite}
    <div class="veil">
      <div class="dialog" role="alertdialog" aria-label="Save changes">
        <h2>Save changes to “{name}”?</h2>
        <p>{path ? 'Your changes since it was last saved will be lost otherwise.' : 'This document hasn’t been saved anywhere yet.'}</p>
        <div class="row">
          <button class="btn" onclick={() => closeAnswer('cancel')}>Cancel</button>
          <span class="gap"></span>
          <button class="btn" onclick={() => closeAnswer('discard')}>Don’t save</button>
          <button class="btn primary" onclick={() => closeAnswer('save')}>Save</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showShortcuts}<Shortcuts onclose={() => ((showShortcuts = false), doc.focus())} />{/if}
  {#if showSettings}<Settings bind:settings {version} onclose={() => ((showSettings = false), doc.focus())} />{/if}
</div>

<style>
  .app {
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .top {
    flex: none;
    height: var(--topbar);
    display: flex;
    align-items: center;
    gap: 6px;
    /* room on the right for Windows' own minimise / maximise / close */
    padding: 0 148px 0 14px;
    -webkit-app-region: drag;
  }
  .top button {
    -webkit-app-region: no-drag;
  }
  .mark {
    display: grid;
    margin-right: 2px;
  }
  .name {
    font: 500 14px var(--font-title);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .dot {
    color: var(--accent);
    margin-left: 5px;
    font-size: 15px;
  }
  .gap {
    flex: 1;
  }
  .btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 7px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
  }
  .btn:hover,
  .btn.on {
    background: var(--surface-2);
    color: var(--ink);
  }
  .btn.icon {
    width: 32px;
    padding: 0;
    justify-content: center;
  }
  .btn.icon.on {
    color: var(--accent);
    background: none;
  }
  .btn.icon.on:hover {
    background: var(--surface-2);
  }
  .btn.small {
    height: 26px;
    font-size: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .btn.primary:hover {
    background: color-mix(in srgb, var(--accent) 88%, var(--ink));
    color: var(--accent-ink);
  }

  /* ---------- the toolbar ---------- */
  .tools {
    flex: none;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 42px;
    padding: 0 12px 4px;
    border-bottom: 1px solid var(--line);
  }
  .style {
    height: 30px;
    width: 116px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--surface);
    color: var(--ink);
    font: inherit;
    font-weight: 500;
  }
  .tools .sep {
    width: 1px;
    height: 18px;
    background: var(--line);
    margin: 0 7px;
  }
  .tool {
    width: 32px;
    height: 30px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 15px;
  }
  .tool b {
    font-weight: 700;
  }
  .tool .serif {
    font-family: var(--font-text);
    font-size: 16px;
  }
  .tool u,
  .tool s {
    font-weight: 500;
  }
  .tool:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--ink);
  }
  .tool.on,
  .tool.on:hover {
    color: var(--accent);
    background: var(--accent-soft);
  }
  .tool:disabled {
    opacity: 0.38;
  }
  .linkbox {
    position: absolute;
    top: 40px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 18;
    display: flex;
    gap: 6px;
    padding: 7px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
  }
  .linkbox input {
    width: 300px;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg);
    color: var(--ink);
    font: inherit;
  }

  .kind {
    -webkit-app-region: no-drag;
    font-size: 11px;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0 8px;
    line-height: 18px;
    margin-left: 4px;
  }
  .kind:hover,
  .kind.on {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  }
  .tablemenu {
    top: 38px;
    right: auto;
    left: 50%;
    transform: translateX(-50%);
    min-width: 220px;
    z-index: 21;
  }
  .tools .scrim {
    z-index: 20;
  }
  .tools.off .style {
    opacity: 0.45;
  }

  /* ---------- the menu ---------- */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 19;
    -webkit-app-region: no-drag;
  }
  .menu {
    position: absolute;
    top: calc(var(--topbar) - 2px);
    right: 148px;
    z-index: 20;
    min-width: 240px;
    padding: 5px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 6px 10px;
    border-radius: 6px;
    text-align: left;
  }
  .menu button:hover {
    background: var(--surface-2);
  }
  .menu kbd,
  .menu .tick {
    margin-left: auto;
    font: inherit;
    font-size: 11.5px;
    color: var(--faint);
  }
  .menu .tick + kbd {
    margin-left: 8px;
  }
  .menu .tick {
    color: var(--accent);
  }
  .menu hr {
    border: 0;
    border-top: 1px solid var(--line);
    margin: 4px 6px;
  }

  .notice {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px;
    background: var(--accent-soft);
    color: var(--ink);
    font-size: 12.5px;
    border-bottom: 1px solid var(--line);
  }
  .notice span {
    flex: 1;
  }

  /* ---------- the outline, the desk and the sheet ---------- */
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .desk {
    flex: 1;
    min-width: 0;
    overflow: auto;
    position: relative;
    padding: 28px 28px 22vh;
  }
  /* A4 (210 mm wide at 96 dpi: 794 px), with 2.5 cm margins, as the document prints */
  .sheet {
    width: 794px;
    min-height: 1123px;
    margin: 0 auto;
    padding: 94px 94px 120px;
    background: var(--paper);
    border-radius: 2px;
    box-shadow: var(--sheet-shadow);
    cursor: text;
  }
  .text {
    min-height: 900px;
  }
  .text :global(.ProseMirror) {
    min-height: 900px;
  }

  .status {
    flex: none;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 16px;
    font-size: 11.5px;
    color: var(--faint);
    font-variant-numeric: tabular-nums;
    border-top: 1px solid var(--line);
  }
  .status .sep {
    opacity: 0.6;
  }
  .zoom {
    color: var(--accent);
  }

  .toast {
    position: absolute;
    left: 50%;
    bottom: 42px;
    transform: translateX(-50%);
    z-index: 40;
    background: var(--ink);
    color: var(--bg);
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    box-shadow: var(--shadow);
    animation: rise 0.18s ease-out;
    white-space: nowrap;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }

  .veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    background: color-mix(in srgb, var(--bg) 55%, transparent);
    backdrop-filter: blur(1.5px);
    display: grid;
    place-items: center;
  }
  .dialog {
    width: min(440px, calc(100% - 40px));
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: var(--shadow);
    padding: 20px 20px 16px;
  }
  .dialog h2 {
    margin: 0 0 6px;
    font: 600 17px/1.3 var(--font-title);
    overflow-wrap: anywhere;
  }
  .dialog p {
    margin: 0 0 18px;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .dialog .btn {
    height: 32px;
    padding: 0 14px;
    border: 1px solid var(--line);
    color: var(--ink);
  }
  .dialog .btn.primary {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
</style>
