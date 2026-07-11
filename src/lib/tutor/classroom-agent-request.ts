import type { TranscriptSegment } from '@/types';
import { extractRecentFocus } from '@/lib/services/classroom/recent-focus';
import { formatTranscriptWithSpeakers } from '@/lib/utils/transcript-format';

export interface InClassTutorAgentBody extends Record<string, unknown> {
  messages: unknown[];
  sessionId: string;
  model?: string;
  mode: 'in-class';
  context: {
    /** 到目前为止的完整转录（尾部截断），让同桌知道整节课在讲什么 */
    fullTranscript?: string;
    recentFocus?: string;
    learnerProfile?: string;
    /** 用户在课堂上传的图片/截图/文档解析文本。课堂场景刚需：拍 PPT 上一道题问"这个怎么做"。 */
    supportMaterials?: Array<{ title: string; content: string }>;
  };
  options: {
    returnTimestamps: false;
    thinkingGuide: false;
  };
}

export function buildInClassTutorAgentBody(input: {
  messages: unknown[];
  sessionId?: string | null;
  segments: TranscriptSegment[];
  model?: string;
  /** individual learner profile（含 bio + 结构化字段 + goals）。in-class 也注入，让"同桌"能认识用户。 */
  learnerProfile?: string;
  /** 用户在课堂上传的图片/截图/文档解析文本（来自底座 useChatFileUpload）。 */
  supportMaterials?: Array<{ title: string; content: string }>;
}): InClassTutorAgentBody {
  const recentFocus = extractRecentFocus(input.segments) || undefined;
  const model = input.model?.trim() || undefined;
  const learnerProfile = input.learnerProfile?.trim() || undefined;

  // 构造完整转录文本（尾部截断由 prompt 层的 capFullTranscript 处理）
  // 多人会议模式下带 [说话人N] 标记，让同桌 AI 能区分谁在讲什么。
  const fullTranscript = input.segments.length > 0
    ? formatTranscriptWithSpeakers(input.segments) || undefined
    : undefined;

  const context: InClassTutorAgentBody['context'] = {};
  if (fullTranscript) context.fullTranscript = fullTranscript;
  if (recentFocus) context.recentFocus = recentFocus;
  if (learnerProfile) context.learnerProfile = learnerProfile;
  if (input.supportMaterials && input.supportMaterials.length > 0) {
    context.supportMaterials = input.supportMaterials;
  }

  return {
    messages: input.messages,
    sessionId: input.sessionId || 'anon',
    ...(model ? { model } : {}),
    mode: 'in-class',
    context,
    options: {
      returnTimestamps: false,
      thinkingGuide: false,
    },
  };
}
