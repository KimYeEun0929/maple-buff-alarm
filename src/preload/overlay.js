'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, payload) => fn(payload)),
  onAnnounce: (fn) => ipcRenderer.on('overlay:announce', (_e, payload) => fn(payload)),
  resize: (size) => ipcRenderer.send('overlay:resize', size),
});
