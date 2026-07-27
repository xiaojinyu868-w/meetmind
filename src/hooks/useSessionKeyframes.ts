/**
 * useSessionKeyframes — 复习页按 sessionId 懒加载课中「截取这一页」关键帧。
 *
 * 数据源是 IndexedDB（本机真实数据源）：本机帧用 blob 生成 objectURL，
 * 已上传的帧优先用 mediaUrl（换设备后 blob 不在也能显示）。
 * 返回 { timestampMs, src }[]，直接喂给 TranscriptFlowView 的 keyframes prop。
 */

import { useEffect, useState } from 'react';
import { getSessionKeyframes } from '@/lib/db/keyframes';

export interface KeyframeStripItem {
  timestampMs: number;
  src: string;
}

export function useSessionKeyframes(sessionId: string | null | undefined): KeyframeStripItem[] {
  const [items, setItems] = useState<KeyframeStripItem[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const objectUrls: string[] = [];
    void getSessionKeyframes(sessionId)
      .then((frames) => {
        if (cancelled) return;
        const next = frames
          .map((frame) => {
            let src = frame.mediaUrl || '';
            if (!src && frame.blob) {
              src = URL.createObjectURL(frame.blob);
              objectUrls.push(src);
            }
            return { timestampMs: frame.timestampMs, src };
          })
          .filter((item) => item.src.length > 0);
        setItems(next);
      })
      .catch(() => {
        // 读失败只是没有缩略图，复习页其余部分不受影响
      });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [sessionId]);

  return items;
}
