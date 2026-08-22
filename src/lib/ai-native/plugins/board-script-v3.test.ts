import { describe, expect, it } from 'vitest';
import { extractCues, sanitizeBoardScript } from './board-script';
import type { CheckpointSegment, NarrationSegment } from './board-script';

const checkpointRaw = {
  type: 'checkpoint',
  narration: '好，这道题考考你。',
  question: { text: 'full name 怎么写？', role: 'term' },
  hints: ['想想她怎么报名字', '先名后姓', 'Jane 后面接 Bond'],
  answer: '答案是 Jane Bond，先名后姓。',
  demoActions: [{ type: 'write', text: 'Jane Bond', role: 'term' }],
};

describe('extractCues', () => {
  it('提取 cue 的 charIndex（剥 cue 后坐标系）并剥掉标记', () => {
    const { display, cues, dropped } = extractCues('我们来看这个公式[a1]——它是主角[a0]吧', 2);
    expect(display).toBe('我们来看这个公式——它是主角吧');
    expect(cues).toEqual([
      { charIndex: 8, actionIndex: 1 },
      { charIndex: 14, actionIndex: 0 },
    ]);
    expect(dropped).toBe(0);
  });

  it('标记后紧跟的一个空格一并剥掉', () => {
    const { display } = extractCues('看这个 [a0] 公式', 1);
    expect(display).toBe('看这个 公式');
  });

  it('越界 cue 与重复 cue 丢弃计数，不影响动作', () => {
    const { display, cues, dropped } = extractCues('甲[a0]乙[a9]丙[a0]丁', 1);
    expect(display).toBe('甲乙丙丁');
    expect(cues).toEqual([{ charIndex: 1, actionIndex: 0 }]);
    expect(dropped).toBe(2);
  });

  it('无 cue 时 cues 为空、display 等于原文', () => {
    const { display, cues, dropped } = extractCues('没有标记的一段话', 3);
    expect(display).toBe('没有标记的一段话');
    expect(cues).toEqual([]);
    expect(dropped).toBe(0);
  });

  it('兼容裸数字标记 [N]（模型偷懒写法，2026-08-19 qwen3.7-plus 实测）', () => {
    const { display, cues, dropped } = extractCues('今天我们讲 relocate[0] 这个词', 2);
    // 标记后紧跟的一个空格按规则一并剥掉
    expect(display).toBe('今天我们讲 relocate这个词');
    expect(cues).toEqual([{ charIndex: 14, actionIndex: 0 }]);
    expect(dropped).toBe(0);
  });
});

describe('sanitize v3：narration 段 cue', () => {
  it('sanitize 产出 narrationDisplay + cues，字幕用剥 cue 文本', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: '说到这个概念[a0]，注意[a1]这里。',
              actions: [
                { type: 'write', text: '概念', role: 'term' },
                { type: 'circle', target: 'w1' },
              ],
            },
          ],
        },
      ],
    });
    expect(dropped).toBe(0);
    const segment = script.pages[0].segments[0] as NarrationSegment;
    expect(segment.type).toBe('narration');
    expect(segment.narrationDisplay).toBe('说到这个概念，注意这里。');
    expect(segment.cues).toEqual([
      { charIndex: 6, actionIndex: 0 },
      { charIndex: 9, actionIndex: 1 },
    ]);
  });

  it('无 type 字段的旧数据按 narration 兼容', () => {
    const { script } = sanitizeBoardScript({
      pages: [{ segments: [{ narration: '旧格式', actions: [{ type: 'write', text: '甲', role: 'term' }] }] }],
    });
    const segment = script.pages[0].segments[0] as NarrationSegment;
    expect(segment.type).toBe('narration');
    expect(segment.narrationDisplay).toBe('旧格式');
    expect(segment.cues).toEqual([]);
    expect(segment.actions).toHaveLength(1);
  });
});

describe('sanitize v3：checkpoint 段', () => {
  it('合法 checkpoint 保留全部字段', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [{ segments: [checkpointRaw] }],
    });
    expect(dropped).toBe(0);
    const segment = script.pages[0].segments[0] as CheckpointSegment;
    expect(segment.type).toBe('checkpoint');
    expect(segment.question).toEqual({ text: 'full name 怎么写？', role: 'term' });
    expect(segment.hints).toHaveLength(3);
    expect(segment.answer).toContain('Jane Bond');
    expect(segment.demoActions).toHaveLength(1);
    expect(segment.narrationDisplay).toBe('好，这道题考考你。');
  });

  it('answer 的 cue 提取到 answerCues（指向 demoActions），answerDisplay 剥标记；hints/question 的标记一并剥除', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              ...checkpointRaw,
              question: { text: '填空[a0]：full name？', role: 'term' },
              hints: ['想想[a0]方向', '一半思路', '差一步'],
              answer: '对，写下来看[a0]：Jane Bond——注意[a1]空格。',
              demoActions: [
                { type: 'write', text: 'Jane Bond', role: 'step' },
                { type: 'underline', target: 'w1' },
              ],
            },
          ],
        },
      ],
    });
    // hints[0] + question 的标记无动作可指（2）+ demoActions 的 underline 引用 w1
    // 但本页没有页级 write（页级二次清洗丢弃，1）
    expect(dropped).toBe(3);
    const segment = script.pages[0].segments[0] as CheckpointSegment;
    expect(segment.answerDisplay).toBe('对，写下来看：Jane Bond——注意空格。');
    expect(segment.answerCues).toEqual([
      { charIndex: 6, actionIndex: 0 },
      { charIndex: 20, actionIndex: 1 },
    ]);
    expect(segment.hints[0]).toBe('想想方向');
    expect(segment.question.text).toBe('填空：full name？');
  });

  it('hints 不是恰好 3 级 → 整段丢弃', () => {
    for (const hints of [['只有一级'], ['一', '二'], ['一', '二', '三', '四'], ['一', '', '三']]) {
      const { script, dropped } = sanitizeBoardScript({
        pages: [{ segments: [{ ...checkpointRaw, hints }] }],
      });
      expect(dropped).toBeGreaterThanOrEqual(1);
      // 段被丢 → 页空 → 页被丢 → 保底页
      expect(script.pages[0].segments[0].type).toBe('narration');
    }
  });

  it('question / answer 缺字段或非法 role → 整段丢弃', () => {
    for (const patch of [
      { question: { text: '', role: 'term' } },
      { question: { text: '题', role: 'note' } },
      { answer: '' },
      { question: undefined },
    ]) {
      const raw = { ...checkpointRaw, ...patch };
      const { script, dropped } = sanitizeBoardScript({ pages: [{ segments: [raw] }] });
      expect(dropped).toBeGreaterThanOrEqual(1);
      expect(script.pages[0].segments[0].type).toBe('narration');
    }
  });

  it('demoActions 只允许引用页级 write（越界丢弃）', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            { narration: '讲', actions: [{ type: 'write', text: '甲', role: 'term' }] },
            {
              ...checkpointRaw,
              demoActions: [
                { type: 'write', text: 'Jane Bond', role: 'term' },
                { type: 'underline', target: 'w1' },
                { type: 'circle', target: 'w2' },
              ],
            },
          ],
        },
      ],
    });
    const segment = script.pages[0].segments[1] as CheckpointSegment;
    // w1 是页级 write 合法；w2 越界（demo write 不可作 target）
    expect(segment.demoActions).toHaveLength(2);
    expect(dropped).toBe(1);
  });
});

describe('sanitize v3：ref 动作', () => {
  const twoPages = {
    pages: [
      {
        segments: [
          { narration: '一', actions: [{ type: 'write', text: '甲', role: 'term' }] },
        ],
      },
      {
        segments: [
          {
            narration: '二',
            actions: [
              { type: 'write', text: '乙', role: 'term' },
              { type: 'ref', page: 1, target: 'w1' },
            ],
          },
        ],
      },
    ],
  };

  it('合法 ref 保留', () => {
    const { script, dropped } = sanitizeBoardScript(twoPages);
    expect(dropped).toBe(0);
    const segment = script.pages[1].segments[0] as NarrationSegment;
    expect(segment.actions[1]).toEqual({ type: 'ref', page: 1, target: 'w1' });
  });

  it('page 越界 / target 不存在 / 引用当前页 → 丢弃计数', () => {
    const { dropped } = sanitizeBoardScript({
      pages: [
        ...twoPages.pages,
        {
          segments: [
            {
              narration: '三',
              actions: [
                { type: 'write', text: '丙', role: 'term' },
                { type: 'ref', page: 9, target: 'w1' },
                { type: 'ref', page: 1, target: 'w9' },
                { type: 'ref', page: 3, target: 'w1' },
              ],
            },
          ],
        },
      ],
    });
    expect(dropped).toBe(3);
  });

  it('形状非法的 ref（缺 page / 坏 target）直接丢弃', () => {
    const { script, dropped } = sanitizeBoardScript({
      pages: [
        {
          segments: [
            {
              narration: 'x',
              actions: [
                { type: 'write', text: '甲', role: 'term' },
                { type: 'ref', target: 'w1' },
                { type: 'ref', page: 1, target: 'B3' },
                { type: 'ref', page: 0, target: 'w1' },
              ],
            },
          ],
        },
      ],
    });
    expect(dropped).toBe(3);
    const segment = script.pages[0].segments[0] as NarrationSegment;
    expect(segment.actions).toHaveLength(1);
  });
});
