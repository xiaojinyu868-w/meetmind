import prisma from '@/lib/prisma';
import { createLogger } from '@/lib/logger';
import workspaceService, { type WorkspaceSummary } from './workspace-service';
import workspaceContextService from './workspace-context-service';
import {
  compactText,
  type LocalWorkspaceMigrationPayload,
  type LocalWorkspaceMigrationSummary,
  type LocalWorkspaceSessionMigrationItem,
} from './workspace-context-types';

const log = createLogger('workspace-account');

const LOCAL_SESSION_SOURCE_TYPE = 'local-session';

function normalizeOptionalText(value: string | null | undefined, limit?: number): string | undefined {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return typeof limit === 'number' ? compactText(normalized, limit) : normalized;
}

function sanitizeMetadata(value: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value;
}

function buildLocalSessionSourceKey(userId: string, sessionId: string): string {
  return `${LOCAL_SESSION_SOURCE_TYPE}:${userId}:${sessionId}`;
}

async function repairWechatOwnership(userId: string, workspaceId: string): Promise<number> {
  const directBindingResult = await prisma.wechatInboxMessage.updateMany({
    where: {
      userId,
      OR: [
        { workspaceId: null },
        { bindingStatus: { not: 'bound' } },
      ],
    },
    data: {
      workspaceId,
      bindingStatus: 'bound',
    },
  });

  const wechatProviders = await prisma.authProvider.findMany({
    where: {
      userId,
      provider: 'wechat',
    },
    select: {
      providerId: true,
    },
  });

  for (const provider of wechatProviders) {
    try {
      await workspaceService.resolveWechatWorkspace(provider.providerId);
    } catch (error) {
      log.warn('repair wechat workspace failed:', { userId, openId: provider.providerId, error });
    }
  }

  return directBindingResult.count;
}

function buildMigrationCaptureInput(
  userId: string,
  session: LocalWorkspaceSessionMigrationItem,
): {
  sourceKey: string;
  sourceType: string;
  role: string;
  contentType: string;
  title: string;
  previewText: string;
  normalizedText?: string;
  tutorContext?: string;
  sourceUrl?: string;
  mediaUrl?: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
} | null {
  if (!session.sessionId?.trim()) return null;

  const title = normalizeOptionalText(session.title, 80) || '本地课堂记录';
  const previewText =
    normalizeOptionalText(session.previewText, 220) ||
    normalizeOptionalText(session.normalizedText, 220) ||
    normalizeOptionalText(session.tutorContext, 220) ||
    '这台设备上的课堂历史已同步到账号。';

  const normalizedText = normalizeOptionalText(session.normalizedText, 12000);
  const tutorContext = normalizeOptionalText(session.tutorContext, 16000);
  const sourceUrl = normalizeOptionalText(session.sourceUrl, 500);
  const mediaUrl = normalizeOptionalText(session.mediaUrl, 500);
  const metadata = sanitizeMetadata(session.metadata);

  if (!previewText && !normalizedText && !tutorContext) return null;

  return {
    sourceKey: buildLocalSessionSourceKey(userId, session.sessionId.trim()),
    sourceType: LOCAL_SESSION_SOURCE_TYPE,
    role: session.role || 'primary',
    contentType: normalizeOptionalText(session.contentType, 32) || 'audio',
    title,
    previewText,
    normalizedText,
    tutorContext,
    sourceUrl,
    mediaUrl,
    occurredAt: session.occurredAt,
    metadata: {
      migratedFrom: 'indexeddb',
      migrationVersion: 'workspace-account-v1',
      migratedAt: new Date().toISOString(),
      localSessionId: session.sessionId,
      ...(metadata || {}),
    },
  };
}

export const workspaceAccountService = {
  async ensureAccountDataOwnership(userId: string): Promise<{
    workspace: WorkspaceSummary | null;
    repairedWechatMessages: number;
  }> {
    const workspace = await workspaceService.ensureDefaultWorkspace(userId);
    if (!workspace) {
      return {
        workspace: null,
        repairedWechatMessages: 0,
      };
    }

    const repairedWechatMessages = await repairWechatOwnership(userId, workspace.id);

    return {
      workspace,
      repairedWechatMessages,
    };
  },

  async migrateLocalWorkspaceData(
    userId: string,
    payload: LocalWorkspaceMigrationPayload,
  ): Promise<{
    workspace: WorkspaceSummary;
    summary: LocalWorkspaceMigrationSummary;
  }> {
    const ownership = await this.ensureAccountDataOwnership(userId);
    if (!ownership.workspace) {
      throw new Error('未找到当前工作区');
    }

    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
    let created = 0;
    let updated = 0;
    let skipped = 0;

    let failed = 0;
    for (const session of sessions) {
      // 关键修复（2026-06-04）：per-session try/catch。
      // 之前任一 session 抛错（脏数据 / 超大 metadata / DB 约束）会让整批 migration 500，
      // 用户登录时整页卡住/空白。现在单条失败只跳过 + 记录真因，其余继续同步。
      try {
        const captureInput = buildMigrationCaptureInput(userId, session);
        if (!captureInput) {
          skipped += 1;
          continue;
        }

        const existing = await prisma.workspaceCapture.findUnique({
          where: { sourceKey: captureInput.sourceKey },
          select: { id: true },
        });

        await workspaceContextService.upsertCaptureForUser(userId, captureInput);

        if (existing) {
          updated += 1;
        } else {
          created += 1;
        }
      } catch (sessionError) {
        failed += 1;
        const info = sessionError instanceof Error
          ? { msg: sessionError.message.slice(0, 200), name: sessionError.name }
          : { msg: String(sessionError).slice(0, 200) };
        log.warn('migration skipped one session', {
          userId,
          sessionId: session.sessionId,
          ...info,
        });
      }
    }
    if (failed > 0) {
      log.warn(`migration completed with ${failed} failed sessions (user=${userId})`);
    }

    return {
      workspace: ownership.workspace,
      summary: {
        total: sessions.length,
        created,
        updated,
        skipped,
        repairedWechatMessages: ownership.repairedWechatMessages,
      },
    };
  },
};

export default workspaceAccountService;
