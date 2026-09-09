// 口袋 · 编排：一个键收下面前的东西
//
//   ⌘⇧M：选中了文字 → 收文字（带 HTML 与来源）
//          没选中、剪贴板里是图 → 收图
//          都没有 → 框选截图
//   拖到桌宠 / 口袋窗：文字 / HTML / 网址 → 收文字；图片文件走 screenshot.js 的 uploadImageFile
//
// 每次收下：光标旁回执（可撤销）+ 桌宠吞一口。未登录：打开主窗口。失败：文字进离线队列、图进 pending-shots。
const { app, clipboard, globalShortcut } = require('electron');
const { readSelection } = require('./selection');
const { detectSource, mergeBookmark } = require('./source');
const { postClip, deleteCapture, stashPendingClip, flushPendingClips, newClientId } = require('./clip-client');
const { showReceipt, registerReceiptIpc } = require('./receipt');
const { selectRegion } = require('./region-select');
const { uploadOnce, stashPending, notify, readAccessToken } = require('../screenshot');

const HOTKEY = 'CommandOrControl+Shift+M';
let busy = false;

function firstLine(text) {
  return String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

function originOf(url) {
  return new URL(url).origin;
}

async function requireToken(deps) {
  const token = await readAccessToken(deps.getShellWindow);
  if (token) return token;
  notify({ title: 'MeetMind', body: '先在 MeetMind 窗口登录，再收东西', onClick: deps.showShellWindow });
  deps.showShellWindow();
  return null;
}

// ── 文字 ────────────────────────────────────────────────────────────

async function captureText(deps, { text, html, source, kind = 'text' }) {
  const token = await requireToken(deps);
  if (!token) return { ok: false, reason: 'not-logged-in' };
  const origin = originOf(deps.meetmindUrl);
  const payload = {
    text: text || '',
    html: html || '',
    source: source || {},
    occurredAt: new Date().toISOString(),
    clientId: newClientId(),
  };
  const result = await postClip({ origin, token, payload });
  if (result.status === 'ok') {
    const capture = result.capture;
    showReceipt({
      kind,
      title: capture.title || firstLine(text),
      source: capture.sourceLabel || '',
      undo: () => deleteCapture({ origin, token, captureId: capture.id }),
    });
    deps.onCaptured?.();
    return { ok: true, capture };
  }
  if (result.status === 'auth') {
    stashPendingClip(app.getPath('userData'), payload);
    notify({ title: 'MeetMind', body: '登录已过期，这条先存在口袋里；重新登录后自动补传', onClick: deps.showShellWindow });
    deps.showShellWindow();
    return { ok: false, reason: 'auth' };
  }
  if (result.status === 'empty') {
    showReceipt({ kind: 'error', title: '选中的内容里没有可收的文字', source: '' });
    return { ok: false, reason: 'empty' };
  }
  // 网络 / 服务端失败：先存起来，联网后补
  stashPendingClip(app.getPath('userData'), payload);
  showReceipt({ kind: 'pending', title: firstLine(text) || '这一段', source: source?.app || '' });
  return { ok: false, reason: 'stashed' };
}

// ── 图 ──────────────────────────────────────────────────────────────

async function captureImage(deps, pngBuffer, { title, source } = {}) {
  const token = await requireToken(deps);
  if (!token) return { ok: false, reason: 'not-logged-in' };
  const origin = originOf(deps.meetmindUrl);
  const ts = Date.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const capture = await uploadOnce(pngBuffer, origin, token, ts, {
        title,
        metadata: source ? { pocket: { source } } : undefined,
      });
      showReceipt({
        kind: 'image',
        title: title || '一张图',
        source: source?.app || '',
        undo: capture?.id ? () => deleteCapture({ origin, token, captureId: capture.id }) : undefined,
      });
      deps.onCaptured?.();
      return { ok: true, capture };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('返回 401')) {
        stashPending(pngBuffer, ts);
        notify({ title: 'MeetMind', body: '登录已过期，图先存着；重新登录后自动补传', onClick: deps.showShellWindow });
        deps.showShellWindow();
        return { ok: false, reason: 'auth' };
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  stashPending(pngBuffer, ts);
  showReceipt({ kind: 'pending', title: title || '一张图', source: '' });
  return { ok: false, reason: 'stashed' };
}

function formatHHmm(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ── 热键：收下面前的东西 ─────────────────────────────────────────────

async function captureFromScreen(deps) {
  if (busy) return;
  busy = true;
  try {
    // 录制感知：壳内正在录屏类课 → 这一帧挂到课堂时间轴（保留 v2 行为）
    if (await tryCaptureClassFrame(deps.getShellWindow)) {
      notify({ title: 'MeetMind', body: '这一页收下了', onClick: deps.showShellWindow });
      return;
    }
    // 选区与来源并行取：来源是热键那一刻的前台应用
    const [selection, detected] = await Promise.all([
      readSelection({ clipboard, platform: process.platform }),
      detectSource({ platform: process.platform }),
    ]);
    if (selection.kind === 'text') {
      const source = mergeBookmark(detected, selection.bookmark);
      await captureText(deps, { text: selection.text, html: selection.html, source });
      return;
    }
    if (selection.kind === 'image') {
      await captureImage(deps, selection.image.toPNG(), {
        title: `剪贴板里的图 · ${formatHHmm(new Date())}`,
        source: detected,
      });
      return;
    }
    // 什么都没选：框选
    const picked = await selectRegion();
    if (!picked) return;
    await captureImage(deps, picked.png, {
      title: `屏幕截图 · ${formatHHmm(new Date())}`,
      source: detected,
    });
  } catch (err) {
    console.error('[pocket] 收下失败', err);
    showReceipt({ kind: 'error', title: '没收进去，再试一次', source: '' });
  } finally {
    busy = false;
  }
}

async function tryCaptureClassFrame(getShellWindow) {
  try {
    const win = getShellWindow?.();
    if (!win || win.isDestroyed()) return false;
    const result = await win.webContents.executeJavaScript(
      `typeof window.__meetmindCaptureFrame === 'function' ? window.__meetmindCaptureFrame() : Promise.resolve(false)`,
      true,
    );
    return result === true;
  } catch {
    return false;
  }
}

/** 小窗 / 桌宠按钮：直接进框选（不看选区） */
async function captureRegion(deps) {
  if (busy) return { ok: false, reason: 'busy' };
  busy = true;
  try {
    const picked = await selectRegion();
    if (!picked) return { ok: false, reason: 'cancelled' };
    return await captureImage(deps, picked.png, { title: `屏幕截图 · ${formatHHmm(new Date())}` });
  } finally {
    busy = false;
  }
}

/**
 * 拖放 / 粘贴进来的非文件内容（桌宠、口袋窗都走这里）：
 *   { text?, html?, url?, app? } → 文字剪藏；纯网址也当一条（服务端会给域名做来源）
 */
async function captureDropped(deps, dropped) {
  const text = String(dropped?.text || '').trim();
  const html = String(dropped?.html || '').trim();
  const url = String(dropped?.url || '').trim();
  if (!text && !html && !url) return { ok: false, reason: 'empty' };
  const source = {};
  if (/^https?:\/\//i.test(url)) source.url = url;
  if (dropped?.app) source.app = String(dropped.app).slice(0, 80);
  return captureText(deps, { text: text || url, html, source });
}

function registerPocketHotkey(deps) {
  registerReceiptIpc();
  try {
    const ok = globalShortcut.register(HOTKEY, () => { void captureFromScreen(deps); });
    if (!ok) console.warn(`[pocket] 全局热键 ${HOTKEY} 注册失败（可能被其他应用占用）`);
  } catch (err) {
    console.warn(`[pocket] 全局热键 ${HOTKEY} 注册异常`, err);
  }
  app.on('will-quit', () => globalShortcut.unregisterAll());
}

/** 启动补传离线队列里的文字剪藏 */
async function flushPending(deps) {
  const token = await readAccessToken(deps.getShellWindow);
  const result = await flushPendingClips({
    userDataDir: app.getPath('userData'),
    origin: originOf(deps.meetmindUrl),
    token,
  });
  if (result.sent > 0) console.log(`[pocket] 补传 ${result.sent} 条离线剪藏`);
  return result;
}

module.exports = { registerPocketHotkey, captureFromScreen, captureRegion, captureText, captureImage, captureDropped, flushPending };
