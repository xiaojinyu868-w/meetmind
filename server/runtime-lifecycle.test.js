import { describe, expect, it, vi } from 'vitest';
import lifecycle from './runtime-lifecycle.js';

const { installGracefulShutdown, resolveServerHost } = lifecycle;

describe('resolveServerHost', () => {
  it('binds production to loopback while keeping development remotely reachable', () => {
    expect(resolveServerHost({ dev: false })).toBe('127.0.0.1');
    expect(resolveServerHost({ dev: true })).toBe('0.0.0.0');
  });

  it('honors an explicit HOST override', () => {
    expect(resolveServerHost({ dev: false, configuredHost: '0.0.0.0' })).toBe('0.0.0.0');
  });
});

function createProcessStub() {
  const handlers = new Map();
  return {
    once: vi.fn((event, handler) => handlers.set(event, handler)),
    on: vi.fn((event, handler) => handlers.set(event, handler)),
    emit(event, payload) {
      handlers.get(event)?.(payload);
    },
  };
}

describe('installGracefulShutdown', () => {
  it('waits for every websocket and HTTP server before exiting on SIGTERM', () => {
    let closeHttp;
    let closeWebSocketA;
    let closeWebSocketB;
    const clientA = { close: vi.fn() };
    const clientB = { close: vi.fn() };
    const webSocketServerA = {
      clients: new Set([clientA]),
      close: vi.fn((callback) => { closeWebSocketA = callback; }),
    };
    const webSocketServerB = {
      clients: new Set([clientB]),
      close: vi.fn((callback) => { closeWebSocketB = callback; }),
    };
    const server = {
      close: vi.fn((callback) => { closeHttp = callback; }),
    };
    const processRef = createProcessStub();
    const exit = vi.fn();
    const timer = { unref: vi.fn() };
    const setTimeoutFn = vi.fn(() => timer);
    const clearTimeoutFn = vi.fn();

    installGracefulShutdown({
      server,
      webSocketServers: [webSocketServerA, webSocketServerB],
      processRef,
      exit,
      setTimeoutFn,
      clearTimeoutFn,
      logger: { log: vi.fn(), error: vi.fn() },
    });

    processRef.emit('SIGTERM');

    expect(clientA.close).toHaveBeenCalledWith(1012, 'Service restarting');
    expect(clientB.close).toHaveBeenCalledWith(1012, 'Service restarting');
    expect(webSocketServerA.close).toHaveBeenCalledOnce();
    expect(webSocketServerB.close).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(timer.unref).toHaveBeenCalledOnce();

    closeHttp();
    expect(exit).not.toHaveBeenCalled();

    closeWebSocketA();
    expect(exit).not.toHaveBeenCalled();

    closeWebSocketB();
    expect(clearTimeoutFn).toHaveBeenCalledWith(timer);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('handles the PM2 shutdown message only once', () => {
    const server = {
      close: vi.fn((callback) => callback()),
    };
    const processRef = createProcessStub();
    const exit = vi.fn();

    installGracefulShutdown({
      server,
      webSocketServers: [],
      processRef,
      exit,
      setTimeoutFn: () => ({ unref() {} }),
      logger: { log: vi.fn(), error: vi.fn() },
    });

    processRef.emit('message', 'shutdown');
    processRef.emit('message', 'shutdown');

    expect(server.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
});
