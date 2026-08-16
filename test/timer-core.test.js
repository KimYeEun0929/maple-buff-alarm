'use strict';

const test = require('node:test');
const assert = require('node:assert');

const TimerCore = require('../src/main/timer-core');
const { buildText } = require('../src/main/notifier');

// Date.now()를 직접 통제해서 실제 시간을 기다리지 않고 검증한다.
let now = 1_000_000;
const realNow = Date.now;
test.beforeEach(() => {
  now = 1_000_000;
  Date.now = () => now;
});
test.after(() => {
  Date.now = realNow;
});

function buff(over = {}) {
  return {
    id: over.id || 'b1',
    name: over.name || '이프리트',
    durationSec: over.durationSec ?? 100,
    preNoticeSec: over.preNoticeSec ?? 10,
    tts: over.tts || '',
    volatile: over.volatile ?? false,
    enabled: over.enabled ?? true,
  };
}

function collectDue(core) {
  const seen = [];
  core.on('due', (items) => seen.push(...items));
  return seen;
}

test('사용 안 함 / 이름 없음 / 지속시간 0인 버프는 싣지 않는다', () => {
  const core = new TimerCore();
  core.loadBuffs([
    buff({ id: 'ok' }),
    buff({ id: 'off', enabled: false }),
    buff({ id: 'noname', name: '  ' }),
    buff({ id: 'zero', durationSec: 0 }),
  ]);
  assert.deepStrictEqual(
    core.snapshot().map((b) => b.id),
    ['ok']
  );
});

test('시작하면 종료 시각 기준으로 남은 시간이 계산된다', () => {
  const core = new TimerCore();
  core.loadBuffs([buff({ durationSec: 100 })]);
  core.startBuff('b1');

  assert.strictEqual(core.snapshot()[0].remainMs, 100_000);
  now += 30_000;
  assert.strictEqual(core.snapshot()[0].remainMs, 70_000);
});

test('틱이 밀려도 오차가 누적되지 않는다', () => {
  const core = new TimerCore();
  core.loadBuffs([buff({ durationSec: 100 })]);
  core.startBuff('b1');

  // 200ms 주기여야 할 틱이 실제로는 크게 밀린 상황을 흉내낸다.
  for (const jump of [5_000, 12_000, 3_000, 40_000]) {
    now += jump;
    core.tick();
  }

  // 누산 방식이었다면 여기서 어긋난다. 종료 시각 기준이므로 정확히 맞는다.
  assert.strictEqual(core.snapshot()[0].remainMs, 100_000 - 60_000);
});

test('사전 알림과 만료 알림은 각각 한 번씩만 발생한다', () => {
  const core = new TimerCore();
  const due = collectDue(core);
  core.loadBuffs([buff({ durationSec: 100, preNoticeSec: 10 })]);
  core.startBuff('b1');

  now += 85_000;
  core.tick();
  assert.strictEqual(due.length, 0, '아직 사전 알림 구간이 아니다');

  now += 6_000; // 남은 9초 → SOON
  core.tick();
  core.tick();
  core.tick();
  assert.deepStrictEqual(due.map((d) => d.kind), ['soon'], 'SOON은 한 번만');

  now += 10_000; // 만료
  core.tick();
  core.tick();
  assert.deepStrictEqual(due.map((d) => d.kind), ['soon', 'expired'], 'EXPIRED도 한 번만');
});

test('재시전하면 다시 알림을 받을 수 있다', () => {
  const core = new TimerCore();
  const due = collectDue(core);
  core.loadBuffs([buff({ durationSec: 100, preNoticeSec: 10 })]);

  core.startBuff('b1');
  now += 95_000;
  core.tick(); // soon

  core.startBuff('b1'); // 재시전
  assert.strictEqual(core.snapshot()[0].phase, 'ACTIVE');

  now += 95_000;
  core.tick(); // soon 다시
  assert.deepStrictEqual(due.map((d) => d.kind), ['soon', 'soon']);
});

test('소환수 리셋은 volatile 버프만 지운다', () => {
  const core = new TimerCore();
  core.loadBuffs([
    buff({ id: 'summon', volatile: true }),
    buff({ id: 'skill', volatile: false }),
  ]);
  core.startBuff('summon');
  core.startBuff('skill');

  core.resetVolatile();

  const byId = Object.fromEntries(core.snapshot().map((b) => [b.id, b]));
  assert.strictEqual(byId.summon.phase, 'IDLE');
  assert.strictEqual(byId.summon.remainMs, null);
  assert.strictEqual(byId.skill.phase, 'ACTIVE');
});

test('전체 리셋은 모든 버프를 지운다', () => {
  const core = new TimerCore();
  core.loadBuffs([buff({ id: 'a' }), buff({ id: 'b' })]);
  core.startBuff('a');
  core.startBuff('b');

  core.resetAll();
  assert.ok(core.snapshot().every((b) => b.phase === 'IDLE' && b.remainMs === null));
});

test('프로필을 다시 실으면 실행 중이던 타이머가 초기화된다', () => {
  const core = new TimerCore();
  core.loadBuffs([buff({ id: 'a' })]);
  core.startBuff('a');
  assert.strictEqual(core.snapshot()[0].phase, 'ACTIVE');

  core.loadBuffs([buff({ id: 'a' })]);
  assert.strictEqual(core.snapshot()[0].phase, 'IDLE');
});

test('곧 끝날 버프를 끌어와 한 번에 알린다', () => {
  const core = new TimerCore();
  core.loadBuffs([
    buff({ id: 'a', name: '이프리트', durationSec: 100, preNoticeSec: 10 }),
    buff({ id: 'b', name: '소울애로우', durationSec: 120, preNoticeSec: 10 }),
    buff({ id: 'c', name: '메디테이션', durationSec: 600, preNoticeSec: 10 }),
  ]);
  core.startBuff('a');
  core.startBuff('b');
  core.startBuff('c');

  now += 91_000; // a 는 9초 남음(사전 알림 구간), b 는 29초, c 는 509초
  core.tick();

  const pulled = core.pullForward(30_000);
  assert.deepStrictEqual(pulled.map((p) => p.name), ['소울애로우'], '30초 안에 끝나는 것만');

  const byId = Object.fromEntries(core.snapshot().map((s) => [s.id, s]));
  assert.strictEqual(byId.b.phase, 'SOON', '끌어온 버프는 사전 알림을 이미 받은 것으로 처리');
  assert.strictEqual(byId.c.phase, 'ACTIVE');
});

test('끌어온 버프는 사전 알림을 두 번 받지 않는다', () => {
  const core = new TimerCore();
  const due = collectDue(core);
  core.loadBuffs([buff({ id: 'b', durationSec: 120, preNoticeSec: 10 })]);
  core.startBuff('b');

  now += 91_000;
  core.pullForward(30_000); // 다른 버프와 함께 미리 알림

  now += 20_000; // 남은 9초 — 원래라면 여기서 SOON 이 발생
  core.tick();
  assert.deepStrictEqual(due, [], '이미 알렸으므로 다시 알리지 않는다');
});

test('끌어와 알렸어도 만료 알림은 그대로 나간다', () => {
  const core = new TimerCore();
  const due = collectDue(core);
  core.loadBuffs([buff({ id: 'b', durationSec: 120, preNoticeSec: 10 })]);
  core.startBuff('b');

  now += 91_000;
  core.pullForward(30_000);

  now += 30_000; // 만료
  core.tick();
  // 재버프를 안 했다면 그건 여전히 알려줘야 한다.
  assert.deepStrictEqual(due.map((d) => d.kind), ['expired']);
});

test('이미 알린 버프는 다시 끌어오지 않는다', () => {
  const core = new TimerCore();
  core.loadBuffs([buff({ id: 'b', durationSec: 120, preNoticeSec: 10 })]);
  core.startBuff('b');

  now += 95_000;
  assert.strictEqual(core.pullForward(30_000).length, 1);
  assert.strictEqual(core.pullForward(30_000).length, 0, '두 번째 호출에서는 비어야 한다');
});

test('발화 문구: 개수에 따라 이름 나열 또는 리버프', () => {
  assert.strictEqual(buildText([{ name: '이프리트', kind: 'soon' }]), '이프리트');
  assert.strictEqual(buildText([{ name: '이프리트', kind: 'expired' }]), '이프리트 만료');
  assert.strictEqual(
    buildText([
      { name: '이프리트', kind: 'soon' },
      { name: '소울애로우', kind: 'soon' },
    ]),
    '이프리트, 소울애로우'
  );
  // 넷 이상이면 다 읽는 데 시간이 너무 걸린다.
  assert.strictEqual(
    buildText([
      { name: 'a', kind: 'soon' },
      { name: 'b', kind: 'soon' },
      { name: 'c', kind: 'soon' },
      { name: 'd', kind: 'soon' },
    ]),
    '리버프'
  );
});

test('발화 문구: tts 필드가 있으면 이름 대신 그걸 읽는다', () => {
  assert.strictEqual(buildText([{ name: '속도향상의 알약', tts: '알약', kind: 'soon' }]), '알약');
});
