'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');

const store = require('./store');
const TimerCore = require('./timer-core');
const Notifier = require('./notifier');

const core = new TimerCore();
const notifier = new Notifier(() => store.getSettings());

let overlayWin = null;
let settingsWin = null;

// ---------------------------------------------------------------- windows

function createOverlay() {
  const s = store.getSettings();

  overlayWin = new BrowserWindow({
    width: 340,
    height: 240,
    x: s.overlay.x ?? undefined,
    y: s.overlay.y ?? undefined,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 게임이 창모드여도 확실히 위에 오도록 가장 높은 레벨을 쓴다.
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'index.html'));

  overlayWin.once('ready-to-show', () => {
    overlayWin.show();
    applyOverlayLock(store.getSettings().overlay.locked);
    pushOverlayState();
  });

  overlayWin.on('moved', () => {
    if (!overlayWin) return;
    const [x, y] = overlayWin.getPosition();
    store.setSettings({ overlay: { x, y } });
  });

  overlayWin.on('closed', () => {
    overlayWin = null;
  });
}

/**
 * 잠금 상태에서는 클릭이 뒤(게임)로 통과한다.
 * 이게 오버레이가 게임 포커스를 훔치지 않는 유일한 이유이기도 하다.
 */
function applyOverlayLock(locked) {
  if (!overlayWin) return;
  overlayWin.setIgnoreMouseEvents(!!locked, { forward: true });
}

function createSettings() {
  settingsWin = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    title: '메이플랜드 버프 알람',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'index.html'));

  // M1에는 트레이가 없으므로(M3 예정) 설정 창이 앱의 수명을 쥔다.
  // 게임 중에는 닫지 말고 최소화해 두면 된다.
  settingsWin.on('closed', () => {
    settingsWin = null;
    app.quit();
  });
}

// ------------------------------------------------------------ state sync

function activeProfilePayload() {
  const profile = store.getActiveProfile();
  return {
    profileName: profile ? profile.name : null,
    profileJob: profile ? profile.job : '',
    buffs: core.snapshot(),
    settings: store.getSettings(),
  };
}

function pushOverlayState(snapshot) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const payload = activeProfilePayload();
  if (snapshot) payload.buffs = snapshot;
  overlayWin.webContents.send('overlay:state', payload);
}

function pushSettingsData() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  settingsWin.webContents.send('settings:data', settingsData());
}

function settingsData() {
  return {
    profiles: store.getProfiles(),
    settings: store.getSettings(),
    activeProfileId: store.getActiveProfile()?.id || null,
    knownBuffNames: store.knownBuffNames(),
    runtime: core.snapshot(),
  };
}

/** 활성 프로필의 버프를 타이머 코어에 다시 싣는다. 실행 중이던 타이머는 초기화된다. */
function reloadActiveProfile() {
  const profile = store.getActiveProfile();
  notifier.clear();
  core.loadBuffs(profile ? profile.buffs : []);
  pushOverlayState();
  pushSettingsData();
}

core.on('tick', (snapshot) => {
  pushOverlayState(snapshot);
  // 설정 창의 "남은시간" 칸도 살아 있어야 시작 버튼이 먹었는지 바로 확인된다.
  // 전체 데이터가 아니라 가벼운 스냅샷만 보낸다.
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:runtime', snapshot);
  }
});

core.on('due', (items) => {
  const { ttsEnabled } = store.getSettings();
  if (!ttsEnabled) return;
  notifier.enqueue(items);
});

notifier.on('announce', ({ text }) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const s = store.getSettings();
  overlayWin.webContents.send('overlay:announce', {
    text,
    volume: s.ttsVolume,
    rate: s.ttsRate,
  });
});

// -------------------------------------------------------------------- IPC

ipcMain.handle('data:get', () => settingsData());

ipcMain.handle('profile:create', (_e, payload) => {
  const profile = store.createProfile(payload || {});
  if (!store.getSettings().activeProfileId) {
    store.setSettings({ activeProfileId: profile.id });
  }
  reloadActiveProfile();
  return settingsData();
});

ipcMain.handle('profile:duplicate', (_e, id) => {
  store.duplicateProfile(id);
  pushSettingsData();
  return settingsData();
});

ipcMain.handle('profile:delete', (_e, id) => {
  store.deleteProfile(id);
  reloadActiveProfile();
  return settingsData();
});

ipcMain.handle('profile:select', (_e, id) => {
  store.setSettings({ activeProfileId: id });
  reloadActiveProfile();
  return settingsData();
});

ipcMain.handle('profile:save', (_e, profile) => {
  store.saveProfile(profile);
  // 편집한 프로필이 활성 프로필이면 타이머 코어를 다시 싣는다.
  if (profile.id === store.getActiveProfile()?.id) reloadActiveProfile();
  else pushSettingsData();
  return settingsData();
});

ipcMain.handle('buff:new', () => store.createBuff());

ipcMain.handle('settings:save', (_e, patch) => {
  const next = store.setSettings(patch);
  if (patch.overlay && 'locked' in patch.overlay) applyOverlayLock(next.overlay.locked);
  pushOverlayState();
  pushSettingsData();
  return settingsData();
});

ipcMain.on('buff:start', (_e, id) => core.startBuff(id));
ipcMain.on('buff:cancel', (_e, id) => core.cancelBuff(id));
ipcMain.on('buff:resetAll', () => {
  notifier.clear();
  core.resetAll();
});
ipcMain.on('buff:resetVolatile', () => core.resetVolatile());

ipcMain.on('overlay:resize', (_e, { width, height }) => {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const [x, y] = overlayWin.getPosition();
  overlayWin.setBounds({
    x,
    y,
    width: Math.max(160, Math.round(width)),
    height: Math.max(40, Math.round(height)),
  });
});

// ------------------------------------------------------------- lifecycle

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (settingsWin) {
      if (settingsWin.isMinimized()) settingsWin.restore();
      settingsWin.focus();
    }
  });

  app.whenReady().then(() => {
    createOverlay();
    createSettings();
    reloadActiveProfile();
    core.run();
  });

  // M1에는 트레이가 없다(M3 예정). 설정 창을 닫으면 앱이 종료된다.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', () => {
    core.stop();
    notifier.clear();
  });
}
