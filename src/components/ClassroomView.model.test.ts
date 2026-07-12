import { describe, expect, it } from 'vitest';
import {
  resolveClassroomPaneState,
  resolveIsDemoSession,
  shouldExitDemoRecordingOnStop,
  shouldShowClassroomCompanion,
} from './ClassroomView.model';

describe('resolveIsDemoSession', () => {
  it('recognizes both URL-driven and manually loaded demo lessons', () => {
    expect(resolveIsDemoSession({
      autoLoadDemo: true,
      isRecording: false,
      isDemoLessonLoaded: false,
    })).toBe(true);
    expect(resolveIsDemoSession({
      autoLoadDemo: false,
      isRecording: false,
      isDemoLessonLoaded: true,
    })).toBe(true);
  });

  it('does not mistake a real recording for demo when fixture data is stale', () => {
    expect(resolveIsDemoSession({
      autoLoadDemo: false,
      isRecording: true,
      isDemoLessonLoaded: true,
    })).toBe(false);
  });
});

describe('resolveClassroomPaneState', () => {
  it('opens the recording pane for an explicit guest demo entry', () => {
    expect(resolveClassroomPaneState({ autoLoadDemo: true, isRecording: false })).toBe('recording');
  });

  it('opens the recording pane for a real recording', () => {
    expect(resolveClassroomPaneState({ autoLoadDemo: false, isRecording: true })).toBe('recording');
  });

  it('keeps an empty classroom in the lesson list', () => {
    expect(resolveClassroomPaneState({ autoLoadDemo: false, isRecording: false })).toBe('list');
  });
});

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
