import type { TranscriptSegment } from '@/types';

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
