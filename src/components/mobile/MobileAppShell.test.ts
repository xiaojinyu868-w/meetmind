import { describe, expect, it } from 'vitest';
import {
  buildClassroomTimeline,
  resolveMobileWorkshopRecommendation,
  resolveClassroomPhotoTimestamp,
  sortMobileWorkshopApps,
  sortCollectionNewestFirst,
} from './mobile-collection-utils';
import type { SourceIngestItem } from '@/types/page-types';
import type { TranscriptSegment } from '@/types';
import {
  popMobileStackTo,
  resolveRetainedReviewContext,
  type ScreenState,
} from './mobile-navigation-model';

function note(id: string, addedAt: string): SourceIngestItem {
  return {
    id,
    sourceKey: `manual:${id}`,
    type: 'text',
    role: 'support',
    title: id,
    segmentCount: 1,
    addedAt,
  };
}

describe('sortCollectionNewestFirst', () => {
  it('puts the newest mobile collection item first without mutating shared order', () => {
    const sharedOrder = [
      note('oldest', '2026-07-10T08:00:00.000Z'),
      note('middle', '2026-07-11T08:00:00.000Z'),
      note('newest', '2026-07-12T08:00:00.000Z'),
    ];

    expect(sortCollectionNewestFirst(sharedOrder).map((item) => item.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ]);
    expect(sharedOrder.map((item) => item.id)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('keeps the latest inserted note first when timestamps are identical', () => {
    const sameTime = '2026-07-12T08:00:00.000Z';
    const sharedOrder = [note('first', sameTime), note('second', sameTime)];

    expect(sortCollectionNewestFirst(sharedOrder).map((item) => item.id)).toEqual([
      'second',
      'first',
    ]);
  });
});

describe('classroom photo timeline', () => {
  const transcript = (id: string, startMs: number): TranscriptSegment => ({
    id,
    text: id,
    startMs,
    endMs: startMs + 2_000,
    isFinal: true,
  });
  const photo = (id: string, capturedAtMs: number): SourceIngestItem => ({
    id,
    type: 'image',
    role: 'support',
    title: '板书',
    segmentCount: 0,
    addedAt: '2026-07-17T01:00:00.000Z',
    capturedAtMs,
  });

  it('places a board photo between transcript segments using the shared lesson clock', () => {
    const timeline = buildClassroomTimeline([
      transcript('01:46', 106_000),
      transcript('01:52', 112_000),
      transcript('02:06', 126_000),
    ], [photo('board-02:02', 122_000)]);

    expect(timeline.map((item) => item.key)).toEqual([
      '01:46',
      '01:52',
      'board-02:02',
      '02:06',
    ]);
  });

  it('uses the actual file capture time instead of the earlier camera-button time', () => {
    expect(resolveClassroomPhotoTimestamp({
      requestedAtMs: 110_000,
      recordingStartedAtEpochMs: 1_000_000,
      fileLastModifiedEpochMs: 1_122_000,
      capturedAtEpochMs: 1_123_000,
    })).toBe(122_000);
  });

  it('falls back to the current lesson clock for an old gallery file timestamp', () => {
    expect(resolveClassroomPhotoTimestamp({
      requestedAtMs: 110_000,
      recordingStartedAtEpochMs: 1_000_000,
      fileLastModifiedEpochMs: 500_000,
      capturedAtEpochMs: 1_123_000,
    })).toBe(123_000);
  });
});

describe('mobile workshop recommendation', () => {
  it('respects an explicit no-recommendation judgment instead of inventing one on device', () => {
    expect(resolveMobileWorkshopRecommendation({ recommendedAppKey: null }, 'mindmap')).toBeNull();
  });

  it('uses the local fallback only while the remote judgment is absent', () => {
    expect(resolveMobileWorkshopRecommendation(null, 'mindmap')).toBe('mindmap');
  });

  it('keeps the recommended action first and the expensive audio overview last', () => {
    const apps = [
      { key: 'audio-overview' as const },
      { key: 'flashcards' as const },
      { key: 'quiz' as const },
      { key: 'mindmap' as const },
    ];

    expect(sortMobileWorkshopApps(apps, 'quiz').map((app) => app.key)).toEqual([
      'quiz',
      'flashcards',
      'mindmap',
      'audio-overview',
    ]);
  });
});

describe('mobile evidence return navigation', () => {
  const reviewContext = {
    sessionId: 'lesson-1',
    contentType: 'audio' as const,
    title: '线性代数',
  };
  const stack: ScreenState[] = [
    { screen: 'home' },
    { screen: 'review', reviewContext },
    { screen: 'apps' },
    { screen: 'flashcards' },
  ];

  it('retains classroom context while navigating through nested app screens', () => {
    expect(resolveRetainedReviewContext(stack)).toEqual(reviewContext);
  });

  it('returns directly to review and carries the evidence timestamp', () => {
    expect(popMobileStackTo(stack, 'review', { focusTimestampMs: 50_000 })).toEqual([
      { screen: 'home' },
      { screen: 'review', reviewContext: { ...reviewContext, focusTimestampMs: 50_000 } },
    ]);
  });
});
