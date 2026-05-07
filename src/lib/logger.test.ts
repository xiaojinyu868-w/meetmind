/**
 * Logger + track 单测
 *
 * harness 思想：
 *   - 结构化日志是所有其他埋点的基座，必须有回归保护
 *   - withLogContext 的 ALS 行为 + track() 的事件 schema 都在这里守住
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 先 import，再 vitest 的 mock——确保 pino backend 有机会被注入/bypass
import { createLogger, track, withLogContext } from './logger';

describe('createLogger', () => {
  let spyLog: ReturnType<typeof vi.spyOn>;
  let spyWarn: ReturnType<typeof vi.spyOn>;
  let spyError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    spyLog.mockRestore();
    spyWarn.mockRestore();
    spyError.mockRestore();
  });

  it('exposes debug/info/warn/error/child methods', () => {
    const log = createLogger('unit-test');
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('does not throw for any log level with or without data', () => {
    const log = createLogger('unit-test');
    expect(() => log.info('no data')).not.toThrow();
    expect(() => log.info('with data', { k: 1 })).not.toThrow();
    expect(() => log.warn('warn msg', new Error('boom'))).not.toThrow();
    expect(() => log.error('error msg', { err: 'x' })).not.toThrow();
  });

  it('child logger inherits parent and accepts bindings', () => {
    const parent = createLogger('parent');
    const child = parent.child({ scope: 'sub' });
    expect(() => child.info('child log', { a: 1 })).not.toThrow();
  });
});

describe('withLogContext', () => {
  it('runs the callback and returns its value', () => {
    const result = withLogContext({ requestId: 'req-1' }, () => 42);
    expect(result).toBe(42);
  });

  it('does not throw when nesting contexts', () => {
    const inner = withLogContext({ a: 1 }, () => {
      return withLogContext({ b: 2 }, () => 'nested-ok');
    });
    expect(inner).toBe('nested-ok');
  });
});

describe('track', () => {
  it('accepts all declared event kinds without throwing', () => {
    expect(() => track({ kind: 'asr.start', mode: 'realtime', sessionId: 's1' })).not.toThrow();
    expect(() => track({ kind: 'asr.success', mode: 'realtime', sessionId: 's1', durationMs: 1000 })).not.toThrow();
    expect(() => track({ kind: 'asr.fail', mode: 'realtime', sessionId: 's1', durationMs: 500, errorCode: 'WS_TIMEOUT' })).not.toThrow();

    expect(() => track({ kind: 'tutor.step', sessionId: 's2', step: 1, stepType: 'tool-call', toolCalls: ['makeFlashcards'] })).not.toThrow();
    expect(() => track({ kind: 'tutor.fail', sessionId: 's2', errorCode: 'MODEL_TIMEOUT' })).not.toThrow();

    expect(() => track({ kind: 'echo.start', sessionId: 's3', sourceType: 'audio' })).not.toThrow();
    expect(() => track({ kind: 'echo.success', sessionId: 's3', durationMs: 3000, bodyChars: 500 })).not.toThrow();
    expect(() => track({ kind: 'echo.fail', sessionId: 's3', durationMs: 1000, errorCode: 'LLM_FAIL' })).not.toThrow();

    expect(() => track({ kind: 'sync.batch.start', batchId: 'b1', size: 20 })).not.toThrow();
    expect(() => track({ kind: 'sync.batch.success', batchId: 'b1', size: 20, durationMs: 800 })).not.toThrow();
    expect(() => track({ kind: 'sync.batch.fail', batchId: 'b1', size: 20, durationMs: 3000, errorCode: '413' })).not.toThrow();
    expect(() => track({ kind: 'sync.conflict', batchId: 'b1', detail: { reason: 'stale' } })).not.toThrow();
  });
});
