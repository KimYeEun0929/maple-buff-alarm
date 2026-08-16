'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  onData: (fn) => ipcRenderer.on('settings:data', (_e, payload) => fn(payload)),
  onRuntime: (fn) => ipcRenderer.on('settings:runtime', (_e, snapshot) => fn(snapshot)),

  createProfile: (payload) => ipcRenderer.invoke('profile:create', payload),
  duplicateProfile: (id) => ipcRenderer.invoke('profile:duplicate', id),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  selectProfile: (id) => ipcRenderer.invoke('profile:select', id),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),

  newBuff: () => ipcRenderer.invoke('buff:new'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  testVoice: () => ipcRenderer.send('tts:test'),

  captureHotkey: () => ipcRenderer.invoke('hotkey:capture'),
  cancelCapture: () => ipcRenderer.send('hotkey:cancelCapture'),
  appAction: (action) => ipcRenderer.send('app:action', action),

  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),

  startBuff: (id) => ipcRenderer.send('buff:start', id),
  cancelBuff: (id) => ipcRenderer.send('buff:cancel', id),
  resetAll: () => ipcRenderer.send('buff:resetAll'),
  resetVolatile: () => ipcRenderer.send('buff:resetVolatile'),
});
