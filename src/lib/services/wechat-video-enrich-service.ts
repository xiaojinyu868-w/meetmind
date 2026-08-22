/**
 * wechat-video-enrich-service — 微信视频/播客链接的后台 enrichment 与转写管线
 *
 * 职责（从 /api/wechat/mp 路由拆出，路由只做接收与回执）：
 * - enrichVideoLinkMeta：异步拉链接元数据（B站短链解析 / 小宇宙 episode meta），
 *   更新 wechatInboxMessage + workspaceCapture，然后自动触发 /api/video/import 转写
 * - triggerVideoImportPipeline：调内部导入接口，把转写文本/segments 回写 workspaceCapture，
 *   返回结构化结果供调用方做通知与结算
 * - 转写完成后对「已绑定用户」发客服消息推送（成功/失败/重复），并按 userId 结算 ASR 分钟
 * - 小宇宙去重：同一 episode 已转写过就不再跑管线，直接推原收集链接
 *
 * 推送走 wechat-agent-service 的客服消息通道（48h 窗口外 45015 静默放弃）。
 */

import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import workspaceService from '@/lib/services/workspace-service';
import workspaceContextService from '@/lib/services/workspace-context-service';
import { resolveBilibiliUrl, fetchViewMeta } from '@/lib/services/bilibili-import-service';
import { fetchXiaoyuzhouEpisode, type XiaoyuzhouEpisodeMeta } from '@/lib/services/xiaoyuzhou-import-service';
import { pushWechatCustomerText } from '@/lib/services/wechat-agent-service';
import { getOrCreateWithGrants, settleAsrMinutes } from '@/lib/services/point-account-service';
import { parseVideoLink } from '@/lib/utils/video-link';
import { buildSourceProvenance } from '@/lib/capture/source-provenance';
import {
  syncWorkspaceCaptureEvidence,
  toLightweightEvidenceMetadata,
} from '@/lib/services/workspace-evidence-service';
import { COPY } from '@/lib/ui/copy';
import { createLogger } from '@/lib/logger';

const log = createLogger('wechat-video-enrich');

export interface VideoImportPipelineResult {
  ok: boolean;
  durationSec?: number;
  title?: string;
  segmentCount?: number;
  error?: string;
}

/** 导入来源平台标签映射：优先按 provider/sourceMode 映射，兜底用 providerLabel，最后「视频」 */
const IMPORT_PLATFORM_LABELS: Record<string, string> = {
  bilibili: '哔哩哔哩',
  'bili-subtitle': '哔哩哔哩',
  'bili-native': '哔哩哔哩',
  xiaoyuzhou: '小宇宙播客',
  youtube: 'YouTube',
  douyin: '抖音',
};

export function resolveImportPlatform(input: {
  sourceMode?: unknown;
  source?: { provider?: unknown; providerLabel?: unknown };
}): { platformId: string; platformLabel: string } {
  const provider = typeof input.source?.provider === 'string' ? input.source.provider : '';
  const sourceMode = typeof input.sourceMode === 'string' ? input.sourceMode : '';
  const providerLabel = typeof input.source?.providerLabel === 'string' ? input.source.providerLabel : '';
  return {
    platformId: provider || sourceMode || 'video',
    platformLabel:
      IMPORT_PLATFORM_LABELS[provider] ??
      IMPORT_PLATFORM_LABELS[sourceMode] ??
      (providerLabel || undefined) ??
      '视频',
  };
}

/** 小宇宙收集项标题：播客名 - 单集名（与 /api/video/import 的 displayTitle 一致） */
export function buildXiaoyuzhouDisplayTitle(meta: Pick<XiaoyuzhouEpisodeMeta, 'title' | 'podcastTitle'>): string {
  return meta.podcastTitle ? `${meta.podcastTitle} - ${meta.title}` : meta.title;
}

export function hasImportedVideo(metadataJson: string | null | undefined): boolean {
  if (!metadataJson) return false;
  try {
    return (JSON.parse(metadataJson) as { videoImported?: unknown }).videoImported === true;
  } catch {
    return false;
  }
}

/** 从候选收集里挑出「同一集且已转写过」的那条（排除本次消息自己的收集） */
export function pickDuplicateImport<T extends { sourceKey: string; metadataJson: string | null }>(
  candidates: T[],
  currentSourceKey: string,
): T | null {
  return candidates.find((c) => c.sourceKey !== currentSourceKey && hasImportedVideo(c.metadataJson)) ?? null;
}

function clipReason(reason: string, limit = 30): string {
  const normalized = reason.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

export function buildImportDonePushText(title: string, durationSec: number, url: string): string {
  const minutes = Math.max(1, Math.round(durationSec / 60));
  return `${COPY.wechatPodcast.importDone(title, minutes)}\n${COPY.wechatPodcast.importDoneCta} → ${url}`;
}

export function buildImportFailedPushText(reason?: string): string {
  return COPY.wechatPodcast.importFailed(reason ? clipReason(reason) : undefined);
}

export function buildDuplicatePushText(url: string): string {
  return `${COPY.wechatPodcast.duplicate}\n${url}`;
}

function resolveWechatBaseUrl(request?: NextRequest): string {
  const explicitBase = process.env.WECHAT_MP_PUBLIC_BASE_URL?.trim();
  if (explicitBase) return explicitBase.replace(/\/+$/, '');
  if (request) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    if (host) {
      const proto = request.headers.get('x-forwarded-proto') || 'http';
      return `${proto}://${host}`;
    }
  }
  return `http://localhost:${process.env.PORT || '3002'}`;
}

interface InboxBinding {
  openId: string;
  userId: string | null;
}

/** 已绑定用户的 userId：inbox 行上没有就按 openId 再解析一次（用户可能发完后才绑定） */
async function resolveBoundUserId(inbox: InboxBinding | null): Promise<string | undefined> {
  if (!inbox) return undefined;
  if (inbox.userId) return inbox.userId;
  const binding = await workspaceService.resolveWechatWorkspace(inbox.openId).catch(() => null);
  return binding?.userId;
}

async function pushToBoundUser(openId: string, text: string, tag: string): Promise<void> {
  const pushed = await pushWechatCustomerText(openId, text).catch((error) => {
    log.warn(`[wechat-mp] ${tag} push error:`, error);
    return false;
  });
  if (!pushed) {
    log.warn(`[wechat-mp] ${tag} push rejected (likely outside 48h window)`, { openId: openId.slice(0, 8) });
  }
}

/**
 * 管线结果收尾：已绑定用户才结算 + 推送；未绑定用户静默跳过。
 * - 成功：按 userId 结算 ASR 分钟（内部 fetch 走匿名影子流水，这里补真结算），再推完成通知
 * - 失败：推失败原因
 */
async function finalizeVideoImport(params: {
  linkToken: string;
  inbox: InboxBinding | null;
  result: VideoImportPipelineResult;
  metaDurationSec?: number;
  metaTitle?: string;
  request?: NextRequest;
}): Promise<void> {
  const { result } = params;
  const userId = await resolveBoundUserId(params.inbox);
  if (!userId || !params.inbox) return;

  if (result.ok) {
    const durationSec = params.metaDurationSec ?? result.durationSec ?? 0;
    if (durationSec > 0) {
      try {
        // settleAsrMinutes 不懒建账户——先落实账户与两档发放，再按绑定用户结算
        await getOrCreateWithGrants(userId);
        await settleAsrMinutes(userId, `video-import:wechat:${params.linkToken}`, durationSec / 60, 'asr:import');
      } catch (error) {
        log.warn(`[wechat-mp] settle asr minutes failed for ${params.linkToken}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const url = `${resolveWechatBaseUrl(params.request)}/wechat/open/${params.linkToken}`;
    const title = params.metaTitle || result.title || '这集内容';
    await pushToBoundUser(params.inbox.openId, buildImportDonePushText(title, durationSec, url), 'import-done');
  } else {
    await pushToBoundUser(params.inbox.openId, buildImportFailedPushText(result.error), 'import-failed');
  }
}

/**
 * 调用 /api/video/import 完成视频/播客转写，
 * 把转录文本（带时间戳的 segments）回写到 workspaceCapture 的 normalizedText 和 metadataJson。
 * 这样复习页和 AI Tutor 立即能拿到完整的内容上下文。
 *
 * 返回结构化结果：成功带时长/标题/段数，失败带原因——供调用方做客服推送与积分结算。
 */
export async function triggerVideoImportPipeline(
  linkToken: string,
  videoUrl: string,
  sourceKey: string,
  request?: NextRequest
): Promise<VideoImportPipelineResult> {
  try {
    const baseUrl = resolveWechatBaseUrl(request);

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
      const error = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
      log.warn(`[wechat-mp] video import pipeline failed for ${linkToken}:`, error);
      return { ok: false, error };
    }

    // 提取转录文本和 segments
    const segments = Array.isArray(payload.segments) ? payload.segments as Array<{
      id?: string; text?: string; startMs?: number; endMs?: number;
    }> : [];
    const fullText = typeof payload.text === 'string' ? payload.text : segments.map((s) => s.text || '').join('');
    // 导入侧显式标记的不完整结果（B 站部分下载放行 / ASR 部分结果采用）：provenance 如实记录
    const isPartialTranscript = payload.partial === true;
    const importCoverageRatio =
      typeof payload.coverageRatio === 'number' && Number.isFinite(payload.coverageRatio)
        ? payload.coverageRatio
        : undefined;
    const source = (payload.source || {}) as Record<string, unknown>;
    const platform = resolveImportPlatform({ sourceMode: payload.sourceMode, source });
    const result: VideoImportPipelineResult = {
      ok: true,
      durationSec:
        typeof source.durationSec === 'number' && source.durationSec > 0
          ? source.durationSec
          : typeof payload.totalDuration === 'number'
            ? payload.totalDuration / 1000
            : undefined,
      title: typeof source.title === 'string' ? source.title : undefined,
      segmentCount: segments.length,
    };

    if (!fullText.trim() && segments.length === 0) {
      log.warn(`[wechat-mp] video import returned empty transcript for ${linkToken}`);
      return { ok: false, error: '转写结果为空' };
    }

    // 回写到 workspaceCapture
    const capture = await prisma.workspaceCapture.findFirst({ where: { sourceKey } });
    if (capture) {
      let existingMeta: Record<string, unknown> = {};
      try {
        existingMeta = capture.metadataJson ? JSON.parse(capture.metadataJson) : {};
      } catch {
        existingMeta = {};
      }
      // 生成 sessionId 供前端直接进入复习态（不必再次调用 /api/video/import）
      const videoSessionId = existingMeta.sessionId || `video-import-${capture.id}-${Date.now()}`;
      const fullMetadata = {
        ...existingMeta,
        sessionId: videoSessionId,
        videoImported: true,
        audioUrl: source.audioUrl,
        // 原始 CDN 音频地址（小宇宙 m4a）：本服副本万一被清理时的兜底，也可用于重转写
        ...(typeof source.originAudioUrl === 'string' && source.originAudioUrl
          ? { originAudioUrl: source.originAudioUrl }
          : {}),
        sourceMode: payload.sourceMode || source.sourceMode,
        importMode: payload.mode,
        segmentCount: segments.length,
        // 全量分段：100 分钟播客约 1200+ 句级分段，截断会永久丢失服务端证据
        transcriptSegments: segments.map((s) => ({
          id: s.id,
          text: s.text,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
        provenance: buildSourceProvenance({
          ingressChannel: 'wechat' as const,
          sourceUrl: videoUrl,
          normalizedText: fullText,
          platformId: platform.platformId,
          platformLabel: platform.platformLabel,
          extractionMethod: 'video-transcript',
          contentState: isPartialTranscript ? 'partial' : 'complete',
          completeness: isPartialTranscript ? importCoverageRatio : 1,
        }),
      };
      await prisma.workspaceCapture.update({
        where: { id: capture.id },
        data: {
          // 转写完成即把「播客名 - 单集名」写成正式标题，替换收集时的占位标题
          ...(result.title ? { title: result.title.slice(0, 80) } : {}),
          normalizedText: fullText.slice(0, 200000), // 长播客全文留存（约 6 小时音频上限）
          tutorContext: fullText.slice(0, 8000),      // AI Tutor 用的上下文
          previewText: fullText.slice(0, 500),
          metadataJson: JSON.stringify(fullMetadata),
        },
      });

      const evidenceAvailable = await syncWorkspaceCaptureEvidence({
        captureId: capture.id,
        metadata: fullMetadata,
        normalizedText: fullText.slice(0, 200000),
      });
      await prisma.workspaceCapture.update({
        where: { id: capture.id },
        data: {
          metadataJson: JSON.stringify(toLightweightEvidenceMetadata({
            ...fullMetadata,
            ...(evidenceAvailable ? { evidenceAvailable: true } : {}),
          })),
        },
      });
    }

    return result;
  } catch (error) {
    // 转写是增强能力，不影响基础收集——但要把原因带回去给推送
    log.error(`[wechat-mp] triggerVideoImportPipeline failed for ${linkToken}:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 小宇宙分支：同一集已转写过就直接推原收集链接，不再触发管线 */
async function findDuplicateXiaoyuzhouImport(
  canonicalEpisodeUrl: string,
  currentSourceKey: string,
  boundUserId?: string,
): Promise<{ sourceKey: string; title: string } | null> {
  const candidates = await prisma.workspaceCapture.findMany({
    where: {
      sourceUrl: canonicalEpisodeUrl,
      metadataJson: { contains: '"videoImported":true' },
      ...(boundUserId ? { userId: boundUserId } : {}),
    },
    select: { sourceKey: true, title: true, metadataJson: true },
  });
  return pickDuplicateImport(candidates, currentSourceKey);
}

/**
 * 异步获取视频/播客链接的元数据（短链解析 + 标题/封面/时长），
 * 然后自动触发完整的转写管线（/api/video/import），
 * 把字幕/转录文本回写到 workspaceCapture，以便复习页和 AI Tutor 有内容可用。
 *
 * 不阻塞微信回执。如果任何阶段失败则静默跳过——消息本身已经入库。
 */
export async function enrichVideoLinkMeta(linkToken: string, sourceUrl: string, request?: NextRequest): Promise<void> {
  try {
    await prisma.wechatInboxMessage.update({ where: { linkToken }, data: { status: 'processing' } });
    const parsed = parseVideoLink(sourceUrl);
    if (!parsed || parsed.provider === 'generic') return;

    const inbox = await prisma.wechatInboxMessage.findUnique({
      where: { linkToken },
      select: { openId: true, userId: true },
    });
    const sourceKey = `wechat:${linkToken}`;

    if (parsed.provider === 'bilibili') {
      const resolved = await resolveBilibiliUrl(sourceUrl);
      const meta = await fetchViewMeta(resolved.bvid, resolved.page);

      // 更新 wechatInboxMessage：补充解析后的 URL 和标题
      await prisma.wechatInboxMessage.update({
        where: { linkToken },
        data: {
          sourceUrl: resolved.resolvedUrl,
          title: meta.title || undefined,
          status: 'ready',
        },
      });

      // 更新 workspaceCapture：补充标题、封面、时长
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
              provenance: buildSourceProvenance({
                ingressChannel: 'wechat',
                sourceUrl: resolved.resolvedUrl,
                normalizedText: existing.normalizedText,
                platformId: 'bilibili',
                platformLabel: '哔哩哔哩',
                contentState: existing.normalizedText ? 'partial' : 'link-only',
              }),
            }),
          },
        });
      }

      // ── 阶段 2：触发完整视频转写管线 ──
      const result = await triggerVideoImportPipeline(linkToken, resolved.resolvedUrl, sourceKey, request);
      await finalizeVideoImport({
        linkToken,
        inbox,
        result,
        metaDurationSec: meta.durationSec || undefined,
        metaTitle: meta.title || undefined,
        request,
      });
      return;
    }

    if (parsed.provider === 'xiaoyuzhou') {
      // 规整成 canonical episode URL，去重和 capture.sourceUrl 都以它为准
      const canonicalEpisodeUrl = parsed.videoId
        ? `https://www.xiaoyuzhoufm.com/episode/${parsed.videoId}`
        : sourceUrl.trim();

      const boundUserId = await resolveBoundUserId(inbox);

      // 去重：同一集已经转写过（同用户优先），不再跑管线，直接推原收集
      const duplicate = await findDuplicateXiaoyuzhouImport(canonicalEpisodeUrl, sourceKey, boundUserId);
      if (duplicate) {
        await prisma.wechatInboxMessage.update({
          where: { linkToken },
          data: { title: duplicate.title || undefined, status: 'ready' },
        });
        if (inbox && boundUserId) {
          const originalToken = duplicate.sourceKey.replace(/^wechat:/, '');
          const url = `${resolveWechatBaseUrl(request)}/wechat/open/${originalToken}`;
          await pushToBoundUser(inbox.openId, buildDuplicatePushText(url), 'duplicate');
        }
        return;
      }

      const meta = await fetchXiaoyuzhouEpisode(canonicalEpisodeUrl);
      const displayTitle = buildXiaoyuzhouDisplayTitle(meta);

      await prisma.wechatInboxMessage.update({
        where: { linkToken },
        data: {
          sourceUrl: canonicalEpisodeUrl,
          title: displayTitle,
          status: 'ready',
        },
      });

      const existing = await prisma.workspaceCapture.findFirst({
        where: { sourceKey },
      });

      if (existing) {
        let existingMeta: Record<string, unknown> = {};
        try {
          existingMeta = existing.metadataJson ? JSON.parse(existing.metadataJson) : {};
        } catch {
          existingMeta = {};
        }
        await prisma.workspaceCapture.update({
          where: { id: existing.id },
          data: {
            title: displayTitle || existing.title,
            sourceUrl: canonicalEpisodeUrl,
            previewText: `播客：${displayTitle}`,
            metadataJson: JSON.stringify({
              ...existingMeta,
              thumbnailUrl: meta.coverUrl,
              durationSec: meta.durationSec,
              audioUrl: meta.audioUrl,
              videoProvider: 'xiaoyuzhou',
              provenance: buildSourceProvenance({
                ingressChannel: 'wechat',
                sourceUrl: canonicalEpisodeUrl,
                normalizedText: existing.normalizedText,
                platformId: 'xiaoyuzhou',
                platformLabel: '小宇宙播客',
                contentState: existing.normalizedText ? 'partial' : 'link-only',
              }),
            }),
          },
        });
      }

      // ── 阶段 2：触发完整播客转写管线 ──
      const result = await triggerVideoImportPipeline(linkToken, canonicalEpisodeUrl, sourceKey, request);
      await finalizeVideoImport({
        linkToken,
        inbox,
        result,
        metaDurationSec: meta.durationSec || undefined,
        metaTitle: displayTitle,
        request,
      });
      return;
    }
    // 后续可以扩展 YouTube、Douyin 等
  } catch (error) {
    await prisma.wechatInboxMessage.update({ where: { linkToken }, data: { status: 'failed' } }).catch(() => undefined);
    await workspaceContextService.syncWechatInboxMessageArtifacts(linkToken).catch(() => undefined);
    log.error(`[wechat-mp] enrichVideoLinkMeta failed for ${linkToken}:`, error);
  }
}
