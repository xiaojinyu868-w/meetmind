import { describe, expect, it } from 'vitest';
import { shouldApplyTranscriptToActiveSession } from './session-isolation';

describe('shouldApplyTranscriptToActiveSession', () => {
  it('rejects results that do not identify their lesson', () => {
    expect(shouldApplyTranscriptToActiveSession(undefined, 'session-new')).toBe(false);
  });

  it('accepts a final pass for the lesson that is still active', () => {
    expect(shouldApplyTranscriptToActiveSession('session-new', 'session-new')).toBe(true);
  });

  it('rejects a late final pass from the previous lesson', () => {
    expect(shouldApplyTranscriptToActiveSession('session-old', 'session-new')).toBe(false);
  });

  it('does not apply a result when there is no active lesson', () => {
    expect(shouldApplyTranscriptToActiveSession('session-old', '')).toBe(false);
  });
});
