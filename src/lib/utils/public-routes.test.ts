import { describe, expect, it } from 'vitest';
import { isPublicRoute } from './public-routes';

describe('isPublicRoute', () => {
  it('keeps /api/tutor/agent public for guest AI companion requests', () => {
    expect(isPublicRoute('/api/tutor/agent')).toBe(true);
  });

  it('keeps classroom translation endpoints public for live transcript bubbles', () => {
    expect(isPublicRoute('/api/translate/en-zh')).toBe(true);
    expect(isPublicRoute('/api/translate/zh-en')).toBe(true);
  });
});
