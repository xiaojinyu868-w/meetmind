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
    learnerProfile?: string;
  };
  options: {
    allowInlineApp: true;
    returnTimestamps: false;
    thinkingGuide: false;
  };
}

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
  const context: InClassTutorAgentBody['context'] = {};
  if (recentFocus) context.recentFocus = recentFocus;
  if (learnerProfile) context.learnerProfile = learnerProfile;
  return {
    messages: input.messages,
    sessionId: input.sessionId || 'anon',
    ...(model ? { model } : {}),
    // 课堂问答只需要 recentFocus 做代词消歧；结构化产物由 /api/apps/execute 另取转录。
    // 不再每问一次上传整节 transcript，避免课堂越长首 token 越慢。
    transcript: [],
    mode: 'in-class',
    context,
    options: {
      allowInlineApp: true,
      returnTimestamps: false,
      thinkingGuide: false,
    },
  };
}
