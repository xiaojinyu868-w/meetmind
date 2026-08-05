import type {
  LearnerProfile,
  LearningActivityEntry,
  LearningContextState,
  LearningMemoryEntry,
  LearningThreadEntry,
} from '@/types/user';

export const MAX_LEARNING_MEMORIES = 24;
export const MAX_RECENT_LEARNING_ACTIVITIES = 24;
export const MAX_LEARNING_THREADS = 16;
const MAX_THREAD_EVIDENCE_IDS = 24;

function compact(value: string | undefined, max: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1))}…`;
}

export function toLearningActivityPreview(value: string, max = 220): string {
  const plainText = value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1');
  return compact(plainText, max);
}

export function createEmptyLearningContext(): LearningContextState {
  return { memories: [], recentActivities: [], coursePreferences: [], learningThreads: [] };
}

function compactIdList(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined;
  const ids = Array.from(new Set(values.map((value) => compact(value, 120)).filter(Boolean)))
    .slice(-MAX_THREAD_EVIDENCE_IDS);
  return ids.length > 0 ? ids : undefined;
}

function normalizeLearningThread(thread: LearningThreadEntry): LearningThreadEntry {
  return {
    ...thread,
    title: compact(thread.title, 80),
    intent: compact(thread.intent, 240),
    outcome: compact(thread.outcome, 240) || undefined,
    lastSummary: compact(thread.lastSummary, 240) || undefined,
    nextStep: compact(thread.nextStep, 160) || undefined,
    conversationId: compact(thread.conversationId, 120) || undefined,
    sessionId: compact(thread.sessionId, 120) || undefined,
    relatedSessionIds: compactIdList(thread.relatedSessionIds),
    relatedActivityIds: compactIdList(thread.relatedActivityIds),
  };
}

export function mergeLearningThreadHistory(
  history: LearningThreadEntry[] | undefined,
  thread?: LearningThreadEntry,
): LearningThreadEntry[] {
  const byId = new Map<string, LearningThreadEntry>();
  for (const item of [...(history ?? []), ...(thread ? [thread] : [])]) {
    if (!item?.id || !item.title || !item.intent) continue;
    const normalized = normalizeLearningThread(item);
    const existing = byId.get(normalized.id);
    if (!existing || existing.updatedAt <= normalized.updatedAt) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(-MAX_LEARNING_THREADS);
}

export function learningContextFromProfile(
  profile?: LearnerProfile | null,
): LearningContextState {
  if (!profile) return createEmptyLearningContext();
  const mergedThreads = mergeLearningThreadHistory(
    profile.learningThreads,
    profile.activeLearningThread,
  );
  const latestActive = [...mergedThreads].reverse().find((thread) => thread.status === 'active');
  const learningThreads = mergedThreads.map((thread) => (
    thread.status === 'active' && thread.id !== latestActive?.id
      ? { ...thread, status: 'paused' as const }
      : thread
  ));
  return {
    memories: (profile.memories || []).slice(-MAX_LEARNING_MEMORIES),
    recentActivities: (profile.recentLearningActivities || []).slice(
      -MAX_RECENT_LEARNING_ACTIVITIES,
    ),
    coursePreferences: (profile.courseContextPreferences || []).slice(-32),
    learningThreads,
    activeThread: latestActive,
  };
}

export function mergeLearningMemory(
  state: LearningContextState,
  memory: LearningMemoryEntry,
): LearningContextState {
  const comparableSource = memory.sourceId?.trim();
  const withoutDuplicate = state.memories.filter((item) => (
    item.id !== memory.id && (!comparableSource || item.sourceId !== comparableSource)
  ));
  return {
    ...state,
    memories: [...withoutDuplicate, {
      ...memory,
      title: compact(memory.title, 80),
      detail: compact(memory.detail, 240) || undefined,
    }].slice(-MAX_LEARNING_MEMORIES),
  };
}

export function mergeLearningActivity(
  state: LearningContextState,
  activity: LearningActivityEntry,
): LearningContextState {
  const comparableSource = activity.sourceId?.trim();
  const withoutDuplicate = state.recentActivities.filter((item) => (
    item.id !== activity.id && (!comparableSource || item.sourceId !== comparableSource)
  ));
  return {
    ...state,
    recentActivities: [...withoutDuplicate, {
      ...activity,
      title: compact(activity.title, 80),
      detail: compact(activity.detail, 240) || undefined,
    }]
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(-MAX_RECENT_LEARNING_ACTIVITIES),
  };
}

export function attachLearningThreadActivityEvidence(
  thread: LearningThreadEntry,
  activity: LearningActivityEntry,
): LearningThreadEntry | undefined {
  if (thread.status !== 'active') return undefin