import { formatTimestamp } from '@/lib/services/longcut-utils';
import type { AITutorProps, Segment } from './tutor-types';
import { normalizeSupportContextText } from './tutor-utils';

const REALTIME_FOCUS_WINDOW_MS = 45_000;

interface RealtimeTutorContextInput {
  breakpoint: AITutorProps['breakpoint'] | { timestamp?: number | null } | null;
  preferSupportContext?: boolean;
}

interface RealtimeTutorInstructionInput extends RealtimeTutorContextInput {
  segments: Segment[];
  supportContextText?: string;
}

export function resolveRealtimeTutorHasContext({
  segments,
  supportContextText,
}: {
  segments: Segment[];
  supportContextText?: string | null;
}): boolean {
  return segments.length > 0 || normalizeSupportContextText(supportContextText || '').length > 0;
}

export function buildRealtimeTutorContextLabel({
  breakpoint,
  preferSupportContext,
}: RealtimeTutorContextInput): string {
  if (typeof breakpoint?.timestamp === 'number') {
    return `${formatTimestamp(breakpoint.timestamp)} 附近`;
  }
  return preferSupportContext ? '已选内容' : '整节课';
}

export function buildRealtimeTutorInstructions({
  breakpoint,
  segments,
  supportContextText = '',
  preferSupportContext = false,
}: RealtimeTutorInstructionInput): string {
  const focusTimestamp = typeof breakpoint?.timestamp === 'number' ? breakpoint.timestamp : null;
  const relevantSegments = focusTimestamp !== null
    ? segments.filter((segment) => (
      segment.startMs <= focusTimestamp + REALTIME_FOCUS_WINDOW_MS &&
      segment.endMs >= focusTimestamp - REALTIME_FOCUS_WINDOW_MS
    ))
    : (preferSupportContext ? [] : segments);
  const mergedText = relevantSegments.map((segment) => segment.text).join(' ');
  const contextText = normalizeSupportContextText(mergedText || supportContextText, 2600);
  const sceneHint = breakpoint
    ? '学生刚好卡在课上的一个具体片段，你要顺着这段继续讲。'
    : '学生正在围绕整节课继续追问，你要像陪学同学一样顺着往下带。';

  return [
    '你是一位像真人一样在微信里陪学生语音辅导的中文同学。',
    '学生会一轮一轮地发来语音。',
    '先自然接住学生刚说的话，再继续解释，一次只推进一点。',
    '不要写提纲，不要列条目，不要把回答讲成讲义。',
    '除非学生明确要回放原话，否则不要主动报时间戳。',
    sceneHint,
    contextText ? `这节课的已知上下文：${contextText}` : '',
  ].filter(Boolean).join('\n\n');
}
