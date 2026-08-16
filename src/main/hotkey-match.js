'use strict';

/**
 * 키 입력을 단축키로 해석하는 순수 로직. 네이티브 모듈에 의존하지 않아 그대로 테스트할 수 있다.
 *
 * keycode 는 uiohook 의 물리 키 코드다. 물리 코드를 쓰기 때문에
 * 상단 숫자열과 넘패드, 좌우 Shift 가 자연히 구분된다.
 */

// uiohook keycode -> 표시용 이름
const KEY_LABELS = {
  1: 'Esc', 2: '1', 3: '2', 4: '3', 5: '4', 6: '5', 7: '6', 8: '7', 9: '8', 10: '9',
  11: '0', 12: '-', 13: '=', 14: 'Backspace', 15: 'Tab',
  16: 'Q', 17: 'W', 18: 'E', 19: 'R', 20: 'T', 21: 'Y', 22: 'U', 23: 'I', 24: 'O', 25: 'P',
  26: '[', 27: ']', 28: 'Enter', 29: 'Ctrl',
  30: 'A', 31: 'S', 32: 'D', 33: 'F', 34: 'G', 35: 'H', 36: 'J', 37: 'K', 38: 'L',
  39: ';', 40: "'", 41: '`', 42: 'Shift', 43: '\\',
  44: 'Z', 45: 'X', 46: 'C', 47: 'V', 48: 'B', 49: 'N', 50: 'M',
  51: ',', 52: '.', 53: '/', 54: 'Shift(우)', 55: '넘패드*', 56: 'Alt', 57: 'Space',
  58: 'CapsLock',
  59: 'F1', 60: 'F2', 61: 'F3', 62: 'F4', 63: 'F5', 64: 'F6', 65: 'F7', 66: 'F8',
  67: 'F9', 68: 'F10', 69: 'NumLock', 70: 'ScrollLock',
  71: '넘패드7', 72: '넘패드8', 73: '넘패드9', 74: '넘패드-',
  75: '넘패드4', 76: '넘패드5', 77: '넘패드6', 78: '넘패드+',
  79: '넘패드1', 80: '넘패드2', 81: '넘패드3', 82: '넘패드0', 83: '넘패드.',
  87: 'F11', 88: 'F12', 91: 'F13', 92: 'F14', 93: 'F15',
  99: 'F16', 100: 'F17', 101: 'F18', 102: 'F19', 103: 'F20',
  104: 'F21', 105: 'F22', 106: 'F23', 107: 'F24',
  3612: '넘패드Enter', 3613: 'Ctrl(우)', 3637: '넘패드/', 3639: 'PrtSc', 3640: 'Alt(우)',
  3655: 'Home', 3657: 'PgUp', 3663: 'End', 3665: 'PgDn', 3666: 'Ins', 3667: 'Del',
  3675: 'Win', 3676: 'Win(우)',
  57416: '↑', 57419: '←', 57421: '→', 57424: '↓',
  60999: '넘패드Home', 61000: '넘패드↑', 61001: '넘패드PgUp',
  61003: '넘패드←', 61005: '넘패드→',
  61007: '넘패드End', 61008: '넘패드↓', 61009: '넘패드PgDn',
  61010: '넘패드Ins', 61011: '넘패드Del',
};

const MODIFIER_CODES = new Set([29, 3613, 56, 3640, 42, 54, 3675, 3676]);

const ESCAPE = 1;
const ENTER = 28;
const NUMPAD_ENTER = 3612;

/**
 * 채팅창에 실제로 글자를 넣는 키들. 채팅 중 감지를 멈출 대상을 고르는 데 쓴다.
 * 방향키·F키·PgUp 같은 키는 채팅창에서 글자를 만들지 않으므로 여기 없다.
 */
const TYPING_KEYCODES = new Set([
  // 알파벳
  16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  30, 31, 32, 33, 34, 35, 36, 37, 38,
  44, 45, 46, 47, 48, 49, 50,
  // 상단 숫자열
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  // 기호
  12, 13, 26, 27, 39, 40, 41, 43, 51, 52, 53,
  // 공백 · 편집
  57, 14, 15,
  // 넘패드 (NumLock 켠 상태에서 숫자를 찍는다)
  71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 55, 3637,
]);

function isModifier(keycode) {
  return MODIFIER_CODES.has(keycode);
}

/** 이 입력이 채팅창에 글자를 남길 수 있는가. */
function isTypingKey(hotkey) {
  if (!hotkey || hotkey.bareModifier) return false;
  if (hotkey.ctrl || hotkey.alt) return false; // Ctrl/Alt 조합은 글자를 만들지 않는다
  return TYPING_KEYCODES.has(hotkey.keycode);
}

function keyLabel(keycode) {
  return KEY_LABELS[keycode] || `키(${keycode})`;
}

/** 저장·비교용 문자열. 조합이 완전히 같을 때만 같은 값이 나온다. */
function signature(hotkey) {
  if (!hotkey) return null;
  if (hotkey.bareModifier) return `bare:${hotkey.keycode}`;
  return `key:${hotkey.keycode}:${hotkey.ctrl ? 1 : 0}${hotkey.alt ? 1 : 0}${hotkey.shift ? 1 : 0}`;
}

function describe(hotkey) {
  if (!hotkey) return '없음';
  if (hotkey.bareModifier) return `${keyLabel(hotkey.keycode)} (단독)`;
  const parts = [];
  if (hotkey.ctrl) parts.push('Ctrl');
  if (hotkey.alt) parts.push('Alt');
  if (hotkey.shift) parts.push('Shift');
  parts.push(keyLabel(hotkey.keycode));
  return parts.join('+');
}

function makeHotkey({ keycode, ctrl = false, alt = false, shift = false, bareModifier = false }) {
  const hotkey = { keycode, ctrl, alt, shift, bareModifier };
  hotkey.label = describe(hotkey);
  return hotkey;
}

/**
 * 키 이벤트 스트림을 단축키 하나로 해석한다.
 *
 * 수식키를 단독으로 스킬 슬롯에 배치할 수 있어야 하는데, Shift+A 를 누를 때도
 * Shift 의 keydown 은 발생한다. 그래서 수식키는 keydown 이 아니라 keyup 에서,
 * 누르고 있는 동안 다른 키가 눌리지 않았을 때만 발동으로 판정한다.
 */
class KeyResolver {
  constructor({ repeatMs = 300 } = {}) {
    this.repeatMs = repeatMs;
    this.pressed = new Set(); // 지금 눌려 있는 키
    this.bareCandidates = new Map(); // 수식키 keycode -> 아직 단독인가
    this.lastFiredAt = new Map(); // signature -> ms
  }

  reset() {
    this.pressed.clear();
    this.bareCandidates.clear();
    this.lastFiredAt.clear();
  }

  /** @returns {object|null} 해석된 단축키, 또는 아직 확정되지 않았으면 null */
  keydown(event, now = Date.now()) {
    const { keycode } = event;
    const alreadyHeld = this.pressed.size > 0 && !this.pressed.has(keycode);
    this.pressed.add(keycode);

    // 다른 키가 눌리는 순간, 진행 중이던 수식키 단독 후보는 조합의 일부가 된다.
    for (const code of this.bareCandidates.keys()) {
      if (code !== keycode) this.bareCandidates.set(code, false);
    }

    if (isModifier(keycode)) {
      // 이미 다른 키를 누르고 있었다면 이 수식키도 조합의 일부다.
      if (!this.bareCandidates.has(keycode)) this.bareCandidates.set(keycode, !alreadyHeld);
      return null; // 수식키 자체는 keyup 에서 판정
    }

    return this.fire(
      makeHotkey({
        keycode,
        ctrl: !!event.ctrlKey,
        alt: !!event.altKey,
        shift: !!event.shiftKey,
      }),
      now
    );
  }

  keyup(event, now = Date.now()) {
    const { keycode } = event;
    this.pressed.delete(keycode);
    if (!isModifier(keycode)) return null;

    const wasBare = this.bareCandidates.get(keycode);
    this.bareCandidates.delete(keycode);
    if (!wasBare) return null;

    return this.fire(makeHotkey({ keycode, bareModifier: true }), now);
  }

  /** 키를 누르고 있으면 OS 가 반복 이벤트를 보낸다. 같은 조합의 연타는 무시한다. */
  fire(hotkey, now) {
    const sig = signature(hotkey);
    const last = this.lastFiredAt.get(sig);
    if (last !== undefined && now - last < this.repeatMs) return null;
    this.lastFiredAt.set(sig, now);
    return hotkey;
  }
}

/**
 * 같은 키에 두 가지가 걸려 있으면 하나는 반드시 먹지 않는다.
 * @returns {Array<{signature: string, labels: string[]}>}
 */
function findCollisions(entries) {
  const bySig = new Map();
  for (const entry of entries) {
    const sig = signature(entry.hotkey);
    if (!sig) continue;
    if (!bySig.has(sig)) bySig.set(sig, []);
    bySig.get(sig).push(entry.label);
  }
  return [...bySig.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([sig, labels]) => ({ signature: sig, labels }));
}

module.exports = {
  KEY_LABELS,
  MODIFIER_CODES,
  TYPING_KEYCODES,
  ESCAPE,
  ENTER,
  NUMPAD_ENTER,
  isModifier,
  isTypingKey,
  keyLabel,
  signature,
  describe,
  makeHotkey,
  KeyResolver,
  findCollisions,
};
