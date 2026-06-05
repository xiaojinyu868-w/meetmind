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
    /** M14.5: 用户在课堂上传的图片/截图/文档解析文本。课堂场景刚需：拍 PPT 上一道题问"这个怎么做"。 */
    supportMaterials?: Array<{ title: string; content: string }>;
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
  /** M14.5：用户在课堂上传的图片/截图/文档解析文本（来自底座 useChatFileUpload）。 */
  supportMaterials?: Array<{ title: string; content: string }>;
}): InClassTutorAgentBody {
  const recentFocus = extractRecentFocus(input.segments) || undefined;
  const model = input.model?.trim() || undefined;
  const learnerProfile = input.learnerProfile?.trim() || undefined;

  const context: InClassTutorAgentBody['context'] = {};
  if (recentFocus) context.recentFocus = recentFocus;
  if (learnerProfile) context.learnerProfile = learnerProfile;
  if (input.supportMaterials && input.supportMaterials.length > 0) {
    context.supportMaterials = input.supportMaterials;
  }

  return {
    messages: input.messages,
    sessionId: input.sessionId || 'anon',
    ...(model ? { model } : {}),
    // tutor agent in-class 只需要 recentFocus；保留空数组以兼容 ContextSchema 默认值。
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
