import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@/types';
import { buildQuizCards, GENERATION_FAILED, resolveQuestionShape } from './quiz.plugin';

const segments: TranscriptSegment[] = [
  { id: 's1', text: '机会成本是为了得到某个选择而放弃的最佳替代方案。', startMs: 0, endMs: 8_000, isFinal: true },
  { id: 's2', text: '边际成本描述额外生产一个单位所增加的成本。', startMs: 9_000, endMs: 18_000, isFinal: true },
];

const grounded = {
  stem: '机会成本指的是什么？', type: 'short', options: [], answer: '为了一个选择而放弃的最佳替代方案。', explanation: '关键是"最佳替代方案"：放弃的不是所有选项，是其中最好的那个。', startMs: 12_000,
};

const quizOf = (cards: ReturnType<typeof buildQuizCards>) => cards.filter((card) => card.meta?.cardKind === 'quiz');

describe('buildQuizCards：模型的题就是题，没有兜底题', () => {
  it('证据落地不通过时保留模型原题，只按模型时间戳给跳转、evidence 标 weak；绝不换成"回放 X:XX 复述"', () => {
    const cards = buildQuizCards(segments, {
      questions: [grounded, {
        stem: '量子纠缠为什么能够实现超光速通信？', type: 'single', options: ['因为波函数坍缩', '因为量子隧穿'], answer: 'A', explanation: '量子纠缠允许信息瞬间传递（本题只测落地逻辑）。', startMs: 12_000,
      }],
    });
    const quiz = quizOf(cards);
    expect(quiz).toHaveLength(2);
    expect(quiz[1].body).toContain('量子纠缠');
    expect(quiz[1].meta?.type).toBe('single');
    // 答案在插件侧就收口成选项原文（"A" → 选项文本），窗口不用再猜
    expect(quiz[1].meta?.answer).toBe('因为波函数坍缩');
    expect(quiz[1].meta?.evidence).toBe('timestamp');
    expect(quiz[1].citations?.[0]?.startMs).toBe(9_000);
    expect(cards.some((card) => /回放 \d+:\d+/.test(card.body))).toBe(false);
  });

  it('落地不到也没有时间戳：不给引用与跳转（跳错比没有更伤信任），题仍保留', () => {
    const cards = buildQuizCards(segments, {
      questions: [grounded, { stem: '量子纠缠为什么能够实现超光速通信？', type: 'short', options: [], answer: '不能。', explanation: '纠缠不传递信息，测量结果的相关性不能被用来编码消息。' }],
    });
    const weak = quizOf(cards)[1];
    expect(weak.body).toContain('量子纠缠');
    expect(weak.citations).toBeUndefined();
    expect(weak.actions).toBeUndefined();
    expect(weak.meta?.evidence).toBe('none');
  });

  it('落地成功的题按内容匹配到原话，而不是按数组顺序', () => {
    const cards = buildQuizCards(segments, {
      questions: [grounded, { stem: '边际成本描述的是什么？', type: 'short', options: [], answer: '额外生产一个单位增加的成本。', explanation: '边际 = 再多一个单位；不是平均成本。', startMs: 0 }],
    });
    const quiz = quizOf(cards);
    expect(quiz[0].citations?.[0]?.startMs).toBe(0);
    expect(quiz[0].citations?.[0]?.snippet).toContain('机会成本');
    expect(quiz[0].meta?.evidence).toBe('text');
    expect(quiz[1].citations?.[0]?.startMs).toBe(9_000);
  });

  it('可用题不足两道（模型失败 / 空题 / 缺答案 / 缺解析）→ 抛 GENERATION_FAILED，不凑数', () => {
    expect(() => buildQuizCards(segments, null)).toThrow(GENERATION_FAILED);
    expect(() => buildQuizCards(segments, { questions: [] })).toThrow(GENERATION_FAILED);
    expect(() => buildQuizCards(segments, { questions: [grounded, { stem: '没有答案的题', explanation: '有解析没答案也不算题。' }] })).toThrow(GENERATION_FAILED);
    // 2026-09-11 起解析是题的一部分：没有解析的题对答错的人没有用
    expect(() => buildQuizCards(segments, { questions: [grounded, { stem: '边际成本描述的是什么？', type: 'short', options: [], answer: '额外一个单位的成本。' }] })).toThrow(GENERATION_FAILED);
  });

  it('同一题干复读两遍只算一道；concept 进 meta 供轨迹 / eval 用', () => {
    const cards = buildQuizCards(segments, {
      questions: [
        { ...grounded, concept: '机会成本' },
        { ...grounded, stem: '机会成本指的是什么' },
        { stem: '边际成本描述的是什么？', type: 'short', options: [], answer: '额外一个单位的成本。', explanation: '边际 = 再多一个单位。', concept: '边际成本' },
      ],
    });
    const quiz = quizOf(cards);
    expect(quiz).toHaveLength(2);
    expect(quiz.map((card) => card.meta?.concept)).toEqual(['机会成本', '边际成本']);
  });

  it('多选题：答案收口成 "A、C"；只解析出一个正确项就是单选；一个都对不上降级简答', () => {
    const options = ['放弃的最佳替代方案', '已经花掉收不回的钱', '所有被放弃的选项之和', '再生产一个单位的成本'];
    const cards = buildQuizCards(segments, {
      questions: [
        { stem: '关于机会成本，哪些说法对？', type: 'multiple', options, answer: 'A, D', explanation: 'A 是定义；D 是边际成本，在课里老师拿它和机会成本对照。B 是沉没成本；C 错在"之和"——只算最好的那个。' },
        { stem: '关于机会成本，哪些说法对？（二）', type: 'multiple', options, answer: '放弃的最佳替代方案', explanation: '只有 A 对。' },
        { stem: '关于机会成本，哪些说法对？（三）', type: 'multiple', options, answer: '以上都不对', explanation: '答案对不上任何选项。' },
      ],
    });
    const quiz = quizOf(cards);
    expect(quiz[0].meta?.type).toBe('multiple');
    expect(quiz[0].meta?.answer).toBe('A、D');
    expect(quiz[1].meta?.type).toBe('single');
    expect(quiz[1].meta?.answer).toBe('放弃的最佳替代方案');
    expect(quiz[2].meta?.type).toBe('short');
    expect(quiz[2].meta?.options).toEqual([]);
  });
});

describe('resolveQuestionShape', () => {
  it('判断题：模型自带 对 / 错 选项时用它的；答案对不上就退回 正确 / 错误 并按肯定 / 否定归位', () => {
    expect(resolveQuestionShape('judge', ['对', '错'], '对')).toEqual({ type: 'judge', options: ['对', '错'], answer: '对' });
    expect(resolveQuestionShape('judge', [], '正确')).toEqual({ type: 'judge', options: ['正确', '错误'], answer: '正确' });
    expect(resolveQuestionShape('judge', [], 'False')).toEqual({ type: 'judge', options: ['正确', '错误'], answer: '错误' });
  });
  it('单选：答案必须落到某个选项上，落不到就降级为简答（不猜、不造）', () => {
    expect(resolveQuestionShape('single', ['甲', '乙'], 'B').answer).toBe('乙');
    expect(resolveQuestionShape('single', ['甲', '乙'], '丙')).toEqual({ type: 'short', options: [], answer: '丙' });
    expect(resolveQuestionShape(undefined, ['甲'], '甲')).toEqual({ type: 'short', options: [], answer: '甲' });
  });
});
