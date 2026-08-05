'use client';

import { useCallback, useState } from 'react';
import type {
  LearningIntentAnswer,
  LearningIntentPlan,
} from '@/types/learning-intent';
import type { LearningThreadEntry } from '@/types/user';

interface LearningIntentContext {
  learnerContext?: string;
  recentContext?: string;
  activeContext?: string;
}

interface RequestLearningIntentInput extends LearningIntentContext {
  query: string;
  answers?: LearningIntentAnswer[];
}

interface LearningIntentResponse {
  ok?: boolean;
  plan?: LearningIntentPlan;
}

export function createLearningThread(
  plan: LearningIntentPlan,
  query: string,
  conversationId?: string,
  sessionId?: string,
): LearningThreadEntry {
  const now = new Date().toISOString();
  return {
    id: `thread-${crypto.randomUUID()}`,
    title: plan.title,
    intent: query,
    outcome: plan.outcome,
    depth: 'deep',
    status: 'active',
    nextStep: plan.checkpoints[0],
    conversationId,
    sessionId,
    relatedSessionIds: sessionId ? [sessionId] : undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function learningThreadToIntent(thread: LearningThreadEntry): LearningIntentPlan {
  return {
    title: thread.title,
    outcome: thread.outcome || thread.lastSummary || thread.intent,
    approach: 'understand',
    contextFocus: 'mixed',
    checkpoints: thread.nextStep ? [thread.nextStep] : [],
    confidence: 'high',
  };
}

export function withConfirmedLearningIntent<T extends { global: Record<string, unknown> }>(
  context: T,
  plan: LearningIntentPlan,
): T {
  return {
    ...context,
    global: {
      ...context.global,
      depth: 'deep',
      intent: {
        title: plan.title,
        outcome: plan.outcome,
        approach: plan.approach,
        checkpoints: plan.checkpoints,
      },
    },
  };
}

export function shouldAutoStartLearningIntent(
  plan: LearningIntentPlan,
): boolean {
  return !plan.questions?.length;
}

export function useLearningIntentFlow() {
  const [busy, setBusy] = useState(false);

  const requestIntent = useCallback(async ({
    query,
    learnerContext,
    recentContext,
    activeContext,
    answers,
  }: RequestLearningIntentInput): Promise<LearningIntentPlan> => {
    setBusy(true);
    try {
      const response = await fetch('/api/tutor/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          learnerContext,
          recentContext,
          activeContext,
          ...(answers?.length ? { answers } : {}),
        }),
      });
      const payload = await response.json() as LearningIntentResponse;
      if (!response.ok || !payload.plan) throw new Error('intent unavailable');
      return payload.plan;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, requestIntent };
}
