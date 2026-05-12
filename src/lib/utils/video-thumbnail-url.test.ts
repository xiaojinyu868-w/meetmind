import { describe, expect, it } from 'vitest';
import { resolveVideoThumbnailUrl } from './video-thumbnail-url';

describe('resolveVideoThumbnailUrl', () => {
  it('proxies Bilibili hdslb thumbnails to avoid browser 403 hotlink blocks', () => {
    const url = 'https://i0.hdslb.com/bfs/archive/demo.jpg';
    expect(resolveVideoThumbnailUrl(url)).toBe(`/api/video/image?url=${encodeURIComponent(url)}`);
  });

  it('keeps non-Bilibili thumbnails unchanged', () => {
    const url = 'https://example.com/cover.jpg';
    expect(resolveVideoThumbnailUrl(url)).toBe(url);
  });
});
