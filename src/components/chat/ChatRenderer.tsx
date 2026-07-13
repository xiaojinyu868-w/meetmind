/**
 * ChatRenderer —— 流式消息内容渲染器。
 *
 * 包装 StreamingMarkdown，外加 marker 拦截 pipeline。
 * marker 把"AI 文本里的特定块"截留出来交给消费者渲染（例如 IntentSummaryCard）。
 *
 * 现在支持的 marker：
 *   - intent-summary：---我想要的---...---结束---（goal 模式）
 *
 * 时间戳 [MM:SS] / 引用 [资料N] / KaTeX / GFM / 代码块这些
 * 直接交给 StreamingMarkdown 内置处理（已经做得很好）。
 *
 * 不做的事：
 *   - 不渲染 inline app card / tool card —— 那是 ChatBubble 之外、消息层级的事，由 adapter 直接挂
 */

'use client';

import * as React from 'react';
import { StreamingMarkdown } from '@/components/StreamingMarkdown';
import { extractIntentSummary, type IntentSummaryExtraction } from './markers/extractIntentSummary';
import { extractLearningProgress, type LearningProgressExtraction } from './markers/extractLearningProgress';

export type ChatMarkerKind = 'intent-summary' | 'learning-progress';

export interface ChatMarkerHit {
  kind: ChatMarkerKind;
  /** intent-summary 的具体 payload */
  intentSummary?: IntentSummaryExtraction;
  /** learning-progress 的候选记忆点；必须由用户确认后才能写入长期记忆。 */
  learningProgress?: LearningProgressExtraction;
  /** 命中此 marker 的消息 ID（消费者用于状态聚合） */
  messageId: string;
}

export interface ChatRendererProps {
  /** 完整 AI 文本（流式中也持续传入） */
  content: string;
  /** 是否还在流（控制末尾打字 caret） */
  isStreaming?: boolean;
  /** 时间戳点击（review 模式才传） */
  onTimestampClick?: (ms: number) => void;
  /** 当前播放位置（高亮当前播放的时间戳） */
  currentTime?: number;
  /** 启用哪些 marker */
  markers?: ChatMarkerKind[];
  /** marker 命中后的回调（消费者用来 setState 显示卡片等） */
  onMarkerHit?: (hit: ChatMarkerHit) => void;
  /** 当前消息 ID（marker 回调要带上） */
  messageId?: string;
  className?: string;
}

export const ChatRenderer = React.memo(function ChatRenderer({
  content,
  isStreaming,
  onTimestampClick,
  currentTime,
  markers,
  onMarkerHit,
  messageId,
  className,
}: ChatRendererProps) {
  // 应用 marker：从 content 切出 marker 块，剩余文本交给 markdown 渲染
  const { displayText, summary, progress } = React.useMemo(() => {
    let text = content;
    let summary: IntentSummaryExtraction | undefined;
    let progress: LearningProgressExtraction | undefined;
    if (markers?.includes('intent-summary')) {
      const hit = extractIntentSummary(text);
      if (hit) {
        text = hit.textWithoutBlock;
        summary = hit;
      }
    }
    if (markers?.includes('learning-progress')) {
      const hit = extractLearningProgress(text);
      if (hit) {
        text = hit.textWithoutBlock;
        progress = hit;
      }
    }
    return { displayText: text, summary, progress };
  }, [content, markers]);

  // 命中 marker 时通知（仅在新命中时触发——避免重复回调）
  const lastSummaryRawRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (summary && summary.rawBlock !== lastSummaryRawRef.current) {
      lastSummaryRawRef.current = summary.rawBlock;
      onMarkerHit?.({
        kind: 'intent-summary',
        intentSummary: summary,
        messageId: messageId ?? '',
      });
    }
  }, [summary, onMarkerHit, messageId]);

  const lastProgressRawRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (progress && progress.rawBlock !== lastProgressRawRef.current) {
      lastProgressRawRef.current = progress.rawBlock;
      onMarkerHit?.({
        kind: 'learning-progress',
        learningProgress: progress,
        messageId: messageId ?? '',
      });
    }
  }, [progress, onMarkerHit, messageId]);

  // 全空：流式刚开始还没字符 → 不渲染（让消费者用 ThinkingStrip 占位）
  if (!displayText.trim()) return null;

  return (
    <StreamingMarkdown
      content={displayText}
      isStreaming={isStreaming}
      onTimestampClick={onTimestampClick}
      currentTime={currentTime}
      className={className}
    />
  );
});

ChatRenderer.displayName = 'ChatRenderer';
