import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deriveWechatInboxIntelligence } from '@/lib/services/wechat-inbox-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { downloadWechatImage, downloadWechatMedia } from '@/lib/services/wechat-media-service';
import {
  buildWechatTextReply,
  isWechatMpConfigured,
  normalizeWechatMpMessage,
  parseWechatMpXml,
  verifyWechatMpSignature,
} from '@/lib/services/wechat-mp-service';
import { enrichLinkContent } from '@/lib/services/jina-reader-service';

export const runtime = 'nodejs';

function xmlResponse(xml: string, status = 200): NextResponse {
  return new NextResponse(xml, {
    status,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function textResponse(text: string, status = 200): NextResponse {
  return new NextResponse(text, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function verifyRequest(request: NextRequest): { ok: boolean; error?: string } {
  const { searchParams } = new URL(request.url);
  const signature = searchParams.get('signature') || '';
  const timestamp = searchParams.get('timestamp') || '';
  const nonce = searchParams.get('nonce') || '';

  if (!verifyWechatMpSignature(signature, timestamp, nonce)) {
    return { ok: false, error: 'invalid signature' };
  }

  return { ok: true };
}

function getWechatH5BaseUrl(request: NextRequest): string {
  const explicitBase = process.env.WECHAT_MP_PUBLIC_BASE_URL?.trim();
  if (explicitBase) {
    return explicitBase.replace(/\/+$/, '');
  }

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3001';
  const protocol = request.headers.get('x-forwarded-proto') || 'http';
  return `${protocol}://${host}`;
}

function buildWechatEntryUrl(baseUrl: string, linkToken: string, isBound: boolean): string {
  if (isBound) {
    return `${baseUrl}/wechat/open/${linkToken}`;
  }
  return `${baseUrl}/wechat/capture/${linkToken}`;
}

function buildAckText(baseReply: string, captureUrl: string, isBound: boolean): string {
  if (isBound) {
    return `${baseReply}\n查看：${captureUrl}`;
  }
  return `${baseReply}\n查看这条收集：${captureUrl}\n首次使用？点上面的链接绑定你的账号，以后发来的内容都会自动进入收集流。`;
}

export async function GET(request: NextRequest) {
  if (!isWechatMpConfigured()) {
    return textResponse('wechat mp not configured', 503);
  }

  const verified = verifyRequest(request);
  if (!verified.ok) {
    return textResponse(verified.error || 'invalid signature', 403);
  }

  const { searchParams } = new URL(request.url);
  return textResponse(searchParams.get('echostr') || '');
}

export async function POST(request: NextRequest) {
  if (!isWechatMpConfigured()) {
    return textResponse('wechat mp not configured', 503);
  }

  const verified = verifyRequest(request);
  if (!verified.ok) {
    return textResponse(verified.error || 'invalid signature', 403);
  }

  const rawXml = await request.text();
  const payload = parseWechatMpXml(rawXml);
  const openId = payload.FromUserName?.trim() || '';
  const developerId = payload.ToUserName?.trim() || '';

  if (!openId || !developerId) {
    return textResponse('success');
  }

  const normalized = normalizeWechatMpMessage(payload);
  const intelligence = await deriveWechatInboxIntelligence(openId, normalized);
  const baseUrl = getWechatH5BaseUrl(request);

  try {
    if (normalized.messageId) {
      const existing = await prisma.wechatInboxMessage.findUnique({
        where: { messageId: normalized.messageId },
      });

      if (existing) {
        const captureUrl = buildWechatEntryUrl(baseUrl, existing.linkToken, existing.bindingStatus === 'bound');
        return xmlResponse(
          buildWechatTextReply(
            openId,
            developerId,
            buildAckText(existing.replyText || normalized.replyText || '已经收到了。', captureUrl, existing.bindingStatus === 'bound')
          )
        );
      }
    }

    const linkToken = randomBytes(16).toString('hex');
    await prisma.wechatInboxMessage.create({
      data: {
        linkToken,
        openId,
        userId: intelligence.userId,
        workspaceId: intelligence.workspaceId,
        developerId,
        msgType: normalized.msgType,
        eventType: normalized.eventType,
        messageId: normalized.messageId,
        messageAt: normalized.messageAt,
        rawXml,
        payloadJson: JSON.stringify(payload),
        normalizedText: normalized.normalizedText,
        previewText: normalized.previewText,
        sourceUrl: normalized.sourceUrl,
        mediaId: normalized.mediaId,
        mediaUrl: normalized.mediaUrl,
        title: normalized.title,
        reachKind: normalized.reach?.kind,
        reachChannel: normalized.reach?.channel,
        collectionRole: intelligence.collectionRole,
        bindingStatus: intelligence.bindingStatus,
        echoTitle: intelligence.echoTitle,
        echoBody: intelligence.echoBody,
        echoChipsJson: JSON.stringify(intelligence.echoChips),
        tutorContext: intelligence.tutorContext,
        replyText: normalized.replyText,
        processedAt: new Date(),
      },
    });

    if (intelligence.workspaceId) {
      await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken);
    }

    // 异步下载媒体到本地，不阻塞回执。
    void (async () => {
      try {
        let localMediaUrl: string | null = null;

        if (normalized.msgType === 'image' && normalized.mediaUrl) {
          localMediaUrl = await downloadWechatImage(normalized.mediaUrl, linkToken);
        } else if (normalized.msgType === 'voice' && normalized.mediaId) {
          localMediaUrl = await downloadWechatMedia(normalized.mediaId, linkToken, 'voice');
        }

        if (localMediaUrl) {
          await prisma.wechatInboxMessage.update({
            where: { linkToken },
            data: { mediaUrl: localMediaUrl },
          });
        }

        if (intelligence.workspaceId) {
          await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken, {
            hydrateVoice: normalized.msgType === 'voice',
          });
        }
      } catch (error) {
        console.error('[wechat-mp] async media download failed:', error);
      }
    })();

    // 异步抓取 web-link 正文（Jina Reader），不阻塞回执。
    if (normalized.reach?.channel === 'web-link' && normalized.sourceUrl) {
      void enrichLinkContent(linkToken);
    }

    const captureUrl = buildWechatEntryUrl(baseUrl, linkToken, intelligence.bindingStatus === 'bound');
    return xmlResponse(
      buildWechatTextReply(openId, developerId, buildAckText(normalized.replyText, captureUrl, intelligence.bindingStatus === 'bound'))
    );
  } catch (error) {
    console.error('wechat mp ingest failed:', error);
    return textResponse('server error', 500);
  }
}
