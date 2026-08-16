'use strict';

const { EventEmitter } = require('events');
const { KeyResolver, signature, ESCAPE } = require('./hotkey-match');

/**
 * 전역 키 후킹.
 *
 * Electron 의 globalShortcut 은 등록한 키를 **가로챈다**. 그 키가 게임에 전달되지 않아
 * 스킬이 안 나가므로 절대 쓰지 않는다. uiohook 의 수동 리스닝은 이벤트를 관찰만 하고
 * 소비하지 않으므로 게임 입력에 영향을 주지 않는다.
 *
 * uiohook 에는 keyTap/keyToggle 같은 입력 주입 API 도 있지만 이 앱은 쓰지 않는다.
 * 입력을 넣는 순간 매크로가 된다.
 */
class HotkeyHook extends EventEmitter {
  constructor({ guard = null } = {}) {
    super();
    this.guard = guard;
    this.resolver = new KeyResolver();
    this.bindings = new Map(); // signature -> { type, payload }
    this.status = 'off'; // 'off' | 'running' | 'error'
    this.error = null;
    this.capturing = null; // { resolve }
    this.uio = null;
    this.attached = false;
  }

  setBindings(entries) {
    this.bindings = new Map();
    for (const entry of entries) {
      const sig = signature(entry.hotkey);
      if (sig) this.bindings.set(sig, { type: entry.type, payload: entry.payload });
    }
  }

  start() {
    if (this.status === 'running') return this.state();
    try {
      if (!this.uio) this.uio = require('uiohook-napi').uIOhook;
      if (!this.attached) {
        this.uio.on('keydown', (e) => this.onKeyDown(e));
        this.uio.on('keyup', (e) => this.onKeyUp(e));
        this.attached = true;
      }
      this.uio.start();
      this.resolver.reset();
      this.status = 'running';
      this.error = null;
    } catch (err) {
      this.status = 'error';
      this.error = explainStartFailure(err);
    }
    return this.state();
  }

  stop() {
    if (this.uio && this.status === 'running') {
      try {
        this.uio.stop();
      } catch {
        // 이미 멈춰 있으면 무시한다.
      }
    }
    this.cancelCapture();
    this.resolver.reset();
    if (this.status !== 'error') this.status = 'off';
    return this.state();
  }

  state() {
    return { status: this.status, error: this.error };
  }

  /** 다음에 눌리는 키 하나를 그대로 돌려준다. Esc 를 누르면 취소. */
  capture() {
    if (this.status === 'error') {
      // 후킹이 실패한 상태에서 "켜세요"라고만 하면 이미 켠 사용자는 막힌다. 진짜 원인을 보여준다.
      return Promise.reject(new Error(`키 후킹이 동작하지 않아 등록할 수 없습니다.\n\n${this.error}`));
    }
    if (this.status !== 'running') {
      return Promise.reject(new Error('키 후킹을 먼저 켜야 단축키를 등록할 수 있습니다. (설정 탭)'));
    }
    this.cancelCapture();
    return new Promise((resolve) => {
      this.capturing = { resolve };
    });
  }

  cancelCapture() {
    if (!this.capturing) return;
    this.capturing.resolve(null);
    this.capturing = null;
  }

  onKeyDown(event) {
    // 캡처 중 Esc 는 취소로 쓴다(그래서 Esc 자체는 단축키로 등록할 수 없다).
    if (this.capturing && event.keycode === ESCAPE) {
      this.cancelCapture();
      return;
    }
    this.dispatch(this.resolver.keydown(event));
  }

  onKeyUp(event) {
    this.dispatch(this.resolver.keyup(event));
  }

  dispatch(hotkey) {
    if (!hotkey) return;

    if (this.capturing) {
      const { resolve } = this.capturing;
      this.capturing = null;
      resolve(hotkey);
      return;
    }

    // 채팅 상태는 등록되지 않은 키(그냥 친 글자)로도 갱신되어야 하므로 먼저 관찰한다.
    if (this.guard && this.guard.observe(hotkey)) this.emit('guardChanged');

    const hit = this.bindings.get(signature(hotkey));
    if (!hit) return;
    if (this.guard && this.guard.blocks(hotkey, hit)) return;

    this.emit('trigger', hit);
  }
}

/**
 * 후킹 실패 원인을 사용자가 조치할 수 있는 문장으로 바꾼다.
 * 날것의 "Cannot find module ..." 은 무엇을 해야 하는지 알려주지 않는다.
 */
function explainStartFailure(err) {
  const message = err && err.message ? err.message : String(err);

  if (err && err.code === 'MODULE_NOT_FOUND' && message.includes('uiohook-napi')) {
    return (
      '키 후킹 모듈(uiohook-napi)이 설치되어 있지 않습니다.\n' +
      '프로젝트 폴더에서 npm install 을 실행한 뒤 앱을 다시 켜세요.'
    );
  }

  // 패키지는 있는데 그 안의 네이티브 바이너리를 못 찾는 경우.
  if (/No native build|bindings|\.node/i.test(message)) {
    return (
      '키 후킹 모듈의 네이티브 파일을 불러오지 못했습니다.\n' +
      'node_modules 폴더를 지우고 npm install 을 다시 실행해 보세요.\n\n' +
      `원본 오류: ${message}`
    );
  }

  return message;
}

module.exports = HotkeyHook;
module.exports.explainStartFailure = explainStartFailure;
