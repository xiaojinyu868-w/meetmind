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
import { listLiveMaterials, writeLiveMaterials, type LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import prisma from '@/lib/prisma';
import type { LearnerContext } from '@/types/learner-context';
import { createLogger } from '@/lib/logger';
import { listZhihuCaptures, materializeCaptures, ZhihuImportError, type MaterializeResult, type ZhihuCaptureRecord } from './zhihu-import-service';
import {
  buildPack,
  excerptBudget as coreExcerptBudget,
  excerptFor as coreExcerptFor,
  excerptOf as coreExcerptOf,
  headExcerpt as coreHeadExcerpt,
  outlineOf as coreOutlineOf,
  selectByRank,
  selectNamed,
  type LessonMode,
  type MaterialSelection,
} from '@/lib/services/material-lessons/material-lesson-planner';

const log = createLogger('zhihu-lesson');

export const ZHIHU_LESSON_MAX_ITEMS = 8;
const DEFAULT_TOPIC = '知乎收藏夹里的一节课';

/**
 * 本文件是知乎对「从材料开一节课」能力层（services/material-lessons）的适配：captures → MaterialCandidate，其余交给能力层。
 * 课的单位（2026-09-13 起）：
 * - single：讲学生收藏的**一篇**——全文直接给（≤12000 字），再长按结构取到 8000 字并附小节目录；这是主路径
 * - theme：一条线上的 2–4 篇一起讲，每篇 ≤4000 字，老师负责把它们连起来
 * - favlist：整个收藏夹（旧路径，≤8 篇 1800/1200/700 节选）——只作兜底 / smoke，第一屏不再直接用
 */
export type ZhihuLessonMode = 'single' | 'theme' | 'favlist';

export interface BuildZhihuLessonInput {
  favlistUrlToken?: string;
  captureIds?: string[];
  topic?: string;
  maxItems?: number;
  /** 不传：一条 captureId → single；多条 → theme；只给收藏夹 → favlist */
  mode?: ZhihuLessonMode;
  /** 「随手开一节」时同学替学生挑了这篇的理由，进材料包也进课堂页 */
  pickReason?: string;
  learner?: LearnerContext | null;
}

export { SINGLE_FULL_TEXT_LIMIT, SINGLE_EXCERPT_BUDGET, THEME_MAX_ITEMS, THEME_EXCERPT_BUDGET, SUMMARY_BUDGET } from '@/lib/services/material-lessons/material-lesson-planner';
import { THEME_MAX_ITEMS } from '@/lib/services/material-lessons/material-lesson-planner';

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
  /** 这位学生之前上过的相关课（给老师一句"别从头讲同一段"）：single 按同一篇（sourceId），其余按同一收藏夹；默认查材料包目录 + TeachThread */
  priorLessons: (userId: string, materialsTitle: string, sourceIds: string[]) => Promise<ZhihuLessonSummary[]>;
  providerModel: () => string;
  now: () => number;
}

function defaultDeps(): ZhihuLessonDeps {
  return {
    listCaptures: listZhihuCaptures,
    materialize: materializeCaptures,
    createThread,
    writeMaterials: writeLiveMaterials,
    priorLessons: async (userId, materialsTitle, sourceIds) => {
      const all = await listLessonsForUser(userId, 50);
      if (sourceIds.length) return all.filter((l) => l.sourceIds.some((id) => sourceIds.includes(id)));
      return all.filter((l) => l.materialsTitle === materialsTitle);
    },
    providerModel: () => resolveTeachLiveProvider().model,
    now: () => Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 纯函数：挑材料、切节选
// ---------------------------------------------------------------------------

export { candidateOf, materialKindOf } from './zhihu-material-candidate';
import { candidateOf } from './zhihu-material-candidate';

export function toLessonMode(mode: ZhihuLessonMode): LessonMode {
  return mode === 'favlist' ? 'collection' : mode;
}

function selectionToRecords(records: ZhihuCaptureRecord[], selection: MaterialSelection): { chosen: ZhihuCaptureRecord[]; skipped: MaterialSelection['skipped'] } {
  const byId = new Map(records.map((r) => [r.id, r]));
  return { chosen: selection.chosen.map((c) => byId.get(c.id)).filter((r): r is ZhihuCaptureRecord => Boolean(r)), skipped: selection.skipped };
}

/** 整夹（旧路径）：按赞同挑 ≤8 篇 —— 能力层 selectByRank 的知乎壳 */
export function selectLessonMaterials(records: ZhihuCaptureRecord[], maxItems = ZHIHU_LESSON_MAX_ITEMS) {
  return selectionToRecords(records, selectByRank(records.map(candidateOf), maxItems));
}

/** 点名的几篇 —— 能力层 selectNamed 的知乎壳 */
export function selectNamedMaterials(records: ZhihuCaptureRecord[], ids: string[], maxItems: number) {
  return selectionToRecords(records, selectNamed(records.map(candidateOf), ids, maxItems));
}

// 节选相关纯函数由能力层提供；这里保留同名导出，旧测试与调用方不动
export const outlineOf = coreOutlineOf;
export const excerptOf = coreExcerptOf;
export const headExcerpt = coreHeadExcerpt;
export const excerptBudget = coreExcerptBudget;
export function excerptFor(text: string, mode: ZhihuLessonMode, index: number, full: boolean): string {
  return coreExcerptFor(text, toLessonMode(mode), index, full);
}

export function buildMaterialPack(params: { title: string; chosen: ZhihuCaptureRecord[]; skipped: LiveMaterialPack['skipped']; now: number; ownerUserId?: string; priorLessons?: LiveMaterialPack['priorLessons']; mode?: ZhihuLessonMode; pickReason?: string }): LiveMaterialPack {
  return buildPack({
    source: 'zhihu-favlist',
    title: params.title,
    chosen: params.chosen.map(candidateOf),
    skipped: params.skipped ?? [],
    now: params.now,
    mode: toLessonMode(params.mode ?? 'favlist'),
    ownerUserId: params.ownerUserId,
    priorLessons: params.priorLessons,
    pickReason: params.pickReason,
  });
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

  const mode: ZhihuLessonMode = input.mode ?? (input.captureIds?.length === 1 ? 'single' : input.captureIds?.length ? 'theme' : 'favlist');
  const maxItems = mode === 'single' ? 1 : mode === 'theme' ? Math.min(THEME_MAX_ITEMS, input.maxItems ?? THEME_MAX_ITEMS) : input.maxItems;
  // single / theme 是学生（或同学替学生）点名的几篇：保持点名顺序，不按赞同重排
  const { chosen, skipped } =
    mode === 'favlist'
      ? selectLessonMaterials(records, maxItems)
      : selectNamedMaterials(records, input.captureIds ?? [], maxItems ?? THEME_MAX_ITEMS);
  if (!chosen.length) throw new ZhihuImportError('favlist_not_found', '这些收藏里没有可以讲的正文（都是视频或想法）');

  // 只给进材料包的几篇抽正文；抽不到的留摘要（materializeCaptures 已如实标注）
  const needBody = chosen.filter((r) => r.zhihu.body !== 'full').map((r) => r.id);
  const materialized = needBody.length ? await d.materialize(userId, needBody, { concurrency: 3 }) : [];
  const refreshed = needBody.length ? await d.listCaptures(userId, { ids: chosen.map((r) => r.id) }) : chosen;
  const byId = new Map(refreshed.map((r) => [r.id, r]));
  const ordered = chosen.map((r) => byId.get(r.id) ?? r);

  const title = inferTitle(records, input.favlistUrlToken);
  const topic = (input.topic?.trim() || (mode === 'single' ? ordered[0].title : title)).slice(0, 100);
  // 之前上过的相关课（single 按同一篇，其余按同一收藏夹）：告诉老师别从头讲同一段（查失败不影响开课）
  const prior = await d.priorLessons(userId, title, mode === 'single' ? ordered.map((r) => r.id) : []).catch(() => [] as ZhihuLessonSummary[]);
  const pack = buildMaterialPack({
    title,
    chosen: ordered,
    skipped,
    now: d.now(),
    ownerUserId: userId,
    priorLessons: prior.slice(0, 5).map((l) => ({ threadId: l.threadId, title: l.title || l.topic, createdAt: l.createdAt })),
    mode,
    pickReason: input.pickReason,
  });

  const thread = await d.createThread({ topic, model: d.providerModel(), engine: 'live', learner: input.learner ?? null });
  await d.writeMaterials(thread.id, pack);
  log.info('zhihu-lesson: created', {
    userId,
    threadId: thread.id,
    mode,
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
  /** 进了材料包的 capture id（按篇记课用） */
  sourceIds: string[];
  mode: ZhihuLessonMode;
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
        sourceIds: pack.items.map((i) => i.sourceId).filter((id): id is string => Boolean(id)),
        mode: (pack.mode as ZhihuLessonMode | undefined) ?? 'favlist',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }];
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

