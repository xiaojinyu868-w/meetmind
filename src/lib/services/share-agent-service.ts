/**
 * SharedAgent service — 场景上下文作为分享单元（v3.0）
 *
 * 设计参见 roadmap/v3.0-virality-agent.md。
 *
 * 这层对应 prisma SharedAgent / ShareInteraction / ShareClaim 三个表。
 * - 创建：客户端把 share-time snapshot 包成 payload 发给后端，后端只验证 + 存档，不读 IndexedDB
 * - 读取：通过 token 公开读，匿名也能 GET（仅返回 snapshot，不返回 ownerId / chatHistory）
 * - 对话：/api/tutor/agent 在 mode='shared' 时拉这里的 snapshot 拼 system prompt
 * - 领取：登录用户 POST claim，把 snapshot 复刻到自己的 workspace（创建 WorkspaceCapture）
 *
 * 隐私铁律：
 *  - snapshot 永远不带原作者的 chat history / 学习者画像 / 个人层应用产物
 *  - 公开 GET 不暴露 ownerId / workspaceId（防社工）
 *  - chat 在 shared 态写到访问者自己的 conversation，不回流到原作者
 */

import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { createLogger, track } from '@/lib/logger';

const log = createLogger('share-agent-service');

// ──────────────────────────────────────────────────────────────
// Snapshot Schema —— 客户端发上来的 share-time snapshot
// ──────────────────────────────────────────────────────────────

/**
 * 场景层产物的种类。受控集合——客户端不能塞任意值。
 * 注意：'flashcards' 默认是个人层，但用户在分享时
 * 显式勾选可以放进来；'chat-only' 表示纯对话分享（无产物）。
 */
export const SHARE_ARTIFACT_KINDS = [
  'cheatsheet',
  'mindmap',
  'quiz',
  'flashcards',
  'infographic',
  'audio-overview',
  'notes',
  'chat-only',
] as const;
export type ShareArtifactKind = (typeof SHARE_ARTIFACT_KINDS)[number];

/**
 * 转录摘要 —— 不带原文全量，只带可索引段落。
 * 设计目的：让分享态 Agent 能基于真实课堂内容回答 + 引用 [MM:SS]，
 * 但不暴露所有原始转录字符串（隐私 + 体积控制）。
 */
const TranscriptDigestSchema = z.object({
  /** 总时长（秒） */
  totalSec: z.number().int().nonnegative(),
  /** 关键段落（建议 ≤ 50 段，单段 ≤ 1000 字） */
  segments: z
    .array(
      z.object({
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
        text: z.string().min(1).max(2000),
        speaker: z.string().max(40).optional(),
      }),
    )
    .max(80),
  /** 课堂上的关键术语（用于上下文 biasing） */
  keyTerms: z.array(z.string().max(40)).max(40).optional(),
});
export type TranscriptDigest = z.infer<typeof TranscriptDigestSchema>;

/**
 * 分享 Agent 的 snapshot payload —— 客户端 POST /api/share/agent 时发上来。
 */
export const SharedAgentSnapshotSchema = z.object({
  title: z.string().min(1).max(120),
  subject: z.string().max(80).optional(),
  artifactKind: z.enum(SHARE_ARTIFACT_KINDS),
  /** 选定的具体产物（场景层应用的输出）。chat-only 时省略。 */
  artifact: z.unknown().optional(),
  transcriptDigest: TranscriptDigestSchema,
  /** 分享者展示昵称 */
  sharerNickname: z.string().min(1).max(40).optional(),
  /** 给"分享态 Agent"system prompt 注入的额外背景（可选） */
  conversationContext: z.string().max(4000).optional(),
});
export type SharedAgentSnapshot = z.infer<typeof SharedAgentSnapshotSchema>;

// ──────────────────────────────────────────────────────────────
// Public-facing payload （GET /api/share/[token] 返回的形状）
// ──────────────────────────────────────────────────────────────

export interface PublicSharedAgent {
  token: string;
  title: string;
  subject?: string;
  artifactKind: ShareArtifactKind;
  /** snapshot 完整体，artifact + transcriptDigest 都在里面 */
  snapshot: SharedAgentSnapshot;
  sharerNickname?: string;
  conversationEnabled: boolean;
  viewCount: number;
  claimCount: number;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────
// Token 生成
// ──────────────────────────────────────────────────────────────

/**
 * 生成 12 字符 URL-safe token（base64url, 9 bytes ≈ 72 bits 熵）。
 */
function generateShareToken(): string {
  return randomBytes(9).toString('base64url');
}

// ──────────────────────────────────────────────────────────────
// Service API
// ──────────────────────────────────────────────────────────────

export interface CreateShareInput {
  ownerId: string | null;
  workspaceId: string | null;
  sourceSessionId?: string;
  snapshot: SharedAgentSnapshot;
  conversationEnabled?: boolean;
  visibility?: 'public' | 'unlisted';
  expiresAt?: Date | null;
}

export interface CreateShareResult {
  token: string;
  shareId: string;
}

/**
 * 创建一个 SharedAgent。
 *
 * - 失败：snapshot 校验不通过 / token 碰撞（极小概率，重试一次即可）
 * - 成功：返回 token 和内部 id
 */
export async function createSharedAgent(input: CreateShareInput): Promise<CreateShareResult> {
  // 二次校验 snapshot（route 层已经 zod parse 过，这里防御性再过一遍）
  const parsed = SharedAgentSnapshotSchema.parse(input.snapshot);

  // token 碰撞重试（最多 3 次；72 bits 熵实际上一次就过）
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateShareToken();
    const existing = await prisma.sharedAgent.findUnique({ where: { token } });
    if (existing) continue;

    const record = await prisma.sharedAgent.create({
      data: {
        token,
        ownerId: input.ownerId,
        workspaceId: input.workspaceId,
        sourceSessionId: input.sourceSessionId ?? null,
        title: parsed.title,
        subject: parsed.subject ?? null,
        artifactKind: parsed.artifactKind,
        snapshotJson: JSON.stringify(parsed),
        sharerNickname: parsed.sharerNickname ?? null,
        visibility: input.visibility ?? 'public',
        conversationEnabled: input.conversationEnabled ?? true,
        expiresAt: input.expiresAt ?? null,
      },
      select: { id: true, token: true },
    });

    track({
      kind: 'share.create',
      shareId: record.id,
      ownerId: input.ownerId,
      artifactKind: parsed.artifactKind,
    });
    log.debug('created', { shareId: record.id, token: record.token, artifactKind: parsed.artifactKind });
    return { token: record.token, shareId: record.id };
  }

  throw new Error('SharedAgent token 生成 3 次都碰撞，请重试');
}

/**
 * 通过 token 公开读取 SharedAgent。
 *
 * 不暴露 ownerId / workspaceId / interactions（避免社工）。
 * 仅 active 状态的 share 可读；过期或撤销返回 null。
 */
export async function getSharedAgentByToken(token: string): Promise<PublicSharedAgent | null> {
  const record = await prisma.sharedAgent.findUnique({
    where: { token },
  });
  if (!record) return null;
  if (record.status !== 'active') return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

  let snapshot: SharedAgentSnapshot;
  try {
    snapshot = SharedAgentSnapshotSchema.parse(JSON.parse(record.snapshotJson));
  } catch (err) {
    log.error('snapshot 解析失败', { token, err: (err as Error).message });
    return null;
  }

  return {
    token: record.token,
    title: record.title,
    subject: record.subject ?? undefined,
    artifactKind: record.artifactKind as ShareArtifactKind,
    snapshot,
    sharerNickname: record.sharerNickname ?? undefined,
    conversationEnabled: record.conversationEnabled,
    viewCount: record.viewCount,
    claimCount: record.claimCount,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * 内部用：根据 token 拿到完整 SharedAgent 记录（包含 ownerId/workspaceId）。
 *
 * 仅供 server 内部组件调用（如 tutor agent 拼 system prompt、claim 流程）。
 * 不应直接返回给浏览器。
 */
export async function getSharedAgentInternal(token: string) {
  const record = await prisma.sharedAgent.findUnique({ where: { token } });
  if (!record) return null;
  if (record.status !== 'active') return null;
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;
  return record;
}

/**
 * 记录一次访问 / 对话 / 转发事件，并维护对应的计数器。
 */
export async function trackShareInteraction(params: {
  token: string;
  visitorUserId: string | null;
  eventType: 'view' | 'chat' | 'claim' | 'reshare';
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const share = await prisma.sharedAgent.findUnique({
    where: { token: params.token },
    select: { id: true },
  });
  if (!share) return;

  await prisma.shareInteraction.create({
    data: {
      shareId: share.id,
      visitorUserId: params.visitorUserId,
      eventType: params.eventType,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });

  // 更新对应计数器
  const counterField =
    params.eventType === 'view'
      ? 'viewCount'
      : params.eventType === 'chat'
        ? 'chatCount'
        : params.eventType === 'claim'
          ? 'claimCount'
          : null;
  if (counterField) {
    await prisma.sharedAgent.update({
      where: { id: share.id },
      data: { [counterField]: { increment: 1 } },
    });
  }

  track({
    kind: 'share.interaction',
    shareId: share.id,
    eventType: params.eventType,
    visitorUserId: params.visitorUserId,
  });
}

/**
 * 把 SharedAgent 领取到访问者的 workspace。
 *
 * 流程：
 *  1. 验证 share 仍然 active
 *  2. 在 claimer 的 workspace 创建一个 WorkspaceCapture，role='shared-agent'
 *  3. 写 ShareClaim 记录（unique on shareId + claimerUserId，幂等）
 *  4. 触发 trackShareInteraction('claim')
 *
 * 返回：领取后的 capture id，幂等再次领取返回同一个 id。
 */
export async function claimSharedAgent(params: {
  token: string;
  claimerUserId: string;
  claimerWorkspaceId: string;
}): Promise<{ captureId: string; alreadyClaimed: boolean }> {
  const share = await getSharedAgentInternal(params.token);
  if (!share) {
    throw new Error('SHARE_NOT_FOUND');
  }

  // 幂等：已经领取过就直接返回
  const existing = await prisma.shareClaim.findUnique({
    where: {
      shareId_claimerUserId: {
        shareId: share.id,
        claimerUserId: params.claimerUserId,
      },
    },
  });
  if (existing && existing.capturedItemId) {
    return { captureId: existing.capturedItemId, alreadyClaimed: true };
  }

  // 在 claimer 的 workspace 里造一个 capture
  const sourceKey = `shared-agent:${share.token}:${params.claimerUserId}`;
  const capture = await prisma.workspaceCapture.upsert({
    where: { sourceKey },
    create: {
      workspaceId: params.claimerWorkspaceId,
      userId: params.claimerUserId,
      sourceType: 'shared-agent',
      sourceKey,
      contentType: 'shared-agent',
      role: 'support',
      title: share.title,
      previewText: share.subject ?? undefined,
      metadataJson: JSON.stringify({
        sharedAgentToken: share.token,
        sharedAgentId: share.id,
        artifactKind: share.artifactKind,
        sharerNickname: share.sharerNickname ?? null,
        sharedAt: share.createdAt.toISOString(),
      }),
    },
    update: {},
  });

  await prisma.shareClaim.upsert({
    where: {
      shareId_claimerUserId: {
        shareId: share.id,
        claimerUserId: params.claimerUserId,
      },
    },
    create: {
      shareId: share.id,
      claimerUserId: params.claimerUserId,
      claimerWorkspaceId: params.claimerWorkspaceId,
      capturedItemId: capture.id,
    },
    update: {
      capturedItemId: capture.id,
      claimerWorkspaceId: params.claimerWorkspaceId,
    },
  });

  await trackShareInteraction({
    token: share.token,
    visitorUserId: params.claimerUserId,
    eventType: 'claim',
  });

  return { captureId: capture.id, alreadyClaimed: Boolean(existing) };
}

/**
 * 撤销一个已经发出去的 SharedAgent。
 * 幂等：已经 revoked 仍然返回 true。
 */
export async function revokeSharedAgent(params: {
  token: string;
  ownerId: string;
}): Promise<boolean> {
  const share = await prisma.sharedAgent.findUnique({
    where: { token: params.token },
    select: { id: true, ownerId: true, status: true },
  });
  if (!share) return false;
  if (share.ownerId !== params.ownerId) return false;
  if (share.status === 'revoked') return true;

  await prisma.sharedAgent.update({
    where: { id: share.id },
    data: { status: 'revoked' },
  });
  log.debug('revoked', { shareId: share.id });
  return true;
}

// ──────────────────────────────────────────────────────────────
// "我的分享" —— A 自己的分享列表（v3.0 闭环管理面）
// ──────────────────────────────────────────────────────────────

export interface MySharedAgentSummary {
  token: string;
  title: string;
  subject?: string;
  artifactKind: ShareArtifactKind;
  sharerNickname?: string;
  status: 'active' | 'revoked';
  conversationEnabled: boolean;
  viewCount: number;
  chatCount: number;
  claimCount: number;
  createdAt: string;
}

/**
 * 列出指定用户创建的所有 SharedAgent（含已撤销）。
 * 用于 /me/shares 管理面。
 */
export async function listSharedAgentsByOwner(ownerId: string): Promise<MySharedAgentSummary[]> {
  const records = await prisma.sharedAgent.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      token: true,
      title: true,
      subject: true,
      artifactKind: true,
      sharerNickname: true,
      status: true,
      conversationEnabled: true,
      viewCount: true,
      chatCount: true,
      claimCount: true,
      createdAt: true,
    },
  });
  return records.map((r) => ({
    token: r.token,
    title: r.title,
    subject: r.subject ?? undefined,
    artifactKind: r.artifactKind as ShareArtifactKind,
    sharerNickname: r.sharerNickname ?? undefined,
    status: r.status === 'revoked' ? 'revoked' : 'active',
    conversationEnabled: r.conversationEnabled,
    viewCount: r.viewCount,
    chatCount: r.chatCount,
    claimCount: r.claimCount,
    createdAt: r.createdAt.toISOString(),
  }));
}
