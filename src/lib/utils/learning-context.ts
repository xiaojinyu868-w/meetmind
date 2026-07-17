import type {
  LearnerProfile,
  LearningActivityEntry,
  LearningContextState,
  LearningMemoryEntry,
  LearningThreadEntry,
} from '@/types/user';

export const MAX_LEARNING_MEMORIES = 24;
export const MAX_RECENT_LEARNING_ACTIVITIES = 24;

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
  return { memories: [], recentActivities: [], coursePreferences: [] };
}

export function learningContextFromProfile(
  profile?: LearnerProfile | null,
): LearningContextState {
  if (!profile) return createEmptyLearningContext();
  return {
    memories: (profile.memories || []).slice(-MAX_LEARNING_MEMORIES),
    recentActivities: (profile.recentLearningActivities || []).slice(
      -MAX_RECENT_LEARNING_ACTIVITIES,
    ),
    coursePreferences: (profile.courseContextPreferences || []).slice(-32),
    activeThread: profile.activeLearningThread,
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

export function updateLearningThread(
  state: LearningContextState,
  thread?: LearningThreadEntry,
): LearningContextState {
  return { ...state, activeThread: thread };
}

export function formatLearningContextForTutor(
  state: LearningContextState,
  profile?: LearnerProfile | null,
): {
  memories: Array<{ title: string; detail?: string; kind: string }>;
  recentActivities: Array<{ title: string; detail?: string; occurredAt: string }>;
  activeThread?: LearningThreadEntry;
  goals: Array<{ title: string; summary?: string }>;
  bio?: { headline: string; detail?: string };
} {
  return {
    memories: state.memories
      .filter((memory) => memory.status === 'active')
      .slice(-12)
      .map(({ title, detail, kind }) => ({ title, detail, kind })),
    recentActivities: state.recentActivities
      .slice(-8)
      .map(({ title, detail, occurredAt }) => ({ title, detail, occurredAt })),
    activeThread: state.activeThread?.status === 'active' ? state.activeThread : undefined,
    goals: (profile?.goals || [])
      .filter((goal) => (goal.status || 'active') === 'active')
      .slice(-8)
      .map(({ title, summary }) => ({ title, summary })),
    bio: profile?.bio
      ? { headline: profile.bio.headline, detail: profile.bio.detail }
      : undefined,
  };
}

export function summarizeLearningContext(state: LearningContextState): string | undefined {
  const lines: string[] = [];
  const activeMemories = state.memories.filter((memory) => memory.status === 'active').slice(-6);
  if (activeMemories.length > 0) {
    lines.push('长期记忆：');
    activeMemories.forEach((memory) => {
      lines.push(`- ${memory.title}${memory.detail ? `：${memory.detail}` : ''}`);
    });
  }
  const recent = state.recentActivities.slice(-5);
  if (recent.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('最近学习活动：');
    recent.forEach((activity) => {
      lines.push(`- ${activity.title}${activity.detail ? `：${activity.detail}` : ''}`);
    });
  }
  if (state.activeThread?.status === 'active') {
    if (lines.length > 0) lines.push('');
    lines.push(`正在继续：${state.activeThread.title}`);
    if (state.activeThread.lastSummary) lines.push(state.activeThread.lastSummary);
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}
