// 口袋 · 来源：热键那一刻，前台是哪个应用、哪个窗口、浏览器开着哪个网址
//
// 有根是这条流的 DNA：每条剪藏都要能回答"从哪来"。
// macOS 用 AppleScript 问 System Events 与各浏览器；Windows 用 PowerShell 取前台窗口；
// Linux 有 xdotool 就取窗口标题。任何一步失败都只是少一个字段，不阻塞收下。
const { execFile } = require('child_process');

const BROWSER_URL_SCRIPTS = {
  'Google Chrome': 'tell application "Google Chrome" to get {URL, title} of active tab of front window',
  'Microsoft Edge': 'tell application "Microsoft Edge" to get {URL, title} of active tab of front window',
  'Arc': 'tell application "Arc" to get {URL, title} of active tab of front window',
  'Brave Browser': 'tell application "Brave Browser" to get {URL, title} of active tab of front window',
  'Chromium': 'tell application "Chromium" to get {URL, title} of active tab of front window',
  'Safari': 'tell application "Safari" to get {URL, name} of front document',
};

function run(exec, file, args, options) {
  return new Promise((resolve) => {
    try {
      exec(file, args, options, (err, stdout) => resolve(err ? '' : String(stdout || '')));
    } catch {
      resolve('');
    }
  });
}

/** AppleScript 返回 "url, title"，title 里可能带逗号——只在第一个逗号处切 */
function parseAppleScriptPair(raw) {
  const text = String(raw || '').trim();
  if (!text) return { url: '', title: '' };
  const comma = text.indexOf(', ');
  if (comma < 0) return { url: text, title: '' };
  return { url: text.slice(0, comma).trim(), title: text.slice(comma + 2).trim() };
}

/** PowerShell 输出 "process|title" */
function parseWindowsForeground(raw) {
  const text = String(raw || '').trim();
  if (!text) return { app: '', windowTitle: '' };
  const bar = text.indexOf('|');
  if (bar < 0) return { app: text, windowTitle: '' };
  return { app: text.slice(0, bar).trim(), windowTitle: text.slice(bar + 1).trim() };
}

async function detectSourceDarwin(exec) {
  const front = await run(exec, 'osascript', ['-e',
    'tell application "System Events"\n' +
    '  set frontApp to first application process whose frontmost is true\n' +
    '  set appName to name of frontApp\n' +
    '  set winTitle to ""\n' +
    '  try\n    set winTitle to name of front window of frontApp\n  end try\n' +
    '  return appName & "|" & winTitle\n' +
    'end tell'], { timeout: 1500 });
  const { app, windowTitle } = parseWindowsForeground(front);
  const source = { app, windowTitle };
  const script = BROWSER_URL_SCRIPTS[app];
  if (script) {
    const pair = parseAppleScriptPair(await run(exec, 'osascript', ['-e', script], { timeout: 1500 }));
    if (/^https?:\/\//i.test(pair.url)) source.url = pair.url;
    if (pair.title) source.pageTitle = pair.title;
  }
  return source;
}

async function detectSourceWin32(exec) {
  const script = [
    'Add-Type @"',
    'using System; using System.Runtime.InteropServices; using System.Text;',
    'public class FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
    '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid); }',
    '"@',
    '$h=[FG]::GetForegroundWindow(); $sb=New-Object System.Text.StringBuilder 512; [void][FG]::GetWindowText($h,$sb,512);',
    '$pid2=0; [void][FG]::GetWindowThreadProcessId($h,[ref]$pid2); $p=Get-Process -Id $pid2 -ErrorAction SilentlyContinue;',
    'Write-Output ("{0}|{1}" -f $p.ProcessName, $sb.ToString())',
  ].join('\n');
  const raw = await run(exec, 'powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 3000, windowsHide: true });
  return parseWindowsForeground(raw);
}

async function detectSourceLinux(exec) {
  const title = (await run(exec, 'xdotool', ['getactivewindow', 'getwindowname'], { timeout: 1000 })).trim();
  return title ? { windowTitle: title } : {};
}

/** 前台来源；任何平台失败都返回 {}，绝不阻塞收下 */
async function detectSource(deps = {}) {
  const exec = deps.exec || execFile;
  const platform = deps.platform || process.platform;
  try {
    if (platform === 'darwin') return await detectSourceDarwin(exec);
    if (platform === 'win32') return await detectSourceWin32(exec);
    return await detectSourceLinux(exec);
  } catch {
    return {};
  }
}

/** 剪贴板书签（macOS 浏览器复制时带 URL+标题）补位：没问到网址时用它 */
function mergeBookmark(source, bookmark) {
  if (!bookmark) return source;
  const next = { ...source };
  if (!next.url && /^https?:\/\//i.test(bookmark.url || '')) next.url = bookmark.url;
  if (!next.pageTitle && bookmark.title) next.pageTitle = bookmark.title;
  return next;
}

module.exports = { detectSource, mergeBookmark, parseAppleScriptPair, parseWindowsForeground, BROWSER_URL_SCRIPTS };
