import { describe, expect, it } from 'vitest';
import {
  buildCollectionListItemFromSourceItem,
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

  it('restores the classroom clock anchor for a board photo', () => {
    const item = buildWorkspaceCaptureSourceItem({
      id: 'board-photo',
      sourceKey: 'image:board-photo',
      sourceType: 'image',
      status: 'active',
      role: 'support',
      contentType: 'image',
      title: '板书',
      previewText: '课堂板书',
      normalizedText: '课堂板书',
      mediaUrl: 'https://cdn.example.com/board.jpg',
      createdAt: '2026-07-16T08:02:02.000Z',
      metadata: {
        sessionId: 'session-classroom',
        capturedAtMs: 122_000,
      },
    });

    expect(item).toMatchObject({
      sessionId: 'session-classroom',
      capturedAtMs: 122_000,
    });
  });

  it('preserves a zero-second classroom photo anchor in local capture metadata', () => {
    const item = buildWorkspaceCaptureSourceItem({
      id: 'board-photo-zero',
      sourceKey: 'image:board-photo-zero',
      sourceType: 'image',
      status: 'active',
      role: 'support',
      contentType: 'image',
      title: '开场板书',
      previewText: '开场板书',
      normalizedText: '开场板书',
      mediaUrl: 'https://cdn.example.com/board-zero.jpg',
      createdAt: '2026-07-16T08:00:00.000Z',
      metadata: {
        sessionId: 'session-classroom',
        capturedAtMs: 0,
      },
    });

    expect(item.capturedAtMs).toBe(0);
    expect(buildCollectionListItemFromSourceItem(item).metadata).toMatchObject({
      sessionId: 'session-classroom',
      capturedAtMs: 0,
    });
  });
});
