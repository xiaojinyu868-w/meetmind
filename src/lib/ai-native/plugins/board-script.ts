/**
 * BoardScript — 「板书精讲」板书脚本 DSL（纯类型 + helper，客户端/服务端/测试共用）。
 *
 * 架构对齐 AmIWrite（CHI 2026）：LLM 只输出「讲稿 + 板书动作」脚本，播放器
 * （src/components/apps/windows/blackboard/）按序执行。
 * v2 排版权收归播放器：write 不携带坐标，标注按 write 序号引用（'w3'）。
 * v3 对齐论文四块：
 *   1. 词级讲写对齐——narration 内联 cue（[aN] 指向本段 actions 下标）
 *   2. 三阶段渐进放手——checkpoint 段型（提问 + 三级 hint + 看解析示范）
 *   3. 跨页引用——ref 动作（切页脉冲高亮后淡回）
 *   4. 学生板演（纯播放器行为，不占 DSL）
 * v31 白纸讲义画布：write role 增 formula（LaTeX → KaTeX 块级公式）；
 * 新增 new_column 布局动作（一页两栏，栏内从上到下流式追加）。
 */

export const MAX_PAGES = 6;
export const MAX_SEGMENTS_PER_PAGE = 6;
/** v31 讲义画布：单页双栏高密度（16 会误伤长推演段），上限放宽到 24 */
export const MAX_ACTIONS_PER_SEGMENT = 24;
export const MAX_PAUSE_MS = 5000;
export const HINT_COUNT = 3;
/** target 引用：'w3'（wN = 本页第 N 个 write，从 1 开始） */
const TARGET_RE = /^w([1-9]\d*)$/;

/**
 * v31 讲义字阶：title=课题（页首） term=节标题（紫底高亮块） step=正文短句
 * note=缩进注释 formula=块级公式（text 为 LaTeX，KaTeX 排版，不走手写接力）。
 */
export type BoardWriteRole = 'title' | 'term' | 'step' | 'note' | 'formula';

export interface BoardWriteAction {
  type: 'write';
  text: string;
  role: BoardWriteRole;
}

export interface BoardCircleAction {
  type: 'circle';
  /** 'w3' 或 ['w2','w4']（含两端） */
  target: string | string[];
}

export interface BoardUnderlineAction {
  type: 'underline';
  target: string | string[];
}

export interface BoardArrowAction {
  type: 'arrow';
  from: string;
  to: string;
  label?: string;
}

export interface BoardMarkAction {
  type: 'mark';
  mark: 'check' | 'cross';
  target: string;
}

export interface BoardPauseAction {
  type: 'pause';
  ms: number;
}

/**
 * v31 分栏讲义：开新栏（一页最多 2 栏）。布局标记，不产生墨迹、不占 wN，
 * 渲染层按它把后续 write 切到下一栏（BoardCanvas.splitLectureFlow）。
 */
export interface BoardNewColumnAction {
  type: 'new_column';
}

/** v3 跨页引用：切到 page（从 1 开始）的 target write 处脉冲高亮，随后淡回。 */
export interface BoardRefAction {
  type: 'ref';
  page: number;
  target: string;
}

/**
 * v28 贴图（teach-agent 生成）：真人老师把打印图贴上黑板——粉笔框插图。
 * url 为空 = 生成中（播放器渲染粉笔框占位）；prompt 保留供追溯/重生成。
 * 不参与 wN 计数（countPageWrites 只数 write）。
 */
export interface BoardImageAction {
  type: 'image';
  url: string;
  prompt?: string;
  caption?: string;
}

export type BoardAction =
  | BoardWriteAction
  | BoardCircleAction
  | BoardUnderlineAction
  | BoardArrowAction
  | BoardMarkAction
  | BoardPauseAction
  | BoardNewColumnAction
  | BoardRefAction
  | BoardImageAction;

// ── 段型（v3 联合类型） ────────────────────────────────────────────────────

/** 内联 cue：narration 里 [aN] 指向本段 actions 下标 N，charIndex 是剥 cue 后展示文本里的位置。 */
export interface BoardCue {
  charIndex: number;
  actionIndex: number;
}

export interface NarrationSegment {
  type: 'narration';
  /** 讲稿原始文本（可能含 cue 标记） */
  narration: string;
  /** 剥掉 cue 标记的展示/朗读文本（sanitize 总是写入） */
  narrationDisplay?: string;
  /** 词级触发点（sanitize 从 narration 提取；导演 pass 也可直接注入，经校验） */
  cues?: BoardCue[];
  /** 导演 pass：本段讲完后的呼吸停顿 ms（覆盖播放器默认 400；0-2500，校验 clamp） */
  breathMs?: number;
  actions: BoardAction[];
}

export interface CheckpointSegment {
  type: 'checkpoint';
  /** AI 提问的口述（可含 cue） */
  narration: string;
  narrationDisplay?: string;
  cues?: BoardCue[];
  /** 写上黑板的题目 */
  question: { text: string; role: 'term' | 'step' };
  /** 递进三级提示（第一级方向、第二级一半、第三级差一步） */
  hints: [string, string, string];
  /** 口述答案解析（原始文本，可含 cue 标记） */
  answer: string;
  /** 剥掉 cue 标记的答案展示/朗读文本（sanitize 总是写入） */
  answerDisplay?: string;
  /** 答案口述里的 cue（指向 demoActions 下标：解析念到哪，示范写到哪） */
  answerCues?: BoardCue[];
  /** 完整演示范例（「看解析」才放） */
  demoActions: BoardAction[];
}

export type BoardSegment = NarrationSegment | CheckpointSegment;

export interface BoardPage {
  segments: BoardSegment[];
}

export interface BoardQuote {
  /** narration 中以老师原话身份引用的逐字文本 */
  text: string;
  startMs?: number;
}

export interface BoardScript {
  title: string;
  pages: BoardPage[];
  quotes: BoardQuote[];
}

// ── target / 文本校验 helper ───────────────────────────────────────────────

/** 'w3' → 3；非法 → null。 */
export function parseWriteRef(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = TARGET_RE.exec(value.trim());
  if (!match) return null;
  return Number(match[1]);
}

export function isWriteRef(value: unknown): boolean {
  return parseWriteRef(value) !== null;
}

/** 段的展示/朗读文本（剥 cue 后；未清洗的旧数据退回 narration）。 */
export function segmentDisplayText(segment: BoardSegment): string {
  return segment.narrationDisplay ?? segment.narration;
}

/** checkpoint 答案的展示/朗读文本（剥 cue 后；未清洗的旧数据退回 answer）。 */
export function checkpointAnswerText(segment: CheckpointSegment): string {
  return segment.answerDisplay ?? segment.answer;
}

/** 本页 write 总数（跨段累计；checkpoint 的动态 write 不计入）。 */
export function countPageWrites(page: BoardPage): number {
  let count = 0;
  for (const segment of page.segments) {
    if (segment.type === 'checkpoint') continue;
    for (const action of segment.actions) {
      if (action.type === 'write') count += 1;
    }
  }
  return count;
}

// ── 内联 cue（v3 词级讲写对齐） ────────────────────────────────────────────

// 契约写法是 [aN]；模型偶尔会偷懒写成 [N]（2026-08-19 qwen3.7-plus 实测），
// 两种都认——板书讲稿语境下裸方括号数字几乎只会是 cue 标记
const CUE_RE = /\[a?(\d+)\]/g;

/**
 * 从 narration 提取内联 cue（[aN]（兼容 [N]）→ 本段 actions 下标 N）：
 * - charIndex 记录为剥 cue 后展示文本里的位置（与 speechSynthesis onboundary
 *   的 charIndex 同坐标系）
 * - 展示文本剥掉全部 cue 标记（标记后紧跟的一个空格一并去掉）
 * - 越界 cue（下标不存在）/ 同一动作重复 cue：丢弃该 cue 计数，不影响动作
 */
export function extractCues(
  narration: string,
  actionCount: number,
): { display: string; cues: BoardCue[]; dropped: number } {
  const cues: BoardCue[] = [];
  const seenActions = new Set<number>();
  let dropped = 0;
  let display = '';
  let last = 0;

  for (const match of narration.matchAll(CUE_RE)) {
    const index = match.index;
    display += narration.slice(last, index);
    const actionIndex = Number(match[1]);
    if (actionIndex < actionCount && !seenActions.has(actionIndex)) {
      seenActions.add(actionIndex);
      cues.push({ charIndex: display.length, actionIndex });
    } else {
      dropped += 1;
    }
    last = index + match[0].length;
    // 标记后紧跟的一个空格一并剥掉，避免展示文本留出空洞
    if (narration[last] === ' ') last += 1;
  }
  display += narration.slice(last);

  return { display: display.trim(), cues, dropped };
}

// sanitize 清洗层拆在 board-script-sanitize.ts（行数限制），入口保持从这里导出
export { sanitizeBoardScript } from './board-script-sanitize';
