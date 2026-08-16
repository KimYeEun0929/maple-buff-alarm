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

  await check('후킹이 꺼져 있으면 단축키 캡처는 이유를 붙여 거절한다', async () => {
    const h = new HotkeyHook();
    await assert.rejects(() => h.capture(), /키 후킹이 켜져 있어야/);
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

  console.log(`\n${passed} passed, ${failures.length} failed`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  app.exit(failures.length === 0 ? 0 : 1);
}

app.whenReady().then(run);
