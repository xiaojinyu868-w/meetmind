/**
 * Classroom 子模块 barrel export
 */

export { ClassroomLayout } from './ClassroomLayout';
export { ClassroomLeftPanel } from './ClassroomLeftPanel';
export { ClassroomCompanionPanel } from './ClassroomCompanionPanel';
export { ClassroomLessonCard } from './ClassroomLessonCard';
export { ClassroomRecordingView } from './ClassroomRecordingView';
export { MindMap } from './MindMap';
export type {
  Lesson,
  LessonStatus,
  ClassroomPaneState,
  CompanionMessage,
  CompanionMessageRole,
  CompanionCard,
} from './types';
export type { CompanionMode, ForesightBubble } from './ClassroomCompanionPanel';
export type { LiveConcept } from './ClassroomRecordingView';
export { DEMO_LESSONS, DEMO_COMPANION_MESSAGES } from './demoData';
export { composeFirstHello } from './composeFirstHello';
export type { ComposeHelloInput } from './composeFirstHello';
export { audioSessionToLesson } from './lessonAdapter';
export type { LessonExtras } from './lessonAdapter';
