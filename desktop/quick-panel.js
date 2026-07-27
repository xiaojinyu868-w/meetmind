// 桌面小窗（Quick Panel）：加载 Web 端 /companion 紧凑面板。
//
// 为什么小窗 UI 在 Web 端而不是 desktop/ 里手写：
//   面板要复用整套设计系统、COPY 文案和 /api/tutor/agent 数据层，
//   写在 desktop/ 里手写 vanilla JS 等于维护第二套前端。
//   壳只负责承载：无边框透明窗口、置顶、与小球/热键/托盘的接线。
//
// 登录态：与内嵌主窗口共用 session partition（persist:meetmind），
// 用户在主窗口登录后，小窗直接可用，不需要二次登录。
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 620;
const MARGIN = 24;

let panelWindow = null;

function panelUrl(meetmindUrl) {
  return `${new URL(meetmindUrl).origin}/companion`;
}

function placePanel(win) {
  // 默认落在右下角（Dock/任务栏上方），与悬浮球同一侧，符合"从角落长出来"的心智
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  win.setBounds({
    x: Math.round(area.x + area.width - PANEL_WIDTH - MARGIN),
    y: Math.round(area.y + area.height - PANEL_HEIGHT - MARGIN),
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
  });
}

function createQuickPanel(meetmindUrl) {
  if (panelWindow) return panelWindow;
  panelWindow = new BrowserWindow({
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT,
    frame: false,
    transparent: true, // 圆角由 /companion 页面自己渲染
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'panel-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 与 shell-window 主窗口共享登录态（localStorage 里的 access token）
      partition: 'persist:meetmind',
    },
  });

  panelWindow.setAlwaysOnTop(true, 'floating');
  placePanel(panelWindow);
  panelWindow.loadURL(panelUrl(meetmindUrl));
  panelWindow.once('ready-to-show', () => panelWindow?.show());
  // 失焦自动收起：小窗是"伸手用一下"的形态，不占注意力
  panelWindow.on('blur', () => {
    if (panelWindow?.isVisible()) panelWindow.hide();
  });
  panelWindow.on('closed', () => {
    panelWindow = null;
  });
  return panelWindow;
}

function toggleQuickPanel(meetmindUrl) {
  const panel = createQuickPanel(meetmindUrl);
  if (panel.isVisible() && panel.isFocused()) {
    panel.hide();
    return;
  }
  placePanel(panel);
  panel.show();
  panel.focus();
}

function hideQuickPanel() {
  if (panelWindow?.isVisible()) panelWindow.hide();
}

module.exports = {
  createQuickPanel,
  toggleQuickPanel,
  hideQuickPanel,
};
