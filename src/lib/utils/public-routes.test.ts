import { describe, expect, it } from 'vitest';
import { isPublicRoute } from './public-routes';

describe('isPublicRoute', () => {
  it('keeps /api/tutor/agent public for guest AI companion requests', () => {
    expect(isPublicRoute('/api/tutor/agent')).toBe(true);
  });

  it('keeps /api/feed public so guest local captures can produce a rate-limited feed', () => {
    expect(isPublicRoute('/api/feed')).toBe(true);
  });

  it('keeps classroom translation endpoints public for live transcript bubbles', () => {
    expect(isPublicRoute('/api/translate/en-zh')).toBe(true);
    expect(isPublicRoute('/api/translate/zh-en')).toBe(true);
  });

  it('keeps legacy video resolve public for old review-page bundles', () => {
    expect(isPublicRoute('/api/video/resolve')).toBe(true);
  });

  it('keeps video image proxy public for Bilibili thumbnails', () => {
    expect(isPublicRoute('/api/video/image')).toBe(true);
  });
});
