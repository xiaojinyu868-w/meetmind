import type { TranscriptSegment } from '@/types';
import type { ClassCheckCheckpoint, ClassCheckQuestionData } from '@/app/api/class-check/plan/route';

const MIN_PLAN_SEGMENTS = 6;
const LIVE_PLAN_SEGMENT_BUCKET_SIZE = 50;

type CheckpointStatusLike = 'pending' | 'active' | 'completed' | 'skipped';
type QuestionStateLike = 'loading' | 'ready' | 'failed';

export function buildClassCheckPlanRequestKey(params: {
  sessionId: string;
  dataSource: string;
  segments: TranscriptSegment[];
}): string | null {
  const { sessionId, dataSource, segments } = params;
  if (dataSource !== 'video' && dataSource !== 'live') return null;
  if (segments.length < MIN_PLAN_SEGMENTS) return null;

  const safeSessionId = sessionId || 'anonymous-session';
  if (dataSource === 'live') {
    const segmentBucket = Math.floor((segments.length - 1) / LIVE_PLAN_SEGMENT_BUCKET_SIZE);
    return `${safeSessionId}:live:segment-bucket-${segmentBucket}`;
  }

  const lastEndMs = segments.reduce((max, segment) => Math.max(max, segment.endMs || 0), 0);
  return `${safeSessionId}:video:${segments.length}:${lastEndMs}`;
}

export function shouldAutoFetchCheckpointQuestions(params: {
  hasQuestions: boolean;
  questionState?: QuestionStateLike;
  checkpointStatus?: CheckpointStatusLike;
}): boolean {
  if (params.hasQuestions) return false;
  if (params.checkpointStatus !== 'pending') return false;
  return params.questionState !== 'failed';
}

function compactFallbackText(value: string, limit: number): string {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}

export function buildClientFallbackCheckpointQuestions(params: {
  checkpoint: ClassCheckCheckpoint;
  transcript: TranscriptSegment[];
}): ClassCheckQuestionData[] {
  const topic = compactFallbackText(params.checkpoint.topic, 42) || '刚才这个知识点';
  const evidence = compactFallbackText(
    params.transcript
      .filter((segment) => segment.endMs >= params.checkpoint.startMs - 10_000 && segment.startMs <= params.checkpoint.endMs + 10_000)
      .map((segment) => segment.text)
      .filter(Boolean)
      .join(' '),
    90
  ) || topic;

  return [
    {
      stem: `刚才关于「${topic}」，最值得先确认的是哪一件事？`,
      options: [
        'A. 能用自己的话说出它和课堂原文的关系',
        'B. 只记住它出现过，但不用理解',
        'C. 跳过这一段，直接看后面的内容',
        'D. 只背原话，不管它为什么成立',
      ],
      answer: 'A',
      explanation: `课堂里有这条线索：「${evidence}」。先把它和原文关系说清楚，再继续往后学。`,
    },
  ];
}
