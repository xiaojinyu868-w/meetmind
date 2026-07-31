// MeetMind 桌面采集壳 v2 —— 主进程入口
// 职责：Chromium 启动参数、Octo Buddy 悬浮球窗口（v1 行为全部保留）、
// 以及把「内嵌主窗口 shell-window」和「全局热键截图 screenshot」两个能力接起来。
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const {
  createShellWindow,
  getShellWindow,
  showShellWindowAt,
  toggleShellWindow,
  createTray,
} = require('./shell-window');
const { registerScreenshotHotkey, retryPendingShots, captureOnce, uploadImageFile, readAccessToken } = require('./screenshot');
const { toggleQuickPanel, hideQuickPanel, registerQuickPanelHotkey } = require('./quick-panel');
const { startUpdateChecker } = require('./updater');

// Web 版 MeetMind 地址：生产默认走 capture 站点，本地调试用 MEETMIND_URL 覆盖
const MEETMIND_URL = process.env.MEETMIND_URL || 'https://capture.meetmind.online/app';

// 单实例锁：重复启动只唤起已有实例的主窗口，避免多个悬浮球/重复热键抢注册
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// macOS 的 getDisplayMedia 系统声音 loopback 依赖这两个 feature flag，
// Windows 加上也无害（WASAPI loopback 原生支持）。必须在 app ready 之前追加。
app.commandLine.appendSwitch(
  'enable-features',
  'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
);
// 网页内录屏时不再弹「选择分享内容」系统选择器，默认给整块屏幕；
// 真正的授权逻辑在 shell-window.js 的 setDisplayMediaRequestHandler 里。
app.commandLine.appendSwitch('auto-select-desktop-capture-source', 'Entire screen');

// 应用菜单：没有菜单时 macOS 上网页输入框的 Cmd+C/V/X/A 全部失效（Electron 的
// 编辑快捷键走菜单 role 注册）。Windows/Linux 菜单栏被 autoHideMenuBar 隐藏，
// 但快捷键仍然生效。
function installApplicationMenu() {
  const template = [];
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about', label: '关于 MeetMind' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 MeetMind' },
        { role: 'hideOthers', label: '隐藏其他' },
        { type: 'separator' },
        {
          label: '退出 MeetMind',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    });
  }
  template.push(
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ],
    },
    { role: 'windowMenu', label: '窗口' }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let companionWindow = null;
let expanded = false;

function positionFilePath() {
  return path.join(app.getPath('userData'), 'companion-position.json');
}

function clampToWorkArea(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - bounds.height),
  };
}

function readSavedPosition(width, height) {
  try {
    const raw = fs.readFileSync(positionFilePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return clampToWorkArea({ x: parsed.x, y: parsed.y, width, height });
  } catch {
    return null;
  }
}

function savePosition(bounds) {
  try {
    fs.writeFileSync(positionFilePath(), JSON.stringify({ x: bounds.x, y: bounds.y }));
  } catch {
    // ignore
  }
}

function windowSize() {
  // 窗口紧贴身体：矢量角色设计空间 150×140，没有需要容纳贴图的空白边
  return { width: 150, height: 140 };
}

function placeInitialWindow(win) {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = windowSize();
  const saved = readSavedPosition(width, height);
  if (saved) {
    win.setBounds(saved);
    return;
  }
  const margin = 24;
  const x = Math.round(display.workArea.x + display.workArea.width - width - margin);
  const y = Math.round(display.workArea.y + display.workArea.height - height - margin);
  win.setBounds({ x, y, width, height });
}

function createCompanionWindow() {
  const { width, height } = windowSize();
  companionWindow = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  companionWindow.setAlwaysOnTop(true, 'screen-saver');
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Windows 上锁屏/UAC/其他置顶窗口会把桌宠压下去：
  // screen-saver 是最高档，仍可能被系统事件偷走置顶，所以定时重新断言
  setInterval(() => {
    if (companionWindow && !companionWindow.isDestroyed()) {
      companionWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  }, 5000);
  placeInitialWindow(companionWindow);
  companionWindow.loadFile(path.join(__dirname, 'companion.html'));
  companionWindow.once('ready-to-show', () => companionWindow?.show());
  companionWindow.on('closed', () => {
    companionWindow = null;
  });
}

app.whenReady().then(() => {
  installApplicationMenu();
  createCompanionWindow();
  // 常驻主窗口：用户在壳内登录，截图上传复用这里的登录态
  createShellWindow(MEETMIND_URL);
  createTray({ onToggle: toggleShellWindow });

  const screenshotDeps = {
    meetmindUrl: MEETMIND_URL,
    getShellWindow,
    showShellWindow: () => showShellWindowAt(MEETMIND_URL),
    onCaptured: () => companionWindow?.webContents.send('pet:gulp'),
  };
  registerScreenshotHotkey(screenshotDeps);
  // 全局热键 Cmd/Ctrl+Shift+K：随时唤起小窗提问
  registerQuickPanelHotkey(MEETMIND_URL);
  // 上次失败暂存的截图，启动时补传一次（未登录则保留到下次）
  void retryPendingShots(screenshotDeps);
  // 自动更新检查：发现新 desktop-v* release 时安静提示一次
  startUpdateChecker();

  // 第二个实例被启动时：唤起主窗口而不是再开一套
  app.on('second-instance', () => {
    showShellWindowAt(MEETMIND_URL);
  });

  // macOS 点 Dock 图标：恢复主窗口（不只是补悬浮球）
  app.on('activate', () => {
    if (!companionWindow) createCompanionWindow();
    showShellWindowAt(MEETMIND_URL);
  });
});

// 常驻壳：所有窗口关闭也不退出，等托盘菜单或悬浮球显式退出
app.on('window-all-closed', () => {
  // 不调用 app.quit()
});

app.on('before-quit', () => {
  // 标记真正退出，让主窗口的 close 拦截放行
  app.isQuitting = true;
});

ipcMain.handle('companion:set-expanded', (_event, nextExpanded) => {
  expanded = Boolean(nextExpanded);
  if (!companionWindow) return expanded;
  const current = companionWindow.getBounds();
  const { width, height } = windowSize();
  const nextBounds = clampToWorkArea({
    x: current.x + current.width - width,
    y: current.y + current.height - height,
    width,
    height,
  });
  companionWindow.setBounds(nextBounds, true);
  savePosition(nextBounds);
  return expanded;
});

ipcMain.handle('companion:move-by', (_event, deltaX, deltaY) => {
  if (!companionWindow) return;
  const bounds = companionWindow.getBounds();
  const nextBounds = clampToWorkArea({
    ...bounds,
    x: Math.round(bounds.x + Number(deltaX || 0)),
    y: Math.round(bounds.y + Number(deltaY || 0)),
  });
  companionWindow.setBounds(nextBounds);
  savePosition(nextBounds);
});

// v2：悬浮球的 MeetMind 入口统一走壳内主窗口，不再打开外部浏览器
ipcMain.handle('companion:show-main', () => {
  showShellWindowAt(MEETMIND_URL);
});

// v3：悬浮球唤起桌面小窗（随手记 / 随口问 / 截图）
ipcMain.handle('companion:toggle-panel', () => {
  toggleQuickPanel(MEETMIND_URL);
});

ipcMain.handle('panel:hide', () => {
  hideQuickPanel();
});

// 小窗「截图收进来」：与全局热键同一条流程
ipcMain.handle('desktop:capture-screen', () => {
  return captureOnce({
    meetmindUrl: MEETMIND_URL,
    getShellWindow,
    showShellWindow: () => showShellWindowAt(MEETMIND_URL),
    onCaptured: () => companionWindow?.webContents.send('pet:gulp'),
  });
});

// 宠物双击「旁听」：驱动隐藏主窗口里的网页 Recorder（loopback 系统声录课）。
// 网页钩子由 /app 注入 window.__meetmindDesktopRecording；未注入多半是未登录或旧版网页。
ipcMain.handle('pet:toggle-listen', async () => {
  const win = getShellWindow();
  if (!win) return { listening: false, reason: 'no-shell-window' };
  try {
    const result = await win.webContents.executeJavaScript(
      'window.__meetmindDesktopRecording ? window.__meetmindDesktopRecording.toggle() : { listening: false, reason: "hook-missing" }',
      true,
    );
    // 钩子不存在时分辩一下：在登录页 → 提示登录；其余 → 页面还没加载完
    if (result?.reason === 'hook-missing') {
      const url = win.webContents.getURL();
      if (url.includes('/login')) return { listening: false, reason: 'not-logged-in' };
    }
    return result || { listening: false, reason: 'hook-missing' };
  } catch (err) {
    console.warn('[desktop] pet:toggle-listen 失败', err);
    return { listening: false, reason: 'error' };
  }
});

// 桌宠拖放图片 → 收集线（与截图同一条两步链；成功喂吞食动画）
ipcMain.handle('pet:drop-files', async (_event, files) => {
  if (!Array.isArray(files) || files.length === 0) return { ok: false, reason: 'empty' };
  const token = await readAccessToken(getShellWindow);
  if (!token) return { ok: false, reason: 'not-logged-in' };
  const origin = new URL(MEETMIND_URL).origin;
  let uploaded = 0;
  for (const file of files.slice(0, 5)) {
    try {
      const buffer = Buffer.from(String(file.dataBase64), 'base64');
      if (buffer.length === 0 || buffer.length > 12 * 1024 * 1024) continue;
      await uploadImageFile(buffer, {
        origin,
        token,
        title: typeof file.name === 'string' && file.name ? file.name : '拖进来的图',
        fileName: file.name,
        mime: file.type,
      });
      uploaded += 1;
    } catch (err) {
      console.warn('[desktop] 拖放上传失败', err);
    }
  }
  if (uploaded > 0) companionWindow?.webContents.send('pet:gulp');
  return { ok: uploaded > 0, uploaded };
});

// 姿态圆钮：宠物窗口扩/缩给圆钮腾位置。
// 画布是底部锚定的，向上扩窗宠物在屏幕上原地不动；顶部没空间就向下扩。
let dockCollapsedBounds = null;
ipcMain.handle('pet:set-dock', (_event, open) => {
  if (!companionWindow) return;
  const DOCK_H = 78;
  if (open) {
    dockCollapsedBounds = companionWindow.getBounds();
    const b = dockCollapsedBounds;
    const area = screen.getDisplayMatching(b).workArea;
    const roomAbove = b.y - area.y >= DOCK_H;
    const next = roomAbove
      ? { x: b.x, y: b.y - DOCK_H, width: b.width, height: b.height + DOCK_H }
      : { x: b.x, y: b.y, width: b.width, height: b.height + DOCK_H };
    companionWindow.setBounds(clampToWorkArea(next));
  } else if (dockCollapsedBounds) {
    companionWindow.setBounds(dockCollapsedBounds);
    dockCollapsedBounds = null;
  }
});

ipcMain.handle('pet:menu', () => {
  const send = (action) => companionWindow?.webContents.send('pet:action', action);
  const menu = Menu.buildFromTemplate([
    { label: '问同学', click: () => send('ask') },
    { label: '旁听', click: () => send('listen') },
    { label: '收下这一页', click: () => send('capture') },
    { type: 'separator' },
    { label: '打开 MeetMind', click: () => showShellWindowAt(MEETMIND_URL) },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  if (companionWindow) menu.popup({ window: companionWindow });
});

// 小窗打开主窗口；path 只允许站内相对路径，防被注入站外 URL
ipcMain.handle('desktop:show-main', (_event, path) => {
  const origin = new URL(MEETMIND_URL).origin;
  const safePath = typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    ? path
    : '/app';
  showShellWindowAt(`${origin}${safePath}`);
});

ipcMain.handle('companion:quit', () => {
  app.isQuitting = true;
  app.quit();
});
