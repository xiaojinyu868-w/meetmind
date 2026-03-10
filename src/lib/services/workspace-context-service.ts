import prisma from '@/lib/prisma';
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
  title: string;
  body: string;
  chips: string[];
  createdAt: string;
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

function buildEchoFromCapture(input: UpsertWorkspaceCaptureInput): {
  title: string;
  body: string;
  chips: string[];
} {
  const chips: string[] = [];

  if (input.contentType === 'audio') chips.push('课堂原声');
  if (input.contentType === 'video') chips.push('视频材料');
  if (input.contentType === 'document') chips.push('文档材料');
  if (input.contentType === 'image') chips.push('图片线索');
  if (input.contentType === 'link') chips.push('外部链接');
  if (input.contentType === 'text') chips.push('随手记录');
  if (input.role === 'primary') chips.push('主线内容');
  if (input.role === 'support') chips.push('补充上下文');

  const normalizedText = compactText(input.normalizedText || '', 120);

  if (input.contentType === 'audio') {
    return {
      title: '这段原声已经收下了',
      body: normalizedText
        ? '它后面会继续参与回声和 Tutor，不会只停在这一刻。'
        : '这段原声已经进入学习空间了，后面再补一句卡住的点会更有抓手。',
      chips: chips.slice(0, 3),
    };
  }

  if (input.contentType === 'document' || input.contentType === 'video' || input.contentType === 'link') {
    return {
      title: '这份材料已经接进当前上下文',
      body: '它现在不只是一个附件，后面的回声和 Tutor 都能继续引用它。',
      chips: chips.slice(0, 3),
    };
  }

  return {
    title: '这条记录已经留在你的学习脉络里',
    body: normalizedText
      ? '你刚刚记下来的内容，会继续影响后面的回声和 Tutor。'
      : '这条内容已经进入学习空间了，后面再补一点上下文会更有抓手。',
    chips: chips.slice(0, 3),
  };
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
  title: string;
  body: string;
  chipsJson: string | null;
  createdAt: Date;
}): WorkspaceEchoSummary {
  return {
    id: item.id,
    sourceKey: item.sourceKey,
    title: item.title,
    body: item.body,
    chips: parseJsonArray(item.chipsJson).slice(0, 4),
    createdAt: item.createdAt.toISOString(),
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

    const echoSeed = buildEchoFromCapture(input);

    const echo = await prisma.workspaceEcho.upsert({
      where: { sourceKey: input.sourceKey },
      update: {
        workspaceId: workspace.id,
        captureId: capture.id,
        title: echoSeed.title,
        body: echoSeed.body,
        chipsJson: JSON.stringify(echoSeed.chips),
        status: 'active',
      },
      create: {
        workspaceId: workspace.id,
        captureId: capture.id,
        sourceKey: input.sourceKey,
        title: echoSeed.title,
        body: echoSeed.body,
        chipsJson: JSON.stringify(echoSeed.chips),
        status: 'active',
      },
    });

    return {
      workspace,
      capture: toCaptureSummary(capture),
      echo: toEchoSummary(echo),
    };
  },

  async syncWechatInboxMessageArtifacts(linkToken: string) {
    const message = await prisma.wechatInboxMessage.findUnique({
      where: { linkToken },
    });

    if (!message || !message.workspaceId) return null;

    const sourceKey = `wechat:${message.linkToken}`;
    const title = buildWechatCaptureTitle(message);
    const previewText = compactText(message.previewText || message.normalizedText || title, 180);
    const metadataJson = JSON.stringify({
      openId: message.openId,
      msgType: message.msgType,
      eventType: message.eventType,
      reachKind: message.reachKind,
      reachChannel: message.reachChannel,
      mediaId: message.mediaId,
    });

    const capture = await prisma.workspaceCapture.upsert({
      where: { sourceKey },
      update: {
        userId: message.userId,
        workspaceId: message.workspaceId,
        role: message.collectionRole || 'support',
        contentType: inferWechatContentType(message),
        title,
        previewText,
        normalizedText: message.normalizedText,
        sourceUrl: message.sourceUrl,
        mediaUrl: message.mediaUrl,
        metadataJson,
        tutorContext: message.tutorContext,
        occurredAt: message.messageAt,
      },
      create: {
        workspaceId: message.workspaceId,
        userId: message.userId,
        sourceType: 'wechat',
        sourceKey,
        role: message.collectionRole || 'support',
        contentType: inferWechatContentType(message),
        title,
        previewText,
        normalizedText: message.normalizedText,
        sourceUrl: message.sourceUrl,
        mediaUrl: message.mediaUrl,
        metadataJson,
        tutorContext: message.tutorContext,
        occurredAt: message.messageAt,
      },
    });

    if (message.echoTitle && message.echoBody) {
      await prisma.workspaceEcho.upsert({
        where: { sourceKey },
        update: {
          workspaceId: message.workspaceId,
          captureId: capture.id,
          title: message.echoTitle,
          body: message.echoBody,
          chipsJson: message.echoChipsJson,
          status: 'active',
        },
        create: {
          workspaceId: message.workspaceId,
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

    const [captures, echoes] = await Promise.all([
      prisma.workspaceCapture.findMany({
        where: { workspaceId: workspace.id },
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        take: 40,
      }),
      prisma.workspaceEcho.findMany({
        where: { workspaceId: workspace.id, status: 'active' },
        orderBy: { createdAt: 'desc' },
        take: 16,
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
