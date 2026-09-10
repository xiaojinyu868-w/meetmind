/**
 * teach-back-room-model — 「讲给同桌听 · 面试间」表现层的纯逻辑（零依赖，Vitest 覆盖）。
 *
 * 面试间 v3（2026-09-10）：讲者面对的是一排评委，不是自己的转写。画面上只有评委席（三位大肖像立在桌沿上）、
 * 开口那位脚下长出的话、下面的对话记录、左侧的手卡、底部的讲台栏。这里放的是画面要做的几个判断，都是纯函数：
 *   - 评委脚下的话：说完后留一会（SPEECH_LINGER_MS）再淡进对话记录；淡出的曲线；被打断的立刻收进记录；
 *   - 讲完后的"表演"：记下的笔记与复盘按顺序一条条由评委说出来——什么时候算说完（字打完 + 读完的时间 +
 *     声音安静下来）由 performanceFinished 判；
 *   - 对话记录：时间倒序，默认只露最近几条（foldRecord）；
 *   - 手卡：讲者点一张翻过去（toggleFlipped），只是提醒自己讲到哪，不做 AI 判定；
 *   - 反馈条目：实时反馈关着时记下的话讲完后怎么按时间一条条揭示、每位记了几笔；
 *   - 三位评委此刻的状态（在听 / 想问 / 在说 / 记了 N 笔）由真实事件推出来，画面用表情 + 一枚指示点表达；
 *   - 复盘：把 evaluate 的核对结果改写成三位评委各自会说的话（直言说没讲清的、引导说最稳的 +
 *     下一步、追问说没讲到的）——只做分配与排序，不改核对结论、不打分、不上色；
 *   - 点一条记录回到那段转写：反馈按回合号直达；复盘句子按目标点与你的原话相似度找回合。
 *
 * 文案不在这里（见 copy-apps.ts teachBack）；这里只吐结构，组件负责说人话。
 */

import type { TeachBackEvaluation, TeachBackEvaluationItem, TeachBackJudgeId } from '@/lib/ai-native/types';

/** 面试间的三个阶段：开场（评委坐好、手卡在中央）→ 讲 → 讲完了（复盘在同一界面） */
export type RoomStage = 'opening' | 'talking' | 'finished';

/** 你讲过的一段（回合），时间是会话内相对毫秒 */
export interface TranscriptTurn {
  turnIndex: number;
  text: string;
  startedAt: number;
  endedAt: number;
}

export type FeedbackState = 'streaming' | 'done' | 'interrupted';

/** 反馈流里的一条：谁、什么时候（会话内毫秒）、对着你哪一段说的 */
export interface FeedbackEntry {
  id: string;
  judgeId: TeachBackJudgeId;
  /** 对应你讲的哪一回合；检查点（check-in）没有回合 → null */
  turnIndex: number | null;
  at: number;
  text: string;
  state: FeedbackState;
  /** 实时反馈关着时记下的：讲完前不上屏、不出声 */
  held: boolean;
  /** 讲完后已经揭示出来（held 专用） */
  revealed: boolean;
}

/** 反馈流：只看得见实时说出的与已揭示的，最新的在最上 */
export function visibleFeedback(entries: FeedbackEntry[]): FeedbackEntry[] {
  return entries
    .filter((entry) => !entry.held || entry.revealed)
    .sort((a, b) => b.at - a.at);
}

/** 讲完后要揭示的下一条：记下的、说完了的、还没露面的，按时间从早到晚 */
export function nextHeldToReveal(entries: FeedbackEntry[]): FeedbackEntry | null {
  const pending = entries
    .filter((entry) => entry.held && !entry.revealed && entry.state !== 'streaming')
    .sort((a, b) => a.at - b.at);
  return pending[0] ?? null;
}

/** 每位听众记了几笔（实时反馈关着时右栏显示的数字；被打断的不算） */
export function heldCounts(entries: FeedbackEntry[]): Record<TeachBackJudgeId, number> {
  const counts: Record<TeachBackJudgeId, number> = { direct: 0, guide: 0, probe: 0 };
  for (const entry of entries) {
    if (entry.held && !entry.revealed && entry.state !== 'interrupted') counts[entry.judgeId] += 1;
  }
  return counts;
}

/** 被打断的那条只剩一行灰字；说了不到 8 个字就被打断的连这一行也不留 */
export function shouldShowEntry(entry: FeedbackEntry): boolean {
  if (entry.state === 'interrupted') return entry.text.trim().length >= 8;
  return entry.state === 'streaming' || entry.text.trim().length > 0;
}

export type ListenerStatus = 'listening' | 'thinking' | 'speaking' | 'noted' | 'closing';

export interface ListenerContext {
  activeJudge: TeachBackJudgeId | null;
  /** 回合请求在飞、还没人开口（实时反馈开着才会显示） */
  requestInFlight: boolean;
  liveFeedback: boolean;
  heldCount: number;
  finished: boolean;
}

/** 听众此刻的状态词——全部来自真实事件，没有装饰性的动画 */
export function listenerStatusOf(judgeId: TeachBackJudgeId, context: ListenerContext): ListenerStatus {
  if (context.finished) return 'closing';
  if (context.activeJudge === judgeId) return 'speaking';
  if (!context.liveFeedback && context.heldCount > 0) return 'noted';
  if (context.liveFeedback && context.requestInFlight && context.activeJudge === null) return 'thinking';
  return 'listening';
}

/** 揭示节奏：讲完后一条接一条长出来的间隔 */
export const HELD_REVEAL_INTERVAL_MS = 600;

/* ── 复盘：evaluate 结果 → 三位听众各自的话 ── */

export interface ReviewLine {
  item: TeachBackEvaluationItem;
  /** 这一句点开回到你讲的哪一回合；找不到（没讲到）→ null */
  turnIndex: number | null;
}

export type ReviewBlockKind =
  /** 直言：没讲清 / 讲错了（盲区在前，自知缺口在后） */
  | 'unclear'
  /** 引导：讲得最稳的一点 + 接下来先说哪一点 */
  | 'steady'
  /** 追问：还没讲到的 */
  | 'uncovered';

export interface ReviewBlock {
  judgeId: TeachBackJudgeId;
  kind: ReviewBlockKind;
  lines: ReviewLine[];
  /** steady 专用：接下来先把它说一遍（第一处没讲清 → 没讲到） */
  next: ReviewLine | null;
}

const QUADRANT_ORDER: Record<string, number> = { 'blind-spot': 0, 'aware-gap': 1 };

function bigrams(text: string): Set<string> {
  const clean = text.replace(/[\s，。！？；、,.!?;:：「」（）()【】\[\]]/g, '');
  const grams = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1) grams.add(clean.slice(i, i + 2));
  return grams;
}

/**
 * 目标点在你的哪一段里讲到过：按字符二元组重合度找最像的回合；重合太少（不足 3 个或 < 30%）算没讲到——
 * 「函数」「求导」这类课里到处都是的词，两个重合不足以说明你讲的就是它。
 * 只是回到原话的落点，不是核对依据——核对依据是 evaluate 自己的结论。
 */
export function locateTurnForPoint(point: string, turns: TranscriptTurn[]): number | null {
  const target = bigrams(point);
  if (target.size === 0) return null;
  let best: { turnIndex: number; score: number } | null = null;
  for (const turn of turns) {
    const grams = bigrams(turn.text);
    let hits = 0;
    for (const gram of target) if (grams.has(gram)) hits += 1;
    const score = hits / target.size;
    if (hits >= 3 && score >= 0.3 && (!best || score > best.score)) best = { turnIndex: turn.turnIndex, score };
  }
  return best?.turnIndex ?? null;
}

export function buildReviewBlocks(evaluation: TeachBackEvaluation, turns: TranscriptTurn[]): ReviewBlock[] {
  const toLine = (item: TeachBackEvaluationItem): ReviewLine => ({
    item,
    turnIndex: item.coverage === 'missed' ? null : locateTurnForPoint(item.point, turns),
  });
  const unclear = evaluation.items
    .filter((item) => item.quadrant === 'blind-spot' || item.quadrant === 'aware-gap')
    .sort((a, b) => (QUADRANT_ORDER[a.quadrant ?? ''] ?? 9) - (QUADRANT_ORDER[b.quadrant ?? ''] ?? 9))
    .map(toLine);
  const uncovered = evaluation.items.filter((item) => item.quadrant === null || item.coverage === 'missed').map(toLine);
  // 讲得最稳：讲透了优先，其次挣扎着讲通了；一句话只夸一点
  const steady = evaluation.items.find((item) => item.quadrant === 'mastery')
    ?? evaluation.items.find((item) => item.quadrant === 'productive-struggle')
    ?? null;
  const next = unclear[0] ?? uncovered[0] ?? null;
  return [
    { judgeId: 'direct', kind: 'unclear', lines: unclear, next: null },
    { judgeId: 'guide', kind: 'steady', lines: steady ? [toLine(steady)] : [], next },
    { judgeId: 'probe', kind: 'uncovered', lines: uncovered, next: null },
  ];
}

/** 「只讲没讲清的」：盲区 + 自知缺口 + 没讲到的目标 id（按复盘顺序） */
export function reteachTargetIds(evaluation: TeachBackEvaluation): string[] {
  const blocks = buildReviewBlocks(evaluation, []);
  const ids = [
    ...(blocks.find((block) => block.kind === 'unclear')?.lines ?? []),
    ...(blocks.find((block) => block.kind === 'uncovered')?.lines ?? []),
  ].map((line) => line.item.targetId);
  return Array.from(new Set(ids));
}

/** 会话内时钟 mm:ss（超过一小时也只走分钟） */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** 容器多宽才把手卡放成左侧一列（220px）；窄于此（手机 / 复习页中栏 / 小浮窗）= 顶部横向条 */
export const CUE_COLUMN_MIN_WIDTH = 720;

/* ── 手卡：讲者点一张翻过去（"讲过了"），再点翻回来；纯提醒，不做 AI 判定 ── */

export function toggleFlipped(flipped: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(flipped);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/* ── 评委脚下的话：说完后留一会再淡进对话记录 ── */

/** 说完（声音也停了）以后这段话还留在脚下多久 */
export const SPEECH_LINGER_MS = 7_000;
/** 留的最后这段时间里逐渐淡下去 */
export const SPEECH_FADE_MS = 1_400;

export type SpeechPhase = 'speaking' | 'lingering' | 'gone';

/**
 * 一段话此刻在哪个相位：还没说完（closedAt 为 null）= speaking；说完了但没到期 = lingering；到期 = gone（进对话记录）。
 */
export function speechPhaseOf(closedAt: number | null, now: number, lingerMs = SPEECH_LINGER_MS): SpeechPhase {
  if (closedAt === null) return 'speaking';
  return now - closedAt >= lingerMs ? 'gone' : 'lingering';
}

/** 留着的这段话的不透明度：前面一直是 1，最后 SPEECH_FADE_MS 线性淡到 0 */
export function lingerOpacity(closedAt: number, now: number, lingerMs = SPEECH_LINGER_MS, fadeMs = SPEECH_FADE_MS): number {
  const remaining = lingerMs - (now - closedAt);
  if (remaining >= fadeMs) return 1;
  if (remaining <= 0) return 0;
  return Math.round((remaining / fadeMs) * 100) / 100;
}

/* ── 讲完后的表演：记下的笔记与复盘由评委一条条说出来 ── */

/** 表演时逐字流出的速度 */
export const PERFORM_TYPE_MS_PER_CHAR = 28;
/** 一条说完后留在脚下多久再进记录（比实时回合短：后面还有人等着说） */
export const PERFORM_SETTLE_MS = 1_800;
/** 出声开着但声音一直没来（TTS 挂了）：最多再等这么久就当说完 */
export const PERFORM_VOICE_GRACE_MS = 5_000;
/** 声音停下多久才确认真的说完了（句间取下一句音频会有短暂空档） */
export const PERFORM_QUIET_CONFIRM_MS = 1_200;
/** 任何一条最多占台多久 */
export const PERFORM_MAX_MS = 60_000;

/** 读完一段话需要的时间：字数 × 110ms，钳在 2.5s ~ 14s */
export function readingTimeMs(text: string): number {
  return Math.min(14_000, Math.max(2_500, 1_500 + text.trim().length * 110));
}

/** 表演到现在打出了几个字 */
export function typedChars(text: string, elapsedMs: number, msPerChar = PERFORM_TYPE_MS_PER_CHAR): number {
  return Math.min(text.length, Math.max(0, Math.floor(elapsedMs / msPerChar)));
}

export interface PerformanceProgress {
  text: string;
  /** 这条开始表演到现在的毫秒 */
  elapsedMs: number;
  voiceEnabled: boolean;
  /** 这条的声音出现过（speakingJudge 曾等于这位） */
  voiceHeard: boolean;
  /** 声音停下多久了（还在响 / 没响过 = null） */
  quietForMs: number | null;
}

/**
 * 这条算说完了吗：字要打完、读完的时间要够；出声开着还要等声音——响过就等它安静满 PERFORM_QUIET_CONFIRM_MS，
 * 没响过就再宽限 PERFORM_VOICE_GRACE_MS（TTS 失败静默回退到文字）。无论如何不超过 PERFORM_MAX_MS。
 */
export function performanceFinished(progress: PerformanceProgress): boolean {
  const { text, elapsedMs, voiceEnabled, voiceHeard, quietForMs } = progress;
  if (elapsedMs >= PERFORM_MAX_MS) return true;
  const typed = typedChars(text, elapsedMs) >= text.length;
  const read = elapsedMs >= readingTimeMs(text);
  if (!typed || !read) return false;
  if (!voiceEnabled) return true;
  if (voiceHeard) return quietForMs !== null && quietForMs >= PERFORM_QUIET_CONFIRM_MS;
  return elapsedMs >= readingTimeMs(text) + PERFORM_VOICE_GRACE_MS;
}

/* ── 对话记录：时间倒序，默认只露最近几条 ── */

export const RECORD_FOLD_LIMIT = 3;

export interface RecordEntry {
  id: string;
  judgeId: TeachBackJudgeId;
  text: string;
  /** 会话内毫秒（排序用） */
  at: number;
  /** 对着你哪一段说的；复盘 / 检查点没有 → null */
  turnIndex: number | null;
  kind: 'turn' | 'note' | 'review';
  /** 被你打断、没说完 */
  interrupted: boolean;
}

/** 最新的在最上；同一时刻后加进来的算更新（先倒序再稳定排序） */
export function sortRecord<T extends { at: number }>(entries: T[]): T[] {
  return [...entries].reverse().sort((a, b) => b.at - a.at);
}

/** 默认只露最近 limit 条；expanded 时全部 */
export function foldRecord<T>(entries: T[], expanded: boolean, limit = RECORD_FOLD_LIMIT): { shown: T[]; hidden: number } {
  if (expanded || entries.length <= limit) return { shown: entries, hidden: 0 };
  return { shown: entries.slice(0, limit), hidden: entries.length - limit };
}
