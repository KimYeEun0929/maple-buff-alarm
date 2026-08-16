'use strict';

const { isTypingKey, ESCAPE, ENTER, NUMPAD_ENTER } = require('./hotkey-match');

/**
 * 채팅 중에 버프 타이머가 잘못 켜지는 걸 막는다.
 *
 * ## 왜 완벽할 수 없는가
 *
 * 게임의 채팅 엔터와 대화상자 "확인" 엔터는 **키 입력만 봐서는 구분할 수 없다.**
 * 둘 다 keycode 28 이다. 그래서 이 모듈은 구분하는 척하지 않고,
 * **틀린 상태가 오래 가지 않도록** 만드는 데 집중한다.
 *
 * ## 두 가지 오판의 무게가 다르다
 *
 * - 채팅이 아닌데 채팅으로 잘못 봄 → 버프 키가 씹혀 **알림이 조용히 멈춘다** (치명적)
 * - 채팅인데 아닌 걸로 봄 → 글자를 칠 때 타이머가 켜진다 (성가시지만 눈에 보이고 리셋하면 됨)
 *
 * 그래서 모든 판정을 **채팅에서 빠져나오는 쪽으로 기울인다.**
 *
 * ## 규칙
 *
 * 1. Enter → 채팅 시작으로 본다
 * 2. 채팅 중 Enter → 그 사이에 글자를 쳤으면 전송으로 보고 종료.
 *    글자를 안 쳤으면(= 대화상자 확인이었을 가능성) 종료하지 않고 다시 시작으로 둔다
 * 3. Esc → 즉시 종료
 * 4. **채팅 중에 글자를 만들지 않는 키가 오면 즉시 종료** — 방향키로 이동하거나 Alt로
 *    점프하는 순간 채팅이 아니었음이 드러난다. 확인 엔터로 잘못 들어간 상태가
 *    사냥을 재개하자마자 저절로 풀리는 게 이 규칙 덕이다
 * 5. 한동안 입력이 없으면 종료 (마지막 안전망)
 *
 * 억제 대상도 **글자를 만드는 키로 한정**한다. F키나 PgUp 에 걸어둔 버프는
 * 채팅 판정이 틀려도 계속 동작한다.
 */
class ChatGuard {
  constructor(getConfig = () => ({ enabled: true, idleTimeoutSec: 8 })) {
    this.getConfig = getConfig;
    this.chatting = false;
    this.typedSinceEnter = false;
    this.lastKeyAt = 0;
    this.manualPause = false;
  }

  reset() {
    this.chatting = false;
    this.typedSinceEnter = false;
  }

  state() {
    return { chatting: this.chatting, manualPause: this.manualPause };
  }

  setManualPause(value) {
    this.manualPause = !!value;
    return this.manualPause;
  }

  /** 입력이 끊긴 지 오래면 채팅 상태를 푼다. @returns 상태가 바뀌었는가 */
  sweep(now = Date.now()) {
    if (!this.chatting) return false;
    const { idleTimeoutSec } = this.getConfig();
    if (now - this.lastKeyAt <= idleTimeoutSec * 1000) return false;
    this.reset();
    return true;
  }

  /** 키 하나를 관찰해 채팅 상태를 갱신한다. @returns 상태가 바뀌었는가 */
  observe(hotkey, now = Date.now()) {
    const { enabled } = this.getConfig();
    const before = this.chatting;

    if (!enabled) {
      this.reset();
      return before !== this.chatting;
    }

    this.sweep(now);
    this.lastKeyAt = now;

    const code = hotkey.keycode;

    if (code === ESCAPE) {
      this.reset();
    } else if (code === ENTER || code === NUMPAD_ENTER) {
      if (this.chatting && this.typedSinceEnter) {
        this.reset(); // 메시지를 보냈다
      } else {
        this.chatting = true;
        this.typedSinceEnter = false;
      }
    } else if (this.chatting) {
      if (isTypingKey(hotkey)) this.typedSinceEnter = true;
      else this.reset(); // 채팅 중이라면 나올 수 없는 입력이다
    }

    return before !== this.chatting;
  }

  /** 이 입력을 이 바인딩으로 흘려보내도 되는가. */
  blocks(hotkey, binding) {
    // 감지 재개 키는 어떤 상태에서도 먹어야 한다. 아니면 빠져나올 방법이 없다.
    if (binding.type === 'app' && binding.payload === 'detectionToggle') return false;
    if (this.manualPause) return binding.type === 'buff';
    if (!this.chatting) return false;
    return isTypingKey(hotkey);
  }
}

module.exports = ChatGuard;
