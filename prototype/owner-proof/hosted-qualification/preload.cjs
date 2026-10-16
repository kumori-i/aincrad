'use strict';
// Restricted Electron preload. No filesystem, shell, arbitrary IPC or lifecycle API.
const { contextBridge, ipcRenderer } = require('electron');
let submitted = false;
window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.send('qualification:preload', { sandboxed: process.sandboxed === true, contextIsolated: process.contextIsolated === true, type: process.type, pid: process.pid });
}, { once: true });
contextBridge.exposeInMainWorld('qualificationNative', Object.freeze({
  submit(value) { if (submitted) throw new Error('qualification-report-already-submitted'); submitted = true; return ipcRenderer.invoke('qualification:report', value); }
}));
