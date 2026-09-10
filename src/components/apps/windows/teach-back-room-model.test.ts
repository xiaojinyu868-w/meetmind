import { describe, expect, it } from 'vitest';
import type { TeachBackEvaluation, TeachBackEvaluationItem } from '@/lib/ai-native/types';
import {
  buildReviewBlocks,
  foldRecord,
  formatClock,
  heldCounts,
  lingerOpacity,
  listenerStatusOf,
  locateTurnForPoint,
  nextHeldToReveal,
  PERFORM_MAX_MS,
  PERFORM_QUIET_CONFIRM_MS,
  PERFORM_VOICE_GRACE_MS,
  performanceFinished,
  readingTimeMs,
  reteachTargetIds,
  shouldShowEntry,
  sortRecord,
  SPEECH_FADE_MS,
  SPEECH_LINGER_MS,
  speechPhaseOf,
  toggleFlipped,
  typedChars,
  visibleFeedback,
  type FeedbackEntry,
  type TranscriptTurn,
} from './teach-back-room-model';

function entry(partial: Partial<FeedbackEntry> & { id: string; at: number }): FeedbackEntry {
  return {
    judgeId: 'direct',
    turnIndex: 0,
    text: '这一段讲得太快了，链式法则的条件没有说。',
    state: 'done',
    held: false,
    revealed: false,
    ...partial,
  };
}

function item(partial: Partial<TeachBackEvaluationItem> & { targetId: string; point: string }): TeachBackEvaluationItem {
  return {
    coverage: 'explained',
    confidence: 'confident',
    quadrant: 'mastery',
    note: '',
    evidence: null,
    ...partial,
  };
}

describe('反馈流', () => {
  it('最新的在最上；记下的（held）没揭示前不出现', () => {
    const entries = [
      entry({ id: 'a', at: 1000 }),
      entry({ id: 'b', at: 5000 }),
      entry({ id: 'c', at: 3000, held: true }),
      entry({ id: 'd', at: 4000, held: true, revealed: true }),
    ];
    expect(visibleFeedback(entries).map((e) => e.id)).toEqual(['b', 'd', 'a']);
  });

  it('揭示顺序按时间从早到晚，还在流的先不揭', () => {
    const entries = [
      entry({ id: 'late', at: 9000, held: true }),
      entry({ id: 'early', at: 2000, held: true }),
      entry({ id: 'streaming', at: 1000, held: true, state: 'streaming' }),
      entry({ id: 'shown', at: 500, held: true, revealed: true }),
    ];
    expect(nextHeldToReveal(entries)?.id).toBe('early');
    expect(nextHeldToReveal(entries.filter((e) => e.id !== 'early' && e.id !== 'late'))).toBeNull();
  });

  it('记了几笔按听众分开数，被打断的、已揭示的不算', () => {
    const counts = heldCounts([
      entry({ id: 'a', at: 1, held: true }),
      entry({ id: 'b', at: 2, held: true, judgeId: 'probe' }),
      entry({ id: 'c', at: 3, held: true, judgeId: 'probe', state: 'interrupted' }),
      entry({ id: 'd', at: 4, held: true, revealed: true }),
      entry({ id: 'e', at: 5 }),
    ]);
    expect(counts).toEqual({ direct: 1, guide: 0, probe: 1 });
  });

  it('被打断：说满 8 个字才留一行灰字；正在流的哪怕没字也占位', () => {
    expect(shouldShowEntry(entry({ id: 'a', at: 1, state: 'interrupted', text: '你刚才' }))).toBe(false);
    expect(shouldShowEntry(entry({ id: 'b', at: 1, state: 'interrupted', text: '你刚才说的链式法则条件' }))).toBe(true);
    expect(shouldShowEntry(entry({ id: 'c', at: 1, state: 'streaming', text: '' }))).toBe(true);
    expect(shouldShowEntry(entry({ id: 'd', at: 1, state: 'done', text: '' }))).toBe(false);
  });
});

describe('听众状态词', () => {
  const base = { activeJudge: null, requestInFlight: false, liveFeedback: true, heldCount: 0, finished: false };

  it('在说 > 讲完了之外的一切；讲完了 → 说几句', () => {
    expect(listenerStatusOf('direct', { ...base, activeJudge: 'direct' })).toBe('speaking');
    expect(listenerStatusOf('guide', { ...base, activeJudge: 'direct' })).toBe('listening');
    expect(listenerStatusOf('direct', { ...base, activeJudge: 'direct', finished: true })).toBe('closing');
  });

  it('实时反馈开着：请求在飞 = 想问；关着：记了几笔', () => {
    expect(listenerStatusOf('probe', { ...base, requestInFlight: true })).toBe('thinking');
    expect(listenerStatusOf('probe', { ...base, requestInFlight: true, liveFeedback: false })).toBe('listening');
    expect(listenerStatusOf('probe', { ...base, liveFeedback: false, heldCount: 2 })).toBe('noted');
  });
});

describe('回到那段转写', () => {
  const turns: TranscriptTurn[] = [
    { turnIndex: 0, text: '导数的定义是极限，函数在一点的变化率，割线斜率的极限就是切线斜率。', startedAt: 0, endedAt: 8000 },
    { turnIndex: 1, text: '链式法则，复合函数的导数要把外层和内层的导数乘起来。', startedAt: 9000, endedAt: 15000 },
  ];

  it('按二元组重合找最像的回合', () => {
    expect(locateTurnForPoint('链式法则：复合函数求导为什么要相乘', turns)).toBe(1);
    expect(locateTurnForPoint('导数的定义与切线斜率', turns)).toBe(0);
  });

  it('没讲到的点找不到回合', () => {
    expect(locateTurnForPoint('泰勒展开的余项', turns)).toBeNull();
    expect(locateTurnForPoint('', turns)).toBeNull();
  });
});

describe('复盘：三位听众各说各的', () => {
  const evaluation: TeachBackEvaluation = {
    headline: '五个点讲到三个。',
    items: [
      item({ targetId: 't1', point: '导数的定义与切线斜率', quadrant: 'mastery', note: '定义与几何意义都对。' }),
      item({ targetId: 't2', point: '链式法则：复合函数求导为什么要相乘', quadrant: 'aware-gap', confidence: 'uncertain', note: '说了相乘但没说为什么。' }),
      item({ targetId: 't3', point: '隐函数求导', quadrant: 'blind-spot', note: '把 y 当常数处理了。' }),
      item({ targetId: 't4', point: '泰勒展开的余项', quadrant: null, coverage: 'missed', note: '没讲到。' }),
      item({ targetId: 't5', point: '洛必达法则的适用条件', quadrant: 'productive-struggle', note: '绕了一圈说清了。' }),
    ],
  };
  const turns: TranscriptTurn[] = [
    { turnIndex: 0, text: '导数的定义是极限，割线斜率的极限就是切线斜率。', startedAt: 0, endedAt: 8000 },
    { turnIndex: 1, text: '链式法则，复合函数的导数要把外层和内层的导数乘起来。', startedAt: 9000, endedAt: 15000 },
  ];

  it('直言：盲区在前、自知缺口在后，每条带回到原话的回合', () => {
    const [direct] = buildReviewBlocks(evaluation, turns);
    expect(direct.judgeId).toBe('direct');
    expect(direct.kind).toBe('unclear');
    expect(direct.lines.map((line) => line.item.targetId)).toEqual(['t3', 't2']);
    expect(direct.lines[1].turnIndex).toBe(1);
    expect(direct.lines[0].turnIndex).toBeNull(); // 隐函数求导：原话里没有相近的段
  });

  it('引导：讲透了优先当最稳的一点；下一步先说第一处没讲清的', () => {
    const [, guide] = buildReviewBlocks(evaluation, turns);
    expect(guide.kind).toBe('steady');
    expect(guide.lines[0].item.targetId).toBe('t1');
    expect(guide.next?.item.targetId).toBe('t3');
  });

  it('引导：没有讲透的就取挣扎着讲通的；都没有就不夸；没讲清的也没有时下一步指向没讲到的', () => {
    const struggleOnly: TeachBackEvaluation = { headline: '', items: [evaluation.items[4], evaluation.items[3]] };
    const [, guide] = buildReviewBlocks(struggleOnly, turns);
    expect(guide.lines[0].item.targetId).toBe('t5');
    expect(guide.next?.item.targetId).toBe('t4');
    const nothing: TeachBackEvaluation = { headline: '', items: [evaluation.items[3]] };
    expect(buildReviewBlocks(nothing, turns)[1].lines).toEqual([]);
  });

  it('追问：没讲到的一条一行，不带回合', () => {
    const [, , probe] = buildReviewBlocks(evaluation, turns);
    expect(probe.kind).toBe('uncovered');
    expect(probe.lines.map((line) => line.item.targetId)).toEqual(['t4']);
    expect(probe.lines[0].turnIndex).toBeNull();
  });

  it('只讲没讲清的 = 盲区 + 自知缺口 + 没讲到，去重', () => {
    expect(reteachTargetIds(evaluation)).toEqual(['t3', 't2', 't4']);
  });
});

describe('时钟', () => {
  it('mm:ss', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(61_500)).toBe('01:01');
    expect(formatClock(3_725_000)).toBe('62:05');
  });
});

describe('手卡翻转', () => {
  it('点一张翻过去，再点翻回来；不改原集合', () => {
    const none = new Set<string>();
    const one = toggleFlipped(none, 't1');
    expect([...one]).toEqual(['t1']);
    expect(none.size).toBe(0);
    const two = toggleFlipped(one, 't2');
    expect([...two].sort()).toEqual(['t1', 't2']);
    expect([...toggleFlipped(two, 't1')]).toEqual(['t2']);
  });
});

describe('评委脚下的话：说完留一会再淡进记录', () => {
  it('没说完 = speaking；说完未到期 = lingering；到期 = gone', () => {
    expect(speechPhaseOf(null, 99_999)).toBe('speaking');
    expect(speechPhaseOf(10_000, 10_000 + SPEECH_LINGER_MS - 1)).toBe('lingering');
    expect(speechPhaseOf(10_000, 10_000 + SPEECH_LINGER_MS)).toBe('gone');
  });

  it('不透明度：前面一直是 1，最后一段线性淡到 0', () => {
    const closedAt = 5_000;
    expect(lingerOpacity(closedAt, closedAt)).toBe(1);
    expect(lingerOpacity(closedAt, closedAt + SPEECH_LINGER_MS - SPEECH_FADE_MS)).toBe(1);
    expect(lingerOpacity(closedAt, closedAt + SPEECH_LINGER_MS - SPEECH_FADE_MS / 2)).toBe(0.5);
    expect(lingerOpacity(closedAt, closedAt + SPEECH_LINGER_MS)).toBe(0);
    expect(lingerOpacity(closedAt, closedAt + SPEECH_LINGER_MS + 500)).toBe(0);
  });
});

describe('讲完后的表演：一条什么时候算说完', () => {
  const text = '你只说了"能找到"，但没解释清楚逻辑矛盾。如果不是单射，一个 y 对应了两个 x，反过来做映射会违反哪条规则？';

  it('逐字流出与读完的时间', () => {
    expect(typedChars(text, 0)).toBe(0);
    expect(typedChars(text, 28 * 10)).toBe(10);
    expect(typedChars(text, 10 * 60_000)).toBe(text.length);
    expect(readingTimeMs('短')).toBe(2_500);
    expect(readingTimeMs(text)).toBe(1_500 + text.length * 110);
    expect(readingTimeMs('字'.repeat(500))).toBe(14_000);
  });

  it('出声关着：字打完 + 读完的时间到就算说完', () => {
    const base = { text, voiceEnabled: false, voiceHeard: false, quietForMs: null };
    expect(performanceFinished({ ...base, elapsedMs: 1_000 })).toBe(false);
    expect(performanceFinished({ ...base, elapsedMs: readingTimeMs(text) - 1 })).toBe(false);
    expect(performanceFinished({ ...base, elapsedMs: readingTimeMs(text) })).toBe(true);
  });

  it('出声开着：声音响过就等它安静满确认时长；没响过再宽限一段', () => {
    const read = readingTimeMs(text);
    const voiced = { text, voiceEnabled: true, voiceHeard: true };
    expect(performanceFinished({ ...voiced, elapsedMs: read + 10_000, quietForMs: null })).toBe(false);
    expect(performanceFinished({ ...voiced, elapsedMs: read + 10_000, quietForMs: PERFORM_QUIET_CONFIRM_MS - 100 })).toBe(false);
    expect(performanceFinished({ ...voiced, elapsedMs: read + 10_000, quietForMs: PERFORM_QUIET_CONFIRM_MS })).toBe(true);
    const silent = { text, voiceEnabled: true, voiceHeard: false, quietForMs: null };
    expect(performanceFinished({ ...silent, elapsedMs: read + PERFORM_VOICE_GRACE_MS - 1 })).toBe(false);
    expect(performanceFinished({ ...silent, elapsedMs: read + PERFORM_VOICE_GRACE_MS })).toBe(true);
  });

  it('无论如何不超过上限', () => {
    expect(performanceFinished({ text, elapsedMs: PERFORM_MAX_MS, voiceEnabled: true, voiceHeard: true, quietForMs: null })).toBe(true);
  });
});

describe('对话记录', () => {
  const entries = [
    { id: 'a', at: 1_000 },
    { id: 'b', at: 5_000 },
    { id: 'c', at: 5_000 },
    { id: 'd', at: 3_000 },
    { id: 'e', at: 9_000 },
  ];

  it('最新的在最上；同一时刻后加进来的算更新', () => {
    expect(sortRecord(entries).map((entry) => entry.id)).toEqual(['e', 'c', 'b', 'd', 'a']);
  });

  it('默认只露最近三条，展开后全部；不够三条不折', () => {
    const sorted = sortRecord(entries);
    expect(foldRecord(sorted, false)).toEqual({ shown: sorted.slice(0, 3), hidden: 2 });
    expect(foldRecord(sorted, true)).toEqual({ shown: sorted, hidden: 0 });
    expect(foldRecord(sorted.slice(0, 2), false)).toEqual({ shown: sorted.slice(0, 2), hidden: 0 });
  });
});
