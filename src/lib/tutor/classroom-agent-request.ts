import type { TranscriptSegment } from '@/types';
import { extractRecentFocus } from '@/lib/services/classroom/recent-focus';

export interface InClassTutorAgentBody extends Record<string, unknown> {
  messages: unknown[];
  sessionId: string;
  model?: string;
  transcript: [];
  mode: 'in-class';
  context: {
    recentFocus?: string;
    /** M14: 当前课全量转录（截尾 8000 字保护 prefill）。让 AI 处理"刚才那段"、"我没跟上"等回顾型问题时有完整上下文。 */
    fullTranscript?: string;
    /** M14: 当前录音/播放进度（秒）。让 AI 知道"现在"在哪一段，引用时给精确时间戳。 */
    currentTimestampSec?: number;
    learnerProfile?: string;
  };
  options: {
    /** M14: 课堂场景禁用 inline app —— 学生没认知带宽看一张完整速查表/思维导图；
     * 结构化产物全留到课后复习态。 */
    allowInlineApp: false;
    /** M14: 打开时间戳，让 AI 回"刚才那段"时给 [MM:SS] 让学生能跳回转录。 */
    returnTimestamps: true;
    thinkingGuide: false;
  };
}

/**
 * M14：当前课全量转录注入上限。
 * 8000 字 ≈ 12–16k input tokens ≈ 15–20 分钟课堂内容。
 * 长课时取尾部（最近的一段最重要）。
 */
const MAX_IN_CLASS_FULL_TRANSCRIPT_CHARS = 8000;

export function buildInClassTutorAgentBody(input: {
  messages: unknown[];
  sessionId?: string | null;
  segments: TranscriptSegment[];
  model?: string;
  /** M11.5：individual learner profile（含 bio + 结构化字段 + goals）。in-class 也注入，让"同桌"能认识用户。 */
  learnerProfile?: string;
}): InClassTutorAgentBody {
  const recentFocus = extractRecentFocus(input.segments) || undefined;
  const model = input.model?.trim() || undefined;
  const learnerProfile = input.learnerProfile?.trim() || undefined;

  // M14: 当前课全量转录（按时间序拼接，截尾 8000 字）
  const rawFull = input.segments
    .map((seg) => seg.text)
    .filter(Boolean)
    .join(' ')
    .trim();
  const fullTranscript = rawFull.length > 0
    ? (rawFull.length > MAX_IN_CLASS_FULL_TRANSCRIPT_CHARS
        ? rawFull.slice(-MAX_IN_CLASS_FULL_TRANSCRIPT_CHARS)
        : rawFull)
    : undefined;

  // M14: 当前进度 = 最后一段 endMs / 1000（学生最新听到的时间点）
  const lastSeg = input.segments[input.segments.length - 1];
  const currentTimestampSec = lastSeg && typeof lastSeg.endMs === 'number'
    ? Math.floor(lastSeg.endMs / 1000)
    : undefined;

  const context: InClassTutorAgentBody['context'] = {};
  if (recentFocus) context.recentFocus = recentFocus;
  if (fullTranscript) context.fullTranscript = fullTranscript;
  if (typeof currentTimestampSec === 'number') context.currentTimestampSec = currentTimestampSec;
  if (learnerProfile) context.learnerProfile = learnerProfile;

  return {
    messages: input.messages,
    sessionId: input.sessionId || 'anon',
    ...(model ? { model } : {}),
    // tutor agent in-class 不需要原始 segments —— prompt 已带 fullTranscript 文本。
    // 保留空数组以兼容 ContextSchema 默认值。
    transcript: [],
    mode: 'in-class',
    context,
    options: {
      allowInlineApp: false,
      returnTimestamps: true,
      thinkingGuide: false,
    },
  };
}
