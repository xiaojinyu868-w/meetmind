import type { AppPlugin } from '../types';
import { studioWorkshopPlugin } from './studio-workshop.plugin';
import { flashcardsPlugin } from './flashcards.plugin';
import { quizPlugin } from './quiz.plugin';
import { mindmapPlugin } from './mindmap.plugin';
import { knowledgeCardsPlugin } from './knowledge-cards.plugin';
import { confusionDrillPlugin } from './confusion-drill.plugin';
import { reviewPlanPlugin } from './review-plan.plugin';
import { classCheckPlugin } from './class-check.plugin';
import { studyReportPlugin } from './study-report.plugin';
import { fallbackPlugin } from './fallback.plugin';

export const defaultPlugins: AppPlugin[] = [
  studioWorkshopPlugin,
  flashcardsPlugin,
  quizPlugin,
  mindmapPlugin,
  knowledgeCardsPlugin,
  confusionDrillPlugin,
  reviewPlanPlugin,
  classCheckPlugin,
  studyReportPlugin,
  fallbackPlugin,
];

export {
  studioWorkshopPlugin,
  flashcardsPlugin,
  quizPlugin,
  mindmapPlugin,
  knowledgeCardsPlugin,
  confusionDrillPlugin,
  reviewPlanPlugin,
  classCheckPlugin,
  studyReportPlugin,
  fallbackPlugin,
};
