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

  it('keeps only the server capture pointer needed for lazy classroom evidence', () => {
    const item = buildWorkspaceCaptureSourceItem({
      id: 'capture-classroom',
      sourceKey: 'live:classroom',
      sourceType: 'live-audio',
      status: 'active',
      role: 'primary',
      contentType: 'audio',
      title: '量子力学课堂',
      previewText: '今天讨论波函数。',
      normalizedText: '今天讨论波函数。',
      mediaUrl: 'https://cdn.example.com/class.webm',
      createdAt: '2026-07-16T08:00:00.000Z',
      metadata: {
        sessionId: 'session-classroom',
        evidenceAvailable: true,
      },
    });

    expect(item).toMatchObject({
      workspaceCaptureId: 'capture-classroom',
      sessionId: 'session-classroom',
      evidenceAvailable: true,
      reviewable: true,
    });
    expect(item.serverTranscriptSegments).toBeUndefined();
  });

  it('keeps old localSessionId captures openable after background backfill', () => {
    const item = buildWorkspaceCaptureSourceItem({
      id: 'legacy-capture',
      sourceKey: 'legacy:classroom',
      sourceType: 'recording',
      status: 'active',
      role: 'primary',
      contentType: 'audio',
      title: '旧课堂',
      previewText: '旧课堂转录',
      normalizedText: '旧课堂转录',
      createdAt: '2026-07-16T08:00:00.000Z',
      metadata: { localSessionId: 'legacy-session' },
    });

    expect(item.sessionId).toBe('legacy-session');
  });
});
