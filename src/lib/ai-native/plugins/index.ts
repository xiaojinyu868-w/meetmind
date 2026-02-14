import type { AppPlugin } from '../types';
import { knowledgeCardsPlugin } from './knowledge-cards.plugin';
import { gapFillPlugin } from './gap-fill.plugin';
import { confusionDrillPlugin } from './confusion-drill.plugin';
import { reviewPlanPlugin } from './review-plan.plugin';
import { fallbackPlugin } from './fallback.plugin';

export const defaultPlugins: AppPlugin[] = [
  knowledgeCardsPlugin,
  gapFillPlugin,
  confusionDrillPlugin,
  reviewPlanPlugin,
  fallbackPlugin,
];

export {
  knowledgeCardsPlugin,
  gapFillPlugin,
  confusionDrillPlugin,
  reviewPlanPlugin,
  fallbackPlugin,
};
