import fs from 'fs/promises';
import path from 'path';
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
} from '@/lib/services/wechat-voice-utils';
import {
  DAILY_ECHO_KIND,
  getEchoSummaryMetadata,
  type EchoMemorySummary,
  type EchoRecommendation,
} from '@/lib/services/workspace-echo-service';
import workspaceService, { type WorkspaceSummary } from '@/lib/services/workspace-service';

export interface WorkspaceCaptureSummary {
  id: string;
  sourceKey: string;
  sourceType: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string | null;
  sourceUrl?: string | null;
  mediaUrl?: string | null;
  tutorContext?: string | null;
  occurredAt?: string | null;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
}

export interface WorkspaceEchoSummary {
  id: string;
  sourceKey: string;
  kind?: string | null;
  generatedDateKey?: string | null;
  title: string;
  body: string;
  chips: string[];
  recommendations: EchoRecommendation[];
  memory: EchoMemorySummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWorkspaceCaptureInput {
  sourceType: string;
  sourceKey: string;
  role: string;
  contentType: string;
  title: string;
  previewText?: string;
  normalizedText?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  tutorContext?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

function compactText(value: string, limit: number): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

function parseJsonArray(value?: string | null): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return [];
  }
}

function parseJsonObject(value?: string | null): Record<string, unknown> | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function inferWechatContentType(message: {
  msgType: string;
  reachChannel?: string | null;
}): string {
  if (message.msgType === 'voice') return 'audio';
  if (message.msgType === 'image') return 'image';
  if (message.reachChannel === 'video-link') return 'video';
  if (message.msgType === 'link') return 'link';
  return 'text';
}

function buildWechatCaptureTitle(message: {
  title?: string | null;
  msgType: string;
}): string {
  if (message.title?.trim()) return compactText(message.title.trim(), 60);
  if (message.msgType === 'voice') return '微信语音';
  if (message.msgType === 'image') return '微信图片';
  if (message.msgType === 'link') return '微信链接';
  if (message.msgType === 'event') return '微信服务号消息';
  return '微信随手记';
}

function mimeTypeFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.amr') return 'audio/amr';
  return 'application/octet-stream';
}

async function transcribeWechatVoiceFromMediaUrl(mediaUrl?: string | null): Promise<string | null> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) return null;

  const localPath = resolveWechatMediaFilePath(mediaUrl);
  if (!localPath) return null;

  try {
    const buffer = await fs.readFile(localPath);
    if (!buffer.length) return null;

    const blob = new Blob([buffer], { type: mimeTypeFromFilePath(localPath) });
    const result = await qwenASRService.transcribe(blob, apiKey, { language: 'zh' });
    const transcript = (result.text || '').replace(/\s+/g, ' ').trim();
    return transcript || null;
  } catch (error) {
    console.error('[workspace-context] transcribeWechatVoiceFromMediaUrl failed:', error);
    return null;
  }
}

function toCaptureSummary(item: {
  id: string;
  sourceKey: string;
  sourceType: string;
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
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;

    const capture = await prisma.workspaceCapture.upsert({
      where: { sourceKey: input.sourceKey },
      update: {
        workspaceId: workspace.id,
        userId,
        sourceType: input.sourceType,
        role: input.role,
        contentType: input.contentType,
        title: compactText(input.title, 80),
        previewText,
        normalizedText: input.normalizedText,
        sourceUrl: input.sourceUrl,
        mediaUrl: input.mediaUrl,
        metadataJson,
        tutorContext: input.tutorContext,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
      },
      create: {
        workspaceId: workspace.id,
        userId,
        sourceType: input.sourceType,
        sourceKey: input.sourceKey,
        role: input.role,
        contentType: input.contentType,
        title: compactText(input.title, 80),
        previewText,
        normalizedText: input.normalizedText,
        sourceUrl: input.sourceUrl,
        mediaUrl: input.mediaUrl,
        metadataJson,
        tutorContext: input.tutorContext,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : null,
      },
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
    const normalizedText = message.normalizedText || undefined;
    const sourceUrl = message.sourceUrl || undefined;
    const mediaUrl = message.mediaUrl || undefined;
    const tutorContext = message.tutorContext || undefined;
    const metadataJson = JSON.stringify({
      openId: message.openId,
      msgType: message.msgType,
      eventType: message.eventType,
      reachKind: message.reachKind,
      reachChannel: message.reachChannel,
      mediaId: message.mediaId,
      providerLabel,
    });

    if (sourceUrl && message.msgType === 'link') {
      const existingByUrl = await prisma.workspaceCapture.findFirst({
        where: {
          workspaceId,
          sourceUrl,
          sourceKey: { not: sourceKey },
        },
      });

      if (existingByUrl) {
        const updatedCapture = await prisma.workspaceCapture.update({
          where: { id: existingByUrl.id },
          data: {
            title,
            previewText,
            normalizedText: normalizedText || existingByUrl.normalizedText || undefined,
            metadataJson,
            tutorContext,
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

    const capture = await prisma.workspaceCapture.upsert({
      where: { sourceKey },
      update: {
        userId: message.userId,
        workspaceId,
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
      },
      create: {
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
      },
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

  async getCurrentWorkspaceContext(userId: string): Promise<{
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

    const [captures, echoes] = await Promise.all([
      prisma.workspaceCapture.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 40,
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
    ]);

    return {
      workspace,
      captures: captures.map(toCaptureSummary),
      echoes: echoes.map(toEchoSummary),
    };
  },
};

export default workspaceContextService;
