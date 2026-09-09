import { describe, expect, it } from 'vitest';
import type { AppPluginTools } from '../types';
import type { TranscriptSegment } from '@/types';
import { buildQuizCards, GENERATION_FAILED } from './quiz.plugin';

const tools: AppPluginTools = {
  searchTranscript: () => [],
  summarizeSegments: (segments) => segments.map((segment) => segment.text).join(' ').slice(0, 120),
  now: () => '2026-01-01T00:00:00.000Z',
};

const segments: TranscriptSegment[] = [
  { id: 's1', text: '机会成本是为了得到某个选择而放弃的最佳替代方案。', startMs: 0, endMs: 8_000, isFinal: true },
  { id: 's2', text: '边际成本描述额外生产一个单位所增加的成本。', startMs: 9_000, endMs: 18_000, isFinal: true },
];

const grounded = {
  stem: '机会成本指的是什么？', type: 'short', options: [], answer: '为了一个选择而放弃的最佳替代方案。', explanation: '关键是最佳替代方案。', startMs: 12_000,
};

describe('buildQuizCards：模型的题就是题，没有兜底题', () => {
  it('证据落地不通过时保留模型原题，只按模型时间戳给跳转、evidence 标 weak；绝不换成"回放 X:XX 复述"', () => {
    const cards = buildQuizCards(tools, segments, {
      questions: [grounded, {
        stem: '量子纠缠为什么能够实现超光速通信？', type: 'single', options: ['因为波函数坍缩', '因为量子隧穿'], answer: 'A', explanation: '量子纠缠允许信息瞬间传递。', startMs: 12_000,
      }],
    });
    const quiz = cards.filter((card) => card.meta?.cardKind === 'quiz');
    expect(quiz).toHaveLength(2);
    expect(quiz[1].body).toContain('量子纠缠');
    expect(quiz[1].meta?.type).toBe('single');
    expect(quiz[1].meta?.evidence).toBe('timestamp');
    expect(quiz[1].citations?.[0]?.startMs).toBe(9_000);
    expect(cards.some((card) => /回放 \d+:\d+/.test(card.body))).toBe(false);
  });

  it('落地不到也没有时间戳：不给引用与跳转（跳错比没有更伤信任），题仍保留', () => {
    const cards = buildQuizCards(tools, segments, {
      questions: [grounded, { stem: '量子纠缠为什么能够实现超光速通信？', type: 'short', options: [], answer: '不能。' }],
    });
    const weak = cards.filter((card) => card.meta?.cardKind === 'quiz')[1];
    expect(weak.body).toContain('量子纠缠');
    expect(weak.citations).toBeUndefined();
    expect(weak.actions).toBeUndefined();
    expect(weak.meta?.evidence).toBe('none');
  });

  it('落地成功的题按内容匹配到原话，而不是按数组顺序', () => {
    const cards = buildQuizCards(tools, segments, {
      questions: [grounded, { stem: '边际成本描述的是什么？', type: 'short', options: [], answer: '额外生产一个单位增加的成本。', startMs: 0 }],
    });
    const quiz = cards.filter((card) => card.meta?.cardKind === 'quiz');
    expect(quiz[0].citations?.[0]?.startMs).toBe(0);
    expect(quiz[0].citations?.[0]?.snippet).toContain('机会成本');
    expect(quiz[0].meta?.evidence).toBe('text');
    expect(quiz[1].citations?.[0]?.startMs).toBe(9_000);
  });

  it('可用题不足两道（模型失败 / 空题 / 缺答案）→ 抛 GENERATION_FAILED，不凑数', () => {
    expect(() => buildQuizCards(tools, segments, null)).toThrow(GENERATION_FAILED);
    expect(() => buildQuizCards(tools, segments, { questions: [] })).toThrow(GENERATION_FAILED);
    expect(() => buildQuizCards(tools, segments, { questions: [grounded, { stem: '没有答案的题' }] })).toThrow(GENERATION_FAILED);
  });
});
