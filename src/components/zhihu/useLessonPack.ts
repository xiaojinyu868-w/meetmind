'use client';

/**
 * 课堂页材料栏的数据：这节课的材料包（GET /api/zhihu/lesson/[threadId]）。20 s 不回来当失败，给「再试一次」。
 * 课后的一切（考一考 / 继续看 / 材料卡）都在复习页（/app?session=teach:<id>），这里不再有伪转录与出题。
 */

import * as React from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import { fetchLessonPack, ZhihuClientError } from './zhihu-api-client';

export function useLessonPack(threadId: string): { pack: LiveMaterialPack | null; packError: string | null; retryPack: () => void } {
  const { accessToken } = useAuth();
  const [pack, setPack] = React.useState<LiveMaterialPack | null>(null);
  const [packError, setPackError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setPackError(null);
    fetchLessonPack(accessToken, threadId)
      .then((data) => {
        if (!cancelled) setPack(data.pack);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ZhihuClientError) setPackError(error.message);
        else if ((error as Error)?.name === 'TimeoutError' || (error as Error)?.name === 'AbortError') setPackError(C.packSlow);
        else setPackError(C.errors.unknown);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, threadId, attempt]);

  return { pack, packError, retryPack: () => setAttempt((n) => n + 1) };
}
