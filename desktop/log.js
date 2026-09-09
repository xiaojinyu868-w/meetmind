// 桌面壳文件日志：userData/logs/desktop.log（单文件 1MB 滚动一份）。
//
// 用户说"热键没反应"时，托盘「打开日志文件夹」把这个文件发过来就能看。
// 同时仍打到 console（开发时 npm run desktop:dev 直接看）。零依赖。
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024;
let logDir = null;

function init(userDataDir) {
  logDir = path.join(userDataDir, 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* 目录建不出来就只打 console */ }
}

function logFile() {
  return logDir ? path.join(logDir, 'desktop.log') : null;
}

function rotateIfNeeded(file) {
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch { /* 文件不存在 */ }
}

function format(level, scope, message, extra) {
  const time = new Date().toISOString();
  const detail = extra === undefined ? '' : ` ${safeStringify(extra)}`;
  return `${time} ${level.padEnd(5)} [${scope}] ${message}${detail}\n`;
}

function safeStringify(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function write(level, scope, message, extra) {
  const line = format(level, scope, message, extra);
  const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  printer(line.trimEnd());
  const file = logFile();
  if (!file) return;
  try {
    rotateIfNeeded(file);
    fs.appendFileSync(file, line, 'utf8');
  } catch { /* 磁盘满等情况不影响主流程 */ }
}

function createLogger(scope) {
  return {
    info: (message, extra) => write('info', scope, message, extra),
    warn: (message, extra) => write('warn', scope, message, extra),
    error: (message, extra) => write('error', scope, message, extra),
  };
}

module.exports = { init, createLogger, logDir: () => logDir };
