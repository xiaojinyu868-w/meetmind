import { describe, expect, it } from 'vitest';
import {
  getTranslationRetryDelayMs,
  shouldSkipTranslationRequest,
  shouldSkipTranslationTerm,
} from './translation-retry-policy';

describe('translation retry policy', () => {
  it('backs off longer for 429 rate limit responses', () => {
    expect(getTranslationRetryDelayMs(429)).toBe(60_000);
  });

  it('backs off briefly for network errors and server errors', () => {
    expect(getTranslationRetryDelayMs(null)).toBe(8_000);
    expect(getTranslationRetryDelayMs(500)).toBe(12_000);
  });

  it('skips terms while they are in cooldown', () => {
    expect(shouldSkipTranslationTerm('hello', { hello: 2000 }, 1000)).toBe(true);
    expect(shouldSkipTranslationTerm('hello', { hello: 2000 }, 2500)).toBe(false);
    expect(shouldSkipTranslationTerm('world', { hello: 2000 }, 1000)).toBe(false);
  });

  it('skips all translation requests during a global cooldown', () => {
    expect(shouldSkipTranslationRequest(2000, 1000)).toBe(true);
    expect(shouldSkipTranslationRequest(2000, 2500)).toBe(false);
  });
});
