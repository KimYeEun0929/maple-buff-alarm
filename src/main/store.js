'use strict';

const Store = require('electron-store');
const { randomUUID } = require('crypto');

const DEFAULT_SETTINGS = {
  activeProfileId: null,
  ttsEnabled: true,
  ttsVolume: 1.0,
  ttsRate: 1.0,
  ttsPitch: 1.0,
  ttsVoiceURI: null, // null = 자동 (설치된 한국어 음성 중 첫 번째)
  groupWindowSec: 30,
  minAlertGapSec: 5,
  hotkeyHookEnabled: false,
  chatDetection: true, // 채팅 중에는 글자 키에 걸린 버프를 무시
  chatIdleTimeoutSec: 8,
  // 기본값을 비워 둔다. 게임에서 거의 모든 키를 쓰기 때문에,
  // 미리 정해둔 조합은 높은 확률로 게임 단축키와 충돌한다.
  appHotkeys: {
    resetAll: null,
    resetVolatile: null,
    muteToggle: null,
    toggleOverlay: null,
    detectionToggle: null,
  },
  overlay: {
    mode: 'list', // 'list' | 'compact'
    visible: true,
    locked: true, // 잠금 = 클릭 통과. 해제해야 드래그 이동 가능
    opacity: 0.92,
    scale: 1.0,
    x: null,
    y: null,
  },
};

const store = new Store({
  name: 'maple-buff-alarm',
  defaults: { profiles: [], settings: DEFAULT_SETTINGS },
});

/** 저장된 설정에 없는 키는 기본값으로 메운다 (버전 업 후에도 깨지지 않게). */
function getSettings() {
  const saved = store.get('settings') || {};
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    appHotkeys: { ...DEFAULT_SETTINGS.appHotkeys, ...(saved.appHotkeys || {}) },
    overlay: { ...DEFAULT_SETTINGS.overlay, ...(saved.overlay || {}) },
  };
}

function setSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch };
  // 중첩 객체는 통째로 덮어쓰지 않고 병합한다 — 한 키만 바꿔도 나머지가 사라지면 안 된다.
  if (patch.overlay) next.overlay = { ...current.overlay, ...patch.overlay };
  if (patch.appHotkeys) next.appHotkeys = { ...current.appHotkeys, ...patch.appHotkeys };
  store.set('settings', next);
  return next;
}

function getProfiles() {
  return store.get('profiles') || [];
}

function getProfile(id) {
  return getProfiles().find((p) => p.id === id) || null;
}

function getActiveProfile() {
  const { activeProfileId } = getSettings();
  return getProfile(activeProfileId) || getProfiles()[0] || null;
}

function saveProfile(profile) {
  const profiles = getProfiles();
  const i = profiles.findIndex((p) => p.id === profile.id);
  if (i === -1) profiles.push(profile);
  else profiles[i] = profile;
  store.set('profiles', profiles);
  return profile;
}

function createProfile({ name, job }) {
  const profile = {
    id: randomUUID(),
    name: name || '새 캐릭터',
    job: job || '',
    switchHotkey: null, // 게임 중 이 캐릭터로 전환하는 키
    buffs: [],
  };
  saveProfile(profile);
  return profile;
}

/**
 * 전역 버프 카탈로그가 없으므로, 복제가 새 캐릭터 등록의 주 경로다.
 * 버프 목록을 통째로 물려받고 지속시간·이름만 고치면 된다.
 */
function duplicateProfile(id) {
  const src = getProfile(id);
  if (!src) return null;
  const copy = {
    id: randomUUID(),
    name: `${src.name} 사본`,
    job: src.job,
    // 전환 단축키는 물려받지 않는다 — 같은 키에 두 캐릭터가 걸리면 하나는 안 먹는다.
    switchHotkey: null,
    buffs: src.buffs.map((b) => ({ ...b, id: randomUUID() })),
  };
  saveProfile(copy);
  return copy;
}

function deleteProfile(id) {
  store.set('profiles', getProfiles().filter((p) => p.id !== id));
  if (getSettings().activeProfileId === id) {
    setSettings({ activeProfileId: getProfiles()[0]?.id || null });
  }
}

function createBuff() {
  return {
    id: randomUUID(),
    name: '',
    durationSec: 180,
    hotkey: null, // M2에서 캡처
    preNoticeSec: 10,
    tts: '',
    volatile: false,
    enabled: true,
  };
}

/** 버프 이름 자동완성용 — 모든 프로필에서 이미 쓴 이름을 모은다. */
function knownBuffNames() {
  const names = new Set();
  for (const p of getProfiles()) {
    for (const b of p.buffs) if (b.name.trim()) names.add(b.name.trim());
  }
  return [...names].sort();
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
  getProfiles,
  getProfile,
  getActiveProfile,
  saveProfile,
  createProfile,
  duplicateProfile,
  deleteProfile,
  createBuff,
  knownBuffNames,
};
