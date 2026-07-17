/**
 * 转录格式化工具——把 segments 转成带说话人标记的纯文本，供 AI 上下文注入。
 *
 * 用结构化类型而非 TranscriptSegment，兼容 tutor-types.ts 的 Segment（没有 speakerId）
 * 和 types/index.ts 的 TranscriptSegment（有 speakerId），运行时按实际字段判断。
 */

interface TranscriptLikeSegment {
  text: string;
  speakerId?: string;
}

/**
 * 把转录 segments 格式化为带说话人标记的纯文本。
 *
 * 多人会议模式下 segment 带 speakerId。在说话人变化时插入 [说话人N] 标记，
 * 让 AI 能区分"谁在讲什么"。同一说话人连续说话不重复标注，避免噪音。
 * 单人模式（无 speakerId）返回纯文本拼接。
 *
 * 用于 in-class / review 两种 mode 的 fullTranscript 注入。
 */
export function formatTranscriptWithSpeakers(segments: TranscriptLikeSegment[]): string {
  return segments
    .map((s, i) => {
      const text = s.text;
      if (!s.speakerId) return text;
      const prevSpeaker = i > 0 ? segments[i - 1].speakerId : undefined;
      if (prevSpeaker === s.speakerId) return text;
      if (!/^\d+$/.test(s.speakerId)) return text;
      const speakerNum = Number(s.speakerId) + 1;
      if (!Number.isInteger(speakerNum) || speakerNum < 1) return text;
      return `[说话人${speakerNum}] ${text}`;
    })
    .join(' ')
    .trim();
}

/** 检测文本中是否包含说话人标记 */
export function hasSpeakerMarker(text: string): boolean {
  return /\[说话人\d+\]/.test(text);
}
