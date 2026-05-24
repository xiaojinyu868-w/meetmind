import { describe, expect, it } from 'vitest';
import { getCompanionMessagesPreferenceKey } from './classroom-companion-storage';

describe('getCompanionMessagesPreferenceKey', () => {
  it('scopes classroom companion history by session id', () => {
    expect(getCompanionMessagesPreferenceKey('lesson-abc')).toBe('classroom_companion_messages:lesson-abc');
    expect(getCompanionMessagesPreferenceKey('  lesson-abc  ')).toBe('classroom_companion_messages:lesson-abc');
  });

  it('uses a stable anonymous bucket when session id is missing', () => {
    expect(getCompanionMessagesPreferenceKey('')).toBe('classroom_companion_messages:anon');
    expect(getCompanionMessagesPreferenceKey(undefined)).toBe('classroom_companion_messages:anon');
  });
});
