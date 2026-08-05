import { describe, expect, it } from 'vitest';
import type { LearningThreadEntry } from '@/types/user';
import { buildLearningTaskRows, selectLearningTaskEvidence } from './learning-task-section-model';

function createTask(
  id: string,
  status: LearningThreadEntry['status'],
  updatedAt: string,
): LearningThreadEntry {
  return {
    id,
    title: `任务 ${id}`,
    intent: `学会 ${id}`,
    depth: 'deep',
    status,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('buildLearningTaskRows', () => {
  it('orders active, paused and completed tasks while keeping recency inside each group', () => {
    const rows = buildLearningTaskRows([
      createTask('completed', 'completed', '2026-08-05T09:00:00.000Z'),
      createTask('paused-old', 'paused', '2026-08-03T09:00:00.000Z'),
      createTask('paused-new', 'paused', '2026-08-04T09:00:00.000Z'),
    ], createTask('active', 'active', '2026-08-02T09:00:00.000Z'));

    expect(rows.map((row) => row.thread.id)).toEqual([
      'active',
      'paused-new',
      'paused-old',
      'completed',
    ]);
  });

  it('deduplicates the active pointer and counts distinct evidence', () => {
    const active = {
      ...createTask('active', 'active', '2026-08-05T09:00:00.000Z'),
      relatedSessionIds: ['lesson-1', 'lesson-1', 'lesson-2'],
      relatedActivityIds: ['activity-1', 'activity-1', 'activity-2'],
    };
    const rows = buildLearningTaskRows([
      { ...active, updatedAt: '2026-08-05T08:00:00.000Z' },
    ], active);

    expect(rows).toEqual([expect.objectContaining({
      lessonCount: 2,
      activityCount: 2,
      thread: expect.objectContaining({ id: 'active', updatedAt: '2026-08-05T09:00:00.000Z' }),
    })]);
  });

  it('only drills into activities explicitly attached to the task', () => {
    const task = {
      ...createTask('active', 'active', '2026-08-05T09:00:00.000Z'),
      relatedActivityIds: ['activity-2', 'activity-1'],
    };
    const activities = [
      { id: 'activity-3', kind: 'conversation' as const, title: '跨课提问', occurredAt: '2026-08-05T08:00:00.000Z' },
      { id: 'activity-2', kind: 'app' as const, title: '课堂测验', occurredAt: '2026-08-05T09:00:00.000Z' },
      { id: 'activity-1', kind: 'lesson' as const, title: '回听课堂', occurredAt: '2026-08-05T07:00:00.000Z' },
    ];

    expect(selectLearningTaskEvidence(task, activities).map((activity) => activity.id))
      .toEqual(['activity-1', 'activity-2']);
  });
});
