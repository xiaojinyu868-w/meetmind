import { describe, expect, it } from 'vitest';
import { shouldExitDemoRecordingOnStop } from './ClassroomView.model';

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
