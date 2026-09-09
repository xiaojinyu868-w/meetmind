import { describe, expect, it } from 'vitest';
import { isPublicRoute } from '@/lib/utils/public-routes';

describe('Context credential handoff', () => {
  it('delegates v1 authentication while preserving other protected route boundaries', () => {
    expect(isPublicRoute('/api/context/v1/events')).toBe(true);
    expect(isPublicRoute('/api/context/v1/grants')).toBe(true);
    expect(isPublicRoute('/api/context/v10/events')).toBe(false);
    expect(isPublicRoute('/api/context/admin')).toBe(false);
    expect(isPublicRoute('/api/auth/learner-profile')).toBe(false);
  });
});
