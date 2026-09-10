/**
 * app-keys — 应用窗口的快捷键映射（纯函数，可单测）。
 *
 * 原则：回车 / 空格是每个应用最自然的那个动作；数字键直达选项；←→ 在"前后"之间移动；
 * 正在输入（input / textarea / contentEditable）时一律不抢。
 */

export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** 事件落在输入控件上 → 应用快捷键让位 */
export function isTypingTarget(target: KeyTarget | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName || '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
}

/* ── 测验 ── */

export type QuizKeyAction =
  | { type: 'select'; index: number }
  | { type: 'primary' }
  | null;

export interface QuizKeyContext {
  optionCount: number;
  /** 主观题（填空 / 简答）没有数字选项 */
  subjective: boolean;
  submitted: boolean;
  typing: boolean;
}

/** 1–9 选选项（未交卷的客观题）；回车 / 空格 = 底部主动作（确认 / 下一题 / 看这一轮）。←→ 由分页 hook 负责 */
export function resolveQuizKey(key: string, ctx: QuizKeyContext): QuizKeyAction {
  if (ctx.typing) return null;
  if (/^[1-9]$/.test(key)) {
    if (ctx.subjective || ctx.submitted) return null;
    const index = Number(key) - 1;
    return index < ctx.optionCount ? { type: 'select', index } : null;
  }
  if (key === 'Enter' || key === ' ') return { type: 'primary' };
  return null;
}

/* ── 闪卡 ── */

export type FlashcardKeyAction = 'flip' | 'prev' | 'next' | 'got' | 'missed' | 'undo' | null;

export interface FlashcardKeyContext {
  flipped: boolean;
  typing: boolean;
}

/**
 * 空格 / 回车翻面；翻开后 1 = 没记住、2 = 记住了，←→ 同义（← 没记住 / → 记住了，与滑动方向一致）；
 * 没翻开时 ←→ 换牌；Z 撤销上一张的打分。
 */
export function resolveFlashcardKey(key: string, ctx: FlashcardKeyContext): FlashcardKeyAction {
  if (ctx.typing) return null;
  if (key === ' ' || key === 'Enter') return 'flip';
  if (key === 'z' || key === 'Z') return 'undo';
  if (ctx.flipped) {
    if (key === '1' || key === 'ArrowLeft') return 'missed';
    if (key === '2' || key === 'ArrowRight') return 'got';
    return null;
  }
  if (key === 'ArrowLeft') return 'prev';
  if (key === 'ArrowRight') return 'next';
  return null;
}

/* ── 播放类（播客 / 板书） ── */

export type PlayerKeyAction = 'toggle' | 'back' | 'forward' | null;

/** 空格 / K 播放暂停；←→（或 J / L）后退 / 前进一步 */
export function resolvePlayerKey(key: string, typing: boolean): PlayerKeyAction {
  if (typing) return null;
  if (key === ' ' || key === 'k' || key === 'K') return 'toggle';
  if (key === 'ArrowLeft' || key === 'j' || key === 'J') return 'back';
  if (key === 'ArrowRight' || key === 'l' || key === 'L') return 'forward';
  return null;
}
