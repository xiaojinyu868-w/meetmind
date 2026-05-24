const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, shell, screen } = require('electron');

const MEETMIND_URL = process.env.MEETMIND_URL || 'http://localhost:3002/app';

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
  return expanded ? { width: 340, height: 310 } : { width: 176, height: 176 };
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
    },
  });

  companionWindow.setAlwaysOnTop(true, 'floating');
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  placeInitialWindow(companionWindow);
  companionWindow.loadFile(path.join(__dirname, 'companion.html'));
  companionWindow.once('ready-to-show', () => companionWindow?.show());
  companionWindow.on('closed', () => {
    companionWindow = null;
  });
}

app.whenReady().then(() => {
  createCompanionWindow();
  app.on('activate', () => {
    if (!companionWindow) createCompanionWindow();
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
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

ipcMain.handle('companion:open-meetmind', async () => {
  await shell.openExternal(MEETMIND_URL);
});

ipcMain.handle('companion:quit', () => {
  app.quit();
});
