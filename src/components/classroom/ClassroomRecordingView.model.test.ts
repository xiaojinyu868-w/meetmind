import { describe, expect, it } from 'vitest';
import { cycleTranslationMode, resolveSessionTranslationMode } from './ClassroomRecordingView.model';

describe('cycleTranslationMode', () => {
  it('cycles off → en-zh → zh-en → off', () => {
    expect(cycleTranslationMode('off')).toBe('en-zh');
    expect(cycleTranslationMode('en-zh')).toBe('zh-en');
    expect(cycleTranslationMode('zh-en')).toBe('off');
  });
});

describe('resolveSessionTranslationMode', () => {
  it('defaults an English demo session to en-zh before the user touches the toggle', () => {
    expect(resolveSessionTranslationMode({
      userMode: 'off',
      sessionDefault: 'en-zh',
      userTouched: false,
    })).toBe('en-zh');
  });

  it('respects the user after they manually cycle the toggle', () => {
    expect(resolveSessionTranslationMode({
      userMode: 'off',
      sessionDefault: 'en-zh',
      userTouched: true,
    })).toBe('off');
  });
});
