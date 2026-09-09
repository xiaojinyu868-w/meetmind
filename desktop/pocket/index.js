// 口袋 · 编排：一个键收下面前的东西
//
//   ⌘⇧M：选中了文字 → 收文字（带 HTML 与来源）
//          没选中、剪贴板里是图 → 收图
//          都没有 → 框选截图
//   拖到桌宠 / 口袋窗：文字 / HTML / 网址 → 收文字；图片文件走 screenshot.js 的 uploadImageFile
//
// 每次收下：光标旁回执（可撤销）+ 桌宠吞一口。未登录：打开主窗口。失败：文字进离线队列、图进 pending-shots。
const { app, clipboard, globalShortcut, systemPreferences } = require('electron');
const { readSelection } = require('./selection');
const { detectSource, mergeBookmark } = require('./source');
const { postClip, deleteCapture, stashPendingClip, flushPendingClips, newClientId } = require('./clip-client');
const { showReceipt: showReceiptWindow, registerReceiptIpc } = require('./receipt');
const { selectRegion } = require('./region-select');
const { uploadOnce, stashPending, notify, readAccessToken } = require('../screenshot');
const { loadSettings, describeAccelerator } = require('../settings');
const { createLogger } = require('../log');

const log = createLogger('pocket');
let busy = false;
/** 无法模拟复制时的"剪贴板变了没"指纹（见 selection.readSelection） */
let lastFingerprint = '';
let permissionHintShown = false;
/** 实际注册成功的热键（可能是 fallback），托盘菜单展示用 */
let activeCaptureHotkey = null;

function showReceipt(payload) {
  if (loadSettings().showReceipt === false) return;
  showReceiptWindow(payload);
}

/**
 * macOS：模拟复制要「辅助功能」权限。没有时第一次弹系统授权（prompt=true），并告诉用户当前退化成
 * "复制好再按热键"。Windows / Linux 不需要。
 */
function canSimulateCopy() {
  if (process.platform !== 'darwin') return process.platform === 'win32' ? true : undefined; // linux 交给 xdotool 探测
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (!trusted && !permissionHintShown) {
      permissionHintShown = true;
      systemPreferences.isTrustedAccessibilityClient(true); // 弹一次系统授权面板
      notify({ title: 'MeetMind', body: '要收下选中的文字，需要在「系统设置 → 隐私与安全性 → 辅助功能」里允许 MeetMind；在此之前，先复制再按热键也能收' });
      log.warn('accessibility not granted; falling back to clipboard-change mode');
    }
    return trusted;
  } catch (err) {
    log.warn('accessibility check failed', err);
    return true;
  }
}

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
    const settings = loadSettings();
    const simulate = canSimulateCopy();
    const [selection, detected] = await Promise.all([
      readSelection({
        clipboard,
        platform: process.platform,
        canSimulateCopy: simulate,
        restoreClipboard: settings.restoreClipboard !== false,
        lastFingerprint,
        onFingerprint: (fingerprint) => { lastFingerprint = fingerprint; },
      }),
      detectSource({ platform: process.platform }),
    ]);
    log.info('hotkey', { kind: selection.kind, viaSimulatedCopy: selection.viaSimulatedCopy, app: detected.app || '', hasUrl: Boolean(detected.url) });
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
    // 什么都没选：框选（设置里可关）
    if (settings.regionWhenNothingSelected === false) {
      showReceipt({ kind: 'error', title: selection.needsPermission ? '先复制，再按热键' : '没选中东西', source: '' });
      return;
    }
    const picked = await selectRegion();
    if (!picked) return;
    await captureImage(deps, picked.png, {
      title: `屏幕截图 · ${formatHHmm(new Date())}`,
      source: detected,
    });
  } catch (err) {
    log.error('capture failed', err);
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

/** 注册热键；主键被占用（另一个应用先注册了）就退到 fallback；两个都不行就提示 */
function registerWithFallback(primary, fallback, handler) {
  for (const accelerator of [primary, fallback].filter(Boolean)) {
    try {
      if (globalShortcut.isRegistered(accelerator)) continue;
      if (globalShortcut.register(accelerator, handler)) {
        if (accelerator !== primary) log.warn('primary hotkey taken, using fallback', { primary, fallback: accelerator });
        return accelerator;
      }
    } catch (err) {
      log.warn('hotkey register threw', { accelerator, err });
    }
  }
  return null;
}

function registerPocketHotkey(deps) {
  registerReceiptIpc();
  const settings = loadSettings();
  activeCaptureHotkey = registerWithFallback(settings.hotkeyCapture, settings.hotkeyCaptureFallback, () => { void captureFromScreen(deps); });
  if (!activeCaptureHotkey) {
    log.error('no capture hotkey could be registered', { primary: settings.hotkeyCapture, fallback: settings.hotkeyCaptureFallback });
    notify({ title: 'MeetMind', body: `热键 ${describeAccelerator(settings.hotkeyCapture)} 和 ${describeAccelerator(settings.hotkeyCaptureFallback)} 都被别的应用占用了；可在托盘「打开设置文件」里改一个` });
  } else if (activeCaptureHotkey !== settings.hotkeyCapture) {
    notify({ title: 'MeetMind', body: `${describeAccelerator(settings.hotkeyCapture)} 被别的应用占用，这次用 ${describeAccelerator(activeCaptureHotkey)} 收东西` });
  }
  app.on('will-quit', () => globalShortcut.unregisterAll());
  return activeCaptureHotkey;
}

function getActiveCaptureHotkey() {
  return activeCaptureHotkey;
}

/** 启动补传离线队列里的文字剪藏 */
async function flushPending(deps) {
  const token = await readAccessToken(deps.getShellWindow);
  const result = await flushPendingClips({
    userDataDir: app.getPath('userData'),
    origin: originOf(deps.meetmindUrl),
    token,
  });
  if (result.sent > 0) log.info('flushed pending clips', result);
  return result;
}

module.exports = { registerPocketHotkey, registerWithFallback, getActiveCaptureHotkey, captureFromScreen, captureRegion, captureText, captureImage, captureDropped, flushPending };
