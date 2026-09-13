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

/**
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

export const SINGLE_FULL_TEXT_LIMIT = 12_000;
export const SINGLE_EXCERPT_BUDGET = 8_000;
export const THEME_MAX_ITEMS = 4;
export const THEME_EXCERPT_BUDGET = 4_000;
export const SUMMARY_BUDGET = 400;

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

/** 小节目录：给老师看全文骨架（超长单篇按结构取时附上，让它知道自己讲到哪、还剩什么） */
export function outlineOf(text: string, max = 30): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+\S/.test(line) && line.length <= 80)
    .map((line) => line.replace(/^#{1,6}\s+/, ''))
    .slice(0, max);
}

/** 按课的单位决定每篇给老师多少：single 全文优先，theme 每篇 4000，favlist 沿用位次预算 */
export function excerptFor(text: string, mode: ZhihuLessonMode, index: number, full: boolean): string {
  if (!full) return excerptOf(text, SUMMARY_BUDGET);
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (mode === 'single') {
    if (clean.length <= SINGLE_FULL_TEXT_LIMIT) return clean;
    const outline = outlineOf(clean);
    const head = outline.length
      ? `（全文 ${clean.length} 字、${outline.length} 节，下面是开头、各节首段与结尾；目录：${outline.join(' / ')}）\n\n`
      : `（全文 ${clean.length} 字，下面是节选）\n\n`;
    return head + excerptOf(clean, SINGLE_EXCERPT_BUDGET);
  }
  if (mode === 'theme') return excerptOf(clean, THEME_EXCERPT_BUDGET);
  return excerptOf(clean, excerptBudget(index));
}

/** 学生点名的几篇：按点名顺序、只剔掉没法讲的（视频 / 想法 / 连摘要都没有），超出上限的进 skipped */
export function selectNamedMaterials(records: ZhihuCaptureRecord[], ids: string[], maxItems: number): {
  chosen: ZhihuCaptureRecord[];
  skipped: Array<{ sourceId: string; title: string; reason: string }>;
} {
  const byId = new Map(records.map((r) => [r.id, r]));
  const orderedRecords = ids.length ? ids.map((id) => byId.get(id)).filter((r): r is ZhihuCaptureRecord => Boolean(r)) : records;
  const skipped: Array<{ sourceId: string; title: string; reason: string }> = [];
  const chosen: ZhihuCaptureRecord[] = [];
  for (const record of orderedRecords) {
    if (!teachable(record.zhihu.kind)) {
      skipped.push({ sourceId: record.id, title: record.title, reason: `${KIND_LABEL[record.zhihu.kind]}没有可讲的正文` });
      continue;
    }
    if (!(record.normalizedText ?? '').trim()) {
      skipped.push({ sourceId: record.id, title: record.title, reason: '连摘要都没有' });
      continue;
    }
    if (chosen.length >= Math.max(1, maxItems)) {
      skipped.push({ sourceId: record.id, title: record.title, reason: `一条线一节课最多讲 ${Math.max(1, maxItems)} 篇` });
      continue;
    }
    chosen.push(record);
  }
  return { chosen, skipped };
}

/** 排得越前预算越大：前 3 篇 1800 字，接下来 3 篇 1200，其余 700 */
export function excerptBudget(index: number): number {
  if (index < 3) return 1800;
  if (index < 6) return 1200;
  return 700;
}

/** 从头切：在预算内尽量按句号 / 段落收尾；切了就标「（节选）」 */
export function headExcerpt(text: string, budget: number): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean.length <= budget) return clean;
  const window = clean.slice(0, budget);
  const lastBreak = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('。\n'), window.lastIndexOf('。'));
  const cut = lastBreak > budget * 0.6 ? lastBreak + 1 : budget;
  return `${clean.slice(0, cut).trimEnd()}\n……（节选，全文见原链接）`;
}

function clipSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max);
  const lastStop = Math.max(window.lastIndexOf('。'), window.lastIndexOf('！'), window.lastIndexOf('？'), window.lastIndexOf('；'));
  return `${clean.slice(0, lastStop > max * 0.5 ? lastStop + 1 : max).trimEnd()}…`;
}

/**
 * 按结构节选：长回答 / 专栏常有小标题，从头切 1800 字只能拿到开头 10%，结论段一定丢。
 * 有标题时改为：开头一段 + 每个小标题及其第一段 + 结尾一段（结论），标出「（中间略）」；没有标题就退回从头切。
 * 输出是给老师看的材料，不是给学生读的正文，所以宁可每节短一点也要把骨架和结论带上。
 */
export function excerptOf(text: string, budget: number): string {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (clean.length <= budget) return clean;
  const blocks = clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const isHeading = (b: string) => /^#{1,6}\s+\S/.test(b) && b.length <= 80;
  const headingCount = blocks.filter(isHeading).length;
  if (headingCount < 2) return headExcerpt(clean, budget);

  type Section = { heading: string | null; paragraphs: string[] };
  const sections: Section[] = [{ heading: null, paragraphs: [] }];
  for (const block of blocks) {
    if (isHeading(block)) sections.push({ heading: block.replace(/^#{1,6}\s+/, '').trim(), paragraphs: [] });
    else sections[sections.length - 1].paragraphs.push(block);
  }
  const [preamble, ...titled] = sections;
  const lastParagraph = [...blocks].reverse().find((b) => !isHeading(b)) ?? '';

  const out: string[] = [];
  let used = 0;
  const push = (line: string) => {
    out.push(line);
    used += line.length + 1;
  };
  const reserveTail = Math.min(300, Math.floor(budget * 0.18));
  const bodyBudget = budget - reserveTail - 40;

  if (preamble.paragraphs[0]) push(clipSentence(preamble.paragraphs[0], Math.min(400, Math.floor(bodyBudget * 0.25))));
  const perSection = Math.max(90, Math.floor((bodyBudget - used) / Math.max(1, titled.length)));
  for (const section of titled) {
    if (used >= bodyBudget) {
      push('（后面还有小节，中间略）');
      break;
    }
    push(`## ${section.heading}`);
    const first = section.paragraphs[0];
    if (first) push(clipSentence(first, perSection - (section.heading?.length ?? 0) - 4));
    if (section.paragraphs.length > 1) push('（本节其余略）');
  }
  if (lastParagraph && !out.some((line) => line.startsWith(lastParagraph.slice(0, 20)))) {
    push('## 结尾');
    push(clipSentence(lastParagraph, reserveTail));
  }
  // 后续几遍：预算还剩得多时，轮着把各小节的第 2、3、… 段补上（替换掉「本节其余略」），直到预算用到八成——老师多一点可讲的肉
  for (let k = 1; k < 6 && used < budget * 0.8; k += 1) {
    let added = false;
    for (const section of titled) {
      const next = section.paragraphs[k];
      if (!next) continue;
      const marker = out.indexOf('（本节其余略）', out.indexOf(`## ${section.heading}`));
      if (marker < 0) continue;
      const room = budget - used - 40;
      if (room < 80) break;
      const clipped = clipSentence(next, Math.min(room, Math.max(120, Math.floor(budget / Math.max(1, titled.length)))));
      out.splice(marker, 1, clipped, section.paragraphs.length > k + 1 ? '（本节其余略）' : '');
      used += clipped.length + 1;
      added = true;
    }
    if (!added) break;
  }
  return `${out.filter(Boolean).join('\n').trimEnd()}\n……（按结构节选：开头、各小节首段与结尾；全文见原链接）`;
}

function metaLine(record: ZhihuCaptureRecord): string {
  const z = record.zhihu;
  const parts = [KIND_LABEL[z.kind], `赞同 ${z.voteUpCount}`, `评论 ${z.commentCount}`];
  if (z.favTime) parts.push(`${new Date(z.favTime * 1000).toISOString().slice(0, 10)} 收藏`);
  return parts.join(' · ');
}

export function buildMaterialPack(params: { title: string; chosen: ZhihuCaptureRecord[]; skipped: LiveMaterialPack['skipped']; now: number; ownerUserId?: string; priorLessons?: LiveMaterialPack['priorLessons']; mode?: ZhihuLessonMode; pickReason?: string }): LiveMaterialPack {
  const mode: ZhihuLessonMode = params.mode ?? 'favlist';
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
      excerpt: excerptFor(text, mode, index, full),
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
    ...(params.priorLessons?.length ? { priorLessons: params.priorLessons } : {}),
    mode,
    ...(params.pickReason ? { pickReason: params.pickReason.slice(0, 120) } : {}),
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

