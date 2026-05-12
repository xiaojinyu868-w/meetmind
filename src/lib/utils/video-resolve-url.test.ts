import { describe, expect, it } from 'vitest';
import { resolveLegacyVideoUrl } from './video-resolve-url';

describe('resolveLegacyVideoUrl', () => {
  it('returns a safe compatibility payload without fetching remote media', () => {
    const result = resolveLegacyVideoUrl('https://example.com/video.mp4');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedUrl).toBe('https://example.com/video.mp4');
      expect(result.playableUrl).toBe('https://example.com/video.mp4');
    }
  });

  it('rejects unsafe non-http URLs', () => {
    const result = resolveLegacyVideoUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });
});
