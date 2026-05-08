import { describe, expect, it } from 'vitest';
import { resolveBilibiliVideoIdentifiers } from './video-source';

describe('resolveBilibiliVideoIdentifiers', () => {
  it('extracts bvid and cid from player embed url when source.bvid is missing', () => {
    const ids = resolveBilibiliVideoIdentifiers({
      provider: 'bilibili',
      providerLabel: 'Bilibili',
      originalUrl: 'https://b23.tv/abc',
      embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1abcDEF123&cid=987654&page=1',
    });

    expect(ids.bvid).toBe('BV1abcDEF123');
    expect(ids.cid).toBe(987654);
  });

  it('prefers explicit source fields', () => {
    const ids = resolveBilibiliVideoIdentifiers({
      provider: 'bilibili',
      providerLabel: 'Bilibili',
      originalUrl: 'https://www.bilibili.com/video/BV1fromUrl999',
      bvid: 'BV1explicit777',
      cid: 123,
    });

    expect(ids.bvid).toBe('BV1explicit777');
    expect(ids.cid).toBe(123);
  });
});
