/**
 * 课的物化（2026-09-13）：一节 live 课 → LessonRecord → 客户端存成一节课（IndexedDB audioSessions + transcripts）→ 走和录音课同一个复习页。
 *
 * 这是 teach-live 的能力，不认识任何来源：材料包里写的是知乎还是 B 站还是 PDF，这里一视同仁。
 *
 * 事件日志（data/teach-events/<id>.jsonl，每行带 ts）是唯一事实源：
 * - say / ask 块 → 老师的一段话；student-message → 学生的一句；scene cue → 翻页（页标题）
 * - 时间轴不用日志里的 ts（那是生成速度，一轮几百字几秒就完），按口播长度铺（≈ TTS 语速），学生插话按顺序接在后面——
 *   复习页的"回到 0:42"回的是舞台上说到那句的时刻
 * - 每段老师的话记它讲的是哪篇材料（口播里"材料 1 / 材料一"→ A1；单篇课全部归 A1）
 * 边界：record 只含这节课自己的东西 + 材料包（这节课点名的几篇）+ 之前相关课的一行摘要；收藏夹里别的东西不进。
 */

import type { TeachLogEvent } from '@/lib/services/teach-codex/event-bus';
import type { TeachThreadRow } from '@/lib/services/teach-codex/thread-store';
import { LIVE_SPEECH_KINDS, type LiveBlockKind } from '@/types/teach-live';
import type { LiveMaterialPack } from './live-materials';

/** 口播铺时间轴的语速：约 4.5 字 / 秒（与材料伪转录、TTS 实际语速一致） */
export const LESSON_MS_PER_CHAR = 220;
/** 两段话之间留一口气 */
const GAP_MS = 400;
/** 学生一句话按阅读速度铺，比口播快 */
const STUDENT_MS_PER_CHAR = 120;

export interface LessonRecordSegment {
  id: string;
  speaker: 'teacher' | 'student';
  text: string;
  startMs: number;
  endMs: number;
  /** 这段话讲的是哪篇材料（材料包里的 ref，如 A1）；判不出就没有 */
  sourceRef?: string;
  /** 第几页（scene 序号，从 1 起）；开场还没翻页时为 0 */
  page: number;
  /** 第几轮（老师每讲完一轮 +1，从 1 起） */
  round: number;
}

export interface LessonRecordPage {
  index: number;
  title: string;
  startMs: number;
  /** 这页上板书块的种类统计，如 { draw: 1, note: 2 } */
  blocks: Record<string, number>;
}

export interface LessonRecordMaterialItem {
  ref: string;
  title: string;
  author: string | null;
  url: string;
  meta: string;
  body: 'summary' | 'full';
  /** full 里又分整篇都给了老师 / 只给了带目录的骨架 */
  coverage: 'full-text' | 'outline' | 'summary';
  /** 老师口播里点到过它 */
  mentioned: boolean;
}

export interface LessonRecordMaterials {
  source: string;
  title: string;
  mode: 'single' | 'theme' | 'favlist';
  pickReason: string | null;
  items: LessonRecordMaterialItem[];
  skipped: Array<{ title: string; reason: string }>;
}

export interface LessonRecord {
  v: 1;
  threadId: string;
  engine: 'live';
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  /** 铺出来的总时长（ms） */
  durationMs: number;
  rounds: number;
  /** 最后一轮讲完了没有（false = 正在讲或被打断） */
  settled: boolean;
  segments: LessonRecordSegment[];
  pages: LessonRecordPage[];
  materials: LessonRecordMaterials | null;
  /** 同一篇 / 同一组材料之前的课：只有一行，永远不带转录 */
  priorLessons: Array<{ threadId: string; title: string; createdAt: string }>;
  /** 回到舞台接着讲的地址（按来源决定哪张舞台） */
  stageHref: string;
  /** 概览：老师讲了几页、点到了哪几篇；给复习页与邻居层的一行摘要用 */
  digest: { pagesTaught: string[]; materialsMentioned: string[]; teacherChars: number; studentTurns: number };
}

const CN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 };

/** 口播里点到的材料编号：「材料 1」「材料一」「材料二和材料三」 */
export function materialRefsInText(text: string): string[] {
  const refs = new Set<string>();
  for (const m of text.matchAll(/材料\s*([0-9１-９]|[一二三四五六七八九两])/g)) {
    const raw = m[1];
    const n = /^[0-9]$/.test(raw) ? Number(raw) : /^[１-９]$/.test(raw) ? raw.charCodeAt(0) - 0xff10 : CN_DIGITS[raw];
    if (n && n >= 1 && n <= 9) refs.add(`A${n}`);
  }
  return [...refs];
}

function cleanSpeech(text: string): string {
  // 口播里的内联计算 {{ }} 与多余空白：复习页读的是人话
  return text.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
}

export function stageHrefFor(threadId: string, pack: LiveMaterialPack | null): string {
  if (pack?.source === 'zhihu-favlist') return `/apps/zhihu/lesson/${encodeURIComponent(threadId)}`;
  return `/teach/live?t=${encodeURIComponent(threadId)}`;
}

export function buildLessonRecord(thread: Pick<TeachThreadRow, 'id' | 'title' | 'topic' | 'createdAt' | 'updatedAt'>, events: TeachLogEvent[], pack: LiveMaterialPack | null): LessonRecord {
  const segments: LessonRecordSegment[] = [];
  const pages: LessonRecordPage[] = [];
  const openBlocks = new Map<string, { kind: LiveBlockKind; body: string }>();
  let clock = 0;
  let round = 1;
  let settled = false;
  let speechBlockId: string | null = null;
  let looseSpeech = '';
  const singleRef = pack?.mode === 'single' && pack.items[0] ? pack.items[0].ref : null;

  const pushSegment = (speaker: 'teacher' | 'student', rawText: string) => {
    const text = cleanSpeech(rawText);
    if (!text) return;
    const perChar = speaker === 'teacher' ? LESSON_MS_PER_CHAR : STUDENT_MS_PER_CHAR;
    const startMs = clock;
    const endMs = startMs + Math.max(perChar * 4, text.length * perChar);
    clock = endMs + GAP_MS;
    const refs = speaker === 'teacher' ? materialRefsInText(text) : [];
    const sourceRef = refs[0] ?? (speaker === 'teacher' && singleRef ? singleRef : undefined);
    segments.push({ id: `ls-${segments.length + 1}`, speaker, text, startMs, endMs, ...(sourceRef ? { sourceRef } : {}), page: pages.length, round });
  };
  const flushLoose = () => {
    if (looseSpeech.trim()) pushSegment('teacher', looseSpeech);
    looseSpeech = '';
  };
  const countBlock = (kind: string) => {
    const page = pages[pages.length - 1];
    if (!page) return;
    page.blocks[kind] = (page.blocks[kind] ?? 0) + 1;
  };

  for (const ev of events) {
    switch (ev.type) {
      case 'student-message':
        flushLoose();
        // 首条「开始上课」是页面替学生发的，不算学生说话
        if (segments.length === 0 && ev.text.trim() === '开始上课') break;
        pushSegment('student', ev.text);
        break;
      case 'block-open':
        openBlocks.set(ev.id, { kind: ev.kind, body: '' });
        if (LIVE_SPEECH_KINDS.has(ev.kind)) {
          flushLoose();
          speechBlockId = ev.id;
        } else {
          countBlock(ev.kind);
        }
        break;
      case 'block-delta': {
        const block = openBlocks.get(ev.id);
        if (block) block.body += ev.text;
        break;
      }
      case 'text-delta': {
        const block = speechBlockId ? openBlocks.get(speechBlockId) : undefined;
        if (block) block.body += ev.text;
        else looseSpeech += ev.text;
        break;
      }
      case 'block-close': {
        const block = openBlocks.get(ev.id);
        if (!block) break;
        openBlocks.delete(ev.id);
        if (LIVE_SPEECH_KINDS.has(block.kind)) {
          pushSegment('teacher', block.body);
          if (speechBlockId === ev.id) speechBlockId = null;
        }
        break;
      }
      case 'cue':
        if (ev.name === 'scene') {
          flushLoose();
          const title = String(ev.args?.title ?? '').trim() || `第 ${pages.length + 1} 页`;
          pages.push({ index: pages.length + 1, title, startMs: clock, blocks: {} });
        }
        break;
      case 'turn-complete':
        flushLoose();
        for (const [id, block] of openBlocks) {
          if (LIVE_SPEECH_KINDS.has(block.kind)) pushSegment('teacher', block.body);
          openBlocks.delete(id);
        }
        speechBlockId = null;
        round += 1;
        settled = true;
        break;
      case 'interrupted':
        flushLoose();
        for (const [id, block] of openBlocks) {
          if (LIVE_SPEECH_KINDS.has(block.kind)) pushSegment('teacher', block.body);
          openBlocks.delete(id);
        }
        speechBlockId = null;
        settled = false;
        break;
      case 'error':
        settled = false;
        break;
      default:
        break;
    }
  }
  flushLoose();
  for (const [, block] of openBlocks) if (LIVE_SPEECH_KINDS.has(block.kind)) pushSegment('teacher', block.body);
  if (openBlocks.size) settled = false;

  const mentioned = new Set(segments.flatMap((s) => (s.speaker === 'teacher' ? materialRefsInText(s.text) : [])));
  const materials: LessonRecordMaterials | null = pack
    ? {
        source: pack.source,
        title: pack.title,
        mode: pack.mode ?? 'favlist',
        pickReason: pack.pickReason ?? null,
        items: pack.items.map((item) => ({
          ref: item.ref,
          title: item.title,
          author: item.author,
          url: item.url,
          meta: item.meta,
          body: item.body,
          coverage: item.body !== 'full' ? 'summary' : /^（全文 \d+ 字/.test(item.excerpt) || /节选/.test(item.excerpt.slice(-40)) ? 'outline' : 'full-text',
          mentioned: mentioned.has(item.ref) || (pack.mode === 'single' && item.ref === singleRef),
        })),
        skipped: (pack.skipped ?? []).map((s) => ({ title: s.title, reason: s.reason })),
      }
    : null;

  const teacherChars = segments.filter((s) => s.speaker === 'teacher').reduce((n, s) => n + s.text.length, 0);
  return {
    v: 1,
    threadId: thread.id,
    engine: 'live',
    title: thread.title || thread.topic,
    topic: thread.topic,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    durationMs: segments.length ? segments[segments.length - 1].endMs : 0,
    rounds: Math.max(0, round - 1) + (settled ? 0 : segments.length ? 1 : 0),
    settled,
    segments,
    pages,
    materials,
    priorLessons: pack?.priorLessons ?? [],
    stageHref: stageHrefFor(thread.id, pack),
    digest: {
      pagesTaught: pages.map((p) => p.title),
      materialsMentioned: materials ? materials.items.filter((i) => i.mentioned).map((i) => i.ref) : [],
      teacherChars,
      studentTurns: segments.filter((s) => s.speaker === 'student').length,
    },
  };
}

/** 邻居层用的一行：给下一节课 / 复习 Tutor 看的摘要，永远不带转录 */
export function lessonRecordDigestLine(record: LessonRecord): string {
  const pages = record.digest.pagesTaught.length ? `讲了 ${record.digest.pagesTaught.length} 页：${record.digest.pagesTaught.slice(0, 4).join(' / ')}` : '还没翻页';
  const mats = record.digest.materialsMentioned.length ? `；点到 ${record.digest.materialsMentioned.join(' ')}` : '';
  return `《${record.title}》（${Math.max(1, Math.round(record.durationMs / 60000))} 分钟，${record.rounds} 轮）：${pages}${mats}`;
}
