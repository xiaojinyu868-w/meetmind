/**
 * 极简结构化日志工具
 * 
 * 用法：
 *   import { createLogger } from '@/lib/logger';
 *   const log = createLogger('highlight');
 *   log.info('开始处理', { mode, segments: segments.length });
 *   log.debug('详细数据', data);  // 生产环境不输出
 *   log.warn('注意', detail);
 *   log.error('失败', error);
 * 
 * 环境控制：
 *   - NODE_ENV=production 时 debug 级别不输出
 *   - LOG_LEVEL=debug 可在生产强制开启 debug
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL as LogLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()];
}

function formatArgs(tag: string, level: LogLevel, msg: string, data?: unknown): unknown[] {
  const prefix = `[${tag}]`;
  if (data !== undefined) {
    return [prefix, msg, data];
  }
  return [prefix, msg];
}

export interface Logger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

export function createLogger(tag: string): Logger {
  return {
    debug(msg: string, data?: unknown) {
      if (shouldLog('debug')) console.log(...formatArgs(tag, 'debug', msg, data));
    },
    info(msg: string, data?: unknown) {
      if (shouldLog('info')) console.log(...formatArgs(tag, 'info', msg, data));
    },
    warn(msg: string, data?: unknown) {
      if (shouldLog('warn')) console.warn(...formatArgs(tag, 'warn', msg, data));
    },
    error(msg: string, data?: unknown) {
      if (shouldLog('error')) console.error(...formatArgs(tag, 'error', msg, data));
    },
  };
}
