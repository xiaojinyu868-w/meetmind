/**
 * engine-runner 集成测试：内存 stage store + 估时 pacer（speed 拉高），
 * 验证「边生成边执行」全链路：增量解析 → 闭合动作立即执行 → tool-call/tool-result
 * 事件对、口播 text-delta、越表动作跳过、未闭合兜底、abort 穿透。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { ActionEngine } from '../vendor/openmaic/action/engine';
import { createThreadStageStore } from '../runtime/stage-store';
import { createBoardStores } from '../runtime/board-stores';
import { AudioPacer } from '../runtime/audio-pacer';
import { EngineRunner } from '../runtime/engine-runner';

interface Collected {
  kind: string;
  text?: string;
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

function setup() {
  const events: Collected[] = [];
  const stage = createThreadStageStore('t_test', (kind, detail) => events.push({ kind, ...detail }));
  const pacer = new AudioPacer({ speed: 1000 });
  const engine = new ActionEngine(stage, pacer, null, createBoardStores());
  const runner = new EngineRunner({
    engine,
    pacer,
    boardDigest: () => `板书 ${stage.whiteboard.elements.length} 个元素`,
    hooks: {
      onTextDelta: (text) => events.push({ kind: 'text-delta', text }),
      onToolCall: (c) => events.push({ kind: 'tool-call', id: c.id, name: c.name, args: c.args }),
      onToolResult: (id, result) => events.push({ kind: 'tool-result', id, result }),
      onUnknownAction: (name) => events.push({ kind: 'unknown', name }),
    },
  });
  return { events, stage, runner };
}

const SCRIPT = JSON.stringify([
  { type: 'text', content: '质数就是拆不开的数。' },
  { type: 'action', name: 'wb_open', params: {} },
  { type: 'text', content: '写在板上。' },
  { type: 'action', name: 'wb_draw_text', params: { content: '什么是质数', x: 10, y: 10 } },
  { type: 'action', name: 'spotlight', params: { elementId: 'a_1' } },
]);

describe('engine-runner 集成（内存 stage + 估时 pacer）', () => {
  beforeEach(() => {
    delete process.env.TEACH_ACTIONS_FULL;
  });

  it('边生成边执行：逐块喂入，闭合动作立即落板，事件成对且有序', async () => {
    const { events, stage, runner } = setup();
    // 三块切法：第二块切在动作参数中间
    const third = Math.floor(SCRIPT.length / 3);
    runner.feedTextDelta(SCRIPT.slice(0, third));
    runner.feedTextDelta(SCRIPT.slice(third, third * 2));
    runner.feedTextDelta(SCRIPT.slice(third * 2));
    const summary = await runner.finalize();

    expect(summary.closed).toBe(true);
    expect(summary.executedActions).toBe(3);
    expect(summary.speechSegments).toBe(2);

    const spoken = events.filter((e) => e.kind === 'text-delta').map((e) => e.text).join('');
    expect(spoken).toContain('质数就是拆不开的数');
    expect(spoken).toContain('写在板上');

    const calls = events.filter((e) => e.kind === 'tool-call');
    const results = events.filter((e) => e.kind === 'tool-result');
    expect(calls.map((c) => c.name)).toEqual(['wb_open', 'wb_draw_text', 'spotlight']);
    expect(results).toHaveLength(3);
    // id 稳定且 tool-result 与 tool-call 一一对应
    for (const c of calls) {
      expect(results.some((r) => r.id === c.id)).toBe(true);
    }
    // tool-result 形状对齐旧 BoardEnv digest {ok:true, board}
    expect(results[1].result).toMatchObject({ ok: true });
    expect(String(results[1].result!.board)).toContain('1 个元素');

    // elementId 缺省补 a_1，板上元素与 spotlight 引用一致
    const drawCall = calls.find((c) => c.name === 'wb_draw_text')!;
    expect(drawCall.args).toMatchObject({ elementId: 'a_1', content: '什么是质数' });
    expect(stage.whiteboard.elements).toHaveLength(1);
    expect(stage.whiteboard.elements[0].id).toBe('a_1');
  });

  it('TEACH_ACTIONS_FULL=0 收回 V1：越表动作（wb_draw_table）跳过执行并计 unknownActions', async () => {
    process.env.TEACH_ACTIONS_FULL = '0';
    const { events, stage, runner } = setup();
    const script = JSON.stringify([
      { type: 'text', content: '看表格。' },
      { type: 'action', name: 'wb_draw_table', params: { x: 0, y: 0, width: 100, height: 80, data: [['a']] } },
    ]);
    runner.feedTextDelta(script);
    const summary = await runner.finalize();

    expect(summary.closed).toBe(true);
    expect(summary.executedActions).toBe(0);
    expect(summary.unknownActions).toEqual(['wb_draw_table']);
    expect(events.some((e) => e.kind === 'unknown' && e.name === 'wb_draw_table')).toBe(true);
    expect(events.filter((e) => e.kind === 'tool-call')).toHaveLength(0);
    expect(stage.whiteboard.elements).toHaveLength(0);
  });

  it('默认全量词表：wb_draw_table 放行执行', async () => {
    const { stage, runner } = setup();
    runner.feedTextDelta(
      JSON.stringify([
        { type: 'action', name: 'wb_draw_table', params: { x: 0, y: 0, width: 100, height: 80, data: [['表头'], ['值']] } },
      ]),
    );
    const summary = await runner.finalize();
    expect(summary.executedActions).toBe(1);
    expect(summary.unknownActions).toEqual([]);
    expect(stage.whiteboard.elements).toHaveLength(1);
    expect(stage.whiteboard.elements[0].type).toBe('table');
  });

  it('未闭合兜底：截断输出救回已完成条目，口播不泄漏裸 JSON', async () => {
    const { events, runner } = setup();
    runner.feedTextDelta(
      '[{"type":"text","content":"先说到这。"},{"type":"action","name":"wb_open","params":{}},{"type":"text","content":"残片',
    );
    const summary = await runner.finalize();
    expect(summary.closed).toBe(false);
    expect(summary.executedActions).toBe(1);
    const spoken = events.filter((e) => e.kind === 'text-delta').map((e) => e.text).join('');
    expect(spoken).toContain('先说到这');
    expect(spoken).not.toContain('{"type"');
  });

  it('abort 穿透：清空待执行队列，正在估时的 speech 立即放行', async () => {
    const { events, runner } = setup();
    const slow = new AudioPacer({ speed: 0.001 }); // 150ms/char ÷ 0.001 → 极慢
    const stage = createThreadStageStore('t_abort', () => {});
    const engine = new ActionEngine(stage, slow, null, createBoardStores());
    const slowRunner = new EngineRunner({
      engine,
      pacer: slow,
      boardDigest: () => '',
      hooks: {
        onTextDelta: (t) => events.push({ kind: 'text-delta', text: t }),
        onToolCall: (c) => events.push({ kind: 'tool-call', id: c.id, name: c.name }),
        onToolResult: (id) => events.push({ kind: 'tool-result', id }),
      },
    });
    slowRunner.feedTextDelta(
      JSON.stringify([
        { type: 'text', content: '这是一段很长很长的口播，估时会卡住执行队列。' },
        { type: 'action', name: 'wb_open', params: {} },
      ]),
    );
    slowRunner.abort();
    const summary = await slowRunner.finalize();
    // speech 被放行、wb_open 未执行
    expect(events.filter((e) => e.kind === 'tool-call')).toHaveLength(0);
    expect(stage.whiteboard.elements).toHaveLength(0);
    expect(summary.executedActions).toBe(0);
    expect(runner.isAborted).toBe(false); // 另一个 runner 不受影响（多线程隔离）
  });
});
