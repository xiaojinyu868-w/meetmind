'use client';

import { useCallback } from 'react';
import type { UseLearningContextReturn } from '@/hooks/useLearningContext';
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
  memories: ExistingLearningMemory[];
  activeThread?: LearningThreadEntry;
  activeIntent?: LearningIntentPlan | null;
  addMemory: UseLearningContextReturn['addMemory'];
  updateMemory: UseLearningContextReturn['updateMemory'];
  setActiveThread: UseLearningContextReturn['setActiveThread'];
}

export function useLearningMemoryDistillation({
  accessToken,
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
      const response = await fetch('/api/tutor/memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
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
  }, [accessToken, activeIntent, activeThread, addMemory, memories, setActiveThread, updateMemory]);
}
