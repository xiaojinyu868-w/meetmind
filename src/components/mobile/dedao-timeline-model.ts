/**
 * dedao-timeline-model — 得到风格时间线的条目类型与转换（纯模块）。
 *
 * 抽出来的原因：page.tsx 只需要 toDedaoEntries 这个纯函数，此前却从 DedaoTimeline.tsx 静态取，
 * 顺带把 TranscriptFlowView → WordExplainer（@ai-sdk/react + zod）→ chat/ChatRenderer（react-markdown + KaTeX）
 * 整串拉进 /app 首屏 JS（约 200KB gzip）。组件本身仍从这里 re-export，其他消费方不必改。
 */

import type { Anchor, TranscriptSegment } from '@/types';

export interface DedaoTimelineEntry {
  id: string;
  content: string;
  startMs: number;
  endMs: number;
  hasConfusion: boolean;
  confusionResolved?: boolean;
}

export function toDedaoEntries(
  segments: TranscriptSegment[],
  anchors: Anchor[]
): DedaoTimelineEntry[] {
  return segments.map((segment) => {
    const anchor = anchors.find(
      (a) => a.timestamp >= segment.startMs && a.timestamp <= segment.endMs
    );

    return {
      id: segment.id,
      content: segment.text,
      startMs: segment.startMs,
      endMs: segment.endMs,
      hasConfusion: !!anchor,
      confusionResolved: anchor?.resolved,
    };
  });
}
