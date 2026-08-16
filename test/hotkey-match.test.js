'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  KeyResolver,
  signature,
  describe,
  makeHotkey,
  isModifier,
  findCollisions,
} = require('../src/main/hotkey-match');

const KEY = { A: 30, B: 48, PgUp: 3657, Shift: 42, ShiftRight: 54, Ctrl: 29, Alt: 56, Num1: 79, Digit1: 2 };

const down = (keycode, mods = {}) => ({ keycode, ...mods });
const up = down;

test('물리 keycode 를 쓰므로 상단 숫자열과 넘패드가 구분된다', () => {
  assert.notStrictEqual(signature(makeHotkey({ keycode: KEY.Digit1 })), signature(makeHotkey({ keycode: KEY.Num1 })));
  assert.strictEqual(describe(makeHotkey({ keycode: KEY.Num1 })), '넘패드1');
  assert.strictEqual(describe(makeHotkey({ keycode: KEY.Digit1 })), '1');
});

test('조합키 라벨', () => {
  assert.strictEqual(describe(makeHotkey({ keycode: KEY.A, ctrl: true, shift: true })), 'Ctrl+Shift+A');
  assert.strictEqual(describe(makeHotkey({ keycode: KEY.PgUp })), 'PgUp');
  assert.strictEqual(describe(makeHotkey({ keycode: KEY.Shift, bareModifier: true })), 'Shift (단독)');
});

test('수식키는 keydown 이 아니라 keyup 에서 단독 발동으로 판정한다', () => {
  const r = new KeyResolver();
  assert.strictEqual(r.keydown(down(KEY.Shift), 0), null, 'keydown 에서는 확정하지 않는다');

  const fired = r.keyup(up(KEY.Shift), 10);
  assert.ok(fired, 'keyup 에서 발동');
  assert.strictEqual(fired.bareModifier, true);
  assert.strictEqual(fired.keycode, KEY.Shift);
});

test('Shift+A 를 눌러도 Shift 단독은 발동하지 않는다', () => {
  const r = new KeyResolver();
  r.keydown(down(KEY.Shift), 0);

  const combo = r.keydown(down(KEY.A, { shiftKey: true }), 10);
  assert.deepStrictEqual(
    [combo.keycode, combo.shift, combo.bareModifier],
    [KEY.A, true, false]
  );

  r.keyup(up(KEY.A), 20);
  assert.strictEqual(r.keyup(up(KEY.Shift), 30), null, 'Shift 는 조합의 일부였으므로 발동 안 함');
});

test('수식키를 놓았다가 다시 단독으로 누르면 발동한다', () => {
  const r = new KeyResolver();
  r.keydown(down(KEY.Shift), 0);
  r.keydown(down(KEY.A, { shiftKey: true }), 10);
  r.keyup(up(KEY.A), 20);
  r.keyup(up(KEY.Shift), 30); // 조합이었으므로 발동 안 함

  r.keydown(down(KEY.Shift), 1000);
  assert.ok(r.keyup(up(KEY.Shift), 1010), '이번에는 단독이므로 발동');
});

test('두 수식키를 함께 눌렀다 놓으면 어느 쪽도 단독이 아니다', () => {
  const r = new KeyResolver();
  r.keydown(down(KEY.Ctrl), 0);
  r.keydown(down(KEY.Shift, { ctrlKey: true }), 10);
  assert.strictEqual(r.keyup(up(KEY.Shift), 20), null);
  assert.strictEqual(r.keyup(up(KEY.Ctrl), 30), null);
});

test('일반 키를 누르고 있는 중에 누른 수식키도 단독이 아니다', () => {
  const r = new KeyResolver();
  r.keydown(down(KEY.A), 0); // 이동키를 누른 채로 있는 상황
  r.keydown(down(KEY.Shift), 10);
  assert.strictEqual(r.keyup(up(KEY.Shift), 20), null);
});

test('좌우 Shift 는 서로 다른 키다', () => {
  const r = new KeyResolver();
  r.keydown(down(KEY.Shift), 0);
  const left = r.keyup(up(KEY.Shift), 10);

  r.keydown(down(KEY.ShiftRight), 1000);
  const right = r.keyup(up(KEY.ShiftRight), 1010);

  assert.notStrictEqual(signature(left), signature(right));
});

test('키를 누르고 있을 때 오는 반복 입력은 무시한다', () => {
  const r = new KeyResolver({ repeatMs: 300 });
  assert.ok(r.keydown(down(KEY.PgUp), 0), '첫 입력은 발동');
  assert.strictEqual(r.keydown(down(KEY.PgUp), 40), null, '반복 이벤트');
  assert.strictEqual(r.keydown(down(KEY.PgUp), 250), null, '아직 반복 구간');
  assert.ok(r.keydown(down(KEY.PgUp), 400), '간격이 지나면 다시 발동');
});

test('반복 억제는 키마다 따로 센다', () => {
  const r = new KeyResolver({ repeatMs: 300 });
  assert.ok(r.keydown(down(KEY.A), 0));
  assert.ok(r.keydown(down(KEY.B), 10), '다른 키는 막히면 안 된다');
});

test('같은 키라도 수식키 조합이 다르면 다른 단축키다', () => {
  const plain = makeHotkey({ keycode: KEY.A });
  const withCtrl = makeHotkey({ keycode: KEY.A, ctrl: true });
  assert.notStrictEqual(signature(plain), signature(withCtrl));
});

test('수식키 판별', () => {
  assert.ok(isModifier(KEY.Shift));
  assert.ok(isModifier(KEY.Ctrl));
  assert.ok(!isModifier(KEY.A));
  assert.ok(!isModifier(KEY.PgUp));
});

test('후킹 실패 원인을 조치 가능한 문장으로 바꾼다', () => {
  const { explainStartFailure } = require('../src/main/hotkey-hook');

  const missing = new Error("Cannot find module 'uiohook-napi'");
  missing.code = 'MODULE_NOT_FOUND';
  assert.match(explainStartFailure(missing), /npm install/, '무엇을 해야 하는지 알려줘야 한다');

  assert.match(
    explainStartFailure(new Error('No native build was found for platform=win32')),
    /node_modules/
  );

  // 짐작 못 하는 오류는 원문을 그대로 보여준다.
  assert.strictEqual(explainStartFailure(new Error('알 수 없는 실패')), '알 수 없는 실패');
});

test('같은 키에 두 개가 걸리면 충돌로 잡아낸다', () => {
  const hits = findCollisions([
    { hotkey: makeHotkey({ keycode: KEY.PgUp }), label: '버프: 이프리트' },
    { hotkey: makeHotkey({ keycode: KEY.PgUp }), label: '앱 단축키: 전체 리셋' },
    { hotkey: makeHotkey({ keycode: KEY.A }), label: '버프: 소울애로우' },
    { hotkey: null, label: '미등록은 무시' },
  ]);

  assert.strictEqual(hits.length, 1);
  assert.deepStrictEqual(hits[0].labels, ['버프: 이프리트', '앱 단축키: 전체 리셋']);
});

test('수식키 단독과 같은 키의 조합은 충돌이 아니다', () => {
  const hits = findCollisions([
    { hotkey: makeHotkey({ keycode: KEY.Shift, bareModifier: true }), label: 'bare' },
    { hotkey: makeHotkey({ keycode: KEY.Shift }), label: 'combo' },
  ]);
  assert.strictEqual(hits.length, 0);
});
