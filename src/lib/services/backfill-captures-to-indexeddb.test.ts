import { describe, it, expect } from 'vitest';
import { extractBackfillCandidate, pickBackfillable } from './backfill-captures-to-indexeddb';
import type { WorkspaceCaptureMessage } from '@/types/page-types';

function cap(partial: Partial<WorkspaceCaptureMessage>): WorkspaceCaptureMessage {
  return {
    id: 'c1',
    sourceKey: 'live:1',
    sourceType: 'live-audio',
    role: 'primary',
    contentType: 'audio',
    title: '会议录音',
    previewText: '',
    createdAt: '2026-06-03T19:06:00.000Z',
    status: 'active',
    ...partial,
  };
}

const segs = [
  { id: 's1', text: '第一句', startMs: 0, endMs: 2000 },
  { id: 's2', text: '第二句', startMs: 2000, endMs: 4000 },
];

describe('extractBackfillCandidate', () => {
  it('音频 capture + sessionId + transcriptSegments → 可回填', () => {
    const c = cap({ metadata: { sessionId: 'sess-1', transcriptSegments: segs, duration: 4000 } });
    const r = extractBackfillCandidate(c);
    expect(r).not.toBeNull();
    expect(r!.sessionId).toBe('sess-1');
    expect(r!.segments).toHaveLength(2);
    expect(r!.durationMs).toBe(4000);
  });

  it('没有 sessionId → null', () => {
    const c = cap({ metadata: { transcriptSegments: segs } });
    expect(extractBackfillCandidate(c)).toBeNull();
  });

  it('没有 transcriptSegments → null', () => {
    const c = cap({ metadata: { sessionId: 'sess-1' } });
    expect(extractBackfillCandidate(c)).toBeNull();
  });

  it('archived/deleted → null（不回填非活跃）', () => {
    const c = cap({ status: 'archived', metadata: { sessionId: 'sess-1', transcriptSegments: segs } });
    expect(extractBackfillCandidate(c)).toBeNull();
  });

  it('过滤空文本段', () => {
    const c = cap({
      metadata: {
        sessionId: 'sess-1',
        transcriptSegments: [{ text: '  ', startMs: 0, endMs: 1 }, { text: '有效', startMs: 1, endMs: 2 }],
      },
    });
    const r = extractBackfillCandidate(c);
    expect(r!.segments).toHaveLength(1);
    expect(r!.segments[0].text).toBe('有效');
  });

  it('durationSec 回退换算成 ms', () => {
    const c = cap({ metadata: { sessionId: 'sess-1', transcriptSegments: segs, durationSec: 90 } });
    expect(extractBackfillCandidate(c)!.durationMs).toBe(90000);
  });

  it('无 duration 时用末段 endMs 兜底', () => {
    const c = cap({ metadata: { sessionId: 'sess-1', transcriptSegments: segs } });
    expect(extractBackfillCandidate(c)!.durationMs).toBe(4000);
  });
});

describe('pickBackfillable', () => {
  it('从混合 capture 中挑出可回填项', () => {
    const list = [
      cap({ id: 'a', metadata: { sessionId: 's-a', transcriptSegments: segs } }),
      cap({ id: 'b', contentType: 'text', metadata: { foo: 'bar' } }),
      cap({ id: 'c', metadata: { sessionId: 's-c', transcriptSegments: segs } }),
    ];
    const r = pickBackfillable(list);
    expect(r.map((x) => x.sessionId)).toEqual(['s-a', 's-c']);
  });
});
