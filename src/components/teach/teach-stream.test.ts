import { describe, expect, it } from 'vitest';
import { applyImageUrlToBoard, boardEffectOf, engineTitleFollow, isVisibleTool } from './teach-events';
import { MockTeachSession, flattenScript } from './mockTeachStream';
import type { BoardPage, BoardScript } from '@/lib/ai-native/plugins/board-script';
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

  it('image：无 url 时占位（生成中）；callId 透传为回填定位键', () => {
    expect(boardEffectOf('image', { prompt: '几何拼接', caption: '图示' }, 'tc_1')).toEqual({
      type: 'append',
      action: { type: 'image', url: '', prompt: '几何拼接', caption: '图示', callId: 'tc_1' },
    });
    // 备课态（无 callId）不带上该字段
    expect(boardEffectOf('image', { prompt: 'p' })).toEqual({
      type: 'append',
      action: { type: 'image', url: '', prompt: 'p' },
    });
  });
});

describe('boardEffectOf · 新引擎动作词表（teach-engine，P1-B）', () => {
  it('wb_draw_text：剥富文本标签上板；默认 step，注入 role=title 时为课题标题', () => {
    expect(boardEffectOf('wb_draw_text', { content: '质数与合数', elementId: 'a_1' })).toEqual({
      type: 'append',
      action: { type: 'write', text: '质数与合数', role: 'step' },
    });
    expect(boardEffectOf('wb_draw_text', { content: '质数与合数', role: 'title' })).toEqual({
      type: 'append',
      action: { type: 'write', text: '质数与合数', role: 'title' },
    });
    expect(boardEffectOf('wb_draw_text', { content: '<b>定义</b>' })).toEqual({
      type: 'append',
      action: { type: 'write', text: '定义', role: 'step' },
    });
    expect(boardEffectOf('wb_draw_text', { content: '  ' }).type).toBe('none');
    expect(boardEffectOf('wb_draw_text', {}).type).toBe('none');
  });

  it('wb_draw_latex：latex → write role=formula', () => {
    expect(boardEffectOf('wb_draw_latex', { latex: 'x^2+y^2=z^2', elementId: 'a_2' })).toEqual({
      type: 'append',
      action: { type: 'write', text: 'x^2+y^2=z^2', role: 'formula' },
    });
    expect(boardEffectOf('wb_draw_latex', { latex: '' }).type).toBe('none');
  });

  it('spotlight：a_${n} 元素 id 映射 wN 圈注；自定义 id 原样透传', () => {
    expect(boardEffectOf('spotlight', { elementId: 'a_3' })).toEqual({
      type: 'append',
      action: { type: 'circle', target: 'w3' },
    });
    expect(boardEffectOf('spotlight', { elementId: 'custom' })).toEqual({
      type: 'append',
      action: { type: 'circle', target: 'custom' },
    });
  });

  it('laser 降级 none（P3 vendor UI 换真渲染）；wb_clear → BoardClearAction', () => {
    expect(boardEffectOf('laser', { elementId: 'a_1' }).type).toBe('none');
    expect(boardEffectOf('wb_clear', {})).toEqual({ type: 'append', action: { type: 'clear' } });
  });

  it('wb_open/wb_close/discussion 不上板；v1 词表外动作降级 none', () => {
    for (const name of ['wb_open', 'wb_close', 'discussion', 'speech']) {
      expect(boardEffectOf(name, {}).type).toBe('none');
    }
    // 仅 TEACH_ACTIONS_FULL=1 时模型才可能输出：前端先不认，渲染器留待后续期
    for (const name of ['wb_draw_shape', 'wb_draw_table', 'wb_draw_line', 'wb_draw_code', 'wb_edit_code']) {
      expect(boardEffectOf(name, { content: 'x' }).type).toBe('none');
    }
  });

  it('新词表静默动作不挂 chip，落板动作挂 chip', () => {
    expect(isVisibleTool('speech')).toBe(false);
    expect(isVisibleTool('discussion')).toBe(false);
    expect(isVisibleTool('wb_open')).toBe(false);
    expect(isVisibleTool('wb_close')).toBe(false);
    expect(isVisibleTool('wb_draw_text')).toBe(true);
    expect(isVisibleTool('wb_draw_latex')).toBe(true);
    expect(isVisibleTool('wb_clear')).toBe(true);
    expect(isVisibleTool('spotlight')).toBe(true);
  });

  it('engineTitleFollow：首条 wb_draw_text → 标题 + 注入 title role；空内容/其他动作不跟随', () => {
    expect(engineTitleFollow('wb_draw_text', { content: '<b>质数入门</b>', x: 60 })).toEqual({
      title: '质数入门',
      args: { content: '<b>质数入门</b>', x: 60, role: 'title' },
    });
    expect(engineTitleFollow('wb_draw_text', { content: '  ' })).toBeNull();
    expect(engineTitleFollow('wb_draw_latex', { latex: 'x' })).toBeNull();
    // 注入后的 args 过 boardEffectOf 得到 title 字阶
    const follow = engineTitleFollow('wb_draw_text', { content: '课题' })!;
    expect(boardEffectOf('wb_draw_text', follow.args)).toEqual({
      type: 'append',
      action: { type: 'write', text: '课题', role: 'title' },
    });
  });
});

describe('applyImageUrlToBoard（image-ready → 画布占位回填）', () => {
  const pages = (): BoardPage[] => [
    {
      segments: [
        {
          type: 'narration',
          narration: '',
          actions: [
            { type: 'write', text: '课题', role: 'title' },
            { type: 'image', url: '', prompt: '几何拼接', caption: '图示', callId: 'tc_1' },
          ],
        },
      ],
    },
  ];

  it('按 callId 找到占位动作填上 url（不可变更新）', () => {
    const before = pages();
    const after = applyImageUrlToBoard(before, 'tc_1', '/uploads/teach/abc.png');
    expect(after).not.toBeNull();
    const action = after![0].segments[0];
    if (action.type !== 'narration') throw new Error('unexpected');
    expect(action.actions[1]).toMatchObject({ type: 'image', url: '/uploads/teach/abc.png' });
    // 原数组不被改（React 状态语义）
    expect(before[0].segments[0]).toMatchObject({ actions: [{}, { url: '' }] });
  });

  it('找不到匹配 callId / 已有 url 时返回 null（幂等）', () => {
    expect(applyImageUrlToBoard(pages(), 'tc_missing', '/u/x.png')).toBeNull();
    const filled = applyImageUrlToBoard(pages(), 'tc_1', '/uploads/teach/abc.png')!;
    expect(applyImageUrlToBoard(filled, 'tc_1', '/uploads/teach/again.png')).toBeNull();
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
