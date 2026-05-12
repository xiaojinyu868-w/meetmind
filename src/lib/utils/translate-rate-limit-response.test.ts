import { describe, expect, it } from 'vitest';
import { buildTranslateRateLimitedPayload } from './translate-rate-limit-response';

describe('buildTranslateRateLimitedPayload', () => {
  it('returns an empty translation map with a soft rateLimited flag', () => {
    expect(buildTranslateRateLimitedPayload()).toEqual({ translations: {}, rateLimited: true });
  });
});
