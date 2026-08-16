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
  if (rebuild) {
    renderProfileTable();
    renderBuffTable();
  }
  renderRuntime();
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

    const actions = document.createElement('td');
    actions.className = 'cell-actions';
    actions.append(
      button('복제', async () => apply(await window.api.duplicateProfile(profile.id))),
      button('삭제', async () => {
        if (!confirm(`"${profile.name}" 캐릭터를 삭제할까요? 버프 설정도 함께 사라집니다.`)) return;
        apply(await window.api.deleteProfile(profile.id));
      }, 'danger')
    );

    tr.append(pick, nameTd, jobTd, countTd, actions);
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

    tr.append(nameTd, durTd, preTd, volTd, onTd, remainTd, actions);
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
  setRange('#tts-volume', '#tts-volume-out', s.ttsVolume, (v) => v.toFixed(2));
  setRange('#tts-rate', '#tts-rate-out', s.ttsRate, (v) => `${v.toFixed(2)}x`);
  $('#min-gap').value = s.minAlertGapSec;

  $('#ov-visible').checked = s.overlay.visible;
  $('#ov-locked').checked = s.overlay.locked;
  $('#ov-mode').value = s.overlay.mode;
  setRange('#ov-opacity', '#ov-opacity-out', s.overlay.opacity, (v) => v.toFixed(2));
  setRange('#ov-scale', '#ov-scale-out', s.overlay.scale, (v) => `${v.toFixed(2)}x`);
}

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
  $('#ov-opacity-out').textContent = Number($('#ov-opacity').value).toFixed(2);
  $('#ov-scale-out').textContent = `${Number($('#ov-scale').value).toFixed(2)}x`;
}

bindPref('#tts-enabled', () => $('#tts-enabled').checked, (v) => ({ ttsEnabled: v }));
bindPref('#tts-volume', () => Number($('#tts-volume').value), (v) => ({ ttsVolume: v }));
bindPref('#tts-rate', () => Number($('#tts-rate').value), (v) => ({ ttsRate: v }));
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
