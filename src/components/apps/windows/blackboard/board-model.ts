/**
 * board-model — 黑板播放器的纯函数模型层（可单测）。
 *
 * v2：排版权收归播放器。LLM 只按顺序给 write（text + role），
 * 流式布局引擎 layoutBoardPage 负责字号分级、自动折行、缩进与
 * 溢出收缩；标注类动作（circle/underline/arrow/mark）用 target
 * 引用（'wN'）从布局注册表取 bounds。
 *
 * 另两件事不变：
 * - 动作时间轴编排：buildPageTimeline（segment 时长 = narration 字数 × 150ms
 *   —— 2026-08-18 实测标定的 cosyvoice 真实语速；全部动作锚定讲稿字位，
 *   语音时间轴统一驱动）
 * - 确定性 hash（roughjs 固定 seed）
 */

import type { BoardAction, BoardPage, BoardWriteAction, BoardWriteRole } from '@/lib/ai-native/plugins/board-script';
import { segmentDisplayText } from '@/lib/ai-native/plugins/board-script';
import { matchStructToken } from './board-struct-tokens';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 中文朗读估速：150ms/字。
 *  2026-08-18 节奏诊断实测（scripts/board-rhythm-audit.ts）：cosyvoice-v3-flash
 *  真实朗读 137-163ms/字（原 280ms/字把时间轴稀释约 1.8 倍——写板被迫慢放、
 *  无 cue 动作拖在语音后面，是"讲解节奏不自然"的主因）。降级 robot 音经
 *  boundaryAnchor 自适应，不受此值影响。 */
export const MS_PER_CHAR = 150;
/** 单个非 pause 动作的最小时隙，避免动作挤成一团。 */
export const MIN_ACTION_SLOT_MS = 400;
/** 一个 segment 的最短时长。 */
export const MIN_SEGMENT_MS = 1200;

// ── 时间轴 ─────────────────────────────────────────────────────────────────

export interface TimedAction {
  action: BoardAction;
  /** 相对页首的触发时刻 */
  startMs: number;
  /** pause = 停顿时长；其余动作 = 动画时间窗（渲染层自行取用） */
  durationMs: number;
  /** v3 cue 驱动：设置后按词级 charIndex 触发，不按 startMs（v9 起为倒排提前后的值） */
  cueCharIndex?: number;
  /** v9 音画同步：书写时间窗预算（触发时刻 → 下一动作触发时刻或段末），
   *  BoardWrite 据此自适应书写速度 */
  budgetMs?: number;
}

export interface TimedSegment {
  narration: string;
  startMs: number;
  endMs: number;
  actions: TimedAction[];
}

export interface PageTimeline {
  segments: TimedSegment[];
  totalMs: number;
}

// ── 逐字书写节奏（v8：write 内部严格串行，一个字写完才写下一个） ────────────

/** 板书 token：渲染与接力的最小单元。
 *  v16 原生排版（2026-08-18）：英文按词为单元（词内字距/词间距全部交给字体
 *  本身，不再逐字估算宽度）；CJK 逐字；标点逐字；空格为瞬时"抬笔"节点。
 *  真实老师写英文是一词一词写，不是逐字母摆位置——词内连笔感由 Caveat 原生
 *  连字呈现，也不会再出现"先连写后跳开"的占位宽度误差。
 *  v31：v30 的 frac/sqrt/matrix/sup/sub 手写模拟 token 随黑板形态退役（公式
 *  一律 write role='formula' → KaTeX），行内只留 ==高亮== 马克笔 token；
 *  text 一律是可见平铺文本（不含记法符号）——节奏估算/接力坐标系零改动。 */
export type BoardToken =
  | { kind: 'cjk'; text: string }
  | { kind: 'word'; text: string }
  | { kind: 'punct'; text: string }
  | { kind: 'space' }
  | { kind: 'hl'; text: string };

/** 文本 → token 序列（纯函数，可单测）。 */
export function tokenizeBoardText(text: string): BoardToken[] {
  const tokens: BoardToken[] = [];
  const chars = Array.from(text);
  let index = 0;
  while (index < chars.length) {
    const struct = matchStructToken(chars, index);
    if (struct) {
      tokens.push(struct.token);
      index = struct.next;
      continue;
    }
    const char = chars[index];
    if (char === ' ') {
      tokens.push({ kind: 'space' });
      index += 1;
      continue;
    }
    if (isLatinBoardChar(char)) {
      let word = '';
      while (index < chars.length && isLatinBoardChar(chars[index])) {
        word += chars[index];
        index += 1;
      }
      tokens.push({ kind: 'word', text: word });
      continue;
    }
    tokens.push({ kind: char.charCodeAt(0) > 0xff ? 'cjk' : 'punct', text: char });
    index += 1;
  }
  return tokens;
}

/** token 的书写耗时（逐字节奏求和；词 = 字母求和 + 词尾微顿）。 */
export function tokenPaceMs(token: BoardToken, strokeMode: boolean): number {
  if (token.kind === 'space') return CHAR_PACE.spaceMs;
  let total = 0;
  for (const char of token.text) total += charPaceMs(char, strokeMode);
  if (token.kind === 'word' && token.text.length > 1) total += 100; // 词尾抬笔
  // 高亮 token 的附加一笔：马克笔横扫
  if (token.kind === 'hl') total += 120;
  return total;
}

export const CHAR_PACE = {
  /** CJK 笔顺字（title/term） */
  cjkStrokeMs: 320,
  /** CJK 手写字（step/note） */
  cjkFontMs: 180,
  /** 拉丁字母/数字 */
  latinMs: 80,
  /** 标点自身显现 + 标点后微停顿（真人标点后会顿一下） */
  punctMs: 60,
  punctPauseMs: 120,
  /** 空格=瞬时抬笔 */
  spaceMs: 30,
} as const;

/** 单字书写耗时（BoardWrite 接力与 buildPageTimeline 估算共用同一套）。 */
export function charPaceMs(char: string, strokeMode: boolean): number {
  if (char === ' ') return CHAR_PACE.spaceMs;
  if (isLatinBoardChar(char)) return CHAR_PACE.latinMs;
  if (isAsciiBoardPunct(char) || /\p{P}/u.test(char)) return CHAR_PACE.punctMs + CHAR_PACE.punctPauseMs;
  return strokeMode ? CHAR_PACE.cjkStrokeMs : CHAR_PACE.cjkFontMs;
}

// ── v19 人性化书写节奏（写不是节拍器） ─────────────────────────────────────
//
// 2026-08-19 用户洞察：渲染不是手写，字可以出得快；真人老师的板书节奏是
// 「小组快写 + 词间抬笔 + 短语后换气 + 标点停顿」，绝不匀速。所以：
// - 每个 token 的书写耗时带确定性抖动（0.82~1.25×），同一文本同一位置
//   永远同一节奏（可单测、可复现、不跳变）；
// - token 之间插入「抬笔」停顿：词间 70~140ms、标点 150~270ms、
//   CJK 每 4~6 字一次 190~340ms 的短语换气、字间 25~70ms 微顿；
// - 书写总时长 = 书写 + 停顿（estimateWriteMs 同一来源），手先于口的
//   倒排提前量自动包含停顿——写完最后一个字仍正好落在被念到的时刻；
// - 时间窗预算宽裕时**不再拉伸书写填满窗口**（paceScaleFor 上限 1）：
//   按自然节奏写完就抬笔休息，剩余窗口留给"讲"——这就是网课里
//   "写一段、停一下、接着写"的真实质感。

export interface WritePacePlan {
  /** 每个 token 的书写耗时（含抖动，未乘 paceScale） */
  writeMs: number[];
  /** 每个 token 写完后的抬笔停顿（最后一个 token 恒 0） */
  restMs: number[];
  /** 书写 + 停顿总时长（cue 倒排/预算共用的自然时长） */
  totalMs: number;
}

/** 确定性节奏抖动：0.82~1.25×（hash 驱动，无随机源） */
function paceJitter(seed: string, index: number): number {
  return 0.82 + ((hashSeed(`${seed}#${index}`) % 100) / 100) * 0.43;
}

/** 对一串 token 生成人性化书写计划（seed 一般取原文，保证全文坐标系稳定）。 */
export function buildWritePaceForTokens(
  tokens: BoardToken[],
  strokeMode: boolean,
  seed: string,
): WritePacePlan {
  const writeMs: number[] = [];
  const restMs: number[] = [];
  let sinceBreath = 0;
  let breathInterval = 4 + (hashSeed(seed) % 3); // 每 4~6 个 CJK 字换一次气
  tokens.forEach((token, index) => {
    const last = index === tokens.length - 1;
    if (token.kind === 'space') {
      // 空格本身是瞬时抬笔，不再叠加停顿（词间停顿挂在 word token 尾部）
      writeMs.push(CHAR_PACE.spaceMs);
      restMs.push(0);
      return;
    }
    writeMs.push(Math.round(tokenPaceMs(token, strokeMode) * paceJitter(seed, index)));
    let rest = 0;
    if (!last) {
      // 全角标点被 tokenizer 归为 cjk 类——按字符本身判定，中文逗号句号同样要有停顿
      const isPunctToken =
        token.kind === 'punct' || (token.kind === 'cjk' && /\p{P}/u.test(token.text));
      if (isPunctToken) {
        rest = 150 + (hashSeed(`${seed}!${index}`) % 120); // 标点后停顿 150~270
      } else if (token.kind === 'word') {
        rest = 70 + (hashSeed(`${seed}~${index}`) % 70); // 词间抬笔 70~140
      } else {
        sinceBreath += 1;
        if (sinceBreath >= breathInterval) {
          rest = 190 + (hashSeed(`${seed}^${index}`) % 150); // 短语换气 190~340
          sinceBreath = 0;
          breathInterval = 4 + (hashSeed(`${seed}&${index}`) % 3);
        } else {
          rest = 25 + (hashSeed(`${seed}*${index}`) % 45); // 字间微顿 25~70
        }
      }
    }
    restMs.push(rest);
  });
  const totalMs =
    writeMs.reduce((sum, ms) => sum + ms, 0) + restMs.reduce((sum, ms) => sum + ms, 0);
  return { writeMs, restMs, totalMs };
}

export function buildWritePace(text: string, role: BoardWriteRole): WritePacePlan {
  return buildWritePaceForTokens(tokenizeBoardText(text), role === 'title' || role === 'term', text);
}

/** 一个 write 动作的书写总时长估算（v19：含人性化抖动与抬笔停顿）。 */
export function estimateWriteMs(text: string, role: BoardWriteRole): number {
  return buildWritePace(text, role).totalMs;
}

/** narration 估时：按可见字符数（标点也算进去，朗读有停顿）。 */
export function estimateNarrationMs(narration: string, msPerChar: number = MS_PER_CHAR): number {
  const chars = narration.replace(/\s+/g, '').length;
  return Math.max(MIN_SEGMENT_MS, chars * msPerChar);
}

/**
 * v20 嘴手一体：write 只提前一个"起笔"的量（300ms）——嘴上开始讲这部分内容，
 * 笔开始落。书写过程与对应讲解**共现**（真人老师边写边念，嘴比手快半拍、
 * 手追嘴），而不是 v9 的"按总时长倒排、念到时已写完"——那会让手在讲上一句
 * 时就写下一行，正是"一个人在讲、另一个人在写"的成因（2026-08-19 用户洞察）。
 * 这也更忠于 Kendon/McNeill 的原意：手势 stroke 与相关语音**共现**（略领先
 *  onset），不是提前完成。标注仍是 500ms 提前（动画短，落在指涉词上）。
 */
function anticipateCharsFor(action: BoardAction, msPerChar: number): number {
  const leadMs = action.type === 'write' ? 300 : 500;
  return Math.ceil(leadMs / Math.max(1, msPerChar));
}

/** 书写速度自适应区间（v19）：最快 0.7×（再快就是快闪不像写字——2026-08-18
 *  用户实测节奏偏快从 0.55 上调，紧预算下书写更从容，超出部分由段末闸门
 *  音等画吸收）；**最慢 1×——预算宽裕不再拉伸书写**。书写按人性化自然节奏
 *  写完即抬笔休息，把窗口剩余时间留给讲解（匀速慢放是"机器人写字"感的根源）。 */
export const PACE_SCALE_LIMIT = { min: 0.7, max: 1 } as const;

/**
 * v9 音画同步 + v19 人性化节奏：时间窗预算比自然书写时长紧就加快（区间 0.7~1），
 * 宽裕就按自然节奏写、写完抬笔休息。讲得急写得急；讲得缓时手先写完、
 * 笔停下来等嘴——手和嘴仍在同一支时间上，极端超窗由段末硬同步闸门兜底。
 */
export function paceScaleFor(action: BoardWriteAction, budgetMs: number): number {
  const natural = estimateWriteMs(action.text, action.role);
  if (natural <= 0 || budgetMs <= 0) return 1;
  return Math.min(PACE_SCALE_LIMIT.max, Math.max(PACE_SCALE_LIMIT.min, budgetMs / natural));
}

/**
 * 编排一页的时间轴：actions 按序落在各自 segment 的朗读窗口内均匀分布，
 * pause 硬插入自己的时长（会把后续动作往后推，segment 随之延长）。
 * v3：带 cue 的动作不占均分时隙——它们等 onboundary 的词级 charIndex 触发
 * （cueCharIndex 透传给播放器）；checkpoint 段不产生时间轴（交互态接管）。
 * v8：write 时长按逐字串行节奏估算（estimateWriteMs），与均分时隙取大者，
 * 让朗读和真实书写速度保持对齐。
 * v9 音画同步（v20 修正 cue 语义）：
 * - cue 微提前：cueCharIndex 只提前一个起笔量（anticipateCharsFor，write 300ms），
 *   嘴上开讲 = 落笔开始，书写与对应讲解共现（嘴手一体，不是念到已写完）；
 * - 每个动作带 budgetMs 时间窗预算（触发时刻 → 下一动作触发时刻或段末），
 *   书写速度按预算自适应（paceScaleFor），漂移不跨段（段末硬同步闸门在 useBoardPlayer）。
 */
export function buildPageTimeline(
  page: BoardPage,
  options?: { msPerChar?: number },
): PageTimeline {
  const segments: TimedSegment[] = [];
  let cursor = 0;

  for (const segment of page.segments) {
    if (segment.type === 'checkpoint') {
      // checkpoint 段发占位（交互态接管），保持 timeline 与 page.segments 下标对齐
      segments.push({
        narration: segmentDisplayText(segment),
        startMs: cursor,
        endMs: cursor,
        actions: [],
      });
      continue;
    }
    const display = segmentDisplayText(segment);
    const speechMs = estimateNarrationMs(display, options?.msPerChar);
    const charCount = Math.max(1, display.replace(/\s+/g, '').length);
    const realMsPerChar = speechMs / charCount;

    const cuesByAction = new Map<number, number>();
    for (const cue of segment.cues ?? []) {
      const action = segment.actions[cue.actionIndex];
      if (!action) continue;
      cuesByAction.set(
        cue.actionIndex,
        Math.max(0, cue.charIndex - anticipateCharsFor(action, realMsPerChar)),
      );
    }

    // v15 科学节奏：所有动作统一锚定到讲稿字位（语音时间轴）——
    // 没有 LLM cue 的按字位均匀分布（write 同样微提前起笔；pause 也
    // 占一个均分位，念到该处时标记触发）。消灭"cue 跟真实语音、非 cue
    // 跟估算时间轴"的双时间轴分裂：TTS 在用字级时间戳驱动一切；降级时
    // charIndex 由估算推进，行为与旧均分一致。
    const floating: number[] = [];
    segment.actions.forEach((action, index) => {
      if (!cuesByAction.has(index)) floating.push(index);
    });
    floating.forEach((actionIndex, order) => {
      const action = segment.actions[actionIndex];
      const base = ((order + 0.5) / floating.length) * charCount;
      const lead = action.type === 'pause' ? 0 : anticipateCharsFor(action, realMsPerChar);
      cuesByAction.set(actionIndex, Math.max(0, Math.round(base - lead)));
    });

    const actions: TimedAction[] = segment.actions.map((action, index) => {
      const cueCharIndex = cuesByAction.get(index);
      // 估算触发时刻（预算/单调性参考用；真实触发走 charIndex）
      const startMs = cursor + ((cueCharIndex ?? 0) / charCount) * speechMs;
      return {
        action,
        startMs,
        durationMs: action.type === 'pause' ? action.ms : 0,
        cueCharIndex,
      };
    });

    // 段时长 = 朗读估算（150ms/字已与真实 TTS 对齐）；书写超出的个别
    // 情况由书写预算自适应 + 段末硬同步闸门吸收，不再拉长估算时间轴
    const endMs = cursor + speechMs;

    // v9：时间窗预算。触发时刻（页首坐标）：cue 按提前后 charIndex 等比折算，
    // 其余按时隙游标；终点 = 下一非 pause 动作的触发时刻或段末
    const triggerAt = (timed: TimedAction): number =>
      timed.cueCharIndex !== undefined
        ? cursor + (timed.cueCharIndex / charCount) * speechMs
        : timed.startMs;
    actions.forEach((timed, index) => {
      if (timed.action.type === 'pause') return;
      const next = actions.slice(index + 1).find((later) => later.action.type !== 'pause');
      const start = triggerAt(timed);
      const windowEnd = next ? Math.max(triggerAt(next), start) : endMs;
      timed.budgetMs = Math.max(MIN_ACTION_SLOT_MS, windowEnd - start);
    });

    segments.push({ narration: display, startMs: cursor, endMs, actions });
    cursor = endMs;
  }

  return { segments, totalMs: cursor };
}


// ── v23 讲写联合调度·反向背压（ink → speech） ──────────────────────────────
//
// 2026-08-19 用户实测：段内"嘴讲的比板书快"——语音永远是主时钟，cue 一到
// 新动作就触发，笔的串行队列却在积压，嘴讲到 N+1 笔还在写 N，漂移只能等
// 段末闸门一次吸收。补上联动的另一半：嘴到新动作的 cue 时笔仍有未写完的
// 板书 → 在词边界把音频 hold 住（真人老师"写完才开口讲下一句"的自然停顿），
// 笔追上再放行，被延后的动作在放行后的首个进度事件补触发——嘴手互相等待，
// 漂移不跨内容边界累积。

/** 背压最长 hold：超时强制放行（防死锁），残余漂移交给段末硬同步闸门收尾。
 *  5000ms 标定（2026-08-19 v26 节奏诊断）：笔顺字（title/term）自然书写
 *  最长 ~4.5s（9 字 × 320ms × 抖动上限 + 抬笔停顿），3500 会在"标题写完
 *  圈重点"这类最常见的配合上必现强制放行——speech 提前脱钩正是要消除的
 *  错位；5000 覆盖自然书写的最坏情况，hold 期间学生看笔写字，不突兀。 */
export const MAX_INK_HOLD_MS = 5000;

/**
 * 背压判定（纯函数，可单测）：嘴到该动作的 cue 时笔仍有积压，是否把触发
 * 延后到笔追上。pause 是静默拍（无视觉内容，不该挡嘴）、ref 自带插播暂停
 * （BlackboardPlayer 的 interlude 会暂停整条链），二者不背压。
 */
export function shouldDeferForInk(action: BoardAction, backlog: number): boolean {
  return backlog > 0 && action.type !== 'pause' && action.type !== 'ref';
}

export function isLatinBoardChar(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

/**
 * 板书的半角标点——中文手写体的半角标点字墨普遍又小又浮（如鸿雷的 ':'），
 * 同样分流到 Caveat，与拉丁字母同笔感。
 */
export function isAsciiBoardPunct(char: string): boolean {
  if (char.length !== 1) return false;
  const code = char.charCodeAt(0);
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

// ── 字幕卡拉 OK 窗口（讲到哪，字幕跟到哪） ─────────────────────────────────

/**
 * 把长讲稿裁成跟随朗读位置的字幕窗口（默认 ~44 字 ≈ 两行）：
 * - 按子句（标点边界）切分，定位 charIndex 所在子句；
 * - 窗口 = 当前子句起往后装，装满 maxChars 为止；之前的子句整体滚出；
 * - 当前子句自身超两行时按字滑窗——讲到的部分必然可见，
 *   不再用省略号把正在讲的内容吃掉（2026-08-19 用户实测）。
 */
export function windowSubtitle(text: string, charIndex: number, maxChars = 44): string {
  if (text.length <= maxChars) return text;
  const clauseStarts: number[] = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (/[。！？；，、：…—!?;,:]/.test(text[index]) && index + 1 < text.length) {
      clauseStarts.push(index + 1);
    }
  }
  const clamped = Math.max(0, Math.min(charIndex, text.length - 1));
  let current = 0;
  for (let index = 0; index < clauseStarts.length; index += 1) {
    if (clauseStarts[index] <= clamped) current = index;
    else break;
  }
  const start = clauseStarts[current];
  let used = 0;
  let end = text.length;
  for (let index = current; index < clauseStarts.length; index += 1) {
    const clauseEnd = index + 1 < clauseStarts.length ? clauseStarts[index + 1] : text.length;
    const length = clauseEnd - clauseStarts[index];
    if (used > 0 && used + length > maxChars) {
      end = clauseStarts[index];
      break;
    }
    used += length;
    end = clauseEnd;
  }
  if (end - start <= maxChars) return text.slice(start, end);
  // 单个子句就超窗口：按字滑窗，留 8 字上文保持语境
  const slideStart = Math.max(start, Math.min(clamped - 8, text.length - maxChars));
  return text.slice(slideStart, slideStart + maxChars);
}

// ── 确定性 hash（roughjs seed 用，避免重渲染形状跳变） ─────────────────────

export function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}
