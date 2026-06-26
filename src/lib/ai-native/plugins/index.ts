import type { AppPlugin } from '../types';
import { studioWorkshopPlugin } from './studio-workshop.plugin';
import { flashcardsPlugin } from './flashcards.plugin';
import { quizPlugin } from './quiz.plugin';
import { mindmapPlugin } from './mindmap.plugin';
import { classCheckPlugin } from './class-check.plugin';
import { cheatsheetPlugin } from './cheatsheet.plugin';
import { fallbackPlugin } from './fallback.plugin';

export const defaultPlugins: AppPlugin[] = [
  studioWorkshopPlugin,
  flashcardsPlugin,
  quizPlugin,
  mindmapPlugin,
  classCheckPlugin,
  cheatsheetPlugin,
  fallbackPlugin,
];

export {
  studioWorkshopPlugin,
  flashcardsPlugin,
  quizPlugin,
  mindmapPlugin,
  classCheckPlugin,
  cheatsheetPlugin,
  fallbackPlugin,
};
