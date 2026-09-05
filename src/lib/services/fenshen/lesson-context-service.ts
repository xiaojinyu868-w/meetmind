/**
 * 分身课后上下文物化 —— prisma / 前端快照 → workspace 文件。
 *
 * 课后上下文按"上传长文本"范式写成 workspace 里的文件
 * （lesson/transcript.txt、lesson/outline.md、lesson/confusions.md、
 * learner/profile.md），数据源 prisma（WorkspaceCapture /
 * WorkspaceTranscriptSegment / anchor artifacts type='confusion' /
 * User.learnerProfileJson）。快照语义：每次 ensureChatSession 重刷，session
 * 中途的实时更新 v1 不追求。
 *
 * 从 fenshen-session-service.ts 拆出（500 行硬限制）；对话编排见
 * fenshen-session-service.ts。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/prisma';

export interface ContextSegment {
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string | null;
}

export interface ContextConfusion {
  timestampMs: number;
  text?: string;
}

export interface ContextProfile {
  bio?: { headline: string; detail?: string };
  goals?: Array<{ title: string; summary?: string }>;
}

export interface LessonContextInput {
  captureTitle?: string;
  capturePreview?: string;
  normalizedText?: string;
  segments: ContextSegment[];
  confusions: ContextConfusion[];
  profile?: ContextProfile | null;
}

export interface ContextFile {
  /** 相对 workDir 的路径（lesson/transcript.txt 等） */
  relPath: string;
  content: string;
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** 纯函数：上下文输入 → 物化文件集（可单测） */
export function buildContextFiles(input: LessonContextInput): ContextFile[] {
  const title = input.captureTitle?.trim() || '（未命名课堂）';

  let transcript: string;
  if (input.segments.length > 0) {
    transcript = input.segments
      .map((s) => `[${formatMs(s.startMs)}]${s.speakerId ? ` ${s.speakerId}` : ''} ${s.text.trim()}`)
      .join('\n');
  } else if (input.normalizedText?.trim()) {
    transcript = input.normalizedText.trim();
  } else {
    transcript = '（暂无课堂转录）';
  }

  const outline = [`# ${title}`];
  if (input.capturePreview?.trim()) outline.push('', input.capturePreview.trim());
  if (input.segments.length > 0) {
    const first = input.segments[0];
    const last = input.segments[input.segments.length - 1];
    outline.push('', `时长约 ${formatMs(last.endMs)}，共 ${input.segments.length} 段转录。`);
    outline.push(`开场：${first.text.trim().slice(0, 60)}`);
  }

  const confusions =
    input.confusions.length > 0
      ? input.confusions
          .map((c) => `- [${formatMs(c.timestampMs)}] ${c.text?.trim() || '（学生在此标记没跟上）'}`)
          .join('\n')
      : '（学生这节课没有留下困惑标记）';

  const profileLines: string[] = [];
  if (input.profile?.bio) {
    profileLines.push(`## 基本情况`, input.profile.bio.headline);
    if (input.profile.bio.detail?.trim()) profileLines.push(input.profile.bio.detail.trim());
  }
  const goals = (input.profile?.goals ?? []).filter((g) => g.title?.trim());
  if (goals.length > 0) {
    if (profileLines.length > 0) profileLines.push('');
    profileLines.push('## 学习目标');
    for (const g of goals) {
      profileLines.push(`- ${g.title.trim()}${g.summary?.trim() ? `：${g.summary.trim()}` : ''}`);
    }
  }
  const profile = profileLines.length > 0 ? profileLines.join('\n') : '（暂无学生画像）';

  return [
    { relPath: path.join('lesson', 'transcript.txt'), content: `# 课堂转录 · ${title}\n\n${transcript}\n` },
    { relPath: path.join('lesson', 'outline.md'), content: `${outline.join('\n')}\n` },
    { relPath: path.join('lesson', 'confusions.md'), content: `# 学生标记的困惑\n\n${confusions}\n` },
    { relPath: path.join('learner', 'profile.md'), content: `# 学生画像\n\n${profile}\n` },
  ];
}

interface AnchorPayload {
  type?: string;
  timestamp?: number;
  text?: string;
  note?: string;
}

/** 这节课的前端快照（guest/demo 会话未持久化到服务端 DB 时的上下文来源） */
export interface LessonSnapshot {
  title?: string;
  segments?: { startMs: number; endMs: number; text: string; speakerId?: string | null }[];
}

/** 物化范围：来自前端当前复习页的课程会话（分身要"听"的就是这节课） */
export interface MaterializeScope {
  sessionId?: string;
  lessonSnapshot?: LessonSnapshot;
}

/** 宽松解析请求体里的 lessonSnapshot（路由薄壳用）；形状不对返回 undefined */
export function parseLessonSnapshot(raw: unknown): LessonSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as { title?: unknown; segments?: unknown };
  const snapshot: LessonSnapshot = {};
  if (typeof input.title === 'string' && input.title.trim()) snapshot.title = input.title.trim().slice(0, 100);
  if (Array.isArray(input.segments)) {
    snapshot.segments = input.segments
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        const seg = s as { startMs?: unknown; endMs?: unknown; text?: unknown; speakerId?: unknown };
        if (typeof seg.text !== 'string' || typeof seg.startMs !== 'number') return null;
        return {
          startMs: seg.startMs,
          endMs: typeof seg.endMs === 'number' ? seg.endMs : seg.startMs,
          text: seg.text.slice(0, 500),
          speakerId: typeof seg.speakerId === 'string' ? seg.speakerId : null,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .slice(0, 500);
  }
  return snapshot.title || snapshot.segments?.length ? snapshot : undefined;
}

/**
 * 读最新一节课的证据 + 学生画像，写成 workspace 文件（每次 ensureSession 重刷）。
 * 课程归属：给了 scope.sessionId 就按它反查（segment.sessionId → capture），
 * 分身从哪节课打开就物化哪节课；查不到用前端快照（guest/demo 未持久化），
 * **绝不回落无关 capture**（防跨课污染）；没给 sessionId 才回退全库最新（旧行为）。
 * 画像只取**这节课归属用户**的 profile——修掉旧实现跨用户取画像的泄漏。
 */
export async function materializeLessonContext(
  workDir: string,
  scope: MaterializeScope = {},
): Promise<{ files: number }> {
  let capture = null;
  if (scope.sessionId) {
    const scopedSegment = await prisma.workspaceTranscriptSegment.findFirst({
      where: { sessionId: scope.sessionId },
      orderBy: { createdAt: 'desc' },
      select: { captureId: true },
    });
    if (scopedSegment) {
      capture = await prisma.workspaceCapture.findUnique({ where: { id: scopedSegment.captureId } });
    }
  }
  if (!capture && scope.sessionId) {
    // guest/demo 会话未持久化到服务端 DB：用前端快照物化（快照为空 = 空课占位），
    // 绝不回落无关的旧 capture——那就是用户投诉的「分身讲了别的课」。
    const files = buildContextFiles({
      captureTitle: scope.lessonSnapshot?.title,
      segments: scope.lessonSnapshot?.segments ?? [],
      confusions: [],
      profile: null,
    });
    await writeContextFiles(workDir, files);
    return { files: files.length };
  }
  if (!capture) {
    // 回退：最新一节有转录分段的课；没有则退回最新有 normalizedText 的 capture
    const latestSegment = await prisma.workspaceTranscriptSegment.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { captureId: true },
    });
    capture = latestSegment
      ? await prisma.workspaceCapture.findUnique({ where: { id: latestSegment.captureId } })
      : await prisma.workspaceCapture.findFirst({
          where: { status: 'active', normalizedText: { not: null } },
          orderBy: { updatedAt: 'desc' },
        });
  }

  const segments: ContextSegment[] = capture
    ? await prisma.workspaceTranscriptSegment.findMany({
        where: { captureId: capture.id },
        orderBy: { position: 'asc' },
        select: { startMs: true, endMs: true, text: true, speakerId: true },
      })
    : [];

  const anchorRows = capture
    ? await prisma.workspaceCaptureArtifact.findMany({
        where: { captureId: capture.id, kind: 'anchor' },
        select: { payloadJson: true },
      })
    : [];
  const confusions: ContextConfusion[] = [];
  for (const row of anchorRows) {
    try {
      const payload = JSON.parse(row.payloadJson) as AnchorPayload;
      if (payload.type !== 'confusion' || typeof payload.timestamp !== 'number') continue;
      confusions.push({ timestampMs: payload.timestamp, text: payload.text ?? payload.note });
    } catch {
      // 跳过畸形 payload
    }
  }
  confusions.sort((a, b) => a.timestampMs - b.timestampMs);

  // LearnerProfile 服务端存储 = User.learnerProfileJson（JSON 字符串）。
  // 只取这节课归属用户的画像；capture 归属未知时不取（旧实现跨用户 findFirst 是泄漏）。
  const user = capture?.userId
    ? await prisma.user.findFirst({
        where: { id: capture.userId, learnerProfileJson: { not: null } },
        select: { learnerProfileJson: true },
      })
    : null;
  let profile: ContextProfile | null = null;
  if (user?.learnerProfileJson) {
    try {
      const parsed = JSON.parse(user.learnerProfileJson) as ContextProfile;
      profile = { bio: parsed.bio, goals: Array.isArray(parsed.goals) ? parsed.goals : [] };
    } catch {
      // 画像 JSON 损坏则跳过
    }
  }

  const files = buildContextFiles({
    captureTitle: capture?.title,
    capturePreview: capture?.previewText ?? undefined,
    normalizedText: capture?.normalizedText ?? undefined,
    segments,
    confusions,
    profile,
  });
  await writeContextFiles(workDir, files);
  return { files: files.length };
}

async function writeContextFiles(workDir: string, files: ContextFile[]): Promise<void> {
  for (const file of files) {
    const target = path.join(workDir, file.relPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}
