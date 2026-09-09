// 口袋 · 框选截图：冻结当前屏幕 + 十字光标，拖一块；Esc 取消；双击 / Enter 整屏
//
// 之前热键直接截整块屏：4K 屏一张几 MB 的全屏图当"笔记"，板书在角落里一小块。
// 现在和 CleanShot 一样先框选。实现：按显示器实际像素抓一帧 → 铺满该显示器的无边框窗口显示这一帧
// （压暗）→ 拖出的矩形亮回原图 → 回主进程按 scaleFactor 裁切 PNG。
const path = require('path');
const { BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen } = require('electron');

let overlay = null;
let pendingResolve = null;

async function grabDisplay(display) {
  const pixelWidth = Math.round(display.size.width * display.scaleFactor);
  const pixelHeight = Math.round(display.size.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: pixelWidth, height: pixelHeight },
  });
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('没有拿到可用的屏幕画面');
  return source.thumbnail;
}

function closeOverlay() {
  if (overlay && !overlay.isDestroyed()) overlay.close();
  overlay = null;
}

function settle(result) {
  const resolve = pendingResolve;
  pendingResolve = null;
  closeOverlay();
  if (resolve) resolve(result);
}

/**
 * 进入框选。resolve：
 *   { png: Buffer, width, height, region: { x, y, width, height } } —— 用户框了一块（或整屏）
 *   null —— 取消
 * 同时只允许一个覆盖层；再次调用直接返回 null。
 */
async function selectRegion() {
  if (overlay) return null;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const frame = await grabDisplay(display);
  const frameSize = frame.getSize();
  const scale = frameSize.width / display.bounds.width;

  return new Promise((resolve) => {
    pendingResolve = resolve;
    overlay = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'region-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
    overlay.on('closed', () => {
      overlay = null;
      if (pendingResolve) settle(null);
    });
    overlay.on('blur', () => {
      // 用户切走了（Cmd+Tab）：视为取消，不留一层黑幕
      if (pendingResolve) settle(null);
    });

    const onDone = (_event, rect) => {
      ipcMain.removeListener('region:done', onDone);
      ipcMain.removeListener('region:cancel', onCancel);
      if (!pendingResolve) return;
      try {
        const region = {
          x: Math.max(0, Math.round(rect.x * scale)),
          y: Math.max(0, Math.round(rect.y * scale)),
          width: Math.min(frameSize.width, Math.max(1, Math.round(rect.width * scale))),
          height: Math.min(frameSize.height, Math.max(1, Math.round(rect.height * scale))),
        };
        region.width = Math.min(region.width, frameSize.width - region.x);
        region.height = Math.min(region.height, frameSize.height - region.y);
        const cropped = region.width >= frameSize.width && region.height >= frameSize.height
          ? frame
          : frame.crop(region);
        settle({ png: cropped.toPNG(), width: region.width, height: region.height, region });
      } catch (err) {
        console.warn('[pocket] 裁切失败', err);
        settle(null);
      }
    };
    const onCancel = () => {
      ipcMain.removeListener('region:done', onDone);
      ipcMain.removeListener('region:cancel', onCancel);
      settle(null);
    };
    ipcMain.on('region:done', onDone);
    ipcMain.on('region:cancel', onCancel);

    overlay.loadFile(path.join(__dirname, 'region.html'));
    overlay.webContents.once('did-finish-load', () => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.webContents.send('region:frame', {
        dataUrl: frame.toDataURL(),
        width: display.bounds.width,
        height: display.bounds.height,
        scale,
      });
      overlay.show();
      overlay.focus();
    });
  });
}

/** 整屏（不框选）：给"剪贴板里既没字也没图、也不想框"的快捷路径 */
async function grabWholeCursorScreen() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const frame = await grabDisplay(display);
  const size = frame.getSize();
  return { png: frame.toPNG(), width: size.width, height: size.height };
}

module.exports = { selectRegion, grabWholeCursorScreen, nativeImage };
