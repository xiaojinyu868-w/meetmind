// 桌面壳设置：userData/settings.json（热键、行为开关）。
//
// 没有设置界面之前，这个文件就是设置界面（托盘菜单里「打开设置文件」）。
// 读失败一律回默认值，不让一个坏 JSON 把壳拖死。
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // 收下面前的东西 / 口袋窗；被占用时自动退到 fallback
  hotkeyCapture: 'CommandOrControl+Shift+M',
  hotkeyCaptureFallback: 'CommandOrControl+Alt+M',
  hotkeyPocket: 'CommandOrControl+Shift+K',
  hotkeyPocketFallback: 'CommandOrControl+Alt+K',
  // 收文字后把用户原来的剪贴板写回去
  restoreClipboard: true,
  // 收下后光标旁回执
  showReceipt: true,
  // 按热键时没有选区：true 进框选，false 什么都不做
  regionWhenNothingSelected: true,
};

let cached = null;

function settingsPath() {
  // 懒加载 electron：describeAccelerator 等纯函数要能在 node 单测里 require
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  if (cached) return cached;
  let stored = {};
  try {
    stored = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  } catch {
    stored = {};
  }
  cached = { ...DEFAULTS, ...stored };
  return cached;
}

/** 首次启动写出一份带默认值的文件，用户打开就知道能改什么 */
function ensureSettingsFile() {
  const file = settingsPath();
  if (fs.existsSync(file)) return file;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(DEFAULTS, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.warn('[desktop] 写默认设置失败', err);
  }
  return file;
}

function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    cached = next;
  } catch (err) {
    console.warn('[desktop] 保存设置失败', err);
  }
  return next;
}

/** Electron accelerator → 用户看得懂的写法（⌘⇧M / Ctrl+Shift+M） */
function describeAccelerator(accelerator, platform = process.platform) {
  const mac = platform === 'darwin';
  return String(accelerator || '')
    .replace(/CommandOrControl|CmdOrCtrl/g, mac ? '⌘' : 'Ctrl')
    .replace(/Command|Cmd/g, '⌘')
    .replace(/Control|Ctrl/g, mac ? '⌃' : 'Ctrl')
    .replace(/Shift/g, mac ? '⇧' : 'Shift')
    .replace(/Alt|Option/g, mac ? '⌥' : 'Alt')
    .replace(/\+/g, mac ? '' : '+');
}

module.exports = { DEFAULTS, loadSettings, saveSettings, ensureSettingsFile, settingsPath, describeAccelerator };
