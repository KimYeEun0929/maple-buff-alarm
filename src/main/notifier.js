'use strict';

const { EventEmitter } = require('events');

/**
 * 알림 발화 정책.
 *
 * 버프를 6~8개씩 쓰면 알림이 쉴 새 없이 울려서 결국 앱을 끄게 된다.
 * 그래서 타이머 코어가 만든 이벤트를 그대로 읽지 않고 여기서 한 번 거른다.
 *
 * M1에서 구현한 것:
 *   - 최소 간격(minAlertGapSec) 안에 두 번 말하지 않는다
 *   - 대기 중 쌓인 이벤트는 하나로 합쳐서 한 번만 말한다
 *
 * M3 예정:
 *   - 아직 만료되지 않았지만 groupWindowSec 안에 끝날 버프를 끌어와 미리 함께 알리기
 */
class Notifier extends EventEmitter {
  constructor(getSettings) {
    super();
    this.getSettings = getSettings;
    this.pending = new Map(); // buffId -> item (같은 버프가 겹치면 최신 것만)
    this.lastSpokeAt = 0;
    this.flushTimer = null;
  }

  enqueue(items) {
    for (const item of items) this.pending.set(item.id, item);
    this.schedule();
  }

  schedule() {
    if (this.flushTimer) return;
    const { minAlertGapSec } = this.getSettings();
    const waitMs = Math.max(0, this.lastSpokeAt + minAlertGapSec * 1000 - Date.now());
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, waitMs);
  }

  flush() {
    if (this.pending.size === 0) return;
    const items = [...this.pending.values()];
    this.pending.clear();
    this.lastSpokeAt = Date.now();
    this.emit('announce', { text: buildText(items), items });
  }

  clear() {
    this.pending.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}

/**
 * 이름을 나열하되, 넷 이상이면 다 읽는 데 시간이 너무 걸려 사냥에 방해가 된다.
 * 그 경우 개별 이름을 포기하고 "리버프" 한 마디로 대체한다.
 */
function buildText(items) {
  if (items.length >= 4) return '리버프';
  const names = items.map((i) => (i.tts && i.tts.trim()) || i.name);
  const allExpired = items.every((i) => i.kind === 'expired');
  return names.join(', ') + (allExpired ? ' 만료' : '');
}

module.exports = Notifier;
module.exports.buildText = buildText;
