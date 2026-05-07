/**
 * 结构化日志（pino-backed）
 *
 * - 保持老 API：createLogger(tag).info/warn/error/debug(msg, data)
 * - 升级点：底层用 pino → 生产输出 JSON（含 timestamp / level / tag / requestId / userId），接入 Sentry 后自动映射为 breadcrumbs + logs
 * - 浏览器端自动降级到 console（pino 只在 Node runtime 加载）
 *
 * Async 上下文传参（requestId / userId）：
 *   withLogContext({ requestId: 'abc' }, () => { log.info(...) })
 *
 * 用法不变：
 *   const log = createLogger('asr');
 *   log.info('asr.start', { mode, segments });
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
  /** 派生子 logger，携带额外的 bindings */
  child: (bindings: Record<string, unknown>) => Logger;
}

const isBrowser = typeof window !== 'undefined';

// ============================================================
// Async Local Storage（服务端注入 requestId / userId）
// ============================================================

type LogContext = Record<string, unknown>;

// 动态加载 AsyncLocalStorage（只在 Node runtime 可用）
let alsInstance: unknown = null;
function getALS(): {
  getStore: () => LogContext | undefined;
  run: <T>(ctx: LogContext, fn: () => T) => T;
} | null {
  if (isBrowser) return null;
  if (alsInstance) return alsInstance as ReturnType<typeof getALS>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AsyncLocalStorage } = require('async_hooks') as typeof import('async_hooks');
    alsInstance = new AsyncLocalStorage<LogContext>();
    return alsInstance as ReturnType<typeof getALS>;
  } catch {
    return null;
  }
}

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const als = getALS();
  if (!als) return fn();
  const merged = { ...(als.getStore() ?? {}), ...ctx };
  return als.run(merged, fn);
}

function getContext(): LogContext {
  const als = getALS();
  if (!als) return {};
  return als.getStore() ?? {};
}

// ============================================================
// Pino Backend（服务端）/ Console Backend（浏览器）
// ============================================================

type PinoLike = {
  debug: (obj: object, msg?: string) => void;
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
  child: (bindings: Record<string, unknown>) => PinoLike;
};

let rootPino: PinoLike | null = null;

function getRootPino(): PinoLike | null {
  if (isBrowser) return null;
  if (rootPino) return rootPino;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pinoModule = require('pino');
    const pino = pinoModule.default ?? pinoModule;
    const level = process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
    // Prod: JSON；Dev: pino-pretty 如果可用
    const isDev = process.env.NODE_ENV !== 'production';
    const transport =
      isDev && !process.env.LOG_JSON
        ? (() => {
            try {
              // 检查 pino-pretty 是否可用
              require.resolve('pino-pretty');
              return { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } };
            } catch {
              return undefined;
            }
          })()
        : undefined;
    rootPino = pino({
      level,
      base: { service: 'meetmind' },
      timestamp: pino.stdTimeFunctions.isoTime,
      ...(transport ? { transport } : {}),
    }) as unknown as PinoLike;
    return rootPino;
  } catch {
    return null;
  }
}

function fmtConsole(tag: string, msg: string, data?: unknown): unknown[] {
  const prefix = `[${tag}]`;
  if (data !== undefined) return [prefix, msg, data];
  return [prefix, msg];
}

// ============================================================
// createLogger：服务端走 pino，浏览器走 console
// ============================================================

export function createLogger(tag: string): Logger {
  const backend = getRootPino();

  if (!backend) {
    // 浏览器 / pino 不可用：降级到 console，保持旧行为
    const level = (process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug')) as LogLevel;
    const priority: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const minPriority = priority[level] ?? 1;
    const shouldLog = (l: LogLevel) => priority[l] >= minPriority;

    const make = (l: LogLevel): ((msg: string, data?: unknown) => void) => (msg, data) => {
      if (!shouldLog(l)) return;
      const out = l === 'error' ? console.error : l === 'warn' ? console.warn : console.log;
      out(...fmtConsole(tag, msg, data));
    };
    return {
      debug: make('debug'),
      info: make('info'),
      warn: make('warn'),
      error: make('error'),
      child: (bindings) => createLogger(`${tag}:${String(bindings.scope ?? 'sub')}`),
    };
  }

  const scoped = backend.child({ tag });
  const withCtx = (l: LogLevel, msg: string, data?: unknown) => {
    const ctx = getContext();
    // 结构化字段：{tag, ...ctx, data, msg}
    const payload: Record<string, unknown> = { ...ctx };
    if (data !== undefined) payload.data = data;
    scoped[l](payload, msg);
  };

  return {
    debug: (msg, data) => withCtx('debug', msg, data),
    info: (msg, data) => withCtx('info', msg, data),
    warn: (msg, data) => withCtx('warn', msg, data),
    error: (msg, data) => withCtx('error', msg, data),
    child: (bindings) => {
      const childBackend = scoped.child(bindings);
      const wrap = (l: LogLevel, msg: string, data?: unknown) => {
        const ctx = getContext();
        const payload: Record<string, unknown> = { ...ctx };
        if (data !== undefined) payload.data = data;
        childBackend[l](payload, msg);
      };
      return {
        debug: (m, d) => wrap('debug', m, d),
        info: (m, d) => wrap('info', m, d),
        warn: (m, d) => wrap('warn', m, d),
        error: (m, d) => wrap('error', m, d),
        child: (b) => {
          const g = childBackend.child(b);
          const w = (l: LogLevel, m: string, d?: unknown) => {
            const c = getContext();
            const p: Record<string, unknown> = { ...c };
            if (d !== undefined) p.data = d;
            g[l](p, m);
          };
          return {
            debug: (m, d) => w('debug', m, d),
            info: (m, d) => w('info', m, d),
            warn: (m, d) => w('warn', m, d),
            error: (m, d) => w('error', m, d),
            child: (bb) => createLogger(`${tag}:${String(bb.scope ?? 'sub')}`),
          };
        },
      };
    },
  };
}

// ============================================================
// 关键路径埋点（四大路径：asr / tutor / echo / sync）
// ============================================================

export type TrackEvent =
  | { kind: 'asr.start'; mode: 'realtime' | 'async' | 'fast'; sessionId: string; language?: string }
  | { kind: 'asr.success'; mode: string; sessionId: string; durationMs: number; segments?: number; chars?: number }
  | { kind: 'asr.fail'; mode: string; sessionId: string; durationMs: number; errorCode?: string; errorMsg?: string }
  | { kind: 'asr.correction.record'; sessionId: string; asrMode: string; correctionId: string }
  | { kind: 'asr.correction.fail'; sessionId: string; asrMode: string; errorCode?: string; errorMsg?: string }
  | { kind: 'tutor.step'; sessionId: string; step: number; stepType: string; toolCalls?: string[]; usage?: unknown }
  | { kind: 'tutor.fail'; sessionId: string; step?: number; errorCode?: string; errorMsg?: string }
  | { kind: 'echo.start'; sessionId: string; sourceType: string }
  | { kind: 'echo.success'; sessionId: string; durationMs: number; bodyChars?: number }
  | { kind: 'echo.fail'; sessionId: string; durationMs: number; errorCode?: string; errorMsg?: string }
  | { kind: 'sync.batch.start'; batchId: string; size: number }
  | { kind: 'sync.batch.success'; batchId: string; size: number; durationMs: number }
  | { kind: 'sync.batch.fail'; batchId: string; size: number; durationMs: number; errorCode?: string }
  | { kind: 'sync.conflict'; batchId: string; detail?: unknown };

const trackLog = createLogger('track');

/** 记录结构化业务事件——所有关键路径都走这里，保证格式统一、可被 Sentry/下游聚合 */
export function track(event: TrackEvent): void {
  const { kind, ...rest } = event;
  const level: LogLevel = kind.endsWith('.fail') ? 'error' : kind.endsWith('.success') ? 'info' : 'info';
  trackLog[level](kind, rest);
}
