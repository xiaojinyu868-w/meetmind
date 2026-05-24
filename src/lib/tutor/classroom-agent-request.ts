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
}): InClassTutorAgentBody {
  const recentFocus = extractRecentFocus(input.segments) || undefined;
  const model = input.model?.trim() || undefined;
  return {
    messages: input.messages,
    sessionId: input.sessionId || 'anon',
    ...(model ? { model } : {}),
    // 课堂问答只需要 recentFocus 做代词消歧；结构化产物由 /api/apps/execute 另取转录。
    // 不再每问一次上传整节 transcript，避免课堂越长首 token 越慢。
    transcript: [],
    mode: 'in-class',
    context: recentFocus ? { recentFocus } : {},
    options: {
      allowInlineApp: true,
      returnTimestamps: false,
      thinkingGuide: false,
    },
  };
}
