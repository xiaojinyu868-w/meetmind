'use client';

import { useCallback } from 'react';
import { refreshLearningContextFromServer, type UseLearningContextReturn } from '@/hooks/useLearningContext';
import type { DistilledLearningMemory, ExistingLearningMemory } from '@/lib/services/learning-memory-distillation-service';
import type { LearningIntentPlan } from '@/types/learning-intent';
import type { LearningThreadEntry } from '@/types/user';

interface DistillLearningMemoryRequest {
  userText: string;
  assistantText: string;
  sourceId: string;
}

interface UseLearningMemoryDistillationOptions {
  accessToken?: string;
  /** 登录用户 ID（服务端事件管道的读刷新按 ownerKey 广播）；访客无需传 */
  userId?: string;
  memories: ExistingLearningMemory[];
  activeThread?: LearningThreadEntry;
  activeIntent?: LearningIntentPlan | null;
  addMemory: UseLearningContextReturn['addMemory'];
  updateMemory: UseLearningContextReturn['updateMemory'];
  setActiveThread: UseLearningContextReturn['setActiveThread'];
}

// 服务端蒸馏合并是 fire-and-forget：事件落库后延迟重拉画像刷新本地 state。
const SERVER_REFRESH_DELAYS_MS = [2_500, 8_000];

export function useLearningMemoryDistillation({
  accessToken,
  userId,
  memories,
  activeThread,
  activeIntent,
  addMemory,
  updateMemory,
  setActiveThread,
}: UseLearningMemoryDistillationOptions) {
  return useCallback(async (
    input: DistillLearningMemoryRequest,
  ): Promise<void> => {
    try {
      if (accessToken && userId) {
        // 登录用户（P0 事件化）：只发事件，蒸馏与 merge 收归服务端
        // （learning-event-service），客户端不再走 merge→PATCH 整体回写。
        // type 标 'progress'：这是蒸馏前的原始互动回合，具体性质由蒸馏模型判定。
        const response = await fetch('/api/memory/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            appId: 'global-ask',
            type: 'progress',
            payload: { v: 1, userText: input.userText, assistantText: input.assistantText },
            sourceId: input.sourceId,
            idempotencyKey: `global-understanding:${input.sourceId}`,
          }),
        });
        if (!response.ok) return;
        for (const delay of SERVER_REFRESH_DELAYS_MS) {
          setTimeout(() => {
            void refreshLearningContextFromServer(userId, accessToken);
          }, delay);
        }
        return;
      }

      // 访客：维持现有客户端蒸馏 + 本地合并流程（IndexedDB learning_context_guest_v1）
      const response = await fetch('/api/tutor/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userText: input.userText,
          assistantText: input.assistantText,
          existingMemories: memories.slice(-12).map(({ id, kind, title, detail }) => ({
            id,
            kind,
            title,
            detail,
          })),
        }),
      });
      if (!response.ok) return;
      const payload = await response.json() as { ok?: boolean; memories?: DistilledLearningMemory[] };
      const distilled = payload.ok && Array.isArray(payload.memories) ? payload.memories : [];

      for (let index = 0; index < distilled.length; index += 1) {
        const memory = distilled[index];
        const replacement = memory.replaceId
          ? memories.find((item) => item.id === memory.replaceId)
          : undefined;
        if (replacement) {
          await updateMemory(replacement.id, {
            kind: memory.kind,
            title: memory.title,
            detail: memory.detail,
            status: 'active',
          });
        } else {
          await addMemory({
            kind: memory.kind,
            title: memory.title,
            detail: memory.detail,
            source: 'ai',
            sourceId: `global-understanding:${input.sourceId}:${index}`,
          });
        }
      }

      if (distilled.length > 0 && activeThread) {
        await setActiveThread({
          ...activeThread,
          lastSummary: distilled.map((memory) => memory.title).join('；'),
          nextStep: activeIntent?.checkpoints[1] || activeIntent?.checkpoints[0],
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Context maintenance must never interrupt the user's main learning flow.
    }
  }, [accessToken, userId, activeIntent, activeThread, addMemory, memories, setActiveThread, updateMemory]);
}
