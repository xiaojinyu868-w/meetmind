/**
 * 「从材料开一节课」的能力层：选材、课的单位、每篇给老师多少、材料包组装。与来源无关——输入是 MaterialCandidate[]。
 *
 * 课的单位（2026-09-13 起）：
 * - single：讲学生收藏的**一篇**——全文直接给（≤12000 字），再长按结构取到 8000 字并附小节目录；这是主路径
 * - theme：一条线上的 2–4 篇一起讲，每篇 ≤4000 字，老师负责把它们连起来
 * - collection：整组材料按赞同挑 ≤8 篇 1800/1200/700 节选——只作兜底 / smoke，第一屏不再直接用（来源方旧名 favlist）
 *
 * 节选是给老师的材料不是给学生的正文：宁可每节短也要带骨架和结论（按结构取）。
 * 从 services/zhihu/zhihu-lesson-service 抽出（2026-09-13），知乎那边只剩 captures → candidates 的映射。
 */

import type { LiveMaterialItem, LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import { isTeachableKind, MATERIAL_KIND_LABEL, type MaterialCandidate } from './material-candidate';

export type LessonMode = 'single' | 'theme' | 'collection';

export const COLLECTION_MAX_ITEMS = 8;
export const SINGLE_FULL_TEXT_LIMIT = 12_000;
export const SINGLE_EXCERPT_BUDGET = 8_000;
export const THEME_MAX_ITEMS = 4;
export const THEME_EXCERPT_BUDGET = 4_000;
export const SUMMARY_BUDGET = 400;

export interface MaterialSelection {
  chosen: MaterialCandidate[];
  skipped: Array<{ sourceId: string; title: string; reason: string }>;
}

function unteachableReason(candidate: MaterialCandidate): string | null {
  if (!isTeachableKind(candidate.kind)) return `${MATERIAL_KIND_LABEL[candidate.kind]}没有可讲的正文`;
  if (!candidate.text.trim()) return '连摘要都没有';
  return null;
}

/** 整组材料（collection 模式）：按赞同 → 收藏时间排序，只留能讲的，≤ maxItems */
export function selectByRank(candidates: MaterialCandidate[], maxItems = COLLECTION_MAX_ITEMS): MaterialSelection {
  const skipped: MaterialSelection['skipped'] = [];
  const teachable: MaterialCandidate[] = [];
  for (const candidate of candidates) {
    const reason = unteachableReason(candidate);
    if (reason) skipped.push({ sourceId: candidate.id, title: candidate.title, reason });
    else teachable.push(candidate);
  }
  teachable.sort((a, b) => b.votes - a.votes || b.collectedAt - a.collectedAt);
  const limit = Math.max(1, Math.min(COLLECTION_MAX_ITEMS, maxItems));
  const chosen = teachable.slice(0, limit);
  for (const rest of teachable.slice(limit)) {
    skipped.push({ sourceId: rest.id, title: rest.title, reason: `这节课最多讲 ${limit} 篇，按赞同排在后面` });
  }
  return { chosen, skipped };
}

/** 学生（或同学替学生）点名的几篇：保持点名顺序、只剔掉没法讲的，超出上限的进 skipped */
export function selectNamed(candidates: MaterialCandidate[], ids: string[], maxItems: number): MaterialSelection {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ordered = ids.length ? ids.map((id) => byId.get(id)).filter((c): c is MaterialCandidate => Boolean(c)) : candidates;
  const skipped: MaterialSelection['skipped'] = [];
  const chosen: MaterialCandidate[] = [];
  const limit = Math.max(1, maxItems);
  for (const candidate of ordered) {
    const reason = unteachableReason(candidate);
    if (reason) {
      skipped.push({ sourceId: candidate.id, title: candidate.title, reason });
      continue;
    }
    if (chosen.length >= limit) {
      skipped.push({ sourceId: candidate.id, title: candidate.title, reason: `一条线一节课最多讲 ${limit} 篇` });
      continue;
    }
    chosen.push(candidate);
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
export function excerptFor(text: string, mode: LessonMode, index: number, full: boolean): string {
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


export interface BuildPackParams {
  /** 来源标识（如 zhihu-favlist），只给日志与前端展示 */
  source: string;
  /** 这组材料的名字（收藏夹名） */
  title: string;
  chosen: MaterialCandidate[];
  skipped: LiveMaterialPack['skipped'];
  now: number;
  mode: LessonMode;
  ownerUserId?: string;
  priorLessons?: LiveMaterialPack['priorLessons'];
  pickReason?: string;
}

/** 把选好的材料装进给 teach-live 的材料包（collection 在包里仍写作旧名 favlist，前端 / 已落盘的包都认它） */
export function buildPack(params: BuildPackParams): LiveMaterialPack {
  const items: LiveMaterialItem[] = params.chosen.map((candidate, index) => ({
    ref: `A${index + 1}`,
    title: candidate.title,
    author: candidate.author,
    url: candidate.url,
    meta: candidate.meta,
    body: candidate.hasFullText && candidate.text.length > 0 ? 'full' : 'summary',
    excerpt: excerptFor(candidate.text, params.mode, index, candidate.hasFullText && candidate.text.length > 0),
    sourceId: candidate.id,
  }));
  return {
    v: 1,
    source: params.source,
    title: params.title,
    items,
    skipped: params.skipped,
    ...(params.ownerUserId ? { ownerUserId: params.ownerUserId } : {}),
    ...(params.priorLessons?.length ? { priorLessons: params.priorLessons } : {}),
    mode: params.mode === 'collection' ? 'favlist' : params.mode,
    ...(params.pickReason ? { pickReason: params.pickReason.slice(0, 120) } : {}),
    createdAt: new Date(params.now).toISOString(),
  };
}
