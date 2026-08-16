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
  hotkeyHookEnabled: false, // M2에서 사용
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
    overlay: { ...DEFAULT_SETTINGS.overlay, ...(saved.overlay || {}) },
  };
}

function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  if (patch.overlay) next.overlay = { ...getSettings().overlay, ...patch.overlay };
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
  const profile = { id: randomUUID(), name: name || '새 캐릭터', job: job || '', buffs: [] };
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
