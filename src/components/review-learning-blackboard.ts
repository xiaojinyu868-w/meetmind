import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

export type ReviewLearningBlackboardNoteSource = 'workspace' | 'tutor';

export interface ReviewLearningBlackboardNote {
  id: string;
  text: string;
  appKey?: WorkshopAppKey;
  source?: ReviewLearningBlackboardNoteSource;
  createdAt: number;
}

export interface ReviewLearningBlackboardState {
  activeAppKey: WorkshopAppKey | null;
  notes: ReviewLearningBlackboardNote[];
  updatedAt: number;
}

const APP_LABELS: Partial<Record<WorkshopAppKey, string>> = {
  flashcards: '闪卡',
  quiz: '测验',
  mindmap: '思维导图',
  cheatsheet: '速查表',
  'study-report': '学习报告',
  'audio-overview': '播客',
  infographic: '信息图',
};

const MAX_NOTES = 12;
const MODEL_DIRECTIVE_PATTERN = /(如果|应该|优先|提醒|建议|不要|只作为|可以)/;

function getAppLabel(appKey: WorkshopAppKey): string {
  return APP_LABELS[appKey] || appKey;
}

function stripModelDirectives(value: string): string {
  return value
    .split(/(?<=[。！？.!?])/)
    .map((part) => part.trim())
    .filter((part) => part && !MODEL_DIRECTIVE_PATTERN.test(part))
    .join('')
    .trim();
}

function compactText(value: string, max = 160): string {
  const normalized = stripModelDirectives(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function appendNote(
  state: ReviewLearningBlackboardState,
  note: Omit<ReviewLearningBlackboardNote, 'id' | 'createdAt'>,
): ReviewLearningBlackboardState {
  const text = compactText(note.text);
  if (!text) return state;
  const createdAt = Date.now();
  const nextNote: ReviewLearningBlackboardNote = {
    ...note,
    text,
    id: `${createdAt}-${state.notes.length + 1}`,
    createdAt,
  };
  return {
    ...state,
    notes: [...state.notes, nextNote].slice(-MAX_NOTES),
    updatedAt: createdAt,
  };
}

export function createReviewLearningBlackboard(): ReviewLearningBlackboardState {
  return {
    activeAppKey: null,
    notes: [],
    updatedAt: 0,
  };
}

export function openReviewLearningApp(
  state: ReviewLearningBlackboardState,
  appKey: WorkshopAppKey,
  source: ReviewLearningBlackboardNoteSource,
): ReviewLearningBlackboardState {
  const actor = source === 'tutor' ? '同桌' : '学生';
  return appendNote(
    { ...state, activeAppKey: appKey },
    {
      appKey,
      source,
      text: `${actor}打开了${getAppLabel(appKey)}。`,
    },
  );
}

export function closeReviewLearningApp(state: ReviewLearningBlackboardState): ReviewLearningBlackboardState {
  return {
    ...state,
    activeAppKey: null,
    updatedAt: Date.now(),
  };
}

export function appendReviewLearningActivity(
  state: ReviewLearningBlackboardState,
  text: string,
): ReviewLearningBlackboardState {
  return appendNote(state, {
    appKey: state.activeAppKey || undefined,
    source: 'workspace',
    text,
  });
}

export function formatReviewBlackboardForTutorAgent(state: ReviewLearningBlackboardState): string | undefined {
  const lines: string[] = ['【当前学习现场】'];
  if (state.activeAppKey) {
    lines.push(`当前打开：${getAppLabel(state.activeAppKey)}`);
  }

  const recent = state.notes.slice(-8).map((note) => note.text).filter(Boolean);
  if (recent.length > 0) {
    if (lines.length > 1) lines.push('');
    lines.push('最近发生：');
    recent.forEach((text) => {
      lines.push(`- ${text}`);
    });
  }

  if (lines.length === 1) return undefined;
  return lines.join('\n');
}
