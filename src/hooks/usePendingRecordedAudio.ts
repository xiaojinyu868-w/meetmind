/**
 * usePendingRecordedAudio
 *
 * 待处理录音音频管理 — 从 page.tsx 提取（Phase 6）
 *
 * 包含：
 *   pendingRecordedAudiosRef  — 内部 Map ref
 *   resolvePendingRecordedAudio — 按 recordingId 查找或返回唯一项
 *   clearPendingRecordedAudio   — 按 recordingId 删除或清除唯一项
 *
 * 零外部依赖，纯 ref 逻辑。
 */

import { useCallback, useRef } from 'react';
import type { PendingRecordedAudio } from '@/types/page-types';

export function usePendingRecordedAudio() {
  const pendingRecordedAudiosRef = useRef<Map<string, PendingRecordedAudio>>(new Map());

  const resolvePendingRecordedAudio = useCallback((recordingId?: string) => {
    if (recordingId && pendingRecordedAudiosRef.current.has(recordingId)) {
      return pendingRecordedAudiosRef.current.get(recordingId) || null;
    }

    if (pendingRecordedAudiosRef.current.size === 1) {
      return Array.from(pendingRecordedAudiosRef.current.values())[0] || null;
    }

    return null;
  }, []);

  const clearPendingRecordedAudio = useCallback((recordingId?: string) => {
    if (recordingId && pendingRecordedAudiosRef.current.has(recordingId)) {
      pendingRecordedAudiosRef.current.delete(recordingId);
      return;
    }

    if (pendingRecordedAudiosRef.current.size === 1) {
      const onlyKey = pendingRecordedAudiosRef.current.keys().next().value;
      if (onlyKey) {
        pendingRecordedAudiosRef.current.delete(onlyKey);
      }
    }
  }, []);

  return {
    pendingRecordedAudiosRef,
    resolvePendingRecordedAudio,
    clearPendingRecordedAudio,
  };
}
