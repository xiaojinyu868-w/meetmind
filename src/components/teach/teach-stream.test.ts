import { describe, expect, it } from 'vitest';
import { boardEffectOf, isVisibleTool } from './teach-events';
import { MockTeachSession, flattenScript } from './mockTeachStream';
import type { BoardScript } from '@/lib/ai-native/plugins/board-script';
import type { TeachEvent } from './teach-events';

describe('boardEffectOf（tool-call → 画布效果）', () => {
  it('write 合法 role 透传，非法 role 降级 step，空文本不上板', () => {
    expect(boardEffectOf('write', { text: '课题', role: 'title' })).toEqual({
      type: 'append',
      action: { type: 'write', text: '课题', role: 'title' },
    });
    expect(boardEffectOf('write', { text: 'x', role: 'weird' })).toEqual({
      type: 'append',
      action: { type: 'write', text: 'x', role: 'step' },
    });
    expect(boardEffectOf('write', { text: '', role: 'step' }).type).toBe('none');
  });

  it('flip_page 翻页；pause/ask/finish/ref 不上板', () => {
    expect(boardEffectOf('flip_page', {}).type).toBe('flip');
    for (const name of ['pause', 'ask', 'finish', 'ref']) {
      expect(boardEffectOf(name, {}).type).toBe('none');
    }
  });

  it('circle/underline target 透传', () => {
    expect(boardEffectOf('circle', { target: 'w2' })).toEqual({
      type: 'append',
      action: { type: 'circle', target: 'w2' },
    });
  });

  it('布局/控制类工具不挂 chip，可见工具挂 chip', () => {
    expect(isVisibleTool('write')).toBe(true);
    expect(isVisibleTool('circle')).toBe(true);
    expect(isVisibleTool('ask')).toBe(true);
    expect(isVisibleTool('pause')).toBe(false);
    expect(isVisibleTool('new_column')).toBe(false);
    expect(isVisibleTool('finish')).toBe(false);
    expect(isVisibleTool('flip_page')).toBe(false);
  });
});

const SCRIPT: BoardScript = {
  title: '测试课',
  quotes: [],
  pages: [
    {
      segments: [
        {
          type: 'narration',
          narration: '先写课题。[a0]',
          narrationDisplay: '先写课题。',
          cues: [{ charIndex: 5, actionIndex: 0 }],
          actions: [{ type: 'write', text: '课题', role: 'title' }],
        },
        {
          type: 'checkpoint',
          narration: '算一下这道题。',
          question: { text: '1+1=?', role: 'step' },
          hints: ['h1', 'h2', 'h3'],
          answer: '等于 2。',
          demoActions: [],
        },
        {
          type: 'narration',
          narration: '接着讲。',
          actions: [{ type: 'write', text: '要点', role: 'step' }],
        },
      ],
    },
    {
      segments: [
        {
          type: 'narration',
          narration: '第二页。',
          actions: [{ type: 'write', text: '第二页内容', role: 'step' }],
        },
      ],
    },
  ],
};

async function collect(stream: AsyncGenerator<TeachEvent>): Promise<TeachEvent[]> {
  const events: TeachEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('MockTeachSession（BoardScript → 契约事件流）', () => {
  const pace = { deltaMs: 0, toolDelayMs: 0 };

  it('开课流：cue 到位发 tool-call，checkpoint 挂起等作答', async () => {
    const session = new MockTeachSession(SCRIPT, pace);
    const events = await collect(session.run());
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('text-delta');
    const toolNames = events.filter((e) => e.type === 'tool-call').map((e) => e.name);
    expect(toolNames).toContain('write');
    expect(toolNames).toContain('ask');
    // checkpoint 挂起：turn-complete 收尾，剩余单元未播
    expect(types[types.length - 1]).toBe('turn-complete');
    expect(session.pendingCheckpoint).not.toBeNull();
    expect(session.isDone()).toBe(false);
  });

  it('作答：「你的答案」上板 + 解析 + 续播到 finish（含翻页）', async () => {
    const session = new MockTeachSession(SCRIPT, pace);
    await collect(session.run());
    const events = await collect(session.answer('42'));
    const calls = events.filter((e) => e.type === 'tool-call');
    const writeAnswer = calls.find((e) => e.name === 'write' && String(e.args.text).startsWith('你的答案：'));
    expect(writeAnswer?.args.text).toBe('你的答案：42');
    expect(calls.some((e) => e.name === 'flip_page')).toBe(true);
    expect(calls.some((e) => e.name === 'finish')).toBe(true);
    expect(events[events.length - 1].type).toBe('turn-complete');
    expect(session.isDone()).toBe(true);
    // 解析文本流出
    const text = events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('');
    expect(text).toContain('等于 2。');
  });

  it('普通提问：引用织进回答；游标快照可恢复', async () => {
    const session = new MockTeachSession(SCRIPT, pace);
    await collect(session.run());
    const cursor = session.getCursor();
    const events = await collect(session.ask('为什么', '求根公式'));
    const text = events.filter((e) => e.type === 'text-delta').map((e) => e.text).join('');
    expect(text).toContain('「求根公式」');

    const restored = new MockTeachSession(SCRIPT, pace);
    restored.restore(cursor, true);
    expect(restored.pendingCheckpoint).not.toBeNull();
    const rest = await collect(restored.run());
    // 从 checkpoint 之后续播：不再出现 ask
    expect(rest.filter((e) => e.type === 'tool-call').some((e) => e.name === 'ask')).toBe(false);
  });

  it('flattenScript：页边界插 flip，checkpoint 抽出口述/题目/解析', () => {
    const units = flattenScript(SCRIPT);
    expect(units.filter((u) => u.kind === 'flip')).toHaveLength(1);
    const checkpoint = units.find((u) => u.kind === 'checkpoint');
    expect(checkpoint && 'question' in checkpoint ? checkpoint.question : '').toBe('1+1=?');
  });
});
