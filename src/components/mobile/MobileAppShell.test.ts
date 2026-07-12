import { describe, expect, it } from 'vitest';
import { sortCollectionNewestFirst } from './mobile-collection-utils';
import type { SourceIngestItem } from '@/types/page-types';

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
