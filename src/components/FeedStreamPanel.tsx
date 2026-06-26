'use client';

import { useEffect, useRef } from 'react';
import { useSessionId } from '@/stores/session-store';
import { useFeedStream } from '@/hooks/data/useFeedStream';
import { FeedStream } from '@/components/FeedStream';
import type { TranscriptSegment } from '@/types';
import type { FeedItem } from '@/types';

interface FeedStreamPanelProps {
  segments: TranscriptSegment[];
  /** 跳到时间戳 */
  onSeek?: (timeMs: number) => void;
  /** 让同学解释 */
  onAskTutor?: (text: string) => void;
}

/**
 * 信息流面板 — 复习态中间学习工作区的 feed tab 内容。
 *
 * 从 sessionStore 获取 sessionId，用 useFeedStream 生成基于个人上下文的信息流。
 * 切到 feed tab 时自动生成一次；之后用户可以手动刷新。
 */
export function FeedStreamPanel({ segments, onSeek, onAskTutor }: FeedStreamPanelProps) {
  const sessionId = useSessionId();
  const hasGeneratedRef = useRef(false);

  const { items, isLoading, error, generate } = useFeedStream({
    sessionId,
    segments,
  });

  // 首次切到 feed tab 且有转录内容时自动生成
  useEffect(() => {
    if (segments.length > 0 && !hasGeneratedRef.current && !isLoading) {
      hasGeneratedRef.current = true;
      void generate();
    }
  }, [segments.length, isLoading, generate]);

  const handleAction = (item: FeedItem) => {
    if (item.actionType === 'jump-timestamp' && item.timestamps?.[0] && onSeek) {
      // 解析 MM:SS → ms
      const parts = item.timestamps[0].split(':');
      const mins = parseInt(parts[0] || '0', 10);
      const secs = parseInt(parts[1] || '0', 10);
      onSeek((mins * 60 + secs) * 1000);
    } else if (item.actionType === 'ask-tutor' && onAskTutor) {
      onAskTutor(item.title);
    }
  };

  return (
    <div className="h-full overflow-y-auto px-5 py-4">
      <FeedStream
        items={items}
        isLoading={isLoading}
        error={error}
        onAction={handleAction}
        onRetry={generate}
      />
    </div>
  );
}
