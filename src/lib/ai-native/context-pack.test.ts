import { describe, expect, it } from 'vitest';
import type { TranscriptSegment, Anchor } from '@/types';
import {
  ANNOTATION_SOFT_LIMIT,
  buildExecutionContextFromPack,
  buildPackFromExecutionContext,
  buildPackFromSingleSession,
  findOwningSegmentIndex,
  formatAnnotation,
  isAppSupportedAtTier,
  pickAnnotationsForPrompt,
  renderTranscriptWithAnnotations,
  validatePack,
} from './context-pack';
import type {
  AppExecutionContext,
  ContextPack,
  PersonalAnnotation,
} from './types';

// ─────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────

function seg(id: string, startMs: number, endMs: number, text: string): TranscriptSegment {
  return { id, text, startMs, endMs, confidence: 0.95 };
}

const SEGS: TranscriptSegment[] = [
  seg('s1', 0, 5_000, '老师：今天我们讲边际成本。'),
  seg('s2', 5_000, 12_000, '边际成本就是再多生产一个单位的成本。'),
  seg('s3', 12_000, 20_000, '所以 MC = ΔTC / ΔQ。'),
  seg('s4', 20_000, 30_000, '价格弹性是另一个重要概念。'),
];

const SESSION_A = 'sess-A';
const SESSION_B = 'sess-B';

function packForSession(annotations?: PersonalAnnotation[]): ContextPack {
  return {
    tier: 'class',
    lessons: [
      {
        sessionId: SESSION_A,
        transcript: SEGS,
        anchors: [] as Anchor[],
      },
    ],
    personalAnnotations: annotations,
  };
}

function ann(
  targetMs: number,
  kind: PersonalAnnotation['kind'],
  text?: string,
  sessionId: string = SESSION_A
): PersonalAnnotation {
  return { sessionId, targetMs, kind, text };
}

// ─────────────────────────────────────────────────────────────────────────
// findOwningSegmentIndex
// ─────────────────────────────────────────────────────────────────────────

describe('findOwningSegmentIndex', () => {
  it('returns index of segment containing the timestamp', () => {
    expect(findOwningSegmentIndex(2_000, SEGS)).toBe(0);
    expect(findOwningSegmentIndex(8_000, SEGS)).toBe(1);
    expect(findOwningSegmentIndex(15_000, SEGS)).toBe(2);
    expect(findOwningSegmentIndex(25_000, SEGS)).toBe(3);
  });

  it('returns -1 when timestamp is before all segments', () => {
    expect(findOwningSegmentIndex(-100, SEGS)).toBe(-1);
  });

  it('returns last index when timestamp is past all segments', () => {
    expect(findOwningSegmentIndex(99_999, SEGS)).toBe(SEGS.length - 1);
  });

  it('handles empty segment list', () => {
    expect(findOwningSegmentIndex(1000, [])).toBe(-1);
  });

  it('chooses segment whose startMs matches exactly', () => {
    expect(findOwningSegmentIndex(5_000, SEGS)).toBe(1);
    expect(findOwningSegmentIndex(0, SEGS)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// formatAnnotation
// ─────────────────────────────────────────────────────────────────────────

describe('formatAnnotation', () => {
  it('formats confusion without text', () => {
    expect(formatAnnotation(ann(8_000, 'confusion'))).toBe('[t=00:08 ⟪困惑⟫]');
  });

  it('formats confusion with text (rare but supported)', () => {
    expect(formatAnnotation(ann(8_000, 'confusion', '没听懂'))).toBe('[t=00:08 ⟪困惑：没听懂⟫]');
  });

  it('formats note with text', () => {
    expect(formatAnnotation(ann(15_000, 'note', '和上节课的定义不同？'))).toBe(
      '[t=00:15 ⟪用户备注：和上节课的定义不同？⟫]'
    );
  });

  it('formats note without text → 标记 fallback', () => {
    expect(formatAnnotation(ann(15_000, 'note'))).toBe('[t=00:15 ⟪标记⟫]');
  });

  it('formats star without text', () => {
    expect(formatAnnotation(ann(120_000, 'star'))).toBe('[t=02:00 ⟪重点⟫]');
  });

  it('formats star with text', () => {
    expect(formatAnnotation(ann(120_000, 'star', '期末必考'))).toBe('[t=02:00 ⟪重点：期末必考⟫]');
  });

  it('zero-pads single-digit minutes and seconds', () => {
    expect(formatAnnotation(ann(0, 'confusion'))).toContain('[t=00:00');
    expect(formatAnnotation(ann(60_500, 'confusion'))).toContain('[t=01:00');
    expect(formatAnnotation(ann(605_000, 'confusion'))).toContain('[t=10:05');
  });

  it('trims whitespace in text', () => {
    expect(formatAnnotation(ann(0, 'note', '  问题  '))).toBe('[t=00:00 ⟪用户备注：问题⟫]');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// pickAnnotationsForPrompt
// ─────────────────────────────────────────────────────────────────────────

describe('pickAnnotationsForPrompt', () => {
  it('returns all annotations when count <= soft limit, sorted by time', () => {
    const anns: PersonalAnnotation[] = [
      ann(20_000, 'confusion'),
      ann(5_000, 'note', 'X'),
      ann(10_000, 'star'),
    ];
    const result = pickAnnotationsForPrompt(anns, SESSION_A);
    expect(result.map((a) => a.targetMs)).toEqual([5_000, 10_000, 20_000]);
  });

  it('filters by sessionId', () => {
    const anns: PersonalAnnotation[] = [
      ann(5_000, 'confusion', undefined, SESSION_A),
      ann(10_000, 'confusion', undefined, SESSION_B),
    ];
    const result = pickAnnotationsForPrompt(anns, SESSION_A);
    expect(result).toHaveLength(1);
    expect(result[0].targetMs).toBe(5_000);
  });

  it('truncates to soft limit using kind priority (note > star > confusion)', () => {
    const anns: PersonalAnnotation[] = [];
    // 25 confusions, 3 notes, 2 stars → 30 total
    for (let i = 0; i < 25; i++) anns.push(ann(i * 1000, 'confusion'));
    for (let i = 0; i < 3; i++) anns.push(ann(100_000 + i * 1000, 'note', 'q' + i));
    for (let i = 0; i < 2; i++) anns.push(ann(200_000 + i * 1000, 'star'));

    const result = pickAnnotationsForPrompt(anns, SESSION_A, 20);
    expect(result).toHaveLength(20);
    // All 3 notes should survive
    expect(result.filter((a) => a.kind === 'note')).toHaveLength(3);
    // All 2 stars should survive
    expect(result.filter((a) => a.kind === 'star')).toHaveLength(2);
    // 15 confusions (out of 25) should survive
    expect(result.filter((a) => a.kind === 'confusion')).toHaveLength(15);
  });

  it('preserves time order in final output even after priority truncation', () => {
    const anns: PersonalAnnotation[] = [];
    for (let i = 0; i < 30; i++) {
      anns.push(ann(i * 1000, i % 5 === 0 ? 'note' : 'confusion', i % 5 === 0 ? 'x' : undefined));
    }
    const result = pickAnnotationsForPrompt(anns, SESSION_A, 20);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].targetMs).toBeGreaterThanOrEqual(result[i - 1].targetMs);
    }
  });

  it('returns empty array when no annotations match session', () => {
    const anns: PersonalAnnotation[] = [ann(5_000, 'confusion', undefined, SESSION_B)];
    expect(pickAnnotationsForPrompt(anns, SESSION_A)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// renderTranscriptWithAnnotations
// ─────────────────────────────────────────────────────────────────────────

describe('renderTranscriptWithAnnotations', () => {
  it('returns empty string when pack has no lessons', () => {
    const pack: ContextPack = { tier: 'class', lessons: [] };
    expect(renderTranscriptWithAnnotations(pack)).toBe('');
  });

  it('renders pure transcript when personalAnnotations is undefined (分发剥离)', () => {
    const pack = packForSession(undefined);
    const out = renderTranscriptWithAnnotations(pack);
    expect(out).toContain('[t=00:00] 老师：今天我们讲边际成本。');
    expect(out).toContain('[t=00:05] 边际成本就是再多生产一个单位的成本。');
    expect(out).not.toContain('⟪');
  });

  it('renders pure transcript when personalAnnotations is empty array', () => {
    const pack = packForSession([]);
    const out = renderTranscriptWithAnnotations(pack);
    expect(out).not.toContain('⟪');
  });

  it('produces identical output with and without empty annotations (分发等价)', () => {
    const stripped = renderTranscriptWithAnnotations(packForSession(undefined));
    const empty = renderTranscriptWithAnnotations(packForSession([]));
    expect(stripped).toBe(empty);
  });

  it('injects confusion annotation right after its owning segment', () => {
    const pack = packForSession([ann(8_000, 'confusion')]);
    const out = renderTranscriptWithAnnotations(pack);
    const lines = out.split('\n');
    const segIdx = lines.findIndex((l) => l.includes('再多生产一个单位'));
    expect(lines[segIdx + 1]).toBe('[t=00:08 ⟪困惑⟫]');
  });

  it('injects note with user text', () => {
    const pack = packForSession([ann(15_000, 'note', '和上节课的定义不同？')]);
    const out = renderTranscriptWithAnnotations(pack);
    expect(out).toContain('[t=00:15 ⟪用户备注：和上节课的定义不同？⟫]');
  });

  it('injects multiple annotations on the same segment in order', () => {
    const pack = packForSession([
      ann(7_000, 'confusion'),
      ann(8_500, 'star'),
      ann(11_000, 'note', '问'),
    ]);
    const out = renderTranscriptWithAnnotations(pack);
    const idxConfusion = out.indexOf('⟪困惑⟫');
    const idxStar = out.indexOf('⟪重点⟫');
    const idxNote = out.indexOf('⟪用户备注：问⟫');
    expect(idxConfusion).toBeGreaterThan(0);
    expect(idxStar).toBeGreaterThan(idxConfusion);
    expect(idxNote).toBeGreaterThan(idxStar);
  });

  it('emits annotations before first segment when targetMs is negative', () => {
    const pack = packForSession([ann(-1, 'star', '总要点')]);
    const out = renderTranscriptWithAnnotations(pack);
    const lines = out.split('\n');
    expect(lines[0]).toContain('⟪重点：总要点⟫');
  });

  it('attaches annotation past last segment to last segment', () => {
    const pack = packForSession([ann(99_999, 'confusion')]);
    const out = renderTranscriptWithAnnotations(pack);
    const lines = out.split('\n');
    expect(lines[lines.length - 1]).toBe('[t=01:39 ⟪困惑⟫]');
  });

  it('ignores annotations from other sessions (隔离)', () => {
    const pack = packForSession([
      ann(8_000, 'confusion', undefined, SESSION_B),
      ann(8_000, 'confusion', undefined, SESSION_A),
    ]);
    const out = renderTranscriptWithAnnotations(pack);
    // 只有一个 confusion 标记被渲染
    expect(out.match(/⟪困惑⟫/g)).toHaveLength(1);
  });

  it('respects soft limit when annotations > ANNOTATION_SOFT_LIMIT', () => {
    const anns: PersonalAnnotation[] = [];
    for (let i = 0; i < 30; i++) anns.push(ann(i * 800, 'confusion'));
    const pack = packForSession(anns);
    const out = renderTranscriptWithAnnotations(pack);
    expect(out.match(/⟪困惑⟫/g)).toHaveLength(ANNOTATION_SOFT_LIMIT);
  });

  it('preserves all transcript lines regardless of annotations', () => {
    const pack = packForSession([ann(8_000, 'confusion')]);
    const out = renderTranscriptWithAnnotations(pack);
    expect(out).toContain('老师：今天我们讲边际成本。');
    expect(out).toContain('再多生产一个单位');
    expect(out).toContain('MC = ΔTC / ΔQ');
    expect(out).toContain('价格弹性是另一个重要概念');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Adapters：buildPackFromExecutionContext / buildExecutionContextFromPack
// ─────────────────────────────────────────────────────────────────────────

describe('adapters round-trip', () => {
  function makeCtx(): AppExecutionContext {
    return {
      input: {
        sessionId: SESSION_A,
        dataSource: 'live',
        transcript: SEGS,
        anchors: [],
        metadata: { subject: '微观经济学' },
      },
      memory: {
        summary: '本课讲边际成本与价格弹性',
        keyDifficulties: ['MC 公式'],
        terminologyHint: 'MC=marginal cost',
      },
      goal: { intent: 'test' },
    };
  }

  it('buildPackFromExecutionContext keeps lesson data', () => {
    const ctx = makeCtx();
    const pack = buildPackFromExecutionContext(ctx);
    expect(pack.tier).toBe('class');
    expect(pack.lessons).toHaveLength(1);
    expect(pack.lessons[0].sessionId).toBe(SESSION_A);
    expect(pack.lessons[0].transcript).toBe(SEGS);
    expect(pack.lessons[0].summary).toBe('本课讲边际成本与价格弹性');
    expect(pack.lessons[0].terminologyHint).toBe('MC=marginal cost');
  });

  it('buildPackFromExecutionContext respects optional personalAnnotations', () => {
    const ctx = makeCtx();
    const annotations = [ann(5_000, 'confusion')];
    const pack = buildPackFromExecutionContext(ctx, { personalAnnotations: annotations });
    expect(pack.personalAnnotations).toBe(annotations);
  });

  it('buildExecutionContextFromPack restores fields', () => {
    const ctx = makeCtx();
    const pack = buildPackFromExecutionContext(ctx);
    const restored = buildExecutionContextFromPack(pack, { intent: 'restored' }, 'mymodel');
    expect(restored.input.sessionId).toBe(SESSION_A);
    expect(restored.input.transcript).toBe(SEGS);
    expect(restored.memory.summary).toBe('本课讲边际成本与价格弹性');
    expect(restored.memory.terminologyHint).toBe('MC=marginal cost');
    expect(restored.goal.intent).toBe('restored');
    expect(restored.model).toBe('mymodel');
  });

  it('buildExecutionContextFromPack throws on multi-lesson pack', () => {
    const pack: ContextPack = {
      tier: 'unit',
      lessons: [
        { sessionId: 'a', transcript: [], anchors: [] },
        { sessionId: 'b', transcript: [], anchors: [] },
      ],
    };
    expect(() => buildExecutionContextFromPack(pack, { intent: 't' })).toThrow(/multi-lesson/);
  });

  it('buildExecutionContextFromPack throws on empty pack', () => {
    const pack: ContextPack = { tier: 'class', lessons: [] };
    expect(() => buildExecutionContextFromPack(pack, { intent: 't' })).toThrow(/empty pack/);
  });

  it('buildPackFromSingleSession builds class-tier pack', () => {
    const pack = buildPackFromSingleSession({
      sessionId: SESSION_A,
      transcript: SEGS,
      anchors: [],
      summary: 'sum',
      title: '微观第七讲',
      personalAnnotations: [ann(5_000, 'confusion')],
    });
    expect(pack.tier).toBe('class');
    expect(pack.lessons[0].title).toBe('微观第七讲');
    expect(pack.personalAnnotations).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// validatePack
// ─────────────────────────────────────────────────────────────────────────

describe('validatePack', () => {
  it('rejects empty lessons', () => {
    expect(validatePack({ tier: 'class', lessons: [] }).ok).toBe(false);
  });

  it('class tier requires exactly 1 lesson', () => {
    const ok = validatePack({
      tier: 'class',
      lessons: [{ sessionId: 'a', transcript: [], anchors: [] }],
    });
    expect(ok.ok).toBe(true);

    const bad = validatePack({
      tier: 'class',
      lessons: [
        { sessionId: 'a', transcript: [], anchors: [] },
        { sessionId: 'b', transcript: [], anchors: [] },
      ],
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/class tier requires/);
  });

  it('exam tier requires pack.exam', () => {
    const bad = validatePack({
      tier: 'exam',
      lessons: [{ sessionId: 'a', transcript: [], anchors: [] }],
    });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/exam/);

    const ok = validatePack({
      tier: 'exam',
      lessons: [{ sessionId: 'a', transcript: [], anchors: [] }],
      exam: { name: 'final' },
    });
    expect(ok.ok).toBe(true);
  });

  it('unit tier accepts multiple lessons', () => {
    const ok = validatePack({
      tier: 'unit',
      lessons: [
        { sessionId: 'a', transcript: [], anchors: [] },
        { sessionId: 'b', transcript: [], anchors: [] },
      ],
    });
    expect(ok.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// isAppSupportedAtTier
// ─────────────────────────────────────────────────────────────────────────

describe('isAppSupportedAtTier', () => {
  it('matches tier in supportedTiers', () => {
    expect(isAppSupportedAtTier(['class', 'unit'], 'class')).toBe(true);
    expect(isAppSupportedAtTier(['class', 'unit'], 'unit')).toBe(true);
    expect(isAppSupportedAtTier(['class', 'unit'], 'exam')).toBe(false);
  });

  it('treats undefined as supporting all tiers (legacy compat)', () => {
    expect(isAppSupportedAtTier(undefined, 'class')).toBe(true);
    expect(isAppSupportedAtTier(undefined, 'exam')).toBe(true);
  });

  it('treats empty array as supporting all tiers (legacy compat)', () => {
    expect(isAppSupportedAtTier([], 'class')).toBe(true);
  });
});
