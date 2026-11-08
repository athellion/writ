// Writ: Bjørnar's own writing app. The main process: one window per document, reading and writing
// Word files (electron/docx-read.cjs, electron/docx-write.cjs), and asking before a document with
// unsaved changes is closed.
//
// Writ runs as one program however many documents are open: double-clicking another .docx (with
// "Open with → Writ") while Writ is running opens it in a new window of the same Writ. When the last
// window closes, Writ ends. Like Jot, it keeps nothing between runs: it opens blank and fresh.
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, shell, Menu, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDocx } = require('./docx-read.cjs');
const { writeDocx } = require('./docx-write.cjs');

const E2E = !!process.env.WRIT_E2E;
process.on('uncaughtException', (e) => log('error:', e.stack || e.message));
process.on('unhandledRejection', (e) => log('error:', (e && e.stack) || String(e)));
if (process.env.WRIT_USER_DATA) app.setPath('userData', process.env.WRIT_USER_DATA);
const isWin = process.platform === 'win32';
// The pure white flash Electron's windows can show when minimised and restored on Windows: drawing
// through Direct3D 9 stops it (found for Focal, FAMILY.md section 7).
if (isWin) app.commandLine.appendSwitch('use-angle', 'd3d9');

// ---------- a small diary (%APPDATA%\Writ\writ.log), for finding out what happened ----------
function log(...parts) {
  try {
    const line = `${new Date().toISOString()}  ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
    const f = path.join(app.getPath('userData'), 'writ.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, line);
  } catch {}
}

// ---------- settings (%APPDATA%\Writ\settings.json) ----------
const DEFAULTS = {
  theme: 'system', // system | light | dark
  outline: true, // the outline beside the page
  bounds: null, // where the last window was, for the next new one
  lastFolder: null,
};
let settings = { ...DEFAULTS };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
  nativeTheme.themeSource = settings.theme;
}
function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile() + '.tmp', JSON.stringify(settings, null, 2));
    fs.renameSync(settingsFile() + '.tmp', settingsFile());
  } catch (e) {
    log('settings not saved:', e.message);
  }
}
const publicSettings = () => ({ theme: settings.theme, outline: settings.outline, dark: nativeTheme.shouldUseDarkColors });

// ---------- the documents, one window each ----------
// id → { win, id, path, dirty, initial, savedHash, left, closing, watcher }
const docs = new Map();
const newId = () => crypto.randomBytes(6).toString('hex');
const nameOf = (d) => (d.path ? path.basename(d.path) : 'Untitled');
const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const isDocx = (f) => /\.docx$/i.test(f || '');

// the window's own colour before the page draws, and the colour of Windows' buttons in the title bar
function colours() {
  return nativeTheme.shouldUseDarkColors ? { bg: '#161213', symbol: '#ddd2cd' } : { bg: '#ece6e1', symbol: '#3d3532' };
}
const titleOf = (d) => `${d.dirty ? '• ' : ''}${nameOf(d)} — Writ`;

// Where a new window goes: a little below and to the right of the window in front, kept on screen.
function nextBounds() {
  const W = 1180, H = 860;
  const front = BrowserWindow.getFocusedWindow() || [...docs.values()].map((d) => d.win).filter((w) => w && !w.isDestroyed()).pop();
  let b = front ? front.getBounds() : settings.bounds || null;
  if (front) b = { ...b, x: b.x + 28, y: b.y + 28 };
  const area = screen.getDisplayMatching(b || { x: 0, y: 0, width: W, height: H }).workArea;
  if (!b) b = { width: Math.min(W, area.width), height: Math.min(H, area.height), x: 0, y: 0 };
  if (!front && !settings.bounds) {
    b.x = Math.round(area.x + (area.width - b.width) / 2);
    b.y = Math.round(area.y + (area.height - b.height) / 2);
  }
  b.width = Math.min(b.width, area.width);
  b.height = Math.min(b.height, area.height);
  if (b.x + b.width > area.x + area.width || b.y + b.height > area.y + area.height || b.x < area.x || b.y < area.y) {
    b.x = area.x + 40;
    b.y = area.y + 40;
  }
  return b;
}

async function readFile(file) {
  const buf = fs.readFileSync(file);
  const got = await readDocx(buf);
  return { ...got, hash: hash(buf) };
}

// Opens a window for a document: { file } to open a .docx, or nothing for a new, empty one.
async function openDoc({ file = null } = {}) {
  if (file) {
    const open = [...docs.values()].find((d) => d.path && path.resolve(d.path).toLowerCase() === path.resolve(file).toLowerCase());
    if (open) {
      if (open.win.isMinimized()) open.win.restore();
      open.win.show();
      open.win.focus();
      return open;
    }
  }
  const d = { id: newId(), path: file || null, dirty: false, initial: { html: '' }, left: [] };
  if (file) {
    if (!isDocx(file)) {
      dialog.showMessageBox({ type: 'info', message: `Writ opens Word documents (.docx).`, detail: `${path.basename(file)} isn't one.`, buttons: ['OK'] });
      return null;
    }
    try {
      const got = await readFile(file);
      d.initial = { html: got.html };
      d.left = got.left;
      d.savedHash = got.hash;
    } catch (e) {
      log('could not open', file, e.message);
      dialog.showMessageBox({ type: 'warning', message: `${path.basename(file)} couldn't be opened.`, detail: e.message, buttons: ['OK'] });
      return null;
    }
  }
  const b = nextBounds();
  const c = colours();
  d.win = new BrowserWindow({
    ...b,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: titleOf(d),
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: c.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: c.symbol, height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  d.win.docId = d.id;
  docs.set(d.id, d);
  // Shown as soon as the page has drawn; and in any case once it has loaded, or after a few seconds,
  // so a window never stays hidden (on his PC Electron's "drawn" signal sometimes never comes; Jot 0.9.1).
  const reveal = (why) => {
    if (d.win.isDestroyed() || d.shown) return;
    d.shown = true;
    d.win.show();
    log('window shown', `(${why})`);
  };
  d.win.once('ready-to-show', () => reveal('drawn'));
  d.win.webContents.once('did-finish-load', () => setTimeout(() => reveal('loaded'), 300));
  setTimeout(() => reveal('waited'), 4000);
  d.win.webContents.on('render-process-gone', (_e, x) => log('page stopped', x.reason, x.exitCode));
  d.win.webContents.on('preload-error', (_e, p, err) => log('preload error', err.message));
  d.win.webContents.on('console-message', (_e, level, message) => level >= 2 && log('page says:', message));
  d.win.on('page-title-updated', (e) => e.preventDefault());
  d.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  d.win.webContents.on('will-navigate', (e) => e.preventDefault());
  d.win.webContents.on('context-menu', (_e, p) => contextMenu(d, p));
  d.win.on('close', (e) => {
    if (quitting || d.closing) return;
    if (d.dirty) {
      e.preventDefault();
      d.win.webContents.send('doc:ask-close');
    }
  });
  d.win.on('closed', () => {
    unwatch(d);
    docs.delete(d.id);
  });
  for (const ev of ['move', 'resize']) d.win.on(ev, () => (settings.bounds = d.win.getBounds()));
  if (process.env.WRIT_DEV_URL) d.win.loadURL(process.env.WRIT_DEV_URL);
  else d.win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  watch(d);
  log('opened', d.path || '(new document)', d.left.length ? { left: d.left } : '');
  return d;
}

function docOf(e) {
  const w = BrowserWindow.fromWebContents(e.sender);
  return w ? docs.get(w.docId) : null;
}
function refreshTitle(d) {
  if (d.win && !d.win.isDestroyed()) d.win.setTitle(titleOf(d));
}

// ---------- the file changing on disk while it's open ----------
function watch(d) {
  unwatch(d);
  if (!d.path) return;
  try {
    d.watcher = fs.watch(d.path, () => {
      clearTimeout(d.watchTimer);
      d.watchTimer = setTimeout(() => changedOnDisk(d), 400);
    });
    d.watcher.on('error', () => {});
  } catch {}
}
function unwatch(d) {
  try {
    d.watcher?.close();
  } catch {}
  d.watcher = null;
}
async function changedOnDisk(d) {
  if (!d.path || !d.win || d.win.isDestroyed()) return;
  let got;
  try {
    const buf = fs.readFileSync(d.path);
    if (hash(buf) === d.savedHash) return; // our own save
    got = await readDocx(buf);
    got.hash = hash(buf);
  } catch {
    return; // (gone, or being written; a later change will tell)
  }
  d.savedHash = got.hash;
  d.left = got.left;
  d.win.webContents.send('doc:disk', { html: got.html, left: got.left, replace: !d.dirty });
}

// ---------- talking to the page ----------
ipcMain.handle('doc:init', (e) => {
  const d = docOf(e);
  if (!d) return null;
  return { id: d.id, path: d.path, name: nameOf(d), html: d.initial.html, left: d.left, settings: publicSettings(), version: app.getVersion() };
});

ipcMain.on('doc:changed', (e, dirty) => {
  const d = docOf(e);
  if (!d || d.dirty === dirty) return;
  d.dirty = dirty;
  refreshTitle(d);
});

function suggestName(title) {
  return String(title || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').slice(0, 60).trim() || 'Untitled';
}

// Saves the document as a .docx. "as" (Save as…, or a document without a file yet) asks where.
// `title`: the document's first heading or line, for the suggested file name.
ipcMain.handle('doc:save', async (e, { json, as, title }) => {
  const d = docOf(e);
  if (!d) return { ok: false };
  let file = d.path;
  if (!file || as) {
    const base = d.path ? path.basename(d.path, path.extname(d.path)) + (as ? ' (copy)' : '') : suggestName(title);
    const dir = d.path ? path.dirname(d.path) : settings.lastFolder || app.getPath('documents');
    const r = E2E && process.env.WRIT_SAVE_AS
      ? { canceled: false, filePath: path.join(process.env.WRIT_SAVE_AS, `${base}.docx`) }
      : await dialog.showSaveDialog(d.win, { title: as ? 'Save as' : 'Save', defaultPath: path.join(dir, `${base}.docx`), filters: [{ name: 'Word document', extensions: ['docx'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    file = isDocx(r.filePath) ? r.filePath : `${r.filePath}.docx`;
  }
  try {
    const bytes = await writeDocx(json, { title });
    writeSafely(file, bytes);
    const elsewhere = !d.path || path.resolve(d.path) !== path.resolve(file);
    d.path = file;
    d.savedHash = hash(bytes);
    d.dirty = false;
    // what couldn't be brought in belongs to the original file; a file written by Writ has everything
    d.left = [];
    settings.lastFolder = path.dirname(file);
    saveSettings();
    refreshTitle(d);
    watch(d);
    log('saved', file, elsewhere ? '(new place)' : '');
    return { ok: true, path: file, name: nameOf(d) };
  } catch (err) {
    log('save failed', file, err.message);
    const busy = err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES';
    return { ok: false, error: busy ? 'the file is open in another program (Word?), or Writ isn’t allowed to write there.' : err.message };
  }
});

// Written whole to a temporary file beside it and then put in place, so a failed save never leaves a
// half-written document. (Where that isn't allowed, it's written directly.)
function writeSafely(file, bytes) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.writ-${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    if (e.code === 'ENOENT') throw e;
    fs.writeFileSync(file, bytes);
  }
}

ipcMain.on('doc:close', (e) => {
  const d = docOf(e);
  if (!d) return;
  d.closing = true;
  d.win.close();
  if (shuttingDown) askNextUnsaved();
});
// "Cancel" when asked about unsaved changes: the person kept the document, so a shutdown that was
// waiting for it was called off (Windows shows its own "cancel" for that), and nothing more is asked.
ipcMain.on('doc:kept', () => (shuttingDown = false));
ipcMain.on('doc:request-close', (e) => docOf(e)?.win.close());
ipcMain.on('doc:new', () => openDoc());

ipcMain.handle('doc:open', async (e) => {
  const d = docOf(e);
  const r = E2E && process.env.WRIT_OPEN
    ? { canceled: false, filePaths: process.env.WRIT_OPEN.split('|') }
    : await dialog.showOpenDialog(d?.win, {
        title: 'Open',
        defaultPath: d?.path ? path.dirname(d.path) : settings.lastFolder || app.getPath('documents'),
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Word documents', extensions: ['docx'] }],
      });
  if (r.canceled) return false;
  await openFiles(r.filePaths, d);
  return true;
});
ipcMain.on('doc:drop', (e, files) => openFiles(files, docOf(e)));

// Opens files; the first goes into this window if it's an empty, untouched new document.
async function openFiles(files, here) {
  for (const f of files) {
    if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
    const blank = here && !here.path && !here.dirty && !here.touched;
    if (blank) {
      const old = here;
      here = null;
      const d = await openDoc({ file: f });
      if (d && d !== old && !old.win.isDestroyed()) {
        d.win.setBounds(old.win.getBounds());
        old.closing = true;
        d.win.once('show', () => !old.win.isDestroyed() && old.win.close());
      }
    } else await openDoc({ file: f });
  }
}
// the page says when an untitled document has been typed in (so dropping a file opens a new window)
ipcMain.on('doc:touched', (e) => {
  const d = docOf(e);
  if (d) d.touched = true;
});

ipcMain.handle('doc:showInFolder', (e) => {
  const d = docOf(e);
  if (d?.path) shell.showItemInFolder(d.path);
});

// links open in the browser (only web and mail links)
ipcMain.handle('link:open', (_e, href) => {
  if (/^(https?:|mailto:)/i.test(String(href))) shell.openExternal(href);
});

ipcMain.handle('settings:set', (_e, patch) => {
  for (const k of ['theme', 'outline']) if (k in patch) settings[k] = patch[k];
  nativeTheme.themeSource = settings.theme;
  saveSettings();
  for (const d of docs.values()) if (d.win && !d.win.isDestroyed()) d.win.webContents.send('settings', publicSettings());
  return publicSettings();
});

nativeTheme.on('updated', () => {
  const c = colours();
  for (const d of docs.values()) {
    if (!d.win || d.win.isDestroyed()) continue;
    if (isWin) d.win.setTitleBarOverlay({ color: '#00000000', symbolColor: c.symbol, height: 40 });
    d.win.setBackgroundColor(c.bg);
    d.win.webContents.send('settings', publicSettings());
  }
});

// ---------- the right-click menu: the usual ----------
function contextMenu(d, p) {
  const f = p.editFlags;
  Menu.buildFromTemplate([
    { label: 'Cut', role: 'cut', enabled: f.canCut },
    { label: 'Copy', role: 'copy', enabled: f.canCopy },
    { label: 'Paste', role: 'paste', enabled: f.canPaste },
    { label: 'Paste as plain text', role: 'pasteAndMatchStyle', enabled: f.canPaste },
    { type: 'separator' },
    { label: 'Select all', role: 'selectAll' },
  ]).popup({ window: d.win });
}

// ---------- starting, and being started again ----------
function filesIn(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && a !== '.' && fs.existsSync(a) && fs.statSync(a).isFile() && path.resolve(a) !== path.resolve(__dirname, '..') && !/\.(exe|asar)$/i.test(a));
}

let quitting = false;
let shuttingDown = false;
app.on('before-quit', () => (quitting = true));
// Windows signing out or shutting down while a document is unsaved: Writ holds the shutdown (Windows
// shows "Writ is preventing shutdown") and asks about each unsaved document in turn.
function askNextUnsaved() {
  const d = [...docs.values()].find((x) => x.dirty && !x.closing && x.win && !x.win.isDestroyed());
  if (!d) return;
  if (d.win.isMinimized()) d.win.restore();
  d.win.show();
  d.win.focus();
  d.win.webContents.send('doc:ask-close');
}
app.on('query-session-end', (e) => {
  if (![...docs.values()].some((d) => d.dirty)) return;
  e.preventDefault();
  shuttingDown = true;
  log('Windows is ending; asking about unsaved documents first');
  askNextUnsaved();
});
app.on('window-all-closed', () => app.quit());

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = filesIn(argv);
    log('opened again with', files.length ? files : '(nothing)');
    if (files.length) openFiles(files, null);
    else openDoc();
  });
  app.setAppUserModelId('no.bjornar.writ');
  Menu.setApplicationMenu(null);
  app.whenReady().then(async () => {
    loadSettings();
    log('starting', app.getVersion(), process.argv.slice(1));
    const files = filesIn(process.argv);
    for (const f of files) await openDoc({ file: f });
    if (!docs.size) await openDoc();
    if (E2E) {
      globalThis.writ = {
        docs: () => [...docs.values()].map((d) => ({ id: d.id, path: d.path, dirty: d.dirty, title: d.win?.getTitle(), left: d.left })),
        open: async (f) => (await openDoc({ file: f }))?.id,
        newDoc: async () => (await openDoc()).id,
        win: (id) => docs.get(id)?.win,
        settings: () => settings,
        shutdown: () => {
          const ev = { prevented: false, preventDefault() { this.prevented = true; } };
          app.emit('query-session-end', ev);
          return ev.prevented;
        },
      };
    }
  });
}
