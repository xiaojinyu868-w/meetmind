import { describe, expect, it } from 'vitest';
import { shouldRetryInlineAppExecute } from './inline-app-retry';

describe('shouldRetryInlineAppExecute', () => {
  it('retries transient inline app failures before surfacing the error card', () => {
    expect(shouldRetryInlineAppExecute({ status: 500, attempt: 1, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryInlineAppExecute({ status: 429, attempt: 2, maxAttempts: 3 })).toBe(true);
    expect(shouldRetryInlineAppExecute({ status: null, attempt: 1, maxAttempts: 3 })).toBe(true);
  });

  it('does not retry validation failures or the final attempt', () => {
    expect(shouldRetryInlineAppExecute({ status: 400, attempt: 1, maxAttempts: 3 })).toBe(false);
    expect(shouldRetryInlineAppExecute({ status: 500, attempt: 3, maxAttempts: 3 })).toBe(false);
  });
});
