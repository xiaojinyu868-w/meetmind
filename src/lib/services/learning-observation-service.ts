import { getContextConfig } from '@/lib/config/context';
import type { LearningEventInput } from '@/types/learning-event';
import { appendLearningEvent, triggerLearningEventProcessing } from './learning-event-service';
import { appendEducationObservation } from './context/education-adapter';

/** Await durable acceptance; model processing remains outside the learning flow. */
export async function recordLearningObservation(userId: string, input: LearningEventInput): Promise<void> {
  if (getContextConfig().enabled) {
    await appendEducationObservation(userId, input);
    return;
  }
  const event = await appendLearningEvent(userId, input);
  if (event) void triggerLearningEventProcessing(event);
}
