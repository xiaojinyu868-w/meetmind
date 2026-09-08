/**
 * teach-engine-service 单测：mock streamFn（不碰真实 provider）+ 内存 mock prisma +
 * 临时目录事件日志。
 *
 * 覆盖：一轮完整教学（text-delta / tool-call / tool-result / turn-complete 事件流
 * + 标题跟随）、409 防并发、**中途 abort**（spike 从未实测过的路径：signal 贯通
 * 到 streamFn，abort 后 emit interrupted 且无 turn-complete，附 text 时续讲）。
 */

import { rm } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmpRoot = vi.hoisted(() => {
  // 事件日志目录在模块加载时读取（TeachConfig），必须在 import 前注入
  const dir = `${process.env.TMPDIR || '/tmp'}/teach-engine-test-${process.pid}-${Math.random().toString(36).slice(2)}`;
  process.env.TEACH_EVENT_LOG_DIR = dir;
  process.env.TEACH_SKILLS_DIR = `${dir}/no-such-skills-dir`;
  return dir;
});

interface ThreadRow {
  id: string;
  title: string;
  topic: string;
  model: string;
  codexThreadId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const rows = new Map<string, ThreadRow>();
let seq = 0;

vi.mock('@/lib/prisma', () => ({
  prisma: {
    teachThread: {
      create: async ({ data }: { data: Partial<ThreadRow> }) => {
        const now = new Date();
        const row: ThreadRow = {
          id: `th_${++seq}`,
          title: '',
          topic: '',
          model: '',
          codexThreadId: null,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          ...data,
        } as ThreadRow;
        rows.set(row.id, row);
        return row;
      },
      findUnique: async ({ where: { id } }: { where: { id: string } }) => rows.get(id) ?? null,
      update: async ({ where: { id }, data }: { where: { id: string }; data: Partial<ThreadRow> }) => {
        const row = rows.get(id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      },
      findMany: async () => [...rows.values()],
    },
  },
}));

import { subscribeTeachThread, type TeachStreamEvent } from '../../teach-codex/event-bus';
import * as store from '../../teach-codex/thread-store';
import {
  interruptTeachEngineThread,
  sendTeachEngineMessage,
  setTeachEngineStreamFnFactoryForTests,
  TeachEngineError,
} from '../teach-engine-service';

// ---------- fake streamFn ----------

interface FakeStream {
  push(ev: Record<string, unknown>): void;
  result(): Promise<unknown>;
  [Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>>;
}

function makeStream(): { stream: FakeStream; push: (ev: Record<string, unknown>) => void } {
  const queue: Record<string, unknown>[] = [];
  const waiting: Array<(r: IteratorResult<Record<string, unknown>>) => void> = [];
  let finished = false;
  let resolveFinal!: (m: unknown) => void;
  const finalPromise = new Promise<unknown>((r) => (resolveFinal = r));
  const push = (ev: Record<string, unknown>) => {
    if (finished) return;
    if (ev.type === 'done' || ev.type === 'error') {
      finished = true;
      resolveFinal(ev.message ?? ev.error);
    }
    const w = waiting.shift();
    if (w) w({ value: ev, done: false });
    else queue.push(ev);
  };
  const stream: FakeStream = {
    push,
    result: () => finalPromise,
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else if (finished) {
          return;
        } else {
          const r = await new Promise<IteratorResult<Record<string, unknown>>>((res) =>
            waiting.push(res),
          );
          if (r.done) return;
          yield r.value;
        }
      }
    },
  };
  return { stream, push };
}

const EMPTY_USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function freshPartial() {
  return {
    role: 'assistant',
    content: [] as unknown[],
    api: 'unknown',
    provider: 'unknown',
    model: 'fake',
    usage: { ...EMPTY_USAGE },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

/** 当前回合脚本：chunks 逐段吐 text_delta；respectSignal 时被打断则走 error 收尾。 */
let script: { chunks: string[]; chunkDelayMs: number } = { chunks: [], chunkDelayMs: 0 };

function fakeStreamFn() {
  return ((_model: unknown, _context: unknown, options?: { signal?: AbortSignal }) => {
    const { stream, push } = makeStream();
    const partial = freshPartial();
    void (async () => {
      push({ type: 'start', partial });
      let buf = '';
      for (const ch of script.chunks) {
        if (options?.signal?.aborted) {
          partial.stopReason = 'error';
          (partial as Record<string, unknown>).errorMessage = 'aborted';
          push({ type: 'error', reason: 'error', error: partial });
          return;
        }
        buf += ch;
        partial.content = [{ type: 'text', text: buf }];
        push({ type: 'text_delta', contentIndex: 0, delta: ch, partial });
        if (script.chunkDelayMs > 0) {
          await new Promise((r) => setTimeout(r, script.chunkDelayMs));
        }
      }
      partial.stopReason = 'stop';
      push({ type: 'done', reason: 'stop', message: partial });
    })();
    return stream;
  }) as never;
}

// ---------- 测试 ----------

function collectEvents(threadId: string) {
  const events: TeachStreamEvent[] = [];
  const unsubscribe = subscribeTeachThread(threadId, (e) => events.push(e));
  return { events, unsubscribe };
}

async function waitFor(events: TeachStreamEvent[], type: string, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (!events.some((e) => e.type === type)) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`等待事件超时: ${type}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

afterAll(async () => {
  setTeachEngineStreamFnFactoryForTests(null);
  await rm(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  setTeachEngineStreamFnFactoryForTests(fakeStreamFn as never);
});

describe('teach-engine-service（mock streamFn）', () => {
  it('一轮完整教学：事件流契约 + 标题跟随首条 wb_draw_text', async () => {
    const row = await store.createThread({ topic: '什么是质数', model: 'fake' });
    const { events, unsubscribe } = collectEvents(row.id);
    script = {
      chunks: [
        '[{"type":"text","content":"好。"},',
        '{"type":"action","name":"wb_draw_text","params":{"content":"什么是质数","x":10,"y":10}},',
        '{"type":"text","content":"质数就是拆不开的数。"}]',
      ],
      chunkDelayMs: 0,
    };
    await sendTeachEngineMessage(row.id, '老师，什么是质数？');
    await waitFor(events, 'turn-complete');

    const types = events.map((e) => e.type);
    expect(types).toContain('text-delta');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types[types.length - 1]).toBe('turn-complete');

    const call = events.find((e) => e.type === 'tool-call')!;
    expect(call).toMatchObject({ name: 'wb_draw_text' });
    const result = events.find((e) => e.type === 'tool-result')!;
    expect(result).toMatchObject({ id: (call as { id: string }).id });
    expect((result as { result: { ok: boolean } }).result.ok).toBe(true);

    const spoken = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(spoken).toContain('质数就是拆不开的数');

    // 标题跟随：title 从 topic 改成首条 wb_draw_text 内容
    expect(rows.get(row.id)!.title).toBe('什么是质数');

    // student-message 落盘（只落盘不广播）
    expect(events.some((e) => e.type === ('student-message' as never))).toBe(false);
    const logged = await store.readThreadEvents(row.id);
    expect(logged.some((e) => e.type === 'student-message')).toBe(true);
    unsubscribe();
  }, 40_000);

  it('不存在线程 404；turn 进行中再发消息抛 409', async () => {
    await expect(sendTeachEngineMessage('no_such_thread', 'hi')).rejects.toMatchObject({
      status: 404,
    });

    const row = await store.createThread({ topic: '慢课', model: 'fake' });
    const { events, unsubscribe } = collectEvents(row.id);
    // 慢脚本：多段 + 每段延迟，足够长让第二次发送撞上 active turn
    script = {
      chunks: ['[{"type":"text","content":"开', ...Array.from({ length: 30 }, () => '讲')],
      chunkDelayMs: 100,
    };
    await sendTeachEngineMessage(row.id, '开讲');
    await expect(sendTeachEngineMessage(row.id, '再来')).rejects.toMatchObject({
      code: 'turn-active',
      status: 409,
    });
    // 收尾：打断掉这个慢轮，避免泄漏到下一个测试
    await interruptTeachEngineThread(row.id);
    await waitFor(events, 'interrupted');
    unsubscribe();
  }, 40_000);

  it('中途 abort：interrupted 落地、无 turn-complete、附 text 后续讲', async () => {
    const row = await store.createThread({ topic: '打断课', model: 'fake' });
    const { events, unsubscribe } = collectEvents(row.id);

    // 第一轮：慢速流（多段口播 + 长延迟），讲到一半打断并插话
    script = {
      chunks: [
        '[{"type":"text","content":"我们先讲第一部分。"},',
        '{"type":"text","content":"这部分很长。"},',
        '{"type":"text","content":"还没讲完就被打断了。"}]',
      ],
      chunkDelayMs: 300,
    };
    await sendTeachEngineMessage(row.id, '开讲');
    // 等口播真的开始流出再打断（中途 abort，不是开头 abort）
    await waitFor(events, 'text-delta');
    await interruptTeachEngineThread(row.id, '等下，先回答我一个问题');
    await waitFor(events, 'interrupted');
    expect(events.some((e) => e.type === 'turn-complete')).toBe(false);

    // 续讲轮：快脚本正常讲完
    script = { chunks: ['[{"type":"text","content":"好，先答你。"}]'], chunkDelayMs: 0 };
    await waitFor(events, 'turn-complete');
    const spoken = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(spoken).toContain('好，先答你');
    unsubscribe();
  }, 40_000);

  it('interrupt 无活跃 turn 时带 text 直接开讲', async () => {
    const row = await store.createThread({ topic: '直接插话', model: 'fake' });
    const { events, unsubscribe } = collectEvents(row.id);
    script = { chunks: ['[{"type":"text","content":"来了。"}]'], chunkDelayMs: 0 };
    await interruptTeachEngineThread(row.id, '直接问');
    await waitFor(events, 'turn-complete');
    expect(events.some((e) => e.type === 'interrupted')).toBe(false);
    unsubscribe();
  }, 40_000);

  it('TeachEngineError 携带 code/status（路由层判别联合语义）', () => {
    const err = new TeachEngineError('turn-active', '老师正在讲', 409);
    expect(err.status).toBe(409);
    expect(err.code).toBe('turn-active');
    expect(err).toBeInstanceOf(Error);
  });
});
