// The page's only way to the rest of Writ (window.writ).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.off(channel, h);
};

contextBridge.exposeInMainWorld('writ', {
  init: () => ipcRenderer.invoke('doc:init'),
  changed: (dirty) => ipcRenderer.send('doc:changed', dirty),
  touched: () => ipcRenderer.send('doc:touched'),
  save: (json, as = false, title = '') => ipcRenderer.invoke('doc:save', { json, as, title }),
  close: () => ipcRenderer.send('doc:close'),
  kept: () => ipcRenderer.send('doc:kept'),
  requestClose: () => ipcRenderer.send('doc:request-close'),
  newDoc: () => ipcRenderer.send('doc:new'),
  open: () => ipcRenderer.invoke('doc:open'),
  showInFolder: () => ipcRenderer.invoke('doc:showInFolder'),
  openLink: (href) => ipcRenderer.invoke('link:open', href),
  dropFiles: (files) => ipcRenderer.send('doc:drop', files.map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onAskClose: on('doc:ask-close'),
  onDisk: on('doc:disk'),
  onSettings: on('settings'),
});
