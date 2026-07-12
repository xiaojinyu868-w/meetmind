/**
 * Workspace Context Service — 收集/回声的 CRUD 管线
 *
 * 子模块：
 *   workspace-context-types.ts — 类型定义 + 纯工具函数 + 微信 helper
 */

import fs from 'fs/promises';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { detectLinkProvider } from '@/lib/context-reach/link-provider';
import { qwenASRService } from '@/lib/services/qwen-asr-service';
import {
  ensureWechatVoicePlaybackUrl,
  resolveWechatMediaFilePath,
} from '@/lib/services/wechat-media-service';
import {
  buildWechatVoicePreviewText,
  buildWechatVoiceTutorContext,
  isWechatPlayableAudioUrl,
  normalizeWechatMediaPublicPath,
} from '@/lib/services/wechat-voice-utils';
import {
  DAILY_ECHO_KIND,
  getEchoSummaryMetadata,
  parseEchoMetadata,
} from '@/lib/services/workspace-echo-service';
import workspaceService, { type WorkspaceSummary } from '@/lib/services/workspace-service';
import { createLogger } from '@/lib/logger';
import {
  buildSourceProvenance,
  canonicalizeSourceUrl,
  readSourceProvenance,
} from '@/lib/capture/source-provenance';
import type { SourceIngressChannel } from '@/types/page-types';

import {
  type WorkspaceCaptureStatus,
  type WorkspaceCaptureSummary,
  type WorkspaceEchoSummary,
  type UpsertWorkspaceCaptureInput,
  type UpdateWorkspaceCaptureContentInput,
  type WorkspaceCaptureLookupInput,
  compactText,
  parseJsonArray,
  parseJsonObject,
  normalizeCaptureStatus,
  normalizeOptionalCaptureText,
  inferWechatContentType,
  buildWechatCaptureTitle,
  mimeTypeFromFilePath,
} from './workspace-context-types';

// Re-export types for consumers
export type {
  WorkspaceCaptureStatus,
  WorkspaceCaptureSummary,
  WorkspaceEchoSummary,
  UpsertWorkspaceCaptureInput,
  UpdateWorkspaceCaptureContentInput,
};

const log = createLogger('workspace-context');

function inferIngressChannel(sourceType: string): SourceIngressChannel {
  if (sourceType === 'wechat') return 'wechat';
  if (sourceType === 'shared-agent') return 'share';
  if (sourceType === 'manual-note') return 'composer';
  if (sourceType === 'audio' || sourceType === 'video' || sourceType === 'recording') return 'recording';
  if (sourceType === 'document' || sourceType === 'support-import') return 'upload';
  return 'system';
}

function buildWorkspaceCaptureWriteData(params: {
  workspaceId: string;
  userId?: string | null;
  sourceType: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  metadataJson?: string | null;
  tutorContext?: string | null;
  occurredAt?: Date | null;
}): Omit<Prisma.WorkspaceCaptureUncheckedCreateInput, 'sourceKey' | 'status'> {
  return {
    workspaceId: params.workspaceId,
    userId: params.userId || null,
    sourceType: params.sourceType,
    role: params.role,
    contentType: params.contentType,
    title: compactText(params.title, 80),
    previewText: params.previewText,
    normalizedText: params.normalizedText ?? null,
    sourceUrl: params.sourceUrl ?? null,
    mediaUrl: params.mediaUrl ?? null,
    metadataJson: params.metadataJson ?? null,
    tutorContext: params.tutorContext ?? null,
    occurredAt: params.occurredAt ?? null,
  };
}

async function upsertWorkspaceCaptureBySourceKey(params: {
  workspaceId: string;
  userId?: string | null;
  sourceType: string;
  sourceKey: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  metadataJson?: string | null;
  tutorContext?: string | null;
  occurredAt?: Date | null;
}) {
  const existing = await prisma.workspaceCapture.findUnique({
    where: { sourceKey: params.sourceKey },
    select: {
      id: true,
      status: true,
    },
  });

  const data = buildWorkspaceCaptureWriteData(params);

  if (existing) {
    return prisma.workspaceCapture.update({
      where: { id: existing.id },
      data: {
        ...data,
        status: normalizeCaptureStatus(existing.status),
      },
    });
  }

  return prisma.workspaceCapture.create({
    data: {
      ...data,
      sourceKey: params.sourceKey,
      status: 'active',
    },
  });
}

function buildWorkspaceCaptureLookupWhere(params: {
  workspaceId: string;
  lookup: WorkspaceCaptureLookupInput;
}): Prisma.WorkspaceCaptureWhereInput | null {
  const clauses: Prisma.WorkspaceCaptureWhereInput[] = [];

  if (params.lookup.captureId?.trim()) {
    clauses.push({ id: params.lookup.captureId.trim() });
  }

  if (params.lookup.sourceKey?.trim()) {
    clauses.push({ sourceKey: params.lookup.sourceKey.trim() });
  }

  if (clauses.length === 0) return null;

  return {
    workspaceId: params.workspaceId,
    OR: clauses,
  };
}

async function retireEchoesForDeletedCapture(params: {
  workspaceId: string;
  captureId: string;
  sourceKey: string;
}) {
  const retiredEchoIds: string[] = [];

  const directlyLinked = await prisma.workspaceEcho.findMany({
    where: {
      workspaceId: params.workspaceId,
      captureId: params.captureId,
      status: 'active',
    },
    select: { id: true },
  });

  if (directlyLinked.length > 0) {
    await prisma.workspaceEcho.updateMany({
      where: {
        id: { in: directlyLinked.map((item) => item.id) },
      },
      data: {
        status: 'failed',
      },
    });
    retiredEchoIds.push(...directlyLinked.map((item) => item.id));
  }

  const activeDailyEchoes = await prisma.workspaceEcho.findMany({
    where: {
      workspaceId: params.workspaceId,
      kind: DAILY_ECHO_KIND,
      status: 'active',
    },
    select: {
      id: true,
      metadataJson: true,
    },
  });

  const matchingDailyEchoIds = activeDailyEchoes
    .filter((item) => {
      const metadata = parseEchoMetadata(item.metadataJson);
      const memory = metadata?.memory;
      const sourceCaptureIds = Array.isArray(memory?.sourceCaptureIds) ? memory.sourceCaptureIds : [];
      const sourceKeys = Array.isArray(memory?.sourceKeys) ? memory.sourceKeys : [];
      return sourceCaptureIds.includes(params.captureId) || sourceKeys.includes(params.sourceKey);
    })
    .map((item) => item.id);

  const nextRetiredEchoIds = matchingDailyEchoIds.filter((id) => !retiredEchoIds.includes(id));
  if (nextRetiredEchoIds.length > 0) {
    await prisma.workspaceEcho.updateMany({
      where: {
        id: { in: nextRetiredEchoIds },
      },
      data: {
        status: 'failed',
      },
    });
    retiredEchoIds.push(...nextRetiredEchoIds);
  }

  return retiredEchoIds;
}

function resolveWechatMediaPublicUrl(mediaUrl?: string | null): string | null {
  const normalized = normalizeWechatMediaPublicPath(mediaUrl) || (mediaUrl || '').trim();
  if (!normalized) return null;

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const baseUrl = (process.env.WECHAT_MP_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return null;

  return normalized.startsWith('/') ? `${baseUrl}${normalized}` : `${baseUrl}/${normalized}`;
}

async function transcribeWechatVoiceFromMediaUrl(mediaUrl?: string | null): Promise<string | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) return null;

  const localPath = resolveWechatMediaFilePath(mediaUrl);
  const publicUrl = resolveWechatMediaPublicUrl(mediaUrl);
  if (!localPath && !publicUrl) return null;

  try {
    const buffer = localPath ? await fs.readFile(localPath) : Buffer.alloc(0);
    const blob = new Blob([buffer], { type: localPath ? mimeTypeFromFilePath(localPath) : 'audio/mpeg' });
    const result = await qwenASRService.transcribe(blob, apiKey, {
      language: 'zh',
      async: Boolean(publicUrl),
      fileUrl: publicUrl || undefined,
    });
    const transcript = (result.text || '').replace(/\s+/g, ' ').trim();
    return transcript || null;
  } catch (error) {
    log.error('[workspace-context] transcribeWechatVoiceFromMediaUrl failed:', error);
    return null;
  }
}

function toCaptureSummary(item: {
  id: string;
  sourceKey: string;
  sourceType: string;
  status: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string | null;
  normalizedText: string | null;
  sourceUrl: string | null;
  mediaUrl: string | null;
  tutorContext: string | null;
  occurredAt: Date | null;
  createdAt: Date;
  metadataJson: string | null;
}): WorkspaceCaptureSummary {
  return {
    id: item.id,
    sourceKey: item.sourceKey,
    sourceType: item.sourceType,
    status: normalizeCaptureStatus(item.status),
    role: item.role,
    contentType: item.contentType,
    title: item.title,
    previewText: item.previewText || item.title,
    normalizedText: item.normalizedText,
    sourceUrl: item.sourceUrl,
    mediaUrl: item.mediaUrl,
    tutorContext: item.tutorContext,
    occurredAt: item.occurredAt?.toISOString() || null,
    createdAt: item.createdAt.toISOString(),
    metadata: parseJsonObject(item.metadataJson),
  };
}

function toEchoSummary(item: {
  id: string;
  sourceKey: string;
  kind: string | null;
  generatedDateKey: string | null;
  title: string;
  body: string;
  chipsJson: string | null;
  metadataJson: string | null;
  createdAt: Date;
  updatedAt: Date;
}): WorkspaceEchoSummary {
  const parsedMetadata = parseEchoMetadata(item.metadataJson);
  const metadata = getEchoSummaryMetadata(item.metadataJson);

  return {
    id: item.id,
    sourceKey: item.sourceKey,
    kind: item.kind,
    generatedDateKey: item.generatedDateKey,
    title: item.title,
    body: item.body,
    chips: parseJsonArray(item.chipsJson).slice(0, 4),
    recommendations: metadata.recommendations,
    memory: metadata.memory,
    sourceCaptureIds: Array.isArray(parsedMetadata?.memory?.sourceCaptureIds)
      ? parsedMetadata!.memory!.sourceCaptureIds.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [],
    sourceKeys: Array.isArray(parsedMetadata?.memory?.sourceKeys)
      ? parsedMetadata!.memory!.sourceKeys.filter((value): value is string => typeof value === 'string' && Boolean(value))
      : [],
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export const workspaceContextService = {
  async upsertCaptureForUser(userId: string, input: UpsertWorkspaceCaptureInput) {
    const workspace = await workspaceService.ensureDefaultWorkspace(userId);
    if (!workspace) {
      throw new Error('未找到当前工作区');
    }

    const previewText = compactText(input.previewText || input.normalizedText || input.title, 180);
    const canonicalUrl = canonicalizeSourceUrl(input.sourceUrl);
    const duplicateByUrl = canonicalUrl
      ? await prisma.workspaceCapture.findFirst({
          where: {
            workspaceId: workspace.id,
            status: { not: 'deleted' },
            sourceUrl: { in: [...new Set([canonicalUrl, input.sourceUrl].filter((value): value is string => Boolean(value)))] },
            sourceKey: { not: input.sourceKey },
          },
          select: { sourceKey: true, metadataJson: true },
        })
      : null;
    const existingMetadata = parseJsonObject(duplicateByUrl?.metadataJson) || {};
    const explicitProvenance = readSourceProvenance(input.metadata || null);
    const inferredProvenance = buildSourceProvenance({
      ingressChannel: explicitProvenance?.ingressChannel || inferIngressChannel(input.sourceType),
      sourceUrl: input.sourceUrl,
      normalizedText: input.normalizedText,
      platformId: explicitProvenance?.platformId,
      platformLabel: explicitProvenance?.platformLabel,
      publisher: explicitProvenance?.publisher,
      author: explicitProvenance?.author,
      publishedAt: explicitProvenance?.publishedAt,
      extractionMethod: explicitProvenance?.extractionMethod,
      contentState: explicitProvenance?.contentState,
      completeness: explicitProvenance?.completeness,
    });
    const metadataJson = JSON.stringify({
      ...existingMetadata,
      ...(input.metadata || {}),
      provenance: {
        ...(readSourceProvenance(existingMetadata) || {}),
        ...inferredProvenance,
      },
    });

    const capture = await upsertWorkspaceCaptureBySourceKey({
      workspaceId: workspace.id,
      userId,
      sourceType: input.sourceType,
      sourceKey: duplicateByUrl?.sourceKey || input.sourceKey,
      role: input.role,
      contentType: input.contentType,
      title: input.title,
      previewText,
      normalizedText: input.normalizedText,
      sourceUrl: canonicalUrl || input.sourceUrl,
      mediaUrl: input.mediaUrl,
      metadataJson,
      tutorContext: input.tutorContext,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
    });

    return {
      workspace,
      capture: toCaptureSummary(capture),
    };
  },

  async hydrateWechatVoiceMessage(linkToken: string) {
    const message = await prisma.wechatInboxMessage.findUnique({
      where: { linkToken },
    });

    if (!message || message.msgType !== 'voice') return message;

    const nextMediaUrl = await ensureWechatVoicePlaybackUrl({
      linkToken: message.linkToken,
      mediaUrl: message.mediaUrl,
      mediaId: message.mediaId,
    });

    const normalizedTranscript =
      message.normalizedText?.replace(/\s+/g, ' ').trim() ||
      (isWechatPlayableAudioUrl(nextMediaUrl)
        ? await transcribeWechatVoiceFromMediaUrl(nextMediaUrl)
        : null);

    const updates: Record<string, unknown> = {};

    if (nextMediaUrl && nextMediaUrl !== message.mediaUrl) {
      updates.mediaUrl = nextMediaUrl;
    }

    if (normalizedTranscript && normalizedTranscript !== (message.normalizedText || '').trim()) {
      updates.normalizedText = normalizedTranscript;
    }

    const nextPreviewText = normalizedTranscript
      ? buildWechatVoicePreviewText(normalizedTranscript)
      : message.previewText || buildWechatVoicePreviewText();
    if (nextPreviewText !== (message.previewText || '')) {
      updates.previewText = nextPreviewText;
    }

    const nextTutorContext = buildWechatVoiceTutorContext(normalizedTranscript || null);
    if (nextTutorContext !== (message.tutorContext || '')) {
      updates.tutorContext = nextTutorContext;
    }

    if (Object.keys(updates).length === 0) {
      return message;
    }

    return prisma.wechatInboxMessage.update({
      where: { id: message.id },
      data: updates,
    });
  },

  async syncWechatInboxMessageArtifacts(
    linkToken: string,
    options: { hydrateVoice?: boolean } = {}
  ) {
    let message = await prisma.wechatInboxMessage.findUnique({
      where: { linkToken },
    });

    if (!message || !message.workspaceId) return null;
    const workspaceId = message.workspaceId;

    if (options.hydrateVoice && message.msgType === 'voice') {
      const hydrated = await this.hydrateWechatVoiceMessage(linkToken);
      if (hydrated) {
        message = hydrated;
      }
    }

    const sourceKey = `wechat:${message.linkToken}`;
    const title = buildWechatCaptureTitle(message);
    const previewText = compactText(message.previewText || message.normalizedText || title, 180);
    const providerLabel = message.sourceUrl ? detectLinkProvider(message.sourceUrl).label : undefined;
    const msgNormalizedText = message.normalizedText || undefined;
    const sourceUrl = canonicalizeSourceUrl(message.sourceUrl) || message.sourceUrl || undefined;
    const mediaUrl = message.mediaUrl || undefined;
    const msgTutorContext = message.tutorContext || undefined;
    const hasAsyncExtraction = message.reachChannel === 'article-link'
      || message.reachChannel === 'web-link'
      || message.reachChannel === 'video-link';

    // ── 读取已有 capture 的丰富数据，防止 enrichVideoLinkMeta / triggerVideoImportPipeline 写入的数据被覆盖 ──
    const existingCapture = await prisma.workspaceCapture.findUnique({
      where: { sourceKey },
      select: { metadataJson: true, normalizedText: true, tutorContext: true },
    });
    const existingMeta = existingCapture?.metadataJson
      ? (() => { try { return JSON.parse(existingCapture.metadataJson); } catch { return {}; } })()
      : {};

    // 如果 pipeline 已写入更丰富的转录文本，保留 pipeline 的结果
    const normalizedText = (existingCapture?.normalizedText && existingCapture.normalizedText.length > (msgNormalizedText || '').length)
      ? existingCapture.normalizedText
      : msgNormalizedText;
    const tutorContext = (existingCapture?.tutorContext && existingCapture.tutorContext.length > (msgTutorContext || '').length)
      ? existingCapture.tutorContext
      : msgTutorContext;

    // 基础字段写入，但保留已有的 enriched 字段（bvid, embedUrl, thumbnailUrl, videoImported, transcriptSegments 等）
    const metadataJson = JSON.stringify({
      ...existingMeta,
      openId: message.openId,
      msgType: message.msgType,
      eventType: message.eventType,
      reachKind: message.reachKind,
      reachChannel: message.reachChannel,
      mediaId: message.mediaId,
      providerLabel,
      provenance: buildSourceProvenance({
        ingressChannel: 'wechat',
        sourceUrl: message.sourceUrl,
        normalizedText: normalizedText,
        platformLabel: providerLabel,
        isExtracting: hasAsyncExtraction && (message.status === 'received' || message.status === 'processing'),
        failed: message.status === 'failed',
      }),
    });

    if (sourceUrl && message.msgType === 'link') {
      const existingByUrl = await prisma.workspaceCapture.findFirst({
        where: {
          workspaceId,
          status: { not: 'deleted' },
          sourceUrl,
          sourceKey: { not: sourceKey },
        },
      });

      if (existingByUrl) {
        // 同样 merge 已有 metadataJson，防止覆盖 enriched 数据
        const existingByUrlMeta = existingByUrl.metadataJson
          ? (() => { try { return JSON.parse(existingByUrl.metadataJson as string); } catch { return {}; } })()
          : {};
        const mergedByUrlMetadataJson = JSON.stringify({
          ...existingByUrlMeta,
          openId: message.openId,
          msgType: message.msgType,
          eventType: message.eventType,
          reachKind: message.reachKind,
          reachChannel: message.reachChannel,
          mediaId: message.mediaId,
          providerLabel,
          provenance: buildSourceProvenance({
            ingressChannel: 'wechat',
            sourceUrl: message.sourceUrl,
            normalizedText,
            platformLabel: providerLabel,
            isExtracting: hasAsyncExtraction && (message.status === 'received' || message.status === 'processing'),
            failed: message.status === 'failed',
          }),
        });

        const updatedCapture = await prisma.workspaceCapture.update({
          where: { id: existingByUrl.id },
          data: {
            title,
            previewText,
            normalizedText: normalizedText || existingByUrl.normalizedText || undefined,
            metadataJson: mergedByUrlMetadataJson,
            tutorContext: tutorContext || (existingByUrl.tutorContext as string) || undefined,
            occurredAt: message.messageAt,
            mediaUrl,
          },
        });

        if (message.echoTitle && message.echoBody) {
          await prisma.workspaceEcho.upsert({
            where: { sourceKey: existingByUrl.sourceKey },
            update: {
              workspaceId,
              captureId: updatedCapture.id,
              title: message.echoTitle,
              body: message.echoBody,
              chipsJson: message.echoChipsJson,
              status: 'active',
            },
            create: {
              workspaceId,
              captureId: updatedCapture.id,
              sourceKey: existingByUrl.sourceKey,
              title: message.echoTitle,
              body: message.echoBody,
              chipsJson: message.echoChipsJson,
              status: 'active',
            },
          });
        }

        return updatedCapture;
      }
    }

    const capture = await upsertWorkspaceCaptureBySourceKey({
      workspaceId,
      userId: message.userId,
      sourceType: 'wechat',
      sourceKey,
      role: message.collectionRole || 'support',
      contentType: inferWechatContentType(message),
      title,
      previewText,
      normalizedText,
      sourceUrl,
      mediaUrl,
      metadataJson,
      tutorContext,
      occurredAt: message.messageAt,
    });

    if (message.echoTitle && message.echoBody) {
      await prisma.workspaceEcho.upsert({
        where: { sourceKey },
        update: {
          workspaceId,
          captureId: capture.id,
          title: message.echoTitle,
          body: message.echoBody,
          chipsJson: message.echoChipsJson,
          status: 'active',
        },
        create: {
          workspaceId,
          captureId: capture.id,
          sourceKey,
          title: message.echoTitle,
          body: message.echoBody,
          chipsJson: message.echoChipsJson,
          status: 'active',
        },
      });
    }

    return capture;
  },

  async syncWechatInboxArtifactsForOpenId(openId: string): Promise<number> {
    const messages = await prisma.wechatInboxMessage.findMany({
      where: {
        openId,
        workspaceId: { not: null },
      },
      select: {
        linkToken: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const item of messages) {
      await this.syncWechatInboxMessageArtifacts(item.linkToken);
    }

    return messages.length;
  },

  async updateCaptureStatusForUser(
    userId: string,
    params: WorkspaceCaptureLookupInput & { status: WorkspaceCaptureStatus }
  ): Promise<{
    workspace: WorkspaceSummary | null;
    capture: WorkspaceCaptureSummary | null;
    retiredEchoIds: string[];
  }> {
    const workspace = await workspaceService.getDefaultWorkspace(userId);
    if (!workspace) {
      return {
        workspace: null,
        capture: null,
        retiredEchoIds: [],
      };
    }

    const where = buildWorkspaceCaptureLookupWhere({
      workspaceId: workspace.id,
      lookup: params,
    });
    if (!where) {
      throw new Error('缺少要更新的收集标识');
    }

    const capture = await prisma.workspaceCapture.findFirst({
      where,
    });

    if (!capture) {
      return {
        workspace,
        capture: null,
        retiredEchoIds: [],
      };
    }

    const nextStatus = normalizeCaptureStatus(params.status);
    const updatedCapture = await prisma.workspaceCapture.update({
      where: { id: capture.id },
      data: {
        status: nextStatus,
      },
    });

    const retiredEchoIds =
      nextStatus === 'deleted'
        ? await retireEchoesForDeletedCapture({
            workspaceId: workspace.id,
            captureId: capture.id,
            sourceKey: capture.sourceKey,
          })
        : [];

    return {
      workspace,
      capture: toCaptureSummary(updatedCapture),
      retiredEchoIds,
    };
  },

  async updateCaptureContentForUser(
    userId: string,
    params: UpdateWorkspaceCaptureContentInput
  ): Promise<{
    workspace: WorkspaceSummary | null;
    capture: WorkspaceCaptureSummary | null;
  }> {
    const workspace = await workspaceService.getDefaultWorkspace(userId);
    if (!workspace) {
      return {
        workspace: null,
        capture: null,
      };
    }

    const where = buildWorkspaceCaptureLookupWhere({
      workspaceId: workspace.id,
      lookup: params,
    });
    if (!where) {
      throw new Error('缺少要更新的收集标识');
    }

    const capture = await prisma.workspaceCapture.findFirst({
      where,
    });

    if (!capture || normalizeCaptureStatus(capture.status) === 'deleted') {
      return {
        workspace,
        capture: null,
      };
    }

    const nextTitle = normalizeOptionalCaptureText(params.title);
    const nextPreviewText = normalizeOptionalCaptureText(params.previewText);
    const nextNormalizedText = normalizeOptionalCaptureText(params.normalizedText);
    const nextTutorContext = normalizeOptionalCaptureText(params.tutorContext);

    if (
      nextTitle === undefined &&
      nextPreviewText === undefined &&
      nextNormalizedText === undefined &&
      nextTutorContext === undefined
    ) {
      return {
        workspace,
        capture: toCaptureSummary(capture),
      };
    }

    const updatedCapture = await prisma.workspaceCapture.update({
      where: { id: capture.id },
      data: {
        ...(nextTitle !== undefined
          ? {
              title: compactText(nextTitle || capture.title, 80),
            }
          : {}),
        ...(nextPreviewText !== undefined
          ? {
              previewText: nextPreviewText ? compactText(nextPreviewText, 500) : null,
            }
          : {}),
        ...(nextNormalizedText !== undefined
          ? {
              normalizedText: nextNormalizedText,
            }
          : {}),
        ...(nextTutorContext !== undefined
          ? {
              tutorContext: nextTutorContext,
            }
          : {}),
      },
    });

    return {
      workspace,
      capture: toCaptureSummary(updatedCapture),
    };
  },

  async getCurrentWorkspaceContext(
    userId: string,
    options?: { includeArchived?: boolean }
  ): Promise<{
    workspace: WorkspaceSummary | null;
    captures: WorkspaceCaptureSummary[];
    echoes: WorkspaceEchoSummary[];
  }> {
    const workspace = await workspaceService.getDefaultWorkspace(userId);
    if (!workspace) {
      return { workspace: null, captures: [], echoes: [] };
    }

    const pendingWechatVoices = await prisma.wechatInboxMessage.findMany({
      where: {
        workspaceId: workspace.id,
        msgType: 'voice',
        OR: [
          { mediaUrl: null },
          { mediaUrl: '' },
          { mediaUrl: { contains: '.amr' } },
          { normalizedText: null },
          { normalizedText: '' },
        ],
      },
      select: {
        linkToken: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 3,
    });

    for (const item of pendingWechatVoices) {
      await this.syncWechatInboxMessageArtifacts(item.linkToken, { hydrateVoice: true });
    }

    const [captures, echoes, deletedCaptures] = await Promise.all([
      prisma.workspaceCapture.findMany({
        where: {
          workspaceId: workspace.id,
          status: options?.includeArchived ? { in: ['active', 'archived'] } : 'active',
        },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: options?.includeArchived ? 80 : 40,
      }),
      prisma.workspaceEcho.findMany({
        where: {
          workspaceId: workspace.id,
          status: 'active',
          kind: DAILY_ECHO_KIND,
        },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
      prisma.workspaceCapture.findMany({
        where: {
          workspaceId: workspace.id,
          status: 'deleted',
        },
        select: {
          id: true,
          sourceKey: true,
        },
      }),
    ]);

    const deletedCaptureIdSet = new Set(deletedCaptures.map((item) => item.id));
    const deletedCaptureSourceKeySet = new Set(deletedCaptures.map((item) => item.sourceKey));
    const visibleEchoes = echoes.filter((item) => {
      const metadata = parseEchoMetadata(item.metadataJson);
      const memory = metadata?.memory;
      const sourceCaptureIds = Array.isArray(memory?.sourceCaptureIds) ? memory.sourceCaptureIds : [];
      const sourceKeys = Array.isArray(memory?.sourceKeys) ? memory.sourceKeys : [];

      return (
        !sourceCaptureIds.some((id) => deletedCaptureIdSet.has(id)) &&
        !sourceKeys.some((sourceKey) => deletedCaptureSourceKeySet.has(sourceKey))
      );
    });

    return {
      workspace,
      captures: captures.map(toCaptureSummary),
      echoes: visibleEchoes.map(toEchoSummary),
    };
  },
};

export default workspaceContextService;
