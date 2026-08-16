'use strict';

const root = document.getElementById('root');
const listEl = document.getElementById('buffs');
const profileNameEl = document.getElementById('profile-name');

/** buffId -> { li, name, bar, remain } — 200ms마다 DOM을 새로 만들지 않기 위해 재사용한다. */
const rows = new Map();

let lastSize = { width: 0, height: 0 };

// ------------------------------------------------------------------ 렌더

function phaseOrder(b) {
  if (b.phase === 'IDLE') return 3;
  if (b.phase === 'EXPIRED') return 2;
  return 1;
}

function sortBuffs(buffs) {
  return [...buffs].sort((a, b) => {
    const d = phaseOrder(a) - phaseOrder(b);
    if (d !== 0) return d;
    // 다음에 눌러야 할 버프가 항상 맨 앞에 온다.
    return (a.remainMs ?? Infinity) - (b.remainMs ?? Infinity);
  });
}

function makeRow() {
  const li = document.createElement('li');
  li.className = 'buff';

  const name = document.createElement('span');
  name.className = 'name';

  const gauge = document.createElement('span');
  gauge.className = 'gauge';
  const bar = document.createElement('i');
  gauge.appendChild(bar);

  const remain = document.createElement('span');
  remain.className = 'remain';

  li.append(name, gauge, remain);
  return { li, name, bar, remain };
}

function formatRemain(buff) {
  if (buff.remainMs === null) return '-';
  if (buff.phase === 'EXPIRED') return '만료';
  const sec = Math.ceil(buff.remainMs / 1000);
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function render(payload) {
  const { buffs, profileName, settings } = payload;
  const overlay = settings.overlay;

  root.className =
    `mode-${overlay.mode}` +
    (overlay.locked ? '' : ' unlocked') +
    (overlay.visible ? '' : ' hidden') +
    (buffs.length === 0 ? ' is-empty' : '');
  root.style.opacity = String(overlay.opacity);
  root.style.transform = `scale(${overlay.scale})`;

  profileNameEl.textContent = profileName || '캐릭터 없음';

  const sorted = sortBuffs(buffs);
  const seen = new Set();

  sorted.forEach((buff, index) => {
    let row = rows.get(buff.id);
    if (!row) {
      row = makeRow();
      rows.set(buff.id, row);
    }
    seen.add(buff.id);

    const ratio = buff.remainMs === null ? 0 : buff.remainMs / (buff.durationSec * 1000);

    row.name.textContent = buff.name;
    row.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    row.remain.textContent = formatRemain(buff);

    let cls = 'buff';
    if (buff.phase === 'IDLE') cls += ' idle';
    else if (buff.phase === 'SOON') cls += ' soon';
    else if (buff.phase === 'EXPIRED') cls += ' expired blink';
    row.li.className = cls;

    if (listEl.children[index] !== row.li) {
      listEl.insertBefore(row.li, listEl.children[index] || null);
    }
  });

  for (const [id, row] of rows) {
    if (seen.has(id)) continue;
    row.li.remove();
    rows.delete(id);
  }

  syncSize();
}

/** 내용에 맞춰 창을 줄여야 게임 화면을 덜 가린다. */
function syncSize() {
  const rect = root.getBoundingClientRect();
  const width = Math.ceil(rect.width) + 2;
  const height = Math.ceil(rect.height) + 2;
  if (width === lastSize.width && height === lastSize.height) return;
  lastSize = { width, height };
  window.overlayApi.resize({ width, height });
}

// -------------------------------------------------------------------- TTS

let koVoice = null;

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  koVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ko')) || null;
}

pickVoice();
window.speechSynthesis.addEventListener('voiceschanged', pickVoice);

function speak({ text, volume, rate }) {
  if (!text) return;
  // 이전 발화가 남아 있으면 최신 알림이 밀린다. 항상 최신 것을 우선한다.
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ko-KR';
  if (koVoice) utter.voice = koVoice;
  utter.volume = volume;
  utter.rate = rate;
  window.speechSynthesis.speak(utter);
}

// ------------------------------------------------------------------ 배선

window.overlayApi.onState(render);
window.overlayApi.onAnnounce(speak);
