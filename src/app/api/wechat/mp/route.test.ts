import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  derive: vi.fn(),
  markScanned: vi.fn(async () => ({ accepted: true, mode: 'login' as const })),
  inboxFind: vi.fn(),
  inboxCreate: vi.fn(),
  inboxUpdate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    wechatInboxMessage: {
      findUnique: mocks.inboxFind,
      create: mocks.inboxCreate,
      update: mocks.inboxUpdate,
    },
  },
}));
vi.mock('@/lib/services/wechat-inbox-service', () => ({ deriveWechatInboxIntelligence: mocks.derive }));
vi.mock('@/lib/services/workspace-context-service', () => ({
  default: {
    syncWechatInboxMessageArtifacts: vi.fn(),
    syncWechatInboxArtifactsForOpenId: vi.fn(),
  },
}));
vi.mock('@/lib/services/wechat-media-service', () => ({
  downloadWechatImage: vi.fn(),
  downloadWechatMedia: vi.fn(),
}));
vi.mock('@/lib/services/wechat-mp-service', () => ({
  buildWechatTextReply: vi.fn((_to: string, _from: string, text: string) => `<xml>${text}</xml>`),
  isWechatMpConfigured: vi.fn(() => true),
  normalizeWechatMpMessage: vi.fn(),
  parseWechatMpXml: vi.fn(() => ({
    MsgType: 'event',
    Event: 'SCAN',
    EventKey: 'mm_auth_scene-1',
    FromUserName: 'wx-open-id',
    ToUserName: 'official-account',
  })),
  verifyWechatMpSignature: vi.fn(() => true),
}));
vi.mock('@/lib/services/wechat-qr-auth-runtime', () => ({
  wechatQrAuthRuntime: { markScanned: mocks.markScanned },
}));
vi.mock('@/lib/services/jina-reader-service', () => ({
  enrichLinkContent: vi.fn(),
  enrichArticleLinkContent: vi.fn(),
}));
vi.mock('@/lib/services/bilibili-import-service', () => ({
  resolveBilibiliUrl: vi.fn(),
  fetchViewMeta: vi.fn(),
}));
vi.mock('@/lib/utils/video-link', () => ({ parseVideoLink: vi.fn() }));
vi.mock('@/lib/capture/source-provenance', () => ({ buildSourceProvenance: vi.fn() }));
vi.mock('@/lib/services/workspace-evidence-service', () => ({
  syncWorkspaceCaptureEvidence: vi.fn(),
  toLightweightEvidenceMetadata: vi.fn(),
}));

import { POST } from './route';

describe('/api/wechat/mp QR auth event', () => {
  it('updates the authentication challenge and never writes the scan into the capture inbox', async () => {
    const request = new NextRequest(
      'http://localhost/api/wechat/mp?signature=ok&timestamp=1&nonce=2',
      { method: 'POST', body: '<xml />' },
    );

    const response = await POST(request);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.markScanned).toHaveBeenCalledWith({
      scene: 'mm_auth_scene-1',
      openId: 'wx-open-id',
    });
    expect(body).toContain('已确认，请回到电脑继续。');
    expect(mocks.derive).not.toHaveBeenCalled();
    expect(mocks.inboxFind).not.toHaveBeenCalled();
    expect(mocks.inboxCreate).not.toHaveBeenCalled();
  });
});
