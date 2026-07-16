'use client';

import { useCallback, useState } from 'react';
import type {
  LearningIntentAnswer,
  LearningIntentPlan,
} from '@/types/learning-intent';

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

export function shouldAutoStartLearningIntent(
  plan: LearningIntentPlan,
  hasAnswers = false,
): boolean {
  if (hasAnswers) return true;
  return plan.confidence === 'high' && !plan.questions?.length;
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
