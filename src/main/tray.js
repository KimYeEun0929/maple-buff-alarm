'use strict';

const path = require('path');
const { Tray, Menu, nativeImage } = require('electron');

const ICON_PATH = path.join(__dirname, '..', '..', 'assets', 'tray.png');

/**
 * 트레이 상주.
 *
 * 사냥 중에는 설정 창을 볼 일이 없지만, 창을 닫으면 앱이 죽어버리면 곤란하다.
 * 트레이가 앱의 수명을 쥐고, 설정 창은 그냥 여닫는 화면이 된다.
 *
 * 게임 중 Alt+Tab 없이 쓸 수 있는 건 단축키 쪽이고, 트레이는
 * 단축키를 아직 등록하지 않았거나 잊었을 때의 경로다.
 */
class AppTray {
  constructor(handlers) {
    this.handlers = handlers;
    this.tray = null;
  }

  build() {
    if (this.tray) return;
    const icon = nativeImage.createFromPath(ICON_PATH);
    this.tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    this.tray.on('click', () => this.handlers.openSettings());
    this.tray.on('double-click', () => this.handlers.openSettings());
    this.refresh();
  }

  refresh() {
    if (!this.tray) return;
    const s = this.handlers.getState();

    const profileItems = s.profiles.map((p) => ({
      label: p.job ? `${p.name} (${p.job})` : p.name,
      type: 'radio',
      checked: p.id === s.activeProfileId,
      click: () => this.handlers.selectProfile(p.id),
    }));

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: activeLabel(s), enabled: false },
        { type: 'separator' },
        {
          label: '캐릭터 전환',
          enabled: profileItems.length > 0,
          submenu: profileItems.length ? profileItems : [{ label: '없음', enabled: false }],
        },
        { label: '설정 열기', click: () => this.handlers.openSettings() },
        { type: 'separator' },
        {
          label: '음소거',
          type: 'checkbox',
          checked: s.muted,
          click: () => this.handlers.runAction('muteToggle'),
        },
        {
          label: '감지 일시정지',
          type: 'checkbox',
          checked: s.guard.manualPause,
          click: () => this.handlers.runAction('detectionToggle'),
        },
        {
          label: '오버레이 표시',
          type: 'checkbox',
          checked: s.overlayVisible,
          click: () => this.handlers.runAction('toggleOverlay'),
        },
        { type: 'separator' },
        { label: '전체 리셋', click: () => this.handlers.runAction('resetAll') },
        { label: '소환수 리셋', click: () => this.handlers.runAction('resetVolatile') },
        { type: 'separator' },
        { label: '종료', click: () => this.handlers.quit() },
      ])
    );

    this.tray.setToolTip(tooltip(s));
  }

  destroy() {
    if (!this.tray) return;
    this.tray.destroy();
    this.tray = null;
  }
}

function activeLabel(s) {
  const active = s.profiles.find((p) => p.id === s.activeProfileId);
  return active ? `◆ ${active.name}` : '캐릭터 없음';
}

/** 트레이에 마우스만 올려도 지금 상태를 알 수 있어야 한다. */
function tooltip(s) {
  const lines = ['메이플랜드 버프 알람', activeLabel(s)];
  if (s.hookStatus === 'running') lines.push('키 후킹 작동 중');
  else if (s.hookStatus === 'error') lines.push('키 후킹 실패');
  else lines.push('키 후킹 꺼짐');
  if (s.muted) lines.push('음소거');
  if (s.guard.manualPause) lines.push('감지 정지');
  else if (s.guard.chatting) lines.push('채팅 중');
  return lines.join('\n');
}

module.exports = AppTray;
module.exports.tooltip = tooltip;
module.exports.activeLabel = activeLabel;
