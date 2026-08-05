'use client';

import { useCallback } from 'react';
import type { UseLearningContextReturn } from '@/hooks/useLearningContext';
import type {
  DistilledLearningMemory,
  DistilledLearningThreadProgress,
  ExistingLearningMemory,
} from '@/lib/services/learning-memory-distillation-service';
import {
  attachLearningThreadActivityEvidence,
  toLearningActivityPreview,
} from '@/lib/utils/learning-context';
import type { LearningIntentPlan } from '@/types/learning-intent';
import type { LearningActivityEntry, LearningThreadEntry } from '@/types/user';

interface DistillLearningMemoryRequest {
  userText: string;
  assistantText: string;
  sourceId: string;
  activity?: LearningActivityEntry;
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

export function updateLearningThreadFromTurn(
  thread: LearningThreadEntry,
  assistantText: string,
  progress?: DistilledLearningThreadProgress,
  updatedAt = new Date().toISOString(),
): LearningThreadEntry {
  const previous = toLearningActivityPreview(thread.lastSummary || '', 100);
  const current = toLearningActivityPreview(assistantText, 120);
  const fallbackSummary = previous && current
    ? `${previous}；本轮：${current}`
    : current || previous || thread.intent;
  return {
    ...thread,
    lastSummary: progress?.summary || fallbackSummary,
    nextStep: progress?.nextStep || thread.nextStep,
    updatedAt,
  };
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
    const threadInScope = activeIntent && activeThread?.status === 'active'
      ? input.activity
        ? attachLearningThreadActivityEvidence(activeThread, input.activity)
        : activeThread
      : undefined;
    const fallbackThread = threadInScope
      ? updateLearningThreadFromTurn(threadInScope, input.assistantText)
      : undefined;

    try {
      if (fallbackThread) await setActiveThread(fallbackThread);
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
          ...(threadInScope ? {
            activeThread: {
              title: threadInScope.title,
              intent: threadInScope.intent,
              outcome: threadInScope.outcome,
              lastSummary: threadInScope.lastSummary,
  