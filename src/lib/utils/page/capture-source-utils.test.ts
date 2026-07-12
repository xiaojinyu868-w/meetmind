import { describe, expect, it } from 'vitest';
import {
  buildWechatCaptureSourceItem,
  buildWorkspaceCaptureSourceItem,
  resolvePendingAudioFailureStatus,
} from './capture-source-utils';

describe('resolvePendingAudioFailureStatus', () => {
  it('hides raw fetch failures behind a useful audio-preserved fallback', () => {
    expect(resolvePendingAudioFailureStatus('转写未完成： Failed to fetch')).toBe('网络不稳，原声已保留');
    expect(resolvePendingAudioFailureStatus('NetworkError: Failed to fetch')).toBe('网络不稳，原声已保留');
  });
});

describe('capture provenance restoration', () => {
  it('restores platform, author and completeness across devices', () => {
    const item = buildWorkspaceCaptureSourceItem({
      id: 'capture-1',
      sourceKey: 'import:1',
      sourceType: 'document',
      status: 'active',
      role: 'primary',
      contentType: 'document',
      title: '文章标题',
      previewText: '文章摘要',
      normalizedText: '文章正文'.repeat(80),
      sourceUrl: 'https://mp.weixin.qq.com/s/abc',
      mediaUrl: null,
      tutorContext: null,
      occurredAt: '2026-07-12T08:00:00.000Z',
      createdAt: '2026-07-12T08:00:00.000Z',
      metadata: {
        provenance: {
          ingressChannel: 'wechat',
          platformId: 'wechat-article',
          platformLabel: '微信公众号',
          author: '作者甲',
          contentState: 'complete',
          completeness: 1,
        },
      },
    });

    expect(item.provenance).toMatchObject({
      platformLabel: '微信公众号',
      author: '作者甲',
      contentState: 'complete',
    });
  });

  it('shows an honest failed state when WeChat extraction failed', () => {
    const item = buildWechatCaptureSourceItem({
      linkToken: 'token-1',
      msgType: 'link',
      sourceUrl: 'https://mp.weixin.qq.com/s/abc',
      status: 'failed',
    });
    expect(item.provenance?.contentState).toBe('failed');
  });
});
