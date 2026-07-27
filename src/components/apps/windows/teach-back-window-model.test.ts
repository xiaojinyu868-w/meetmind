import { describe, expect, it } from 'vitest';
import type { AppExecutionResult, TeachBackEvaluation } from '@/lib/ai-native/types';
import {
  buildTeachBackResultView,
  formatEvidenceTimestamp,
  normalizeTeachBackTargets,
} from './teach-back-window-model';

function makeResult(payload: unknown): AppExecutionResult {
  return {
    pluginId: 'teach-back-lab',
    version: '0.1.0',
    cards: [],
    tasks: [],
    trace: [],
    render: { mode: 'custom', payload },
  } as AppExecutionResult;
}

describe('normalizeTeachBackTargets', () => {
  it('正规化目标与证据', () => {
    const targets = normalizeTeachBackTargets(makeResult({
      targets: [
        { id: 'target-1', point: '讲清楚三次握手', why: '核心机制', evidence: { startMs: 1000, endMs: 5000, snippet: '三次握手……' } },
        { point: '没有 id 的目标', evidence: null },
      ],
    }));
    expect(targets).toHaveLength(2);
    expect(targets[0].evidence?.startMs).toBe(1000);
    expect(targets[1].id).toBe('target-2');
    expect(targets[1].evidence).toBeNull();
  });

  it('缺 point / 证据字段非法时安全兜底', () => {
    const targets = normalizeTeachBackTargets(makeResult({
      targets: [
        { why: '没有 point' },
        { point: '证据时间戳非法', evidence: { startMs: 'x' } },
        'not-an-object',
      ],
    }));
    expect(targets).toHaveLength(1);
    expect(targets[0].point).toBe('证据时间戳非法');
    expect(targets[0].evidence).toBeNull();
  });

  it('result 为空或 payload 缺 targets 时返回空', () => {
    expect(normalizeTeachBackTargets(null)).toEqual([]);
    expect(normalizeTeachBackTargets(makeResult({}))).toEqual([]);
  });
});

describe('buildTeachBackResultView', () => {
  const evaluation: TeachBackEvaluation = {
    headline: '讲透两点，有一个盲区。',
    items: [
      { targetId: 't1', point: 'A', coverage: 'explained', confidence: 'confident', quadrant: 'mastery', note: '', evidence: null },
      { targetId: 't2', point: 'B', coverage: 'partial', confidence: 'confident', quadrant: 'blind-spot', note: '', evidence: null },
      { targetId: 't3', point: 'C', coverage: 'missed', confidence: 'uncertain', quadrant: null, note: '', evidence: null },
      { targetId: 't4', point: 'D', coverage: 'partial', confidence: 'uncertain', quadrant: 'aware-gap', note: '', evidence: null },
    ],
  };

  it('分组并计数，盲区排在最前', () => {
    const view = buildTeachBackResultView(evaluation);
    expect(view.total).toBe(4);
    expect(view.counts['blind-spot']).toBe(1);
    expect(view.counts.uncovered).toBe(1);
    expect(view.groups.map((group) => group.key)).toEqual(['blind-spot', 'aware-gap', 'mastery', 'uncovered']);
  });

  it('空组不出现', () => {
    const view = buildTeachBackResultView({ headline: '', items: [evaluation.items[0]] });
    expect(view.groups).toHaveLength(1);
    expect(view.groups[0].key).toBe('mastery');
  });
});

describe('formatEvidenceTimestamp', () => {
  it('毫秒转 mm:ss', () => {
    expect(formatEvidenceTimestamp(198_000)).toBe('03:18');
    expect(formatEvidenceTimestamp(0)).toBe('00:00');
  });
});
