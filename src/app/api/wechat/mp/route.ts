import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { deriveWechatInboxIntelligence } from '@/lib/services/wechat-inbox-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import {
  buildWechatTextReply,
  isWechatMpConfigured,
  normalizeWechatMpMessage,
  parseWechatMpXml,
  verifyWechatMpSignature,
} from '@/lib/services/wechat-mp-service';

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

function buildAckText(baseReply: string, captureUrl: string): string {
  return `${baseReply}\n查看这条收集：${captureUrl}\n如果要补 PDF、课件或更多材料，点进去继续。`;
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
        const captureUrl = `${baseUrl}/wechat/capture/${existing.linkToken}`;
        return xmlResponse(
          buildWechatTextReply(
            openId,
            developerId,
            buildAckText(existing.replyText || normalized.replyText || '已经收到。', captureUrl)
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

    const captureUrl = `${baseUrl}/wechat/capture/${linkToken}`;
    return xmlResponse(
      buildWechatTextReply(openId, developerId, buildAckText(normalized.replyText, captureUrl))
    );
  } catch (error) {
    console.error('wechat mp ingest failed:', error);
    return textResponse('server error', 500);
  }
}
