import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DashScopeASRClient,
  isTerminalAsrError,
  resolveHandshakeTimeoutMs,
  resolveReadyTimeoutMs,
  rotateCandidates,
  type ASRLinkInfo,
  type ASRSentence,
} from './dashscope-asr-service';

interface ClientInternals {
  isReady: boolean;
  isFlushing: boolean;
  audioQueue: ArrayBuffer[];
  connectionGeneration: number;
  ws: { readyState: number; send: (data: ArrayBuffer) => void } | null;
  flushAudioQueue: () => void;
  handleResult: (
    sentence: {
      id?: string;
      text?: string;
      beginTime?: number;
      endTime?: number | null;
      isFinal?: boolean;
      itemId?: string;
    },
    replaces?: string[],
  ) => void;
}

/** 可控的假 WebSocket：测试里手动 open / message / 断开，close() 同步触发 onclose（浏览器是异步的，但对状态机等价） */
class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: Array<string | ArrayBuffer> = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1005, reason: '' });
  }

  // ── 测试助手 ──
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  message(payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  drop(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason: '' });
  }

  jsonSent(): Array<Record<string, unknown>> {
    return this.sent
      .filter((item): item is string => typeof item === 'string')
      .map((item) => JSON.parse(item) as Record<string, unknown>);
  }

  binarySent(): ArrayBuffer[] {
    return this.sent.filter((item): item is ArrayBuffer => typeof item !== 'string');
  }
}

/** 16kHz 16bit：100ms = 3200 字节 */
function pcm100ms(fill: number): ArrayBuffer {
  return new Uint8Array(3200).fill(fill).buffer;
}

async function flushAsync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** 就绪连接上的 stop() 会等上游 finished（最多 5s）：这里由假 socket 立刻回 finished */
async function stopClient(client: DashScopeASRClient, ws: FakeWebSocket): Promise<void> {
  const stopping = client.stop();
  await flushAsync();
  if (ws.readyState === FakeWebSocket.OPEN) ws.message({ event: 'finished', code: 1000 });
  await vi.advanceTimersByTimeAsync(5_000);
  await stopping;
}

describe('DashScopeASRClient ordered handoff', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it('queues live PCM behind reconnect backlog instead of sending it out of order', () => {
    const client = new DashScopeASRClient('');
    const internals = client as unknown as ClientInternals;
    const sent: ArrayBuffer[] = [];
    const first = Uint8Array.from([1]).buffer;
    const second = Uint8Array.from([2]).buffer;

    internals.isReady = true;
    internals.isFlushing = true;
    internals.audioQueue = [first];
    internals.ws = {
      readyState: FakeWebSocket.OPEN,
      send: (data) => sent.push(data),
    };

    client.sendAudio(second);

    expect(sent).toEqual([]);
    expect(internals.audioQueue).toEqual([first, second]);

    internals.isFlushing = false;
    internals.flushAudioQueue();
    expect(sent).toEqual([first, second]);
  });

  it('namespaces remote ids per connection so engine switches cannot collide', () => {
    const sentences: ASRSentence[] = [];
    const client = new DashScopeASRClient('', {
      onSentence: (sentence) => sentences.push(sentence),
    });
    const internals = client as unknown as ClientInternals;

    internals.connectionGeneration = 1;
    internals.handleResult({
      id: 'seg-0',
      itemId: 'item-0',
      text: '旧引擎最后一句',
      beginTime: 0,
      endTime: 1000,
      isFinal: true,
    });
    internals.connectionGeneration = 2;
    internals.handleResult({
      id: 'seg-0',
      itemId: 'item-0',
      text: '新引擎第一句',
      beginTime: 1000,
      endTime: 2000,
      isFinal: true,
    });

    expect(sentences[0].id).not.toBe(sentences[1].id);
    expect(sentences[0].itemId).not.toBe(sentences[1].itemId);
  });
});

describe('connection policy helpers', () => {
  it('握手 / 就绪超时随失败轮数增长并封顶', () => {
    expect(resolveHandshakeTimeoutMs(0)).toBe(8_000);
    expect(resolveHandshakeTimeoutMs(1)).toBe(12_000);
    expect(resolveHandshakeTimeoutMs(10)).toBe(20_000);
    expect(resolveReadyTimeoutMs(0)).toBe(15_000);
    expect(resolveReadyTimeoutMs(2)).toBe(25_000);
    expect(resolveReadyTimeoutMs(9)).toBe(30_000);
  });

  it('候选地址按轮数轮转，主地址一直挂起时下一轮先试备用端口', () => {
    const candidates = ['wss://a/api/asr-stream', 'wss://a:8443/api/asr-stream'];
    expect(rotateCandidates(candidates, 0)).toEqual(candidates);
    expect(rotateCandidates(candidates, 1)).toEqual([candidates[1], candidates[0]]);
    expect(rotateCandidates(candidates, 2)).toEqual(candidates);
    expect(rotateCandidates(['only'], 7)).toEqual(['only']);
  });

  it('额度 / 密钥 / 未配置是终态错误，其余是瞬时错误', () => {
    expect(isTerminalAsrError('ASR_QUOTA_EXCEEDED')).toBe(true);
    expect(isTerminalAsrError('GUEST_DAILY_ASR_CAP')).toBe(true);
    expect(isTerminalAsrError('API Key 未配置')).toBe(true);
    expect(isTerminalAsrError('DashScope 连接错误: read ECONNRESET')).toBe(false);
    expect(isTerminalAsrError('识别服务连接超时，正在重试')).toBe(false);
  });
});

describe('DashScopeASRClient connection state machine', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeWebSocket });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { href: 'http://localhost:3001/app' },
        localStorage: { getItem: () => null },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  function createClient(options: ConstructorParameters<typeof DashScopeASRClient>[2] = {}) {
    const links: ASRLinkInfo['state'][] = [];
    const errors: string[] = [];
    const client = new DashScopeASRClient('', {
      onLinkStateChange: (info) => links.push(info.state),
      onError: (message) => errors.push(message),
    }, { reconnectBaseMs: 100, reconnectCapMs: 100, ...options });
    return { client, links, errors };
  }

  it('默认一轮不通就放弃：短用途（语音输入）保持原有语义', async () => {
    const { client, links } = createClient();
    const started = client.start();
    await flushAsync();
    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].drop(1006);
    await expect(started).resolves.toBe(false);
    expect(links).toEqual(['connecting', 'offline']);
  });

  it('首次连接失败不再等于整节课零字幕：按退避重试，期间音频排队，就绪后按序补送', async () => {
    const { client, links } = createClient({ connectAttempts: Number.POSITIVE_INFINITY });
    const started = client.start();
    await flushAsync();
    // 连接还没建立就先来了音频：进队列
    client.sendAudio(pcm100ms(1));
    client.sendAudio(pcm100ms(2));

    FakeWebSocket.instances[0].drop(1006);
    await flushAsync();
    expect(links).toEqual(['connecting', 'reconnecting']);
    expect(FakeWebSocket.instances).toHaveLength(1);

    // 退避（≤100ms）后开第二条
    await vi.advanceTimersByTimeAsync(150);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];
    second.open();
    // 首次连接：队头就是第 0 毫秒，不发偏移
    expect(second.jsonSent().some((msg) => msg.type === 'timeline-offset')).toBe(false);
    second.message({ event: 'ready' });
    await flushAsync();

    await expect(started).resolves.toBe(true);
    expect(links).toEqual(['connecting', 'reconnecting', 'live']);
    expect(second.binarySent().map((buffer) => new Uint8Array(buffer)[0])).toEqual([1, 2]);
    expect(client.isConnected()).toBe(true);
    await stopClient(client, second);
  });

  it('会话中断线：自动重连、断线期音频补送、告诉代理课堂时间轴偏移', async () => {
    const { client, links } = createClient({
      connectAttempts: Number.POSITIVE_INFINITY,
      maxReconnectAttempts: Number.POSITIVE_INFINITY,
    });
    const started = client.start();
    await flushAsync();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message({ event: 'ready' });
    await flushAsync();
    await expect(started).resolves.toBe(true);

    // 就绪后 300ms 音频直发
    client.sendAudio(pcm100ms(1));
    client.sendAudio(pcm100ms(2));
    client.sendAudio(pcm100ms(3));
    expect(first.binarySent()).toHaveLength(3);

    // 断线：期间 200ms 音频进队列
    first.drop(1006);
    await flushAsync();
    expect(links.at(-1)).toBe('reconnecting');
    client.sendAudio(pcm100ms(4));
    client.sendAudio(pcm100ms(5));

    await vi.advanceTimersByTimeAsync(150);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];
    second.open();
    // 队头那一帧在课堂时间轴的第 300ms：代理据此把上游从 0 起算的时间戳平移回整节课
    expect(second.jsonSent()).toContainEqual({ type: 'timeline-offset', offsetMs: 300 });
    second.message({ event: 'ready' });
    await flushAsync();

    expect(links.at(-1)).toBe('live');
    expect(second.binarySent().map((buffer) => new Uint8Array(buffer)[0])).toEqual([4, 5]);
    await stopClient(client, second);
  });

  it('上游中途自己收尾（finished 而非用户 stop）：主动断开走重连，而不是把音频灌进没有上游的连接', async () => {
    const { client, links } = createClient({ maxReconnectAttempts: Number.POSITIVE_INFINITY });
    void client.start();
    await flushAsync();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message({ event: 'ready' });
    await flushAsync();

    first.message({ event: 'finished', code: 1000 });
    await flushAsync();
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(links.at(-1)).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(150);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await client.stop();
  });

  it('握手一直挂起：到点换下一轮，不再是 5s 后整体放弃', async () => {
    const { client } = createClient({ connectAttempts: Number.POSITIVE_INFINITY, handshakeTimeoutMs: 1_000 });
    void client.start();
    await flushAsync();
    expect(FakeWebSocket.instances).toHaveLength(1);
    // 第一轮握手超时 1s → 关掉 → 退避 ≤100ms → 第二轮
    await vi.advanceTimersByTimeAsync(1_200);
    expect(FakeWebSocket.instances[0].readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await client.stop();
  });

  it('额度用完是终态：不重连，start() 返回 false，链路 offline', async () => {
    const { client, links, errors } = createClient({
      connectAttempts: Number.POSITIVE_INFINITY,
      maxReconnectAttempts: Number.POSITIVE_INFINITY,
    });
    const started = client.start();
    await flushAsync();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message({ event: 'error', error: 'ASR_QUOTA_EXCEEDED' });
    first.drop(1005);
    await expect(started).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(links.at(-1)).toBe('offline');
    expect(errors).toEqual(['ASR_QUOTA_EXCEEDED']);
    expect(client.isTerminated()).toBe(true);
  });

  it('长时间收不到任何消息（半开连接）：主动断开重连', async () => {
    const { client, links } = createClient({ maxReconnectAttempts: Number.POSITIVE_INFINITY });
    void client.start();
    await flushAsync();
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message({ event: 'ready' });
    await flushAsync();
    expect(links.at(-1)).toBe('live');

    // 每 15s 检查一次；超过 45s 没有任何入站消息（pong 也没有）→ 第 60s 那次检查判死
    await vi.advanceTimersByTimeAsync(44_000);
    expect(first.readyState).toBe(FakeWebSocket.OPEN);
    await vi.advanceTimersByTimeAsync(17_000);
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(links.at(-1)).toBe('reconnecting');
    await client.stop();
  });

  it('用户 stop：清掉重连计时器，start() 若还没就绪则返回 false', async () => {
    const { client } = createClient({ connectAttempts: Number.POSITIVE_INFINITY });
    const started = client.start();
    await flushAsync();
    FakeWebSocket.instances[0].drop(1006);
    await flushAsync();
    await client.stop();
    await expect(started).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
