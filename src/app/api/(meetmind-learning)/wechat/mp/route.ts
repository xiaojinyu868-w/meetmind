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
import { resolveBilibiliUrl, fetchViewMeta } from '@/lib/services/bilibili-import-service';
import { parseVideoLink } from '@/lib/utils/video-link';
import { createLogger } from '@/lib/logger';
const log = createLogger('wechat/mp');


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

/**
 * 异步获取视频链接的元数据（短链解析 + 标题/封面/时长），
 * 然后自动触发完整的视频转写管线（/api/video/import），
 * 把字幕/转录文本回写到 workspaceCapture，以便复习页和 AI Tutor 有内容可用。
 *
 * 不阻塞微信回执。如果任何阶段失败则静默跳过——消息本身已经入库。
 */
async function enrichVideoLinkMeta(linkToken: string, sourceUrl: string, request?: NextRequest): Promise<void> {
  try {
    const parsed = parseVideoLink(sourceUrl);
    if (!parsed || parsed.provider === 'generic') return;

    if (parsed.provider === 'bilibili') {
      const resolved = await resolveBilibiliUrl(sourceUrl);
      const meta = await fetchViewMeta(resolved.bvid, resolved.page);

      // 更新 wechatInboxMessage：补充解析后的 URL 和标题
      await prisma.wechatInboxMessage.update({
        where: { linkToken },
        data: {
          sourceUrl: resolved.resolvedUrl,
          title: meta.title || undefined,
        },
      });

      // 更新 workspaceCapture：补充标题、封面、时长
      const sourceKey = `wechat:${linkToken}`;
      const existing = await prisma.workspaceCapture.findFirst({
        where: { sourceKey },
      });

      if (existing) {
        const existingMeta = existing.metadataJson ? JSON.parse(existing.metadataJson) : {};
        await prisma.workspaceCapture.update({
          where: { id: existing.id },
          data: {
            title: meta.title || existing.title,
            sourceUrl: resolved.resolvedUrl,
            previewText: meta.title ? `视频：${meta.title}` : existing.previewText,
            metadataJson: JSON.stringify({
              ...existingMeta,
              bvid: resolved.bvid,
              embedUrl: resolved.embedUrl,
              thumbnailUrl: meta.thumbnailUrl,
              durationSec: meta.durationSec,
              videoProvider: 'bilibili',
            }),
          },
        });
      }

      // ── 阶段 2：触发完整视频转写管线 ──
      await triggerVideoImportPipeline(linkToken, resolved.resolvedUrl, sourceKey, request);
    }
    // 后续可以扩展 YouTube、Douyin 等
  } catch (error) {
    log.error(`[wechat-mp] enrichVideoLinkMeta failed for ${linkToken}:`, error);
  }
}

/**
 * 调用 /api/video/import 完成视频转写，
 * 把转录文本（带时间戳的 segments）回写到 workspaceCapture 的 normalizedText 和 metadataJson。
 * 这样复习页和 AI Tutor 立即能拿到完整的视频内容上下文。
 */
async function triggerVideoImportPipeline(
  linkToken: string,
  videoUrl: string,
  sourceKey: string,
  request?: NextRequest
): Promise<void> {
  try {

    // 构造内部请求调用 /api/video/import
    const baseUrl = request
      ? (() => {
          const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3002';
          const proto = request.headers.get('x-forwarded-proto') || 'http';
          return `${proto}://${host}`;
        })()
      : `http://localhost:${process.env.PORT || '3002'}`;

    const response = await fetch(`${baseUrl}/api/video/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: videoUrl,
        mode: 'turbo',
        language: 'zh',
      }),
    });

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;

    if (!response.ok || !payload.success) {
      log.warn(`[wechat-mp] video import pipeline failed for ${linkToken}:`, payload.error || `HTTP ${response.status}`);
      return;
    }

    // 提取转录文本和 segments
    const segments = Array.isArray(payload.segments) ? payload.segments as Array<{
      id?: string; text?: string; startMs?: number; endMs?: number;
    }> : [];
    const fullText = typeof payload.text === 'string' ? payload.text : segments.map((s) => s.text || '').join('');
    const source = (payload.source || {}) as Record<string, unknown>;

    if (!fullText.trim() && segments.length === 0) {
      log.warn(`[wechat-mp] video import returned empty transcript for ${linkToken}`);
      return;
    }

    // 回写到 workspaceCapture
    const capture = await prisma.workspaceCapture.findFirst({ where: { sourceKey } });
    if (capture) {
      const existingMeta = capture.metadataJson ? JSON.parse(capture.metadataJson) : {};
      // 生成 sessionId 供前端直接进入复习态（不必再次调用 /api/video/import）
      const videoSessionId = existingMeta.sessionId || `video-import-${capture.id}-${Date.now()}`;
      await prisma.workspaceCapture.update({
        where: { id: capture.id },
        data: {
          normalizedText: fullText.slice(0, 50000),  // 防止超大
          tutorContext: fullText.slice(0, 8000),      // AI Tutor 用的上下文
          previewText: fullText.slice(0, 500),
          metadataJson: JSON.stringify({
            ...existingMeta,
            sessionId: videoSessionId,
            videoImported: true,
            audioUrl: source.audioUrl,
            sourceMode: payload.sourceMode || source.sourceMode,
            importMode: payload.mode,
            segmentCount: segments.length,
            transcriptSegments: segments.slice(0, 500).map((s) => ({
              id: s.id,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            })),
          }),
        },
      });

    }
  } catch (error) {
    // 静默失败——视频转写是增强能力，不影响基础收集
    log.error(`[wechat-mp] triggerVideoImportPipeline failed for ${linkToken}:`, error);
  }
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
        log.error('[wechat-mp] async media download failed:', error);
      }
    })();

    // 异步抓取 web-link 正文（Jina Reader），不阻塞回执。
    if (normalized.reach?.channel === 'web-link' && normalized.sourceUrl) {
      void enrichLinkContent(linkToken);
    }

    // 异步获取 video-link 元数据（解析短链 + 标题/封面/时长）+ 完整视频转写，不阻塞回执。
    if (normalized.reach?.channel === 'video-link' && normalized.sourceUrl) {
      void enrichVideoLinkMeta(linkToken, normalized.sourceUrl, request);
    }

    const captureUrl = buildWechatEntryUrl(baseUrl, linkToken, intelligence.bindingStatus === 'bound');
    return xmlResponse(
      buildWechatTextReply(openId, developerId, buildAckText(normalized.replyText, captureUrl, intelligence.bindingStatus === 'bound'))
    );
  } catch (error) {
    log.error('wechat mp ingest failed:', error);
    return textResponse('server error', 500);
  }
}
