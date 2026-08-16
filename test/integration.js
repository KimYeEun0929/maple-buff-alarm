'use strict';

/**
 * 메인 프로세스 모듈 통합 검증.
 *
 * store.js 는 electron-store 를 통해 app.getPath('userData') 에 의존하므로
 * 순수 node 로는 돌릴 수 없다. 그래서 이 파일은 Electron 을 메인 프로세스로 띄워 실행한다.
 *
 *   npm run test:integration
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const assert = require('assert');
const { app } = require('electron');

// 실제 사용자 설정을 건드리지 않도록 임시 디렉터리로 돌린다. store 를 require 하기 전에 해야 한다.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mba-test-'));
app.setPath('userData', tmpDir);

const store = require('../src/main/store');
const TimerCore = require('../src/main/timer-core');
const Notifier = require('../src/main/notifier');
const HotkeyHook = require('../src/main/hotkey-hook');
const ChatGuard = require('../src/main/chat-guard');
const { makeHotkey } = require('../src/main/hotkey-match');

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`FAIL ${name}\n     ${err.message}`);
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  await check('설정을 읽으면 빠진 키가 기본값으로 채워진다', () => {
    const s = store.getSettings();
    assert.strictEqual(s.overlay.mode, 'list');
    assert.strictEqual(s.minAlertGapSec, 5);
    assert.strictEqual(typeof s.overlay.locked, 'boolean');
    assert.strictEqual(s.ttsVoiceURI, null, '음성 미지정이 기본값이어야 자동 선택으로 동작한다');
    assert.strictEqual(s.ttsPitch, 1.0);
  });

  await check('음성 선택은 저장되고, 해제하면 자동으로 돌아간다', () => {
    store.setSettings({ ttsVoiceURI: 'urn:voice:heami' });
    assert.strictEqual(store.getSettings().ttsVoiceURI, 'urn:voice:heami');
    store.setSettings({ ttsVoiceURI: null });
    assert.strictEqual(store.getSettings().ttsVoiceURI, null);
  });

  await check('부분 업데이트가 overlay 하위 키를 지우지 않는다', () => {
    store.setSettings({ overlay: { mode: 'compact' } });
    const s = store.getSettings();
    assert.strictEqual(s.overlay.mode, 'compact');
    assert.strictEqual(s.overlay.opacity, 0.92, 'opacity 가 사라지면 안 된다');
    store.setSettings({ overlay: { mode: 'list' } });
  });

  let profile;
  await check('캐릭터를 만들고 버프를 저장하면 다시 읽힌다', () => {
    profile = store.createProfile({ name: '주술사 본캐', job: '주술사' });
    const buff = { ...store.createBuff(), name: '이프리트', durationSec: 220, volatile: true };
    profile.buffs.push(buff);
    store.saveProfile(profile);

    const reloaded = store.getProfile(profile.id);
    assert.strictEqual(reloaded.buffs.length, 1);
    assert.strictEqual(reloaded.buffs[0].name, '이프리트');
    assert.strictEqual(reloaded.buffs[0].durationSec, 220);
    assert.strictEqual(reloaded.buffs[0].volatile, true);
  });

  await check('복제하면 버프 내용은 같고 id 는 새로 생긴다', () => {
    const copy = store.duplicateProfile(profile.id);
    assert.strictEqual(copy.buffs.length, 1);
    assert.strictEqual(copy.buffs[0].name, '이프리트');
    assert.notStrictEqual(copy.id, profile.id);
    assert.notStrictEqual(copy.buffs[0].id, profile.buffs[0].id, 'id 가 겹치면 타이머가 충돌한다');
    store.deleteProfile(copy.id);
  });

  await check('복제해도 전환 단축키는 물려받지 않는다', () => {
    profile.switchHotkey = makeHotkey({ keycode: 3657 }); // PgUp
    store.saveProfile(profile);

    const copy = store.duplicateProfile(profile.id);
    assert.strictEqual(copy.switchHotkey, null, '같은 키에 두 캐릭터가 걸리면 하나는 안 먹는다');
    assert.ok(store.getProfile(profile.id).switchHotkey, '원본은 유지되어야 한다');

    store.deleteProfile(copy.id);
    profile.switchHotkey = null;
    store.saveProfile(profile);
  });

  await check('앱 단축키는 한 개만 바꿔도 나머지가 남는다', () => {
    const hk = makeHotkey({ keycode: 30, ctrl: true, alt: true }); // Ctrl+Alt+A
    store.setSettings({ appHotkeys: { resetAll: hk } });
    store.setSettings({ appHotkeys: { muteToggle: makeHotkey({ keycode: 48 }) } });

    const saved = store.getSettings().appHotkeys;
    assert.strictEqual(saved.resetAll.label, 'Ctrl+Alt+A', '먼저 넣은 키가 사라지면 안 된다');
    assert.strictEqual(saved.muteToggle.label, 'B');
    assert.strictEqual(saved.toggleOverlay, null);

    store.setSettings({ appHotkeys: { resetAll: null, muteToggle: null } });
  });

  await check('자동완성 목록은 모든 캐릭터의 버프 이름을 모아 중복을 없앤다', () => {
    const other = store.createProfile({ name: '저격수 부캐' });
    other.buffs.push(
      { ...store.createBuff(), name: '소울애로우' },
      { ...store.createBuff(), name: '이프리트' } // 다른 캐릭터와 겹치는 이름
    );
    store.saveProfile(other);

    assert.deepStrictEqual(store.knownBuffNames(), ['소울애로우', '이프리트']);
    store.deleteProfile(other.id);
  });

  await check('활성 캐릭터를 지우면 다른 캐릭터로 넘어간다', () => {
    const a = store.createProfile({ name: 'A' });
    store.setSettings({ activeProfileId: a.id });
    store.deleteProfile(a.id);
    assert.notStrictEqual(store.getSettings().activeProfileId, a.id);
    assert.ok(store.getActiveProfile(), '남은 캐릭터가 활성화되어야 한다');
  });

  await check('최소 간격 안에 쌓인 알림은 하나로 합쳐 한 번만 발화한다', async () => {
    store.setSettings({ minAlertGapSec: 0.4 });
    const notifier = new Notifier(() => store.getSettings());
    const spoken = [];
    notifier.on('announce', (a) => spoken.push(a.text));

    notifier.enqueue([{ id: '1', name: '이프리트', kind: 'soon' }]);
    await wait(50);
    // 첫 발화 직후 도착한 두 건은 간격이 지날 때까지 묶여 대기한다.
    notifier.enqueue([{ id: '2', name: '소울애로우', kind: 'soon' }]);
    notifier.enqueue([{ id: '3', name: '메디테이션', kind: 'soon' }]);
    await wait(600);

    assert.deepStrictEqual(spoken, ['이프리트', '소울애로우, 메디테이션']);
    notifier.clear();
    store.setSettings({ minAlertGapSec: 5 });
  });

  await check('타이머 코어와 알림이 실제 시간으로 연결된다', async () => {
    store.setSettings({ minAlertGapSec: 0 });
    const core = new TimerCore();
    const notifier = new Notifier(() => store.getSettings());
    const spoken = [];

    core.on('due', (items) => notifier.enqueue(items));
    notifier.on('announce', (a) => spoken.push(a.text));

    core.loadBuffs([
      {
        id: 'x',
        name: '아기용의 이유식',
        durationSec: 1,
        preNoticeSec: 0,
        tts: '',
        volatile: false,
        enabled: true,
      },
    ]);
    core.run();
    core.startBuff('x');

    await wait(1400);
    core.stop();
    notifier.clear();

    assert.deepStrictEqual(spoken, ['아기용의 이유식 만료']);
    assert.strictEqual(core.snapshot()[0].phase, 'EXPIRED');
    store.setSettings({ minAlertGapSec: 5 });
  });

  await check('후킹이 꺼져 있으면 단축키 캡처는 켜라고 안내한다', async () => {
    const h = new HotkeyHook();
    await assert.rejects(() => h.capture(), /먼저 켜야/);
  });

  await check('후킹이 실패한 상태면 캡처 거절에 진짜 원인이 실린다', async () => {
    const h = new HotkeyHook();
    h.status = 'error';
    h.error = '키 후킹 모듈(uiohook-napi)이 설치되어 있지 않습니다.\nnpm install 을 실행하세요.';

    // "켜세요"라고만 하면 이미 켠 사용자는 무엇이 문제인지 알 수 없다.
    await assert.rejects(() => h.capture(), /npm install/);
  });

  await check('등록된 키가 눌리면 무엇을 해야 하는지 알려준다', () => {
    const h = new HotkeyHook();
    h.setBindings([
      { hotkey: makeHotkey({ keycode: 3657 }), type: 'buff', payload: 'buff-ifrit' },
      { hotkey: makeHotkey({ keycode: 42, bareModifier: true }), type: 'app', payload: 'resetAll' },
    ]);

    const fired = [];
    h.on('trigger', (hit) => fired.push(hit));

    h.onKeyDown({ keycode: 3657 }); // PgUp 누름 → 버프 발동
    h.onKeyUp({ keycode: 3657 });
    h.onKeyDown({ keycode: 42 }); // Shift 누름 — 아직 확정 아님
    h.onKeyUp({ keycode: 42 }); // Shift 뗌 — 단독 발동
    h.onKeyDown({ keycode: 48 }); // 등록되지 않은 키
    h.onKeyUp({ keycode: 48 });

    assert.deepStrictEqual(fired, [
      { type: 'buff', payload: 'buff-ifrit' },
      { type: 'app', payload: 'resetAll' },
    ]);
  });

  await check('채팅을 치면 글자 키 버프는 안 걸리고 F키 버프는 걸린다 (후킹 전체 경로)', async () => {
    const guard = new ChatGuard(() => ({ enabled: true, idleTimeoutSec: 8 }));
    const h = new HotkeyHook({ guard });
    h.setBindings([
      { hotkey: makeHotkey({ keycode: 30 }), type: 'buff', payload: 'buff-on-A' },
      { hotkey: makeHotkey({ keycode: 61 }), type: 'buff', payload: 'buff-on-F3' },
    ]);

    const fired = [];
    h.on('trigger', (hit) => fired.push(hit.payload));

    const tap = async (keycode) => {
      h.onKeyDown({ keycode });
      h.onKeyUp({ keycode });
      await wait(320); // 키 반복 억제(300ms)를 넘긴다
    };

    await tap(28); // Enter — 채팅창 열기
    assert.ok(guard.chatting);

    await tap(30); // "a" 를 침
    assert.deepStrictEqual(fired, [], '채팅 중 글자 키는 버프가 아니다');

    await tap(61); // F3 — 채팅창에 글자를 남기지 않는 키
    assert.deepStrictEqual(fired, ['buff-on-F3'], 'F키 버프는 채팅 중에도 살아 있어야 한다');

    await tap(57419); // ← 이동. 채팅 중일 수 없는 입력
    assert.ok(!guard.chatting, '사냥을 재개하는 순간 채팅 상태가 풀린다');

    await tap(30);
    assert.deepStrictEqual(fired, ['buff-on-F3', 'buff-on-A'], '이제 A 는 다시 버프 키');
  });

  await check('내보낸 설정을 그대로 다시 가져올 수 있다', () => {
    const p = store.createProfile({ name: '왕복 테스트', job: '도적' });
    p.switchHotkey = makeHotkey({ keycode: 3666 }); // Ins
    p.buffs.push({ ...store.createBuff(), name: '헤이스트', durationSec: 300 });
    store.saveProfile(p);
    store.setSettings({ ttsRate: 1.35, overlay: { mode: 'compact' } });

    const dump = JSON.parse(JSON.stringify(store.exportData()));
    store.deleteProfile(p.id);
    store.setSettings({ ttsRate: 1.0, overlay: { mode: 'list' } });

    const summary = store.importData(dump);
    const back = store.getProfile(p.id);

    assert.ok(back, '캐릭터가 되살아나야 한다');
    assert.strictEqual(back.buffs[0].name, '헤이스트');
    assert.strictEqual(back.switchHotkey.label, 'Ins');
    assert.strictEqual(store.getSettings().ttsRate, 1.35);
    assert.strictEqual(store.getSettings().overlay.mode, 'compact');
    assert.ok(summary.profiles >= 1);

    store.deleteProfile(p.id);
  });

  await check('손상된 설정 파일을 가져와도 앱이 깨지지 않는다', () => {
    const before = store.getProfiles().length;

    store.importData({
      profiles: [
        { name: '값이 빠진 캐릭터', buffs: [{ name: '이프리트' }] }, // id·지속시간 없음
        { name: '이상한 값', buffs: [{ name: 'x', durationSec: 'abc', preNoticeSec: -5 }] },
        null, // 통째로 잘못된 항목
      ],
      settings: { ttsVolume: 0.5, activeProfileId: '존재하지-않는-id' },
    });

    const [a, b] = store.getProfiles();
    assert.strictEqual(store.getProfiles().length, 2, '잘못된 항목은 버린다');
    assert.ok(a.id, 'id 를 새로 만들어 준다');
    assert.strictEqual(a.buffs[0].durationSec, 180, '빠진 값은 기본값으로');
    assert.strictEqual(b.buffs[0].durationSec, 180, '숫자가 아니면 기본값으로');
    assert.strictEqual(b.buffs[0].preNoticeSec, 0, '범위를 벗어나면 잘라낸다');
    assert.strictEqual(store.getSettings().activeProfileId, a.id, '없는 캐릭터를 가리키면 되돌린다');
    assert.strictEqual(store.getSettings().overlay.mode, 'list', '빠진 설정은 기본값으로 채운다');

    void before;
  });

  await check('내보내기 형식이 아닌 파일은 이유를 붙여 거절한다', () => {
    assert.throws(() => store.importData({ hello: 'world' }), /내보낸 설정 파일이 아닙니다/);
    assert.throws(() => store.importData(null), /내보낸 설정 파일이 아닙니다/);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(run);
