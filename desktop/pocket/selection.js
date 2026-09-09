// 口袋 · 读别的应用里的选区
//
// Electron 读不到其他进程的选区。通行做法：热键那一刻模拟一次 Cmd/Ctrl+C，
// 轮询系统剪贴板直到它变化，读走文字 / HTML / 网址书签，再把用户原来的剪贴板**原样写回**。
// 模拟按键不用原生模块：macOS 走 osascript（System Events keystroke，需要一次"辅助功能"授权），
// Windows 走 PowerShell SendKeys，Linux 有 xdotool 就用、没有就退化为"你自己 Cmd+C 再按热键"。
//
// 所有 I/O 通过 deps 注入（clipboard / exec / sleep），核心逻辑可以在 node 里单测。
const { execFile } = require('child_process');

const POLL_INTERVAL_MS = 40;
const POLL_TIMEOUT_MS = 480;

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 剪贴板快照：能读到的格式都留一份，等会儿按原格式写回 */
function snapshotClipboard(clipboard) {
  const snapshot = {
    text: clipboard.readText() || '',
    html: clipboard.readHTML() || '',
    rtf: typeof clipboard.readRTF === 'function' ? clipboard.readRTF() || '' : '',
    image: null,
    bookmark: null,
  };
  try {
    const image = clipboard.readImage();
    snapshot.image = image && !image.isEmpty() ? image : null;
  } catch {
    snapshot.image = null;
  }
  if (typeof clipboard.readBookmark === 'function') {
    try {
      const bookmark = clipboard.readBookmark();
      snapshot.bookmark = bookmark && (bookmark.url || bookmark.title) ? bookmark : null;
    } catch {
      snapshot.bookmark = null;
    }
  }
  return snapshot;
}

function restoreClipboard(clipboard, snapshot) {
  if (!snapshot) return;
  try {
    const data = {};
    if (snapshot.text) data.text = snapshot.text;
    if (snapshot.html) data.html = snapshot.html;
    if (snapshot.rtf) data.rtf = snapshot.rtf;
    if (snapshot.image) data.image = snapshot.image;
    if (snapshot.bookmark && snapshot.bookmark.url) data.bookmark = snapshot.bookmark.title || snapshot.bookmark.url;
    if (Object.keys(data).length === 0) {
      clipboard.clear();
      return;
    }
    clipboard.write(data);
  } catch (err) {
    console.warn('[pocket] 还原剪贴板失败', err);
  }
}

/** 两次快照是否是同一份内容（判定"复制生效了没有"） */
function sameClipboard(a, b) {
  if (a.text !== b.text || a.html !== b.html) return false;
  const aImage = a.image ? a.image.toDataURL().length : 0;
  const bImage = b.image ? b.image.toDataURL().length : 0;
  return aImage === bImage;
}

/** 模拟一次"复制"。返回 false 表示本平台做不到（调用方退化为直接读剪贴板） */
function simulateCopy(deps) {
  const run = deps.exec || execFile;
  return new Promise((resolve) => {
    const done = (ok) => resolve(Boolean(ok));
    try {
      if (deps.platform === 'darwin') {
        run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'],
          { timeout: 1500 }, (err) => done(!err));
        return;
      }
      if (deps.platform === 'win32') {
        run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^c")'],
          { timeout: 2500, windowsHide: true }, (err) => done(!err));
        return;
      }
      // Linux：xdotool 可选
      run('xdotool', ['key', '--clearmodifiers', 'ctrl+c'], { timeout: 1500 }, (err) => done(!err));
    } catch {
      done(false);
    }
  });
}

/**
 * 读当前选区。返回：
 *   { kind: 'text', text, html, bookmark }  —— 选中了文字（HTML 可能为空）
 *   { kind: 'image', image }                —— 没选中文字，但剪贴板里有一张图（截图工具刚截的）
 *   { kind: 'none' }                        —— 什么都没有
 * 无论哪种，用户原来的剪贴板都会被还原。
 */
async function readSelection(deps) {
  const clipboard = deps.clipboard;
  const sleep = deps.sleep || defaultSleep;
  const before = snapshotClipboard(clipboard);

  // 先清空再模拟复制：这样"变化"就是"从空到有"，不会被上一次复制的同样内容骗过
  try { clipboard.clear(); } catch { /* 有些平台 clear 会抛，忽略 */ }
  const copied = await simulateCopy(deps);

  let after = snapshotClipboard(clipboard);
  if (copied) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline && !after.text && !after.html && !after.image) {
      await sleep(POLL_INTERVAL_MS);
      after = snapshotClipboard(clipboard);
    }
  }

  const gotText = Boolean(after.text.trim() || after.html.trim());
  const gotImage = Boolean(after.image);

  // 还原用户的剪贴板（成功与否都还原）
  restoreClipboard(clipboard, before);

  if (gotText) {
    return { kind: 'text', text: after.text, html: after.html, bookmark: after.bookmark, viaSimulatedCopy: copied };
  }
  // 模拟复制没产出：看用户剪贴板里本来是不是一张图（截图工具刚截的那张）
  if (gotImage) return { kind: 'image', image: after.image, viaSimulatedCopy: copied };
  if (!copied && before.image) return { kind: 'image', image: before.image, viaSimulatedCopy: false };
  return { kind: 'none', viaSimulatedCopy: copied };
}

module.exports = { readSelection, snapshotClipboard, restoreClipboard, sameClipboard, simulateCopy };
