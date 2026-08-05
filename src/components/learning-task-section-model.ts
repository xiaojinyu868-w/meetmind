import type { LearningActivityEntry, LearningThreadEntry } from '@/types/user';
import { mergeLearningThreadHistory } from '@/lib/utils/learning-context';

export interface LearningTaskRow {
  thread: LearningThreadEntry;
  lessonCount: number;
  activityCount: number;
}

const STATUS_PRIORITY: Record<LearningThreadEntry['status'], number> = {
  active: 0,
  paused: 1,
  completed: 2,
};

export function buildLearningTaskRows(
  learningThreads: LearningThreadEntry[] | undefined,
  activeThread: LearningThreadEntry | undefined,
): LearningTaskRow[] {
  return mergeLearningThreadHistory(learningThreads, activeThread)
    .sort((a, b) => (
      STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      || b.updatedAt.localeCompare(a.updatedAt)
    ))
    .map((thread) => ({
      thread,
      lessonCount: new Set(thread.relatedSessionIds ?? []).size,
      activityCount: new Set(thread.relatedActivityIds ?? []).size,
    }));
}

export function selectLearningTaskEvidence(
  thread: LearningThreadEntry,
  activities: LearningActivityEntry[],
): LearningActivityEntry[] {
  const evidenceIds = new Set(thread.relatedActivityIds ?? []);
  return activities
    .filter((activity) => evidenceIds.has(activity.id))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-6);
}
