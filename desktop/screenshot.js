// MeetMind 桌面采集壳 v2 —— 全局热键截图 → 收集线
//
// 核心新能力：Ctrl/Cmd+Shift+M 截取鼠标所在屏，
// 复用壳内主窗口的登录态，走「upload-image 拿 mediaUrl → captures 写收集线」
// 两步进 MeetMind。失败重试一次（间隔 2s），仍失败则暂存
// userData/pending-shots/，下次启动时补传一次。
const fs = require('fs');
const path = require('path');
const { app, desktopCapturer, globalShortcut, screen, Notification } = require('electron');

const HOTKEY = 'CommandOrControl+Shift+M';
const RETRY_DELAY_MS = 2000;

// 连按热键只处理一次，避免重复截图重复上传
let capturing = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Linux 无通知服务等场景下 Notification 可能不可用：降级为 log，不 crash
function notify({ title, body, onClick }) {
  try {
    if (!Notification.isSupported()) {
      console.log(`[desktop] 通知不可用：${title} - ${body}`);
      return;
    }
    const notification = new Notification({ title, body });
    if (onClick) notification.on('click', onClick);
    notification.show();
  } catch (err) {
    console.warn('[desktop] 发送通知失败', err);
  }
}

function pendingDir() {
  return path.join(app.getPath('userData'), 'pending-shots');
}

// 取鼠标所在那块屏的截图：多屏环境下 source.display_id 与 display.id 对应
async function captureCursorScreen() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 },
  });
  const source =
    sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('没有拿到可用的屏幕截图');
  }
  return source.thumbnail.toPNG();
}

// token 存在主窗口网页的 localStorage 里，只有壳内窗口才能直接读到
async function readAccessToken(getShellWindow) {
  const win = getShellWindow();
  if (!win) return null;
  try {
    const token = await win.webContents.executeJavaScript(
      "localStorage.getItem('meetmind_access_token')"
    );
    return typeof token === 'string' && token ? token : null;
  } catch (err) {
    console.warn('[desktop] 读取登录态失败', err);
    return null;
  }
}

function formatHHmm(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 一次完整上传：先传图拿 mediaUrl，再写一条 capture 进收集线
async function uploadOnce(pngBuffer, origin, token, ts) {
  const form = new FormData();
  form.append('image', new Blob([pngBuffer], { type: 'image/png' }), `screenshot-${ts}.png`);
  form.append('imageKey', `shot-${ts}`);
  const uploadRes = await fetch(`${origin}/api/workspace/upload-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!uploadRes.ok) throw new Error(`upload-image 返回 ${uploadRes.status}`);
  const uploadData = await uploadRes.json();
  if (!uploadData?.success || !uploadData.mediaUrl) {
    throw new Error('upload-image 返回缺少 mediaUrl');
  }

  const now = new Date();
  const captureRes = await fetch(`${origin}/api/workspace/captures`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sourceType: 'desktop-screenshot',
      sourceKey: `desktop-shot-${ts}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'support',
      contentType: 'image',
      title: `屏幕截图 · ${formatHHmm(now)}`,
      mediaUrl: uploadData.mediaUrl,
      occurredAt: now.toISOString(),
      metadata: { channel: 'desktop-companion' },
    }),
  });
  if (!captureRes.ok) throw new Error(`captures 返回 ${captureRes.status}`);
}

// 失败重试一次（间隔 2s）再放弃，交给 pending-shots 兜底
async function uploadWithRetry(pngBuffer, origin, token, ts) {
  try {
    await uploadOnce(pngBuffer, origin, token, ts);
    return true;
  } catch (err) {
    console.warn('[desktop] 截图上传失败，2s 后重试一次', err);
  }
  await delay(RETRY_DELAY_MS);
  try {
    await uploadOnce(pngBuffer, origin, token, ts);
    return true;
  } catch (err) {
    console.warn('[desktop] 截图上传重试仍失败', err);
    return false;
  }
}

// 上传失败的 PNG 落盘暂存，文件名带时间戳，补传时直接复用
function stashPending(pngBuffer, ts) {
  try {
    const dir = pendingDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `shot-${ts}.png`), pngBuffer);
    return true;
  } catch (err) {
    console.warn('[desktop] 暂存截图失败', err);
    return false;
  }
}

// 录制感知分流：壳内正在录屏类课时，网页会挂 window.__meetmindCaptureFrame
// （src/lib/services/keyframe/screen-frame-grabber.ts）。热键先问这个钩子：
// 在录 → 当前帧挂到课堂时间轴；返回假值/不在录 → 走原来的收集线截图。
async function tryCaptureClassFrame(getShellWindow) {
  try {
    const win = getShellWindow?.();
    if (!win || win.isDestroyed()) return false;
    const result = await win.webContents.executeJavaScript(
      `typeof window.__meetmindCaptureFrame === 'function'
        ? window.__meetmindCaptureFrame()
        : Promise.resolve(false)`,
      true,
    );
    return result === true;
  } catch {
    return false;
  }
}

async function handleHotkey(deps) {
  if (capturing) return;
  capturing = true;
  try {
    // 录制感知：正在录屏类课 → 这一帧挂到课堂时间轴（主动意图锚点）
    if (await tryCaptureClassFrame(deps.getShellWindow)) {
      notify({ title: 'MeetMind', body: '这一页收下了', onClick: deps.showShellWindow });
      return;
    }

    const pngBuffer = await captureCursorScreen();
    const origin = new URL(deps.meetmindUrl).origin;
    const token = await readAccessToken(deps.getShellWindow);
    if (!token) {
      notify({
        title: 'MeetMind',
        body: '先在 MeetMind 窗口登录，再截图收集',
        onClick: deps.showShellWindow,
      });
      deps.showShellWindow();
      return;
    }
    const ts = Date.now();
    const ok = await uploadWithRetry(pngBuffer, origin, token, ts);
    if (ok) {
      notify({ title: 'MeetMind', body: '已收进 MeetMind', onClick: deps.showShellWindow });
      return;
    }
    stashPending(pngBuffer, ts);
    notify({ title: 'MeetMind', body: '截图上传失败，已暂存，下次启动时补传' });
  } catch (err) {
    console.error('[desktop] 截图收集失败', err);
    notify({ title: 'MeetMind', body: '截图失败，请再试一次' });
  } finally {
    capturing = false;
  }
}

// 注册失败（热键被占用等）只 log 不 crash，壳的其余能力照常工作
function registerScreenshotHotkey(deps) {
  try {
    const ok = globalShortcut.register(HOTKEY, () => {
      void handleHotkey(deps);
    });
    if (!ok) {
      console.warn(`[desktop] 全局热键 ${HOTKEY} 注册失败（可能被其他应用占用）`);
    }
  } catch (err) {
    console.warn(`[desktop] 全局热键 ${HOTKEY} 注册异常`, err);
  }
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

// 启动时对 pending-shots 补传一次：成功就删文件，没登录态就留着下次再说
async function retryPendingShots(deps) {
  let files = [];
  try {
    files = fs
      .readdirSync(pendingDir())
      .filter((name) => /^shot-\d+\.png$/.test(name));
  } catch {
    return; // 目录不存在 = 没有待补传的截图
  }
  if (!files.length) return;

  const token = await readAccessToken(deps.getShellWindow);
  if (!token) {
    console.log(`[desktop] ${files.length} 张暂存截图等待登录后补传`);
    return;
  }
  const origin = new URL(deps.meetmindUrl).origin;
  for (const name of files) {
    const filePath = path.join(pendingDir(), name);
    try {
      const ts = Number(name.match(/^shot-(\d+)\.png$/)?.[1]) || Date.now();
      const pngBuffer = fs.readFileSync(filePath);
      const ok = await uploadWithRetry(pngBuffer, origin, token, ts);
      if (ok) fs.unlinkSync(filePath);
    } catch (err) {
      console.warn(`[desktop] 补传 ${name} 失败，保留到下次`, err);
    }
  }
}

module.exports = {
  registerScreenshotHotkey,
  retryPendingShots,
  // 小窗「截图收进来」按钮与全局热键共用同一条流程
  captureOnce: handleHotkey,
};
