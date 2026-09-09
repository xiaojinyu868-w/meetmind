// 口袋 · 回执：收下之后光标旁 1.6 秒的一张小卡片——图标 + 第一行 + 来源 + 撤销
//
// 为什么不用系统通知：通知在屏幕角落、要 1-2 秒才出现、不能撤销；回执出现在你正在看的地方，
// 不抢焦点（focusable:false + showInactive），鼠标移上去就停住等你，移开或 1.6s 后自己消失。
const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');

const WIDTH = 340;
const HEIGHT = 84;
const OFFSET = 18;
const SHOW_MS = 1600;
const HOVER_EXTRA_MS = 4000;

let receiptWindow = null;
let hideTimer = null;
let currentUndo = null;

function ensureWindow() {
  if (receiptWindow && !receiptWindow.isDestroyed()) return receiptWindow;
  receiptWindow = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'receipt-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  receiptWindow.setAlwaysOnTop(true, 'screen-saver');
  receiptWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  receiptWindow.loadFile(path.join(__dirname, 'receipt.html'));
  receiptWindow.on('closed', () => { receiptWindow = null; });
  return receiptWindow;
}

function placeNearCursor(win) {
  const point = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(point).workArea;
  let x = point.x + OFFSET;
  let y = point.y + OFFSET;
  if (x + WIDTH > area.x + area.width - 8) x = point.x - WIDTH - OFFSET;
  if (y + HEIGHT > area.y + area.height - 8) y = point.y - HEIGHT - OFFSET;
  x = Math.max(area.x + 8, x);
  y = Math.max(area.y + 8, y);
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: HEIGHT });
}

function scheduleHide(ms) {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (receiptWindow && !receiptWindow.isDestroyed()) receiptWindow.hide();
    currentUndo = null;
  }, ms);
}

/**
 * 显示回执。payload: { kind: 'text'|'image'|'pending'|'error', title, source, undo?: () => Promise<boolean> }
 */
function showReceipt(payload) {
  const win = ensureWindow();
  currentUndo = typeof payload.undo === 'function' ? payload.undo : null;
  const send = () => {
    win.webContents.send('receipt:show', {
      kind: payload.kind,
      title: String(payload.title || '').slice(0, 120),
      source: String(payload.source || '').slice(0, 60),
      undoable: Boolean(currentUndo),
    });
    placeNearCursor(win);
    win.showInactive();
    scheduleHide(SHOW_MS);
  };
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send);
  else send();
}

function registerReceiptIpc() {
  ipcMain.handle('receipt:undo', async () => {
    const undo = currentUndo;
    currentUndo = null;
    if (!undo) return { ok: false };
    const ok = await undo();
    if (receiptWindow && !receiptWindow.isDestroyed()) {
      receiptWindow.webContents.send('receipt:show', { kind: ok ? 'undone' : 'error', title: ok ? '撤销了' : '没撤销成功', source: '', undoable: false });
      scheduleHide(1200);
    }
    return { ok };
  });
  ipcMain.handle('receipt:hover', (_event, hovering) => {
    if (hovering) {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = null;
      scheduleHide(HOVER_EXTRA_MS);
    } else {
      scheduleHide(600);
    }
  });
  ipcMain.handle('receipt:dismiss', () => {
    if (receiptWindow && !receiptWindow.isDestroyed()) receiptWindow.hide();
    currentUndo = null;
  });
}

module.exports = { showReceipt, registerReceiptIpc };
