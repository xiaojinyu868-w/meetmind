import { describe, expect, it } from 'vitest';
import { shouldExitDemoRecordingOnStop, shouldShowClassroomCompanion } from './ClassroomView.model';

describe('shouldExitDemoRecordingOnStop', () => {
  it('treats stopping a guest demo recording pane as exiting demo, not stale database cleanup', () => {
    expect(shouldExitDemoRecordingOnStop({
      autoLoadDemo: true,
      isRecording: false,
      paneState: 'recording',
    })).toBe(true);
  });

  it('does not intercept real recording stop', () => {
    expect(shouldExitDemoRecordingOnStop({
      autoLoadDemo: true,
      isRecording: true,
      paneState: 'recording',
    })).toBe(false);
  });
});

describe('shouldShowClassroomCompanion', () => {
  it('hides the companion in the empty classroom list state', () => {
    expect(shouldShowClassroomCompanion({
      autoLoadDemo: false,
      isRecording: false,
      paneState: 'list',
    })).toBe(false);
  });

  it('shows the companion while a real class is being recorded', () => {
    expect(shouldShowClassroomCompanion({
      autoLoadDemo: false,
      isRecording: true,
      paneState: 'recording',
    })).toBe(true);
  });

  it('shows the companion while a demo class is playing as a recording pane', () => {
    expect(shouldShowClassroomCompanion({
      autoLoadDemo: true,
      isRecording: false,
      paneState: 'recording',
    })).toBe(true);
  });
});
