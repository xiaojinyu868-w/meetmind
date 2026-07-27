// MeetMind 桌面采集壳 v2 —— 内嵌主窗口（MeetMind 网页跑在壳内）
//
// 为什么需要这个窗口：
// 1) 截图收集要复用网页登录态（localStorage 里的 meetmind_access_token），
//    只有 MeetMind 跑在壳内，主进程才能直接读到 token；
// 2) 网页内录课需要「主屏幕视频轨 + 系统声音 loopback」，
//    只有壳才能通过 setDisplayMediaRequestHandler 免弹窗授权。
// 所以 v2 起不再用 shell.openExternal 打开外部浏览器。
const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  desktopCapturer,
  shell,
} = require('electron');

let shellWindow = null;
let tray = null;
let meetmindOrigin = 'https://capture.meetmind.online';

function getShellWindow() {
  return shellWindow;
}

// ── 窗口位置/尺寸持久化（用户关了再开，窗口回到原处）──────────────
function shellStatePath() {
  return path.join(app.getPath('userData'), 'shell-window-state.json');
}

function readShellState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(shellStatePath(), 'utf8'));
    if (typeof parsed.width !== 'number' || typeof parsed.height !== 'number') return null;
    // 显示器可能换了：校验窗口仍落在某块屏幕工作区内，否则丢弃
    const { screen } = require('electron');
    const display = screen.getDisplayMatching({
      x: parsed.x || 0,
      y: parsed.y || 0,
      width: parsed.width,
      height: parsed.height,
    });
    const area = display.workArea;
    const inside =
      (parsed.x || 0) >= area.x - parsed.width / 2 &&
      (parsed.y || 0) >= area.y - 40 &&
      (parsed.x || 0) < area.x + area.width &&
      (parsed.y || 0) < area.y + area.height;
    return inside ? parsed : null;
  } catch {
    return null;
  }
}

function saveShellState(win) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    fs.writeFileSync(shellStatePath(), JSON.stringify(win.getBounds()));
  } catch {
    // ignore
  }
}

// ── 系统内录授权（这是壳的核心价值之一）──────────────────────────
function registerDisplayMediaHandler(win) {
  // 网页里直接调 getDisplayMedia 会弹系统级「选择要分享的内容」选择器，
  // 而且多数平台默认不给电脑声音。壳在这里接管授权：直接给主屏幕视频轨 +
  // loopback 音频轨，用户在壳内录网课时无弹窗、且能录到电脑声音
  // （Windows 走 WASAPI loopback；macOS 依赖 main.js 里的启动参数）。
  win.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        if (!sources.length) {
          callback({});
          return;
        }
        callback({ video: sources[0], audio: 'loopback' });
      })
      .catch((err) => {
        console.warn('[desktop] displayMedia 授权失败，回退空轨', err);
        callback({});
      });
  });
}

// ── 安全与导航策略 ───────────────────────────────────────────────
function isInternalUrl(url) {
  return url.startsWith(meetmindOrigin) || url.startsWith('devtools:');
}

function registerSecurityHandlers(win) {
  // 权限最小化：只放行 MeetMind 站内需要的媒体权限，其余一律拒绝
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    const allowed = ['media', 'display-capture', 'notifications', 'clipboard-sanitized-write'];
    callback(allowed.includes(permission));
  });

  // 网页内 target=_blank：站内链接就在主窗口里打开，站外一律交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalUrl(url)) {
      void win.loadURL(url);
    } else if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 主窗口导航守卫：离开 MeetMind 站点的导航改由系统浏览器承担，
  // 壳内永远是 MeetMind（防被网页内容带跑去第三方页面）
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) {
        void shell.openExternal(url);
      }
    }
  });
}

// ── 断网兜底：加载失败给本地重试页，不留白屏 ─────────────────────
function registerLoadFailureFallback(win) {
  win.webContents.on('did-fail-load', (_event, errorCode, _desc, validatedURL, isMainFrame) => {
    // -3 = ERR_ABORTED（用户主动跳走），不是失败
    if (!isMainFrame || errorCode === -3) return;
    console.warn('[desktop] 主窗口加载失败，进入断网兜底页', errorCode, validatedURL);
    void win.loadFile(path.join(__dirname, 'offline.html'), {
      search: `retry=${encodeURIComponent(validatedURL || meetmindOrigin)}`,
    });
  });
}

function createShellWindow(meetmindUrl) {
  meetmindOrigin = new URL(meetmindUrl).origin;
  if (shellWindow) return shellWindow;

  const saved = readShellState();
  shellWindow = new BrowserWindow({
    width: saved?.width || 1280,
    height: saved?.height || 840,
    x: saved?.x,
    y: saved?.y,
    minWidth: 960,
    minHeight: 640,
    show: false, // ready-to-show 再亮相，避免白屏闪一下
    autoHideMenuBar: true,
    icon: nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png')),
    webPreferences: {
      // 主窗口加载的是远端网页，安全基线不能松：不开 node、保持隔离
      contextIsolation: true,
      nodeIntegration: false,
      // 与桌面小窗（quick-panel）共享登录态：token 在 localStorage，
      // 同一 partition 才有同一份 localStorage
      partition: 'persist:meetmind',
    },
  });

  // 必须在 loadURL 之前注册，否则网页首次请求录屏时 handler 还没挂上
  registerDisplayMediaHandler(shellWindow);
  registerSecurityHandlers(shellWindow);
  registerLoadFailureFallback(shellWindow);
  shellWindow.loadURL(meetmindUrl);
  shellWindow.once('ready-to-show', () => {
    shellWindow?.show();
  });

  // 关闭按钮只隐藏不退出：壳要常驻，登录态和 token 才不会随窗口消失
  shellWindow.on('close', (event) => {
    if (app.isQuitting) return;
    saveShellState(shellWindow);
    event.preventDefault();
    shellWindow?.hide();
  });
  shellWindow.on('closed', () => {
    shellWindow = null;
  });
  shellWindow.on('resized', () => saveShellState(shellWindow));
  shellWindow.on('moved', () => saveShellState(shellWindow));
  return shellWindow;
}

function showShellWindow() {
  if (!shellWindow) return;
  if (shellWindow.isMinimized()) shellWindow.restore();
  shellWindow.show();
  shellWindow.focus();
}

function toggleShellWindow() {
  if (!shellWindow) return;
  if (shellWindow.isVisible() && shellWindow.isFocused()) {
    shellWindow.hide();
    return;
  }
  showShellWindow();
}

// 悬浮球「听课 / 问同学 / 打开 MeetMind」的入口：显示主窗口并确保停在 /app。
// 用户可能已经在壳内学到一半，只有不在 /app 时才导航回去，避免打断学习现场。
function showShellWindowAt(meetmindUrl) {
  if (!shellWindow) {
    createShellWindow(meetmindUrl);
    return;
  }
  const currentUrl = shellWindow.webContents.getURL();
  if (!currentUrl.startsWith(meetmindUrl)) {
    void shellWindow.loadURL(meetmindUrl);
  }
  showShellWindow();
}

// ── 系统托盘 ─────────────────────────────────────────────────────
function createTray({ onToggle }) {
  try {
    // macOS 用 Template 图（系统自动适配明暗菜单栏），其余平台用普通小图
    const iconName = process.platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon.png';
    let icon = nativeImage.createFromPath(path.join(__dirname, 'assets', iconName));
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip('MeetMind 同学');

    rebuildTrayMenu(onToggle);
    // 左键点击 = 显示 / 隐藏主窗口
    tray.on('click', onToggle);
  } catch (err) {
    // Linux 无托盘服务 / 无显示环境时降级为 log，不影响其他能力
    console.warn('[desktop] 系统托盘不可用，已跳过', err);
  }
}

function rebuildTrayMenu(onToggle) {
  if (!tray) return;
  const version = app.getVersion();
  const loginSettings = app.getLoginItemSettings();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `MeetMind 桌面端 v${version}`, enabled: false },
      { label: '截图热键：Ctrl/Cmd + Shift + M', enabled: false },
      { type: 'separator' },
      { label: '显示 / 隐藏 MeetMind', click: onToggle },
      {
        label: '开机自动启动',
        type: 'checkbox',
        checked: loginSettings.openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked });
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ])
  );
}

module.exports = {
  createShellWindow,
  getShellWindow,
  showShellWindow,
  showShellWindowAt,
  toggleShellWindow,
  createTray,
};
