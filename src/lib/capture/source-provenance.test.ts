import { describe, expect, it } from 'vitest';
import {
  buildSourceProvenance,
  canonicalizeSourceUrl,
  inferContentState,
  readSourceProvenance,
} from './source-provenance';

describe('source provenance', () => {
  it('canonicalizes tracking variants without removing WeChat article identity', () => {
    expect(canonicalizeSourceUrl('https://mp.weixin.qq.com/s/abc?__biz=x&utm_source=chat&scene=1&chksm=y#from'))
      .toBe('https://mp.weixin.qq.com/s/abc?__biz=x');
  });

  it('distinguishes complete, partial and link-only content honestly', () => {
    expect(inferContentState({ normalizedText: '完整正文'.repeat(80) })).toBe('complete');
    expect(inferContentState({ normalizedText: '只有摘要' })).toBe('partial');
    expect(inferContentState({ sourceUrl: 'https://example.com' })).toBe('link-only');
  });

  it('round-trips persisted provenance metadata', () => {
    const provenance = buildSourceProvenance({
      ingressChannel: 'wechat',
      sourceUrl: 'https://mp.weixin.qq.com/s/abc',
      normalizedText: '正文'.repeat(120),
      author: '作者甲',
      extractionMethod: 'direct',
      completeness: 0.9,
    });
    expect(readSourceProvenance({ provenance })).toEqual(provenance);
    expect(provenance.platformLabel).toBe('微信公众号');
  });
});
