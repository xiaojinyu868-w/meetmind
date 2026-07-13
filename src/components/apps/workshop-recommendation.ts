import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';

export interface WorkshopRecommendationSignals {
  activeAnchorCount: number;
  difficultyCount: number;
  segmentCount: number;
}

export interface WorkshopRecommendation {
  key: WorkshopAppKey;
  reason: string;
}

/**
 * 只使用用户能核对的课堂信号做首选排序，不推断学习风格或能力水平。
 */
export function recommendWorkshopApp(signals: WorkshopRecommendationSignals): WorkshopRecommendation {
  if (signals.activeAnchorCount > 0) {
    return {
      key: 'quiz',
      reason: COPY.apps.matrix.recommendedForConfusion(signals.activeAnchorCount),
    };
  }
  if (signals.difficultyCount > 0) {
    return {
      key: 'flashcards',
      reason: COPY.apps.matrix.recommendedForDifficulty(signals.difficultyCount),
    };
  }
  if (signals.segmentCount >= 24) {
    return { key: 'mindmap', reason: COPY.apps.matrix.recommendedForStructure };
  }
  return { key: 'cheatsheet', reason: COPY.apps.matrix.recommendedDefault };
}
