import { describe, expect, it } from 'vitest';
import {
  isWriteRef,
  parseWriteRef,
  sanitizeBoardScript,
  MAX_PAGES,
  MAX_SEGMENTS_PER_PAGE,
} from './board-script';

describe('parseWriteRef / isWriteRef', () => {
  it('解析合法 wN 引用', () => {
    expect(parseWriteRef('w1')).toBe(1);
    expect(parseWriteRef('w12')).toBe(12);
    expect(isWriteRef('w3')).toBe(true);
  });

  it('拒绝非法引用', () => {
    expect(parseWriteRef('w0')).toBeNull();
    expect(parseWriteRef('W1')).toBeNull();
    expect(parseWriteRef('w')).toBeNull();
    expect(parseWriteRef('1')).toBeNull();
    expect(parseWriteRef('B3')).toBeNull();
    expect(parseWriteRef(3)).toBeNull();
    expect(parseWriteRef('')).toBeNull();
  });
});

describe('sanitizeBoardScript', () => {
  it('保留合法脚本结构（write 无坐标、标注用 wN）', () => {
    const { script, dropped } = sanitizeBoardScript({
      title: '边际成本',
      pages: [
        {
          segments: [
            {
              narration: '好，我们来看边际成本。',
              actions: [
                { type: 'write', text: '边际成本', role: 'term' },
                { type: 'write', text: '多生产一件的成本', role: 'note' },
                { type: 'circle', target: 'w1' },
                { type: 'underline', target: ['w1', 'w2'] },
                { type: 'arrow', from: 'w1', to: 'w2', label: '就是' },
                { type: 'mark', mark: 'check', target: 'w2' },
                { type: 'pause', ms: 800 },
              ],
            },
          ],
        },
      ],
      quotes: [{ text: '多生产一件要花多少钱', startMs: 1200 }],
    });
    expect(dropped).toBe(0);
    expect(script.title).toBe('边际成本');
    const actions = script.pages[0].segments[0].actions;
    expect(actions).toHaveLength(7);
    expect(actions[0]).toEqual({ type: 'write', text: '边际成本', role: 'term' });
    expect(actions[2]).toEqual({ type: 'circle', target: 'w1' });
    expect(actions[3]).toEqual({ type: 'underline', target: ['w1', 'w2'] });
    expect(actions[4]).toEqual({ type: 'arrow', from: 'w1', to: 'w2', label: '就是' });
    expect(actions[5]).toEqual({ type: 'mark', mark: 'check', target: 'w2' });
  });

  it('丢弃未知 type / 空 text / 非法 target 的动作并计数', () => {
    const { script, dropped } = sanitizeBoardScript({
      title: 't',
      pages: [
        {
          segments: [
            {
              narration: '讲点什么',
              actions: [
                { type: 'laser', target: 'w1' },
                { type: 'write', text: '  ', role: 'term' },
                { type: 'write', text: '概念', role: 'giant' },
                { type: 'write', text: '概念' },
                { type: 'circle', target: 'B3' },
                { type: 'circle', around: 'w1' },
                { type: 'arrow', from: 'w1', to: 'wx' },
                { type: 'mark', mark: 'star', target: 'w1' },
                { type: 'pause', ms: -5 },
                { type: 'write', text: '好动作', role: 'step' },
              ],
            },
          ],
        },
      ],
    });
    expect(dropped).toBe(9);
    expect(script.pages[0].segments[0].actions).toEqual([
      { type: 'write', text: '好动作', role: 'step' },
    ]);
  });

  it('target 引用本页不存在的 wN → 丢弃该标注并计数', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: '第一段',
              actions: [
                { type: 'write', text: '唯一的 write', role: 'term' },
                { type: 'circle', target: 'w1' },
                { type: 'circle', target: 'w2' },
                { type: 'underline', target: ['w1', 'w9'] },
                { type: 'arrow', from: 'w1', to: 'w3' },
                { type: 'mark', mark: 'check', target: 'w0' },
              ],
            },
          ],
        },
      ],
    });
    const actions = script.pages[0].segments[0].actions;
    expect(actions).toEqual([
      { type: 'write', text: '唯一的 write', role: 'term' },
      { type: 'circle', target: 'w1' },
    ]);
    expect(dropped).toBe(4);
  });

  it('wN 序号跨 segment 累计（本页第 N 个 write）', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            { narration: '一', actions: [{ type: 'write', text: '甲', role: 'term' }] },
            {
              narration: '二',
              actions: [
                { type: 'write', text: '乙', role: 'term' },
                { type: 'circle', target: 'w2' },
              ],
            },
          ],
        },
      ],
    });
    expect(dropped).toBe(0);
    expect(script.pages[0].segments[1].actions[1]).toEqual({ type: 'circle', target: 'w2' });
  });

  it('target 数组：去重、剔除非法项、全非法则丢弃', () => {
    const { script } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: 'x',
              actions: [
                { type: 'write', text: '甲', role: 'term' },
                { type: 'write', text: '乙', role: 'term' },
                { type: 'circle', target: ['w1', 'w1', 'w2', 'bad'] },
                { type: 'underline', target: [] },
              ],
            },
          ],
        },
      ],
    });
    const actions = script.pages[0].segments[0].actions;
    expect(actions[2]).toEqual({ type: 'circle', target: ['w1', 'w2'] });
    expect(actions).toHaveLength(3);
  });

  it('丢弃没有 narration 的段和空页', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        { segments: [{ actions: [{ type: 'pause', ms: 100 }] }] },
        { segments: [] },
        {
          segments: [{ narration: '唯一一段', actions: [] }],
        },
      ],
    });
    expect(script.pages).toHaveLength(1);
    expect(script.pages[0].segments[0].narration).toBe('唯一一段');
    expect(dropped).toBeGreaterThanOrEqual(2);
  });

  it('页数 / 段数超限截断', () => {
    const segment = { narration: '一段话', actions: [] };
    const page = { segments: Array(MAX_SEGMENTS_PER_PAGE + 2).fill(segment) };
    const { script, dropped } = sanitizeBoardScript({
      pages: Array(MAX_PAGES + 2).fill(page),
    });
    expect(script.pages).toHaveLength(MAX_PAGES);
    for (const p of script.pages) expect(p.segments).toHaveLength(MAX_SEGMENTS_PER_PAGE);
    expect(dropped).toBeGreaterThan(0);
  });

  it('完全非法输入也能给出保底结构，不抛异常', () => {
    for (const raw of [null, undefined, 42, 'x', [], { pages: 'nope' }]) {
      const { script } = sanitizeBoardScript(raw);
      expect(script.pages.length).toBeGreaterThanOrEqual(1);
      expect(script.pages[0].segments.length).toBeGreaterThanOrEqual(1);
      expect(typeof script.title).toBe('string');
    }
  });

  it('pause 超上限钳制而非丢弃；arrow 空 label 省略字段', () => {
    const { script } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: '停一下',
              actions: [
                { type: 'write', text: '甲', role: 'term' },
                { type: 'write', text: '乙', role: 'term' },
                { type: 'pause', ms: 99999 },
                { type: 'arrow', from: 'w1', to: 'w2', label: '  ' },
              ],
            },
          ],
        },
      ],
    });
    const [pause, arrow] = script.pages[0].segments[0].actions.slice(2);
    expect(pause).toEqual({ type: 'pause', ms: 5000 });
    expect(arrow).toEqual({ type: 'arrow', from: 'w1', to: 'w2' });
  });

  it('quotes 清洗：空文本丢弃、startMs 容忍数字字符串', () => {
    const { script } = sanitizeBoardScript({
      pages: [{ segments: [{ narration: 'x', actions: [] }] }],
      quotes: [
        { text: '原话', startMs: '1500' },
        { text: '  ' },
        { nope: true },
        { text: '第二句', startMs: -3 },
      ],
    });
    expect(script.quotes).toEqual([
      { text: '原话', startMs: 1500 },
      { text: '第二句', startMs: 0 },
    ]);
  });
});

describe('v16 导演注入：数据态 cue 与 breathMs 经 sanitize 保留', () => {
  it('数据态 cue 优先于 narration 内联 cue；越界/重复丢弃；breathMs clamp', () => {
    const { script } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: '我们来看公式[a0]，注意这里。',
              cues: [
                { actionIndex: 0, charIndex: 7 },
                { actionIndex: 1, charIndex: 11 },
                { actionIndex: 0, charIndex: 2 }, // 重复丢弃
                { actionIndex: 5, charIndex: 1 }, // actionIndex 越界丢弃
              ],
              breathMs: 9999,
              actions: [
                { type: 'write', text: '公式', role: 'term' },
                { type: 'circle', target: 'w1' },
              ],
            },
          ],
        },
      ],
      quotes: [],
    });
    const segment = script.pages[0].segments[0];
    if (segment.type !== 'narration') throw new Error('expect narration segment');
    // 数据态 cue 生效（不是 narration [a0] 提取的结果）
    expect(segment.cues).toEqual([
      { actionIndex: 0, charIndex: 7 },
      { actionIndex: 1, charIndex: 11 },
    ]);
    expect(segment.breathMs).toBe(2500);
  });

  it('无数据态 cue 时回退 narration 内联 cue；breathMs 非数字丢弃', () => {
    const { script } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: '看这里[a1]。',
              breathMs: 'abc',
              actions: [
                { type: 'write', text: '甲', role: 'term' },
                { type: 'circle', target: 'w1' },
              ],
            },
          ],
        },
      ],
      quotes: [],
    });
    const segment = script.pages[0].segments[0];
    if (segment.type !== 'narration') throw new Error('expect narration segment');
    expect(segment.cues).toEqual([{ actionIndex: 1, charIndex: 3 }]);
    expect(segment.breathMs).toBeUndefined();
  });
});
