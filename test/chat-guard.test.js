'use strict';

const test = require('node:test');
const assert = require('node:assert');

const ChatGuard = require('../src/main/chat-guard');
const { makeHotkey, isTypingKey } = require('../src/main/hotkey-match');

const K = {
  Enter: 28, Esc: 1, A: 30, B: 48, Space: 57, Digit1: 2, Num1: 79,
  F3: 61, PgUp: 3657, Left: 57419, Alt: 56, Ctrl: 29, Home: 3655,
};

const key = (keycode, over = {}) => makeHotkey({ keycode, ...over });
const buff = { type: 'buff', payload: 'b1' };
const guardWith = (over = {}) =>
  new ChatGuard(() => ({ enabled: true, idleTimeoutSec: 8, ...over }));

// ------------------------------------------------------- 글자 키 판별

test('글자를 만드는 키만 채팅 억제 대상이다', () => {
  assert.ok(isTypingKey(key(K.A)));
  assert.ok(isTypingKey(key(K.Digit1)));
  assert.ok(isTypingKey(key(K.Num1)), '넘패드 숫자도 채팅창에 찍힌다');
  assert.ok(isTypingKey(key(K.Space)));

  assert.ok(!isTypingKey(key(K.F3)), 'F키는 채팅창에 글자를 남기지 않는다');
  assert.ok(!isTypingKey(key(K.PgUp)));
  assert.ok(!isTypingKey(key(K.A, { ctrl: true })), 'Ctrl 조합은 글자가 아니다');
  assert.ok(!isTypingKey(makeHotkey({ keycode: K.Alt, bareModifier: true })));
});

// ------------------------------------------------------ 정상 채팅 흐름

test('채팅을 치는 동안 글자 키에 걸린 버프는 발동하지 않는다', () => {
  const g = guardWith();

  g.observe(key(K.Enter), 0); // 채팅창 열기
  assert.ok(g.chatting);

  g.observe(key(K.A), 100);
  assert.ok(g.blocks(key(K.A), buff), '채팅 중 A는 버프가 아니라 글자다');
});

test('메시지를 보내면 채팅이 끝나고 다시 버프가 잡힌다', () => {
  const g = guardWith();

  g.observe(key(K.Enter), 0);
  g.observe(key(K.A), 100); // 뭔가 침
  g.observe(key(K.Enter), 200); // 전송

  assert.ok(!g.chatting);
  assert.ok(!g.blocks(key(K.A), buff), '이제 A는 다시 버프 키다');
});

test('Esc 로 채팅을 닫으면 바로 풀린다', () => {
  const g = guardWith();
  g.observe(key(K.Enter), 0);
  g.observe(key(K.Esc), 100);
  assert.ok(!g.chatting);
});

// -------------------------------------------- 확인 엔터로 잘못 들어간 경우

test('대화상자 확인 엔터로 잘못 들어가도 이동하는 순간 풀린다', () => {
  const g = guardWith();

  g.observe(key(K.Enter), 0); // 스킬창 "확인" — 채팅이 아니다
  assert.ok(g.chatting, '입력만 봐서는 구분할 수 없으므로 일단 채팅으로 본다');

  g.observe(key(K.Left), 100); // 사냥 재개 — 방향키로 이동
  assert.ok(!g.chatting, '채팅 중이라면 나올 수 없는 입력이므로 즉시 해제');
  assert.ok(!g.blocks(key(K.A), buff), '이후 A는 정상적으로 버프 키');
});

test('점프(Alt)나 공격(Ctrl) 같은 수식키 단독 입력으로도 풀린다', () => {
  for (const code of [K.Alt, K.Ctrl]) {
    const g = guardWith();
    g.observe(key(K.Enter), 0);
    g.observe(makeHotkey({ keycode: code, bareModifier: true }), 100);
    assert.ok(!g.chatting, `keycode ${code} 로 해제되어야 한다`);
  }
});

test('확인 엔터 직후에도 F키·PgUp 버프는 애초에 막히지 않는다', () => {
  const g = guardWith();
  g.observe(key(K.Enter), 0);

  assert.ok(!g.blocks(key(K.F3), buff), 'F키는 채팅으로 오해할 수 없다');
  assert.ok(!g.blocks(key(K.PgUp), buff));
  assert.ok(!g.blocks(key(K.A, { ctrl: true, alt: true }), buff));
});

test('빈 채팅창에서 엔터를 또 눌러도 채팅 상태를 유지한다', () => {
  const g = guardWith();
  g.observe(key(K.Enter), 0);
  g.observe(key(K.Enter), 100); // 아무것도 안 치고 엔터
  assert.ok(g.chatting, '글자를 안 쳤으므로 전송으로 보지 않는다');
});

// ----------------------------------------------------------- 안전망

test('입력이 끊긴 채 시간이 지나면 채팅 상태가 저절로 풀린다', () => {
  const g = guardWith({ idleTimeoutSec: 8 });
  g.observe(key(K.Enter), 0);

  assert.strictEqual(g.sweep(5_000), false, '아직 시간 안에 있다');
  assert.ok(g.chatting);

  assert.strictEqual(g.sweep(9_000), true, '시간이 지나 해제');
  assert.ok(!g.chatting);
});

test('오래 자리를 비웠다가 누른 첫 키는 버프로 처리된다', () => {
  const g = guardWith({ idleTimeoutSec: 8 });
  g.observe(key(K.Enter), 0);

  g.observe(key(K.A), 60_000); // 한참 뒤
  assert.ok(!g.blocks(key(K.A), buff), '관찰 시점에 먼저 만료 처리된다');
});

test('채팅 감지를 끄면 아무것도 막지 않는다', () => {
  const g = guardWith({ enabled: false });
  g.observe(key(K.Enter), 0);
  assert.ok(!g.chatting);
  assert.ok(!g.blocks(key(K.A), buff));
});

// -------------------------------------------------------- 수동 일시정지

test('수동 일시정지는 버프만 막고 앱 단축키는 살려둔다', () => {
  const g = guardWith();
  g.setManualPause(true);

  assert.ok(g.blocks(key(K.A), buff));
  assert.ok(!g.blocks(key(K.A), { type: 'app', payload: 'resetAll' }));
  assert.ok(!g.blocks(key(K.A), { type: 'profile', payload: 'p1' }));
});

test('감지 재개 키는 어떤 상태에서도 먹어야 한다', () => {
  const toggle = { type: 'app', payload: 'detectionToggle' };

  const paused = guardWith();
  paused.setManualPause(true);
  assert.ok(!paused.blocks(key(K.A), toggle), '일시정지 중에도 빠져나올 수 있어야 한다');

  const chatting = guardWith();
  chatting.observe(key(K.Enter), 0);
  assert.ok(!chatting.blocks(key(K.A), toggle), '채팅 중에도 마찬가지');
});
