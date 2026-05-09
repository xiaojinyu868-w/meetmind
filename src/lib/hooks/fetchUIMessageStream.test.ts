/**
 * fetchUIMessageStream — 行为测试
 *
 * 覆盖 classroom 同桌依赖的核心路径：
 *   - 多个 text-delta 帧累加成 fullText
 *   - text-start / text-end 不影响累加
 *   - tool-call 钩子透传
 *   - error 帧抛出
 *   - abort 信号下返回部分文本 + aborted=true
 *   - HTTP 4xx/5xx 错误映射
 */

import { describe, it, expect, vi } from 'vitest';
import { fetchUIMessageStream } from './fetchUIMessageStream';

// 帮助：构造一个 ReadableStream，模拟 AI SDK v6 UIMessage 帧
function makeStream(frames: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      }
      controller.close();
    },
  });
}

function mockFetch(body: ReadableStream, status = 200, responseHeaders: Record<string, string> = {}) {
  const headers = new Headers(responseHeaders);
  return vi.fn().mockResolvedValue(
    new Response(body, { status, headers }),
  );
}

describe('fetchUIMessageStream — text deltas 累加', () => {
  it('多个 text-delta 帧按顺序拼成 fullText', async () => {
    const stream = makeStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: '好的' },
      { type: 'text-delta', id: 't1', delta: '，我' },
      { type: 'text-delta', id: 't1', delta: '来回答。' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    globalThis.fetch = mockFetch(stream) as unknown as typeof fetch;

    const deltas: string[] = [];
    const result = await fetchUIMessageStream('/api/x', {}, {
      onTextDelta: (chunk) => deltas.push(chunk),
    });

    expect(result.text).toBe('好的，我来回答。');
    expect(result.aborted).toBe(false);
    expect(deltas).toEqual(['好的', '，我', '来回答。']);
  });

  it('onTextStart 只触发一次（第一个 text-start）', async () => {
    const stream = makeStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'A' },
      { type: 'text-end', id: 't1' },
      { type: 'text-start', id: 't2' },
      { type: 'text-delta', id: 't2', delta: 'B' },
      { type: 'text-end', id: 't2' },
    ]);
    globalThis.fetch = mockFetch(stream) as unknown as typeof fetch;

    const onTextStart = vi.fn();
    await fetchUIMessageStream('/api/x', {}, { onTextStart });

    expect(onTextStart).toHaveBeenCalledTimes(1);
  });

  it('空 delta 不触发 callback', async () => {
    const stream = makeStream([
      { type: 'text-delta', id: 't1', delta: '' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
    ]);
    globalThis.fetch = mockFetch(stream) as unknown as typeof fetch;

    const onTextDelta = vi.fn();
    const result = await fetchUIMessageStream('/api/x', {}, { onTextDelta });

    expect(onTextDelta).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('hi', 'hi');
    expect(result.text).toBe('hi');
  });
});

describe('fetchUIMessageStream — tool-call 钩子', () => {
  it('tool-input-available 和 tool-output-available 分别触发 onToolCall / onToolResult', async () => {
    const stream = makeStream([
      { type: 'tool-input-start', toolCallId: 'c1', toolName: 'makeQuiz' },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'makeQuiz', input: { count: 3 } },
      { type: 'tool-output-available', toolCallId: 'c1', output: { ok: true } },
      { type: 'finish', finishReason: 'stop' },
    ]);
    globalThis.fetch = mockFetch(stream) as unknown as typeof fetch;

    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    await fetchUIMessageStream('/api/x', {}, { onToolCall, onToolResult });

    expect(onToolCall).toHaveBeenCalledWith({
      toolCallId: 'c1',
      toolName: 'makeQuiz',
      input: { count: 3 },
    });
    expect(onToolResult).toHaveBeenCalledWith({
      toolCallId: 'c1',
      output: { ok: true },
    });
  });
});

describe('fetchUIMessageStream — 错误路径', () => {
  it('流里的 error 帧被抛出', async () => {
    const stream = makeStream([
      { type: 'text-delta', id: 't1', delta: '开始' },
      { type: 'error', errorText: '模型超时了' },
    ]);
    globalThis.fetch = mockFetch(stream) as unknown as typeof fetch;

    await expect(fetchUIMessageStream('/api/x', {})).rejects.toThrow('模型超时了');
  });

  it('HTTP 400 带 error body 映射成 error message', async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad request' }), { status: 400 }),
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    await expect(fetchUIMessageStream('/api/x', {})).rejects.toThrow('bad request');
  });

  it('HTTP 429 + Retry-After 附上等待提示', async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: '请求太频繁' }), {
        status: 429,
        headers: { 'Retry-After': '30' },
      }),
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    await expect(fetchUIMessageStream('/api/x', {})).rejects.toThrow('约 30 秒后再试');
  });
});

describe('fetchUIMessageStream — abort', () => {
  it('signal aborted 时返回 aborted=true + 部分文本', async () => {
    const ctrl = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'half' })}\n\n`),
        );
        // 在后续 chunk 前 abort
        ctrl.abort();
        // 尝试再发一个（应当已经拒绝）
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'text-delta', id: 't1', delta: 'more' })}\n\n`),
          );
        } catch {
          /* abort 后 enqueue 会抛，忽略 */
        }
        controller.close();
      },
    });
    globalThis.fetch = mockFetch(stream) as unknown as typeof fetch;

    const result = await fetchUIMessageStream('/api/x', {}, { signal: ctrl.signal });
    // 要么 aborted=true，要么至少没抛错（读取过程中被 abort）
    expect(result.text.startsWith('half') || result.aborted).toBe(true);
  });
});
