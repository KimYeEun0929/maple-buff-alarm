'use strict';

const { EventEmitter } = require('events');

const TICK_MS = 200;

/**
 * 버프 타이머의 단일 진실 원천. 렌더러는 여기서 브로드캐스트한 상태를 그리기만 한다.
 *
 * 남은 시간을 1초씩 빼는 누산 방식은 setInterval 지연이 계속 쌓여 반드시 어긋난다.
 * 그래서 종료 시각(endsAt)을 저장하고 매 틱마다 현재 시각과 비교한다.
 * 절전에서 복귀해도 Date.now() 비교라 자동으로 맞는다.
 */
class TimerCore extends EventEmitter {
  constructor() {
    super();
    this.buffs = new Map(); // buffId -> Buff
    this.states = new Map(); // buffId -> { endsAt, phase }
    this.ticker = null;
  }

  /**
   * 프로필 전환 또는 버프 편집 시 호출.
   * 캐릭터를 바꿨다는 건 이전 버프가 전부 무의미하다는 뜻이므로 상태를 모두 비운다.
   */
  loadBuffs(buffs) {
    const usable = (buffs || []).filter((b) => b.enabled && b.name.trim() && b.durationSec > 0);
    this.buffs = new Map(usable.map((b) => [b.id, b]));
    this.states = new Map(usable.map((b) => [b.id, { endsAt: null, phase: 'IDLE' }]));
    this.emitTick();
  }

  startBuff(id) {
    const buff = this.buffs.get(id);
    if (!buff) return;
    this.states.set(id, {
      endsAt: Date.now() + buff.durationSec * 1000,
      phase: 'ACTIVE',
    });
    this.emitTick();
  }

  cancelBuff(id) {
    if (!this.states.has(id)) return;
    this.states.set(id, { endsAt: null, phase: 'IDLE' });
    this.emitTick();
  }

  /** 사망 등으로 버프가 전부 날아갔을 때. */
  resetAll() {
    for (const id of this.states.keys()) {
      this.states.set(id, { endsAt: null, phase: 'IDLE' });
    }
    this.emitTick();
  }

  /** 맵/채널 이동 후 — 소환수만 사라진 경우. */
  resetVolatile() {
    for (const [id, buff] of this.buffs) {
      if (buff.volatile) this.states.set(id, { endsAt: null, phase: 'IDLE' });
    }
    this.emitTick();
  }

  run() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (!this.ticker) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  tick() {
    const now = Date.now();
    const due = [];

    for (const [id, st] of this.states) {
      if (st.endsAt === null) continue;
      const buff = this.buffs.get(id);
      const remainMs = st.endsAt - now;

      // 상태 전이 시점에만 알림을 만들므로 중복 발화가 구조적으로 불가능하다.
      if (remainMs <= 0) {
        if (st.phase !== 'EXPIRED') {
          st.phase = 'EXPIRED';
          due.push({ id, name: buff.name, tts: buff.tts, kind: 'expired' });
        }
      } else if (remainMs <= buff.preNoticeSec * 1000) {
        if (st.phase === 'ACTIVE') {
          st.phase = 'SOON';
          due.push({ id, name: buff.name, tts: buff.tts, kind: 'soon' });
        }
      }
    }

    if (due.length) this.emit('due', due);
    this.emitTick();
  }

  /**
   * 곧 끝날 버프를 미리 끌어와 한 번에 알리기 위한 목록.
   *
   * 25초 뒤 끝날 버프를 지금 알려주면 한 번에 재버프할 수 있다. 따로 알리면
   * 25초 뒤에 또 울려서, 사냥 중 알림 횟수가 버프 수만큼 늘어난다.
   *
   * 끌어온 버프는 SOON 으로 올려 사전 알림이 다시 나가지 않게 한다.
   * 만료 알림은 그대로 남긴다 — 재버프를 안 했다면 그건 여전히 알려줘야 한다.
   */
  pullForward(withinMs, now = Date.now()) {
    const pulled = [];
    for (const [id, st] of this.states) {
      if (st.phase !== 'ACTIVE' || st.endsAt === null) continue;
      if (st.endsAt - now > withinMs) continue;
      st.phase = 'SOON';
      const buff = this.buffs.get(id);
      pulled.push({ id, name: buff.name, tts: buff.tts, kind: 'soon' });
    }
    return pulled;
  }

  snapshot() {
    const now = Date.now();
    return [...this.buffs.values()].map((b) => {
      const st = this.states.get(b.id);
      return {
        id: b.id,
        name: b.name,
        durationSec: b.durationSec,
        volatile: b.volatile,
        phase: st.phase,
        remainMs: st.endsAt === null ? null : Math.max(0, st.endsAt - now),
      };
    });
  }

  emitTick() {
    this.emit('tick', this.snapshot());
  }
}

module.exports = TimerCore;
module.exports.TICK_MS = TICK_MS;
