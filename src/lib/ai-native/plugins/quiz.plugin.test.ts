import { describe, expect, it } from 'vitest';
import type { AppPluginTools } from '../types';
import type { TranscriptSegment } from '@/types';
import { buildQuizCards } from './quiz.plugin';

const tools: AppPluginTools = {
  searchTranscript: () => [],
  summarizeSegments: (segments) => segments.map((segment) => segment.text).join(' ').slice(0, 120),
  now: () => '2026-01-01T00:00:00.000Z',
};

const segments: TranscriptSegment[] = [
  { id: 's1', text: '机会成本是为了得到某个选择而放弃的最佳替代方案。', startMs: 0, endMs: 8_000, isFinal: true },
  { id: 's2', text: '边际成本描述额外生产一个单位所增加的成本。', startMs: 9_000, endMs: 18_000, isFinal: true },
];

describe('buildQuizCards evidence grounding', () => {
  it('replaces an unsupported model question instead of attaching a fake citation', () => {
    const cards = buildQuizCards(tools, segments, {
      questions: [{
        stem: '量子纠缠为什么能够实现超光速通信？',
        type: 'single',
        options: ['因为波函数坍缩', '因为量子隧穿'],
        answer: 'A',
        explanation: '量子纠缠允许信息瞬间传递。',
        startMs: 12_000,
      }],
    });

    const quiz = cards.find((card) => card.meta?.cardKind === 'quiz');
    expect(quiz?.meta?.type).toBe('short');
    expect(quiz?.body).toContain('回放 0:09');
    expect(quiz?.citations?.[0]?.snippet).toContain('边际成本');
    expect(quiz?.body).not.toContain('量子纠缠');
  });

  it('anchors a supported question to matching content rather than array order', () => {
    const cards = buildQuizCards(tools, segments, {
      questions: [{
        stem: '机会成本指的是什么？',
        type: 'short',
        options: [],
        answer: '为了一个选择而放弃的最佳替代方案。',
        explanation: '关键是最佳替代方案。',
        startMs: 12_000,
      }],
    });

    const quiz = cards.find((card) => card.meta?.cardKind === 'quiz');
    expect(quiz?.body).toContain('机会成本');
    expect(quiz?.citations?.[0]?.startMs).toBe(0);
    expect(quiz?.citations?.[0]?.snippet).toContain('机会成本');
  });
});
