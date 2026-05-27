import type { ClassroomPaneState } from './classroom';

export function shouldExitDemoRecordingOnStop(input: {
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
