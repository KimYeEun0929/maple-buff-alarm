'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

const store = require('./store');
const TimerCore = require('./timer-core');
const Notifier = require('./notifier');
const HotkeyHook = require('./hotkey-hook');
const ChatGuard = require('./chat-guard');
const AppTray = require('./tray');
const { findCollisions, describe } = require('./hotkey-match');

const core = new TimerCore();
const notifier = new Notifier(() => store.getSettings());
const guard = new ChatGuard(() => {
  const s = store.getSettings();
  return { enabled: s.chatDetection, idleTimeoutSec: s.chatIdleTimeoutSec };
});
const hook = new HotkeyHook({ guard });

let overlayWin = null;
let settingsWin = null;
let tray = null;

// 트레이가 앱의 수명을 쥔다. 이 값이 true 일 때만 창을 진짜로 닫는다.
let isQuitting = false;

// 오버레이 렌더러가 보고한 음성 목록. 설정 창 드롭다운에 쓴다.
let availableVoices = [];

// 조용 모드는 실행 중에만 유지한다. 껐다 켜면 다시 소리가 나야 한다.
let muted = false;

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

  // 창을 닫아도 앱은 트레이에 남는다. 사냥 중에 실수로 닫아 알림이 끊기면 안 된다.
  settingsWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    settingsWin.hide();
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

function openSettings() {
  if (!settingsWin || settingsWin.isDestroyed()) {
    createSettings();
    return;
  }
  if (!settingsWin.isVisible()) settingsWin.show();
  if (settingsWin.isMinimized()) settingsWin.restore();
  settingsWin.focus();
  pushSettingsData();
}

// ------------------------------------------------------------ state sync

function activeProfilePayload() {
  const profile = store.getActiveProfile();
  return {
    profileName: profile ? profile.name : null,
    profileJob: profile ? profile.job : '',
    buffs: core.snapshot(),
    settings: store.getSettings(),
    muted,
    guard: guard.state(),
  };
}

function pushOverlayState(snapshot) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const payload = activeProfilePayload();
  if (snapshot) payload.buffs = snapshot;
  overlayWin.webContents.send('overlay:state', payload);
}

function pushSettingsData() {
  if (tray) tray.refresh();
  if (!settingsWin || settingsWin.isDestroyed()) return;
  settingsWin.webContents.send('settings:data', settingsData());
}

function settingsData() {
  return {
    profiles: store.getProfiles(),
    settings: store.getSettings(),
    activeProfileId: store.getActiveProfile()?.id || null,
    knownBuffNames: store.knownBuffNames(),
    voices: availableVoices,
    runtime: core.snapshot(),
    hook: hook.state(),
    muted,
    guard: guard.state(),
    collisions: currentCollisions(),
  };
}

/**
 * 같은 키에 두 가지가 걸려 있으면 하나는 반드시 먹지 않는다.
 * 프로필 전환 키와 앱 단축키는 항상 살아 있고, 버프 키는 활성 캐릭터의 것만 살아 있다.
 */
function currentCollisions() {
  const settings = store.getSettings();
  const active = store.getActiveProfile();
  const entries = [];

  for (const [action, hotkey] of Object.entries(settings.appHotkeys)) {
    if (hotkey) entries.push({ hotkey, label: `앱 단축키: ${APP_ACTION_LABELS[action] || action}` });
  }
  for (const profile of store.getProfiles()) {
    if (profile.switchHotkey) {
      entries.push({ hotkey: profile.switchHotkey, label: `캐릭터 전환: ${profile.name}` });
    }
  }
  if (active) {
    for (const buff of active.buffs) {
      if (buff.hotkey && buff.enabled) {
        entries.push({ hotkey: buff.hotkey, label: `버프: ${buff.name || '(이름 없음)'}` });
      }
    }
  }

  return findCollisions(entries).map((c) => ({ ...c, label: describeSignature(entries, c) }));
}

const APP_ACTION_LABELS = {
  resetAll: '전체 리셋',
  resetVolatile: '소환수 리셋',
  muteToggle: '음소거',
  toggleOverlay: '오버레이 표시/숨김',
  detectionToggle: '감지 일시정지/재개',
};

function describeSignature(entries, collision) {
  const first = entries.find((e) => e.label === collision.labels[0]);
  return first ? describe(first.hotkey) : collision.signature;
}

/** 설정 창이 없어도(닫혔다 열려도) 목록이 유지되도록 메인에 들고 있는다. */
function speakOnOverlay(text) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const s = store.getSettings();
  overlayWin.webContents.send('overlay:announce', {
    text,
    volume: s.ttsVolume,
    rate: s.ttsRate,
    pitch: s.ttsPitch,
  });
}

/** 활성 프로필의 버프를 타이머 코어에 다시 싣는다. 실행 중이던 타이머는 초기화된다. */
function reloadActiveProfile() {
  const profile = store.getActiveProfile();
  notifier.clear();
  core.loadBuffs(profile ? profile.buffs : []);
  rebuildBindings();
  pushOverlayState();
  pushSettingsData();
}

/**
 * 후킹 매핑 테이블을 다시 만든다.
 * 프로필 전환 키와 앱 단축키는 항상 살아 있고, 버프 키는 활성 캐릭터의 것만 싣는다.
 */
function rebuildBindings() {
  const settings = store.getSettings();
  const active = store.getActiveProfile();
  const entries = [];

  for (const [action, hotkey] of Object.entries(settings.appHotkeys)) {
    if (hotkey) entries.push({ hotkey, type: 'app', payload: action });
  }
  for (const profile of store.getProfiles()) {
    if (profile.switchHotkey) {
      entries.push({ hotkey: profile.switchHotkey, type: 'profile', payload: profile.id });
    }
  }
  if (active) {
    for (const buff of active.buffs) {
      if (buff.hotkey && buff.enabled) {
        entries.push({ hotkey: buff.hotkey, type: 'buff', payload: buff.id });
      }
    }
  }

  hook.setBindings(entries);
}

function syncHookRunning() {
  const wanted = store.getSettings().hotkeyHookEnabled;
  if (wanted && hook.status !== 'running') hook.start();
  else if (!wanted && hook.status === 'running') hook.stop();
}

hook.on('trigger', ({ type, payload }) => {
  if (type === 'buff') {
    core.startBuff(payload);
    return;
  }
  if (type === 'profile') {
    if (payload === store.getActiveProfile()?.id) return;
    store.setSettings({ activeProfileId: payload });
    reloadActiveProfile();
    return;
  }
  if (type === 'app') runAppAction(payload);
});

function runAppAction(action) {
  switch (action) {
    case 'resetAll':
      notifier.clear();
      core.resetAll();
      break;
    case 'resetVolatile':
      core.resetVolatile();
      break;
    case 'muteToggle':
      muted = !muted;
      if (muted) notifier.clear();
      pushOverlayState();
      pushSettingsData();
      break;
    case 'toggleOverlay':
      store.setSettings({ overlay: { visible: !store.getSettings().overlay.visible } });
      pushOverlayState();
      pushSettingsData();
      break;
    case 'detectionToggle':
      guard.setManualPause(!guard.manualPause);
      pushOverlayState();
      pushSettingsData();
      break;
    default:
      break;
  }
}

hook.on('guardChanged', () => {
  pushOverlayState();
  pushSettingsData();
});

core.on('tick', (snapshot) => {
  // 채팅 상태로 잘못 잡혔을 때 화면 표시가 계속 남아 있으면 안 된다.
  if (guard.sweep()) pushSettingsData();
  pushOverlayState(snapshot);
  // 설정 창의 "남은시간" 칸도 살아 있어야 시작 버튼이 먹었는지 바로 확인된다.
  // 전체 데이터가 아니라 가벼운 스냅샷만 보낸다.
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:runtime', snapshot);
  }
});

core.on('due', (items) => {
  if (muted || !store.getSettings().ttsEnabled) return;
  // 곧 끝날 다른 버프도 같이 끌어와 한 번에 알린다. 안 그러면 버프 수만큼 알림이 늘어난다.
  const window = store.getSettings().groupWindowSec * 1000;
  notifier.enqueue(window > 0 ? [...items, ...core.pullForward(window)] : items);
});

notifier.on('announce', ({ text }) => speakOnOverlay(text));

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
  if (profile.id === store.getActiveProfile()?.id) {
    reloadActiveProfile();
  } else {
    // 비활성 캐릭터라도 전환 단축키는 항상 살아 있어야 한다.
    rebuildBindings();
    pushSettingsData();
  }
  return settingsData();
});

ipcMain.handle('buff:new', () => store.createBuff());

ipcMain.handle('settings:save', (_e, patch) => {
  const next = store.setSettings(patch);
  if (patch.overlay && 'locked' in patch.overlay) applyOverlayLock(next.overlay.locked);
  if (patch.appHotkeys) rebuildBindings();
  if ('hotkeyHookEnabled' in patch) syncHookRunning();
  pushOverlayState();
  pushSettingsData();
  return settingsData();
});

ipcMain.handle('hotkey:capture', async () => {
  try {
    return { hotkey: await hook.capture() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('hotkey:cancelCapture', () => hook.cancelCapture());

ipcMain.handle('data:export', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(settingsWin, {
    title: '설정 내보내기',
    defaultPath: `maple-buff-alarm-${stamp}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  try {
    fs.writeFileSync(filePath, JSON.stringify(store.exportData(), null, 2), 'utf8');
    return { path: filePath };
  } catch (err) {
    return { error: `저장하지 못했습니다: ${err.message}` };
  }
});

ipcMain.handle('data:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settingsWin, {
    title: '설정 가져오기',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };

  try {
    const raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    const summary = store.importData(raw);
    reloadActiveProfile();
    syncHookRunning();
    applyOverlayLock(store.getSettings().overlay.locked);
    pushOverlayState();
    return { summary };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('tts:voices', (_e, voices) => {
  availableVoices = Array.isArray(voices) ? voices : [];
  pushSettingsData();
});

// 음성을 고를 때 바로 들어보라고. 음성 알림이 꺼져 있어도 테스트는 재생한다.
ipcMain.on('tts:test', () => speakOnOverlay('이프리트, 소울애로우'));

ipcMain.on('buff:start', (_e, id) => core.startBuff(id));
ipcMain.on('buff:cancel', (_e, id) => core.cancelBuff(id));
ipcMain.on('buff:resetAll', () => runAppAction('resetAll'));
ipcMain.on('buff:resetVolatile', () => runAppAction('resetVolatile'));
ipcMain.on('app:action', (_e, action) => runAppAction(action));

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
  app.on('second-instance', () => openSettings());

  app.whenReady().then(() => {
    createOverlay();
    createSettings();

    tray = new AppTray({
      getState: () => ({
        profiles: store.getProfiles(),
        activeProfileId: store.getActiveProfile()?.id || null,
        muted,
        guard: guard.state(),
        overlayVisible: store.getSettings().overlay.visible,
        hookStatus: hook.status,
      }),
      openSettings,
      selectProfile: (id) => {
        store.setSettings({ activeProfileId: id });
        reloadActiveProfile();
      },
      runAction: (action) => runAppAction(action),
      quit: () => {
        isQuitting = true;
        app.quit();
      },
    });
    tray.build();

    reloadActiveProfile();
    syncHookRunning();
    core.run();
  });

  // 트레이에 상주하므로 창을 다 닫아도 종료하지 않는다.
  app.on('window-all-closed', () => {});

  app.on('before-quit', () => {
    isQuitting = true;
    core.stop();
    notifier.clear();
    hook.stop();
    if (tray) tray.destroy();
  });
}
