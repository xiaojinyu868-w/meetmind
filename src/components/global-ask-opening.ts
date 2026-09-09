/**
 * global-ask-opening — 问同学第一屏：同学开口的那一两句（纯函数，可单测）
 *
 * 之前的空态把上下文当库存陈列（"正在读：chip chip +4 / 记住：chip / 会参考 6 份…"），像一张表单。
 * 人对人不是这样开口的。同学看过你的课，应该直接说出它注意到的两件事：
 *   「刚听完《AI 场景上下文应用》。你在 0:30、1:12 停过。「线性规划的建模」还没稳。」
 * 句子里的书名 / 时间点 / 概念本身就是可点的——点它，一句指向那个位置的问题落进输入框。
 * 没有标签、没有计数、没有 chip。只陈述事实，最多两句，按"此刻 → 最近 → 长期"取最要紧的。
 *
 * 数据来自 buildAskDesk（同一份事实源），这里只负责把事实说成话，并挑出最多 3 条"可以从这里开始"。
 */

import type { LearningThreadEntry } from '@/types/user';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import type { DeskGroup, DeskItem } from './global-ask-desk';

export type OpeningPartKind = 'text' | 'lesson' | 'stamp' | 'concept';

export interface OpeningPart {
  kind: OpeningPartKind;
  text: string;
  /** 可点部分：点了落进输入框的问题 */
  prompt?: string;
}

export interface OpeningStarter {
  id: string;
  text: string;
  prompt: string;
}

export interface AskOpening {
  /** 同学开口的话（按顺序渲染；kind !== 'text' 的是可点的） */
  parts: OpeningPart[];
  /** 「可以从这里开始」——最多 3 条，不与开口里已可点的重复 */
  starters: OpeningStarter[];
  /** 同学还没读到任何东西（要给试听 / 上课的出口） */
  empty: boolean;
}

export interface AskOpeningInput {
  desk: readonly DeskGroup[];
  activeThread?: Pick<LearningThreadEntry, 'title' | 'intent' | 'status'>;
  /** 宿主算好的有根建议句（buildGlobalAskStarters），作为兜底 */
  fallbackStarters: readonly string[];
  depth: 'quick' | 'deep';
  /** 访客有试听入口 */
  canStartDemo: boolean;
  /** 测试注入"现在" */
  now?: Date;
}

const MAX_STARTERS = 3;
const MAX_STAMPS_IN_SENTENCE = 2;
const LESSON_MAX = 22;

function group(desk: readonly DeskGroup[], id: DeskGroup['id']): DeskItem[] {
  return desk.find((g) => g.id === id)?.items ?? [];
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  let units = 0;
  for (let i = 0; i < t.length; i += 1) {
    units += /[\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(t[i]) ? 2 : 1;
    if (units > max * 2) return `${t.slice(0, i).trimEnd()}…`;
  }
  return t;
}

/** 课名按「主题 · 课程 · M-D」契约只念主题——一句话里念全名太长，也不像人说话 */
function lessonName(label: string): string {
  return clip(label.split(' · ')[0] || label, LESSON_MAX);
}

/** 自然日差：0 今天、1 昨天…；无效日期返回 undefined */
function daysAgo(at: string | undefined, now: Date): number | undefined {
  if (!at) return undefined;
  const then = new Date(at);
  if (Number.isNaN(then.getTime())) return undefined;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(then)) / 86_400_000);
  return diff < 0 ? 0 : diff;
}

/** "上次是《X》"太干——知道是哪天就说哪天 */
function heardWhen(at: string | undefined, now: Date): readonly [string, string] {
  const copy = GLOBAL_ASK_COPY.opening;
  const days = daysAgo(at, now);
  if (days === undefined) return copy.lastTime;
  if (days === 0) return copy.heardToday;
  if (days === 1) return copy.heardYesterday;
  if (days === 2) return copy.heardDayBefore;
  if (days < 7) return copy.heardDaysAgo(days);
  const then = new Date(at as string);
  return copy.heardOnDate(then.getMonth() + 1, then.getDate());
}

/** 时刻 chip 的 label 是「00:30 · 原话首句」；开口里只念时间点（MM:SS，与复习页、问题句一致） */
function stampOf(item: DeskItem): string {
  return item.label.split(' · ')[0].trim();
}

export function composeAskOpening(input: AskOpeningInput): AskOpening {
  const copy = GLOBAL_ASK_COPY.opening;
  const now = input.now ?? new Date();
  const parts: OpeningPart[] = [];
  const usedPrompts = new Set<string>();
  const text = (value: string) => { if (value) parts.push({ kind: 'text', text: value }); };
  const link = (kind: OpeningPartKind, value: string, prompt: string) => {
    parts.push({ kind, text: value, prompt });
    usedPrompts.add(prompt);
  };

  const reading = group(input.desk, 'reading');
  const moments = group(input.desk, 'moments').filter((item) => item.tone === 'vermilion' || item.meta);
  const unstable = group(input.desk, 'unstable').filter((item) => item.tone === 'vermilion');
  const recent = group(input.desk, 'recent');
  const memory = group(input.desk, 'memory');
  const challenge = memory.find((item) => item.tone === 'vermilion');

  const currentLesson = reading.find((item) => item.id === 'reading:current-lesson');
  let sentences = 0;

  const speakStops = () => {
    moments.slice(0, MAX_STAMPS_IN_SENTENCE).forEach((item, index) => {
      if (index > 0) text(copy.listSeparator);
      link('stamp', stampOf(item), item.prompt);
    });
    text(moments.length > MAX_STAMPS_IN_SENTENCE ? copy.stoppedAtMore(moments.length - MAX_STAMPS_IN_SENTENCE) : copy.stoppedAt[1]);
  };

  // 此刻：打开着一节课。今天听的说"刚听完"；翻回以前的课不能这么说——"《X》那节，你在 00:30 停过。"
  if (currentLesson) {
    const named = currentLesson.label !== GLOBAL_ASK_COPY.desk.currentLesson;
    const days = daysAgo(currentLesson.at, now);
    const fresh = days === undefined || days === 0;
    if (!named) {
      link('lesson', copy.justHeardThisLesson, currentLesson.prompt);
      text(copy.period);
      sentences += 1;
      if (moments.length > 0) { text(copy.stoppedAt[0]); speakStops(); sentences += 1; }
    } else if (fresh) {
      text(copy.justHeard[0]);
      link('lesson', lessonName(currentLesson.label), currentLesson.prompt);
      text(copy.justHeard[1]);
      sentences += 1;
      if (moments.length > 0) { text(copy.stoppedAt[0]); speakStops(); sentences += 1; }
    } else if (moments.length > 0) {
      text(copy.thatLesson[0]);
      link('lesson', lessonName(currentLesson.label), currentLesson.prompt);
      text(copy.thatLesson[1]);
      text(copy.stoppedAt[0]);
      speakStops();
      sentences += 2;
    } else {
      text(copy.lookingAt[0]);
      link('lesson', lessonName(currentLesson.label), currentLesson.prompt);
      text(copy.lookingAt[1]);
      sentences += 1;
    }
  }

  // 还没稳的概念（检验留下的事实）——最多再占一句
  if (sentences < 2 && unstable.length > 0) {
    text(copy.unstable[0]);
    link('concept', unstable[0].label, unstable[0].prompt);
    text(copy.unstable[1]);
    sentences += 1;
  }

  // 没有当前课：上次那节（知道哪天就说哪天）/ 之前卡住的
  if (sentences === 0 && recent.length > 0) {
    const when = heardWhen(recent[0].at, now);
    text(when[0]);
    link('lesson', lessonName(recent[0].label), recent[0].prompt);
    text(when[1]);
    sentences += 1;
  }
  if (sentences < 2 && challenge) {
    text(copy.stuckBefore[0]);
    link('concept', challenge.label, challenge.prompt);
    text(copy.stuckBefore[1]);
    sentences += 1;
  }

  const empty = sentences === 0;
  if (empty) {
    text(copy.nothingYet);
    text(input.canStartDemo ? copy.nothingYetDemo : copy.nothingYetNoDemo);
  }

  // 可以从这里开始：先是接着上次的线索，再是开口里没点到的事实，最后是有根的通用句
  const starters: OpeningStarter[] = [];
  const pushStarter = (id: string, textValue: string, prompt: string) => {
    if (starters.length >= MAX_STARTERS) return;
    if (usedPrompts.has(prompt) || starters.some((s) => s.prompt === prompt)) return;
    starters.push({ id, text: textValue, prompt });
    usedPrompts.add(prompt);
  };
  if (input.activeThread?.status === 'active' && input.activeThread.title.trim()) {
    pushStarter('thread', copy.resumeThread(clip(input.activeThread.title, 20)), input.activeThread.intent || input.activeThread.title);
  }
  if (input.depth === 'quick') {
    for (const item of [...moments.slice(MAX_STAMPS_IN_SENTENCE), ...unstable.slice(1), ...memory, ...reading.filter((r) => r !== currentLesson), ...recent.slice(1)]) {
      pushStarter(item.id, item.prompt, item.prompt);
    }
  }
  // 同学已经有话可说时，写死的通用句（"帮我解释刚才课堂里最难的概念"、"帮我讲清这节课里最难的地方"）
  // 只是重复句子里已经可点的东西，不上；桌面全空时也不上——空桌面的出口是试听 / 上课，不是假装有课可问
  const generic = new Set<string>([
    ...GLOBAL_ASK_COPY.quickExamples,
    ...GLOBAL_ASK_COPY.deepExamples,
    GLOBAL_ASK_COPY.starters.quickFromCurrentLesson,
  ]);
  if (!empty) {
    for (const fallback of input.fallbackStarters) {
      if (generic.has(fallback)) continue;
      pushStarter(`fallback:${fallback}`, fallback, fallback);
    }
  }

  return { parts, starters, empty };
}
