import type { ClassroomPaneState } from './classroom';

export function resolveIsDemoSession(input: {
  autoLoadDemo: boolean;
  isRecording: boolean;
  isDemoLessonLoaded: boolean;
}): boolean {
  return input.autoLoadDemo || (!input.isRecording && input.isDemoLessonLoaded);
}

export function resolveClassroomPaneState(input: {
  autoLoadDemo: boolean;
  isRecording: boolean;
}): ClassroomPaneState {
  return input.isRecording || input.autoLoadDemo ? 'recording' : 'list';
}

export function shouldOpenDemoReviewOnStop(input: {
  autoLoadDemo: boolean;
  isRecording: boolean;
  paneState: ClassroomPaneState;
}): boolean {
  return input.autoLoadDemo && !input.isRecording && input.paneState === 'recording';
}

export function shouldShowClassroomCompanion(input: {
  paneState: ClassroomPaneState;
  isRecording: boolean;
  autoLoadDemo: boolean;
}): boolean {
  return input.isRecording || (input.autoLoadDemo && input.paneState === 'recording');
}
