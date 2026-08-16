'use strict';

const $ = (sel) => document.querySelector(sel);

let data = null; // { profiles, settings, activeProfileId, knownBuffNames }
let runtime = []; // 타이머 코어 스냅샷 (200ms마다 갱신)
let tableKey = ''; // 표를 다시 그려야 하는지 판단하는 구조 서명

// -------------------------------------------------------------- 유틸

function activeProfile() {
  if (!data) return null;
  return data.profiles.find((p) => p.id === data.activeProfileId) || null;
}

/**
 * 입력 중에 표가 통째로 다시 그려지면 포커스가 날아간다.
 * 그래서 "행 구성이 바뀌었을 때"만 다시 그리도록 서명을 비교한다.
 */
function structureKey(d) {
  return JSON.stringify([
    d.activeProfileId,
    d.profiles.map((p) => [p.id, p.buffs.map((b) => b.id)]),
  ]);
}

function apply(next) {
  data = next;
  const key = structureKey(next);
  const rebuild = key !== tableKey;
  tableKey = key;

  renderHeader();
  renderPrefs();
  renderNameList();
  renderCollisions();
  renderAppHotkeys();
  if (rebuild) {
    renderProfileTable();
    renderBuffTable();
  } else {
    refreshHotkeyLabels();
  }
  renderRuntime();
}

// ------------------------------------------------------------ 단축키 등록

/**
 * 키 캡처는 후킹 스트림에서 받는다. 설정 창 DOM 이벤트로 받으면
 * 실제 후킹이 쓰는 keycode 와 다른 값이 되어 게임에서 안 먹는다.
 */
async function captureInto(btn, onCaptured) {
  const original = btn.textContent;
  btn.textContent = '키를 누르세요…';
  btn.classList.add('capturing');
  try {
    const res = await window.api.captureHotkey();
    if (res.error) {
      alert(res.error);
      return;
    }
    if (res.hotkey) await onCaptured(res.hotkey);
  } finally {
    btn.textContent = original;
    btn.classList.remove('capturing');
  }
}

/** [ 등록된 키 | 등록 | 해제 ] 한 묶음. */
function hotkeyCell(hotkey, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'hotkey-cell';

  const label = document.createElement('code');
  label.className = 'hotkey-label';
  label.textContent = hotkey ? hotkey.label : '미등록';
  if (!hotkey) label.classList.add('none');

  const set = button('등록', () =>
    captureInto(set, async (hk) => {
      label.textContent = hk.label;
      label.classList.remove('none');
      await onChange(hk);
    })
  );

  const clear = button('해제', async () => {
    label.textContent = '미등록';
    label.classList.add('none');
    await onChange(null);
  });

  wrap.append(label, set, clear);
  return wrap;
}

/** 표를 다시 그리지 않는 갱신 경로에서도 라벨은 최신으로 맞춘다. */
function refreshHotkeyLabels() {
  const profile = activeProfile();
  if (!profile) return;
  for (const tr of document.querySelectorAll('#buff-table tbody tr')) {
    const buff = profile.buffs.find((b) => b.id === tr.dataset.buffId);
    const label = tr.querySelector('.hotkey-label');
    if (!buff || !label) continue;
    label.textContent = buff.hotkey ? buff.hotkey.label : '미등록';
    label.classList.toggle('none', !buff.hotkey);
  }
}

function renderCollisions() {
  const box = $('#collisions');
  const list = data.collisions || [];
  box.hidden = list.length === 0;
  if (list.length === 0) return;
  box.innerHTML =
    '<b>같은 키에 두 개 이상이 걸려 있습니다.</b> 하나는 반드시 먹지 않습니다.<br>' +
    list
      .map((c) => `<code>${c.label}</code> → ${c.labels.join(' / ')}`)
      .join('<br>');
}

const APP_ACTIONS = [
  ['resetAll', '전체 리셋 (사망 등으로 버프가 다 날아갔을 때)'],
  ['resetVolatile', '소환수 리셋 (맵/채널 이동 후)'],
  ['muteToggle', '음소거 켜기/끄기'],
  ['toggleOverlay', '오버레이 표시/숨김'],
  ['detectionToggle', '감지 일시정지/재개 (인벤 정리 등 오래 조작할 때)'],
];

function renderAppHotkeys() {
  const tbody = $('#app-hotkey-table tbody');
  tbody.innerHTML = '';
  for (const [action, label] of APP_ACTIONS) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = label;
    const keyTd = document.createElement('td');
    keyTd.appendChild(
      hotkeyCell(data.settings.appHotkeys[action], async (hk) =>
        apply(await window.api.saveSettings({ appHotkeys: { [action]: hk } }))
      )
    );
    tr.append(nameTd, keyTd);
    tbody.appendChild(tr);
  }
}

// ------------------------------------------------------------ 헤더/탭

function renderHeader() {
  const sel = $('#active-profile');
  sel.innerHTML = '';
  if (data.profiles.length === 0) {
    sel.innerHTML = '<option value="">— 없음 —</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const p of data.profiles) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.job ? `${p.name} (${p.job})` : p.name;
    if (p.id === data.activeProfileId) opt.selected = true;
    sel.appendChild(opt);
  }
}

$('#active-profile').addEventListener('change', async (e) => {
  apply(await window.api.selectProfile(e.target.value));
});

for (const btn of document.querySelectorAll('.tabs button')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b === btn);
    for (const name of ['chars', 'buffs', 'prefs']) {
      $(`#tab-${name}`).hidden = name !== btn.dataset.tab;
    }
  });
}

$('#reset-all').addEventListener('click', () => window.api.resetAll());
$('#reset-volatile').addEventListener('click', () => window.api.resetVolatile());

// -------------------------------------------------------------- 캐릭터

$('#add-profile').addEventListener('click', async () => {
  apply(await window.api.createProfile({ name: `캐릭터 ${data.profiles.length + 1}` }));
});

function renderProfileTable() {
  const tbody = $('#profile-table tbody');
  tbody.innerHTML = '';
  $('#profile-empty').classList.toggle('show', data.profiles.length === 0);
  $('#profile-table').hidden = data.profiles.length === 0;

  for (const profile of data.profiles) {
    const tr = document.createElement('tr');
    if (profile.id === data.activeProfileId) tr.className = 'active-row';

    const pick = document.createElement('td');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'active';
    radio.checked = profile.id === data.activeProfileId;
    radio.addEventListener('change', async () => {
      apply(await window.api.selectProfile(profile.id));
    });
    pick.appendChild(radio);

    const nameTd = document.createElement('td');
    nameTd.appendChild(textField(profile.name, (v) => saveProfileField(profile, 'name', v)));

    const jobTd = document.createElement('td');
    jobTd.appendChild(
      textField(profile.job || '', (v) => saveProfileField(profile, 'job', v), '예: 주술사')
    );

    const countTd = document.createElement('td');
    countTd.className = 'center';
    countTd.textContent = `${profile.buffs.length}개`;

    const switchTd = document.createElement('td');
    switchTd.appendChild(
      hotkeyCell(profile.switchHotkey, (hk) => saveProfileField(profile, 'switchHotkey', hk))
    );

    const actions = document.createElement('td');
    actions.className = 'cell-actions';
    actions.append(
      button('복제', async () => apply(await window.api.duplicateProfile(profile.id))),
      button('삭제', async () => {
        if (!confirm(`"${profile.name}" 캐릭터를 삭제할까요? 버프 설정도 함께 사라집니다.`)) return;
        apply(await window.api.deleteProfile(profile.id));
      }, 'danger')
    );

    tr.append(pick, nameTd, jobTd, countTd, switchTd, actions);
    tbody.appendChild(tr);
  }
}

async function saveProfileField(profile, field, value) {
  profile[field] = value;
  apply(await window.api.saveProfile(profile));
}

// ----------------------------------------------------------------- 버프

$('#add-buff').addEventListener('click', async () => {
  const profile = activeProfile();
  if (!profile) {
    alert('먼저 캐릭터를 추가하세요.');
    return;
  }
  profile.buffs.push(await window.api.newBuff());
  apply(await window.api.saveProfile(profile));
});

function renderNameList() {
  const list = $('#known-names');
  list.innerHTML = '';
  for (const name of data.knownBuffNames) {
    const opt = document.createElement('option');
    opt.value = name;
    list.appendChild(opt);
  }
}

function renderBuffTable() {
  const profile = activeProfile();
  const tbody = $('#buff-table tbody');
  tbody.innerHTML = '';

  $('#editing-name').textContent = profile ? profile.name : '-';
  const empty = !profile || profile.buffs.length === 0;
  $('#buff-empty').classList.toggle('show', empty);
  $('#buff-table').hidden = empty;
  if (!profile) return;

  for (const buff of profile.buffs) {
    const tr = document.createElement('tr');
    tr.dataset.buffId = buff.id;

    const nameTd = document.createElement('td');
    const nameInput = textField(buff.name, (v) => saveBuffField(profile, buff, 'name', v), '예: 이프리트');
    nameInput.setAttribute('list', 'known-names');
    nameTd.appendChild(nameInput);

    const durTd = document.createElement('td');
    durTd.appendChild(
      numberField(buff.durationSec, 1, 7200, (v) => saveBuffField(profile, buff, 'durationSec', v))
    );

    const preTd = document.createElement('td');
    preTd.appendChild(
      numberField(buff.preNoticeSec, 0, 120, (v) => saveBuffField(profile, buff, 'preNoticeSec', v))
    );

    const hotkeyTd = document.createElement('td');
    hotkeyTd.appendChild(
      hotkeyCell(buff.hotkey, (hk) => saveBuffField(profile, buff, 'hotkey', hk))
    );

    const volTd = document.createElement('td');
    volTd.className = 'center';
    volTd.appendChild(checkbox(buff.volatile, (v) => saveBuffField(profile, buff, 'volatile', v)));

    const onTd = document.createElement('td');
    onTd.className = 'center';
    onTd.appendChild(checkbox(buff.enabled, (v) => saveBuffField(profile, buff, 'enabled', v)));

    const remainTd = document.createElement('td');
    remainTd.className = 'remain';
    remainTd.dataset.role = 'remain';
    remainTd.textContent = '-';

    const actions = document.createElement('td');
    actions.className = 'cell-actions';
    actions.append(
      button('시작', () => window.api.startBuff(buff.id)),
      button('취소', () => window.api.cancelBuff(buff.id)),
      button('삭제', async () => {
        profile.buffs = profile.buffs.filter((b) => b.id !== buff.id);
        apply(await window.api.saveProfile(profile));
      }, 'danger')
    );

    tr.append(nameTd, durTd, preTd, hotkeyTd, volTd, onTd, remainTd, actions);
    tbody.appendChild(tr);
  }
}

/**
 * 버프를 고치면 타이머 코어가 다시 로드되면서 실행 중이던 타이머가 초기화된다.
 * 사냥 중 실수로 값을 건드렸을 때 조용히 리셋되는 걸 막기 위해, 타이머가 돌고 있으면 한 번 묻는다.
 */
async function saveBuffField(profile, buff, field, value) {
  const running = runtime.some((r) => r.phase !== 'IDLE');
  if (running && !confirmedResetThisSession) {
    if (!confirm('버프 설정을 바꾸면 실행 중인 타이머가 모두 초기화됩니다. 계속할까요?')) {
      tableKey = ''; // 강제로 다시 그려서 입력창 값을 되돌린다
      apply(data);
      return;
    }
    confirmedResetThisSession = true;
  }
  buff[field] = value;
  apply(await window.api.saveProfile(profile));
}

let confirmedResetThisSession = false;

// --------------------------------------------------------------- 런타임

function renderRuntime() {
  const byId = new Map(runtime.map((r) => [r.id, r]));
  for (const tr of document.querySelectorAll('#buff-table tbody tr')) {
    const cell = tr.querySelector('[data-role="remain"]');
    const state = byId.get(tr.dataset.buffId);
    if (!state || state.remainMs === null) {
      cell.textContent = '-';
      cell.className = 'remain';
      continue;
    }
    if (state.phase === 'EXPIRED') {
      cell.textContent = '만료';
      cell.className = 'remain expired';
      continue;
    }
    cell.textContent = `${Math.ceil(state.remainMs / 1000)}초`;
    cell.className = `remain ${state.phase === 'SOON' ? 'soon' : 'active'}`;
  }
}

// ----------------------------------------------------------------- 설정

function renderPrefs() {
  const s = data.settings;
  $('#tts-enabled').checked = s.ttsEnabled;
  renderVoiceList(s.ttsVoiceURI);
  setRange('#tts-volume', '#tts-volume-out', s.ttsVolume, (v) => v.toFixed(2));
  setRange('#tts-rate', '#tts-rate-out', s.ttsRate, (v) => `${v.toFixed(2)}x`);
  setRange('#tts-pitch', '#tts-pitch-out', s.ttsPitch, (v) => v.toFixed(2));
  $('#min-gap').value = s.minAlertGapSec;

  renderHookState();

  $('#ov-visible').checked = s.overlay.visible;
  $('#ov-locked').checked = s.overlay.locked;
  $('#ov-mode').value = s.overlay.mode;
  setRange('#ov-opacity', '#ov-opacity-out', s.overlay.opacity, (v) => v.toFixed(2));
  setRange('#ov-scale', '#ov-scale-out', s.overlay.scale, (v) => `${v.toFixed(2)}x`);
}

function renderHookState() {
  const { status, error } = data.hook || { status: 'off' };
  $('#hook-enabled').checked = data.settings.hotkeyHookEnabled;

  const badge = $('#hook-badge');
  badge.className = 'badge';
  if (status === 'running') {
    badge.textContent = '키 후킹 작동 중';
    badge.classList.add('ok');
  } else if (status === 'error') {
    badge.textContent = '키 후킹 실패';
    badge.classList.add('bad');
  } else {
    badge.textContent = '키 후킹 꺼짐';
  }

  const hint = $('#hook-status');
  if (status === 'error') {
    hint.textContent = `후킹을 시작하지 못했습니다: ${error}`;
    hint.classList.add('warn');
  } else if (status === 'running') {
    hint.textContent = '작동 중입니다. 게임에서 스킬 키를 누르면 타이머가 자동으로 시작됩니다.';
    hint.classList.remove('warn');
  } else {
    hint.textContent = '꺼져 있습니다. 버프 탭의 시작 버튼으로 수동 조작할 수 있습니다.';
    hint.classList.remove('warn');
  }

  $('#mute-badge').hidden = !data.muted;

  $('#chat-detection').checked = data.settings.chatDetection;
  $('#chat-timeout').value = data.settings.chatIdleTimeoutSec;
  $('#chat-timeout').disabled = !data.settings.chatDetection;

  const guard = data.guard || {};
  const gb = $('#guard-badge');
  gb.hidden = !guard.chatting && !guard.manualPause;
  gb.className = 'badge';
  if (guard.manualPause) {
    gb.textContent = '감지 정지';
    gb.classList.add('bad');
  } else if (guard.chatting) {
    gb.textContent = '채팅 중 — 글자 키 무시';
    gb.classList.add('warn');
  }
}

/**
 * 음성 목록은 오버레이 렌더러가 보고할 때까지 비어 있다.
 * 한국어 음성을 위로 올려 고르기 쉽게 한다.
 */
function renderVoiceList(selectedURI) {
  const sel = $('#tts-voice');
  const voices = data.voices || [];
  sel.innerHTML = '';

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '자동 (한국어 음성 우선)';
  sel.appendChild(auto);

  const isKo = (v) => v.lang && v.lang.toLowerCase().startsWith('ko');
  const sorted = [...voices].sort((a, b) => {
    if (isKo(a) !== isKo(b)) return isKo(a) ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const v of sorted) {
    const opt = document.createElement('option');
    opt.value = v.voiceURI;
    opt.textContent = `${v.name} (${v.lang})${v.localService ? '' : ' — 온라인'}`;
    sel.appendChild(opt);
  }

  sel.value = selectedURI && sorted.some((v) => v.voiceURI === selectedURI) ? selectedURI : '';
  sel.disabled = voices.length === 0;
  $('#voice-hint').hidden = false;
}

$('#tts-test').addEventListener('click', () => window.api.testVoice());

function setRange(inputSel, outSel, value, fmt) {
  $(inputSel).value = value;
  $(outSel).textContent = fmt(Number(value));
}

function bindPref(sel, read, build) {
  $(sel).addEventListener('change', async () => apply(await window.api.saveSettings(build(read()))));
  $(sel).addEventListener('input', () => renderPrefsOutputs());
}

function renderPrefsOutputs() {
  $('#tts-volume-out').textContent = Number($('#tts-volume').value).toFixed(2);
  $('#tts-rate-out').textContent = `${Number($('#tts-rate').value).toFixed(2)}x`;
  $('#tts-pitch-out').textContent = Number($('#tts-pitch').value).toFixed(2);
  $('#ov-opacity-out').textContent = Number($('#ov-opacity').value).toFixed(2);
  $('#ov-scale-out').textContent = `${Number($('#ov-scale').value).toFixed(2)}x`;
}

bindPref('#hook-enabled', () => $('#hook-enabled').checked, (v) => ({ hotkeyHookEnabled: v }));
bindPref('#chat-detection', () => $('#chat-detection').checked, (v) => ({ chatDetection: v }));
bindPref('#chat-timeout', () => Number($('#chat-timeout').value), (v) => ({ chatIdleTimeoutSec: v }));
bindPref('#tts-enabled', () => $('#tts-enabled').checked, (v) => ({ ttsEnabled: v }));
bindPref('#tts-volume', () => Number($('#tts-volume').value), (v) => ({ ttsVolume: v }));
bindPref('#tts-rate', () => Number($('#tts-rate').value), (v) => ({ ttsRate: v }));
bindPref('#tts-pitch', () => Number($('#tts-pitch').value), (v) => ({ ttsPitch: v }));
bindPref('#tts-voice', () => $('#tts-voice').value || null, (v) => ({ ttsVoiceURI: v }));
bindPref('#min-gap', () => Number($('#min-gap').value), (v) => ({ minAlertGapSec: v }));
bindPref('#ov-visible', () => $('#ov-visible').checked, (v) => ({ overlay: { visible: v } }));
bindPref('#ov-locked', () => $('#ov-locked').checked, (v) => ({ overlay: { locked: v } }));
bindPref('#ov-mode', () => $('#ov-mode').value, (v) => ({ overlay: { mode: v } }));
bindPref('#ov-opacity', () => Number($('#ov-opacity').value), (v) => ({ overlay: { opacity: v } }));
bindPref('#ov-scale', () => Number($('#ov-scale').value), (v) => ({ overlay: { scale: v } }));

// -------------------------------------------------------- DOM 헬퍼

function textField(value, onChange, placeholder) {
  const el = document.createElement('input');
  el.type = 'text';
  el.value = value;
  if (placeholder) el.placeholder = placeholder;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function numberField(value, min, max, onChange) {
  const el = document.createElement('input');
  el.type = 'number';
  el.value = value;
  el.min = min;
  el.max = max;
  el.addEventListener('change', () => {
    const n = Math.min(max, Math.max(min, Number(el.value) || min));
    el.value = n;
    onChange(n);
  });
  return el;
}

function checkbox(checked, onChange) {
  const el = document.createElement('input');
  el.type = 'checkbox';
  el.checked = checked;
  el.addEventListener('change', () => onChange(el.checked));
  return el;
}

function button(label, onClick, cls) {
  const el = document.createElement('button');
  el.textContent = label;
  if (cls) el.className = cls;
  el.addEventListener('click', onClick);
  return el;
}

// ----------------------------------------------------------------- 시작

window.api.onData(apply);
window.api.onRuntime((snapshot) => {
  runtime = snapshot;
  renderRuntime();
});

window.api.getData().then(apply);
