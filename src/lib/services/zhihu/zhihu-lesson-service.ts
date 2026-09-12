/**
 * 收藏夹 → 一节 live 课（server-only）。
 *
 * 做三件事：从这个用户的知乎收藏里挑材料（按赞同排序、只要有正文可讲的回答 / 文章 / 问题、最多 K 篇）；
 * 把还只有摘要的那几篇现在抽正文（这是 Firecrawl credit 真正花出去的地方，所以只抽进材料包的）；
 * 按预算切节选拼成 LiveMaterialPack，建一个 engine=live 的 TeachThread，材料落盘给 ensureSession 读。
 *
 * 不碰 teach-live 的内部：它只认识「材料包」这个通用形状（teach-live/live-materials.ts）。
 */

import { createThread } from '@/lib/services/teach-codex/thread-store';
import { resolveTeachLiveProvider } from '@/lib/config/teach.config';
import { listLiveMaterials, writeLiveMaterials, type LiveMaterialItem, type LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import prisma from '@/lib/prisma';
import type { LearnerContext } from '@/types/learner-context';
import { createLogger } from '@/lib/logger';
import { listZhihuCaptures, materializeCaptures, ZhihuImportError, type MaterializeResult, type ZhihuCaptureRecord } from './zhihu-import-service';
import type { ZhihuPageKind } from './zhihu-page-clean';

const log = createLogger('zhihu-lesson');

export const ZHIHU_LESSON_MAX_ITEMS = 8;
const DEFAULT_TOPIC = '知乎收藏夹里的一节课';

export interface BuildZhihuLessonInput {
  favlistUrlToken?: string;
  captureIds?: string[];
  topic?: string;
  maxItems?: number;
  learner?: LearnerContext | null;
}

export interface ZhihuLessonResult {
  thread: { id: string; title: string; topic: string };
  pack: LiveMaterialPack;
  materialized: MaterializeResult[];
}

export interface ZhihuLessonDeps {
  listCaptures: typeof listZhihuCaptures;
  materialize: typeof materializeCaptures;
  createThread: typeof createThread;
  writeMaterials: typeof writeLiveMaterials;
  providerModel: () => string;
  now: () => number;
}

function defaultDeps(): ZhihuLessonDeps {
  return {
    listCaptures: listZhihuCaptures,
    materialize: materializeCaptures,
    createThread,
    writeMaterials: writeLiveMaterials,
    providerModel: () => resolveTeachLiveProvider().model,
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 纯函数：挑材料、切节选
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<ZhihuPageKind, string> = {
  answer: '回答',
  article: '文章',
  question: '问题',
  pin: '想法',
  zvideo: '视频',
  unknown: '内容',
};

function teachable(kind: ZhihuPageKind): boolean {
  return kind === 'answer' || kind === 'article' || kind === 'question';
}

export function selectLessonMaterials(records: ZhihuCaptureRecord[], maxItems = ZHIHU_LESSON_MAX_ITEMS): {
  chosen: ZhihuCaptureRecord[];
  skipped: Array<{ sourceId: string; title: string; reason: string }>;
} {
  const skipped: Array<{ sourceId: string; title: string; reason: string }> = [];
  const candidates: ZhihuCaptureRecord[] = [];
  for (const record of records) {
    if (!teachable(record.zhihu.kind)) {
      skipped.push({ sourceId: record.id, title: record.title, reason: `${KIND_LABEL[record.zhihu.kind]}没有可讲的正文` });
      continue;
    }
    if (!(record.normalizedText ?? '').trim()) {
      skipped.push({ sourceId: record.id, title: record.title, reason: '连摘要都没有' });
      continue;
    }
    candidates.push(record);
  }
  candidates.sort((a, b) => b.zhihu.voteUpCount - a.zhihu.voteUpCount || b.zhihu.favTime - a.zhihu.favTime);
  const limit = Math.max(1, Math.min(ZHIHU_LESSON_MAX_ITEMS, maxItems));
  const chosen = candidates.slice(0, limit);
  for (const rest of candidates.slice(limit)) {
    skipped.push({ sourceId: rest.id, title: rest.title, reason: `这节课最多讲 ${limit} 篇，按赞同排在后面` });
  }
  return { chosen, skipped };
}

/** 排得越前预算越大：前 3 篇 1800 字，接下来 3 篇 1200，其余 700 */
export function excerptBudget(index: number): number {
  if (index < 3) return 1800;
  if (index < 6) return 1200;
  return 700;
}

/** 在预算内尽量按段落切；切了就标「（节选）」 */
export function excerptOf(text: string, budget: number): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean.length <= budget) return clean;
  const window = clean.slice(0, budget);
  const lastBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('。\n'), window.lastIndexOf('。'));
  const cut = lastBreak > budget * 0.6 ? lastBreak + 1 : budget;
  return `${clean.slice(0, cut).trimEnd()}\n……（节选，全文见原链接）`;
}

function metaLine(record: ZhihuCaptureRecord): string {
  const z = record.zhihu;
  const parts = [KIND_LABEL[z.kind], `赞同 ${z.voteUpCount}`, `评论 ${z.commentCount}`];
  if (z.favTime) parts.push(`${new Date(z.favTime * 1000).toISOString().slice(0, 10)} 收藏`);
  return parts.join(' · ');
}

export function buildMaterialPack(params: { title: string; chosen: ZhihuCaptureRecord[]; skipped: LiveMaterialPack['skipped']; now: number; ownerUserId?: string }): LiveMaterialPack {
  const items: LiveMaterialItem[] = params.chosen.map((record, index) => {
    const full = record.zhihu.body === 'full' && (record.normalizedText ?? '').length > 0;
    const text = record.normalizedText ?? record.previewText ?? '';
    return {
      ref: `A${index + 1}`,
      title: record.title,
      author: record.zhihu.author,
      url: record.zhihu.url,
      meta: metaLine(record),
      body: full ? 'full' : 'summary',
      excerpt: excerptOf(text, full ? excerptBudget(index) : 400),
      sourceId: record.id,
    };
  });
  return {
    v: 1,
    source: 'zhihu-favlist',
    title: params.title,
    items,
    skipped: params.skipped,
    ...(params.ownerUserId ? { ownerUserId: params.ownerUserId } : {}),
    createdAt: new Date(params.now).toISOString(),
  };
}

function inferTitle(records: ZhihuCaptureRecord[], favlistUrlToken?: string): string {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const f of record.zhihu.favlists) {
      if (favlistUrlToken && f.urlToken !== favlistUrlToken) continue;
      counts.set(f.title, (counts.get(f.title) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [title, count] of counts) {
    if (count > bestCount) {
      best = title;
      bestCount = count;
    }
  }
  return best ?? DEFAULT_TOPIC;
}

// ---------------------------------------------------------------------------
// 编排
// ---------------------------------------------------------------------------

export async function buildZhihuLesson(userId: string, input: BuildZhihuLessonInput, deps: Partial<ZhihuLessonDeps> = {}): Promise<ZhihuLessonResult> {
  const d: ZhihuLessonDeps = { ...defaultDeps(), ...deps };
  if (!input.favlistUrlToken && !(input.captureIds?.length)) {
    throw new ZhihuImportError('favlist_not_found', '需要一个收藏夹或几条收藏');
  }
  const records = await d.listCaptures(userId, { favlistUrlToken: input.favlistUrlToken, ids: input.captureIds });
  if (!records.length) throw new ZhihuImportError('favlist_not_found', '这个收藏夹还没有收进来的内容，先导入');

  const { chosen, skipped } = selectLessonMaterials(records, input.maxItems);
  if (!chosen.length) throw new ZhihuImportError('favlist_not_found', '这些收藏里没有可以讲的正文（都是视频或想法）');

  // 只给进材料包的几篇抽正文；抽不到的留摘要（materializeCaptures 已如实标注）
  const needBody = chosen.filter((r) => r.zhihu.body !== 'full').map((r) => r.id);
  const materialized = needBody.length ? await d.materialize(userId, needBody, { concurrency: 3 }) : [];
  const refreshed = needBody.length ? await d.listCaptures(userId, { ids: chosen.map((r) => r.id) }) : chosen;
  const byId = new Map(refreshed.map((r) => [r.id, r]));
  const ordered = chosen.map((r) => byId.get(r.id) ?? r);

  const title = inferTitle(records, input.favlistUrlToken);
  const topic = (input.topic?.trim() || title).slice(0, 100);
  const pack = buildMaterialPack({ title, chosen: ordered, skipped, now: d.now(), ownerUserId: userId });

  const thread = await d.createThread({ topic, model: d.providerModel(), engine: 'live', learner: input.learner ?? null });
  await d.writeMaterials(thread.id, pack);
  log.info('zhihu-lesson: created', {
    userId,
    threadId: thread.id,
    items: pack.items.length,
    full: pack.items.filter((i) => i.body === 'full').length,
    skipped: skipped?.length ?? 0,
  });
  return { thread: { id: thread.id, title: thread.title, topic: thread.topic }, pack, materialized };
}

// ---------------------------------------------------------------------------
// 我开过的课
// ---------------------------------------------------------------------------

export interface ZhihuLessonSummary {
  threadId: string;
  /** 课名跟随老师的首个 scene title，没有就是课题 */
  title: string;
  topic: string;
  /** 收藏夹名 */
  materialsTitle: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 从材料包目录反查这个用户开过的课（TeachThread 没有归属列）；线程已删的不列 */
export async function listLessonsForUser(userId: string, limit = 20): Promise<ZhihuLessonSummary[]> {
  const packs = await listLiveMaterials((pack) => pack.ownerUserId === userId && pack.source === 'zhihu-favlist');
  if (!packs.length) return [];
  const rows = await prisma.teachThread.findMany({
    where: { id: { in: packs.map((p) => p.threadId) }, status: 'active' },
    select: { id: true, title: true, topic: true, createdAt: true, updatedAt: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return packs
    .flatMap(({ threadId, pack }) => {
      const row = byId.get(threadId);
      if (!row) return [];
      return [{
        threadId,
        title: row.title,
        topic: row.topic,
        materialsTitle: pack.title,
        itemCount: pack.items.length,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

