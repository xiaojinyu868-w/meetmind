import type { ClassroomPaneState } from './classroom';

export function shouldExitDemoRecordingOnStop(input: {
  autoLoadDemo: boolean;
  isRecording: boolean;
  paneState: ClassroomPaneState;
}): boolean {
  return input.autoLoadDemo && !input.isRecording && input.paneState === 'recording';
}
