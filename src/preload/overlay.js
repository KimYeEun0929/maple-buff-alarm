'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onState: (fn) => ipcRenderer.on('overlay:state', (_e, payload) => fn(payload)),
  onAnnounce: (fn) => ipcRenderer.on('overlay:announce', (_e, payload) => fn(payload)),
  resize: (size) => ipcRenderer.send('overlay:resize', size),
  // 사용 가능한 음성 목록은 렌더러만 알 수 있으므로 메인으로 올려 설정 창에 전달한다.
  reportVoices: (voices) => ipcRenderer.send('tts:voices', voices),
});
