import { describe, expect, it } from 'vitest';
import type { TeachBackTarget } from '@/lib/ai-native/types';
import {
  deriveTeachBackQuadrant,
  normalizeTeachBackEvaluation,
} from './teach-back-eval-service';

const transcript = [
  { text: '沉没成本已经发生，不应该继续影响当前的决策。', startMs: 0, endMs: 10_000 },
  { text: '机会成本是做出选择时放弃的最佳替代方案。', startMs: 10_000, endMs: 20_000 },
] as never;

const targets: TeachBackTarget[] = [
  {
    id: 'target-1',
    point: '讲清楚沉没成本为什么不该影响决策',
    evidence: { startMs: 0, endMs: 10_000, snippet: '沉没成本已经发生' },
  },
  { id: 'target-2', point: '讲清楚机会成本的定义', evidence: null },
];

describe('deriveTeachBackQuadrant', () => {
  it('自信且讲对 = mastery', () => {
    expect(deriveTeachBackQuadrant('explained', 'confident')).toBe('mastery');
  });
  it('不确定但讲对 = productive-struggle', () => {
    expect(deriveTeachBackQuadrant('explained', 'uncertain')).toBe('productive-struggle');
  });
  it('不确定且讲错 = aware-gap', () => {
    expect(deriveTeachBackQuadrant('partial', 'uncertain')).toBe('aware-gap');
  });
  it('自信但讲错 = blind-spot', () => {
    expect(deriveTeachBackQuadrant('partial', 'confident')).toBe('blind-spot');
  });
  it('没讲到 = null', () => {
    expect(deriveTeachBackQuadrant('missed', 'confident')).toBeNull();
    expect(deriveTeachBackQuadrant('missed', 'uncertain')).toBeNull();
  });
});

describe('normalizeTeachBackEvaluation', () => {
  it('按映射推导 quadrant，不信任 LLM 自报', () => {
    const result = normalizeTeachBackEvaluation(
      {
        headline: '整体讲得不错。',
        items: [
          { targetId: 'target-1', coverage: 'explained', confidence: 'confident', note: '讲对了。' },
        ],
      },
      targets,
      transcript,
    );
    expect(result.headline).toBe('整体讲得不错。');
    expect(result.items).toHaveLength(2);
    expect(result.items[0].quadrant).toBe('mastery');
    expect(result.items[0].evidence?.startMs).toBe(0);
    // LLM 漏判的目标按 missed 兜底
    expect(result.items[1].coverage).toBe('missed');
    expect(result.items[1].quadrant).toBeNull();
  });

  it('非法枚举向保守方向收口', () => {
    const result = normalizeTeachBackEvaluation(
      { items: [{ targetId: 'target-1', coverage: 'nailed-it', confidence: 'very-sure', note: 'x' }] },
      targets,
      transcript,
    );
    expect(result.items[0].coverage).toBe('missed');
    expect(result.items[0].confidence).toBe('uncertain');
    expect(result.items[0].quadrant).toBeNull();
  });

  it('anchorText 锚回真实片段；锚不住回退目标自带证据', () => {
    const anchored = normalizeTeachBackEvaluation(
      {
        items: [{
          targetId: 'target-2',
          coverage: 'partial',
          confidence: 'confident',
          note: '把机会成本说成了已经花掉的钱。',
          anchorText: '机会成本是做出选择时放弃的最佳替代方案。',
        }],
      },
      targets,
      transcript,
    );
    expect(anchored.items[1].quadrant).toBe('blind-spot');
    expect(anchored.items[1].evidence?.startMs).toBe(10_000);

    const fallback = normalizeTeachBackEvaluation(
      { items: [{ targetId: 'target-1', coverage: 'explained', confidence: 'uncertain', note: '讲对了。', anchorText: '完全无关的一段话，不在原文里。' }] },
      targets,
      transcript,
    );
    expect(fallback.items[0].quadrant).toBe('productive-struggle');
    expect(fallback.items[0].evidence?.startMs).toBe(0);
  });

  it('raw 为空时全部 missed', () => {
    const result = normalizeTeachBackEvaluation(null, targets, transcript);
    expect(result.items.every((item) => item.coverage === 'missed')).toBe(true);
    expect(result.headline).toBe('');
  });
});
