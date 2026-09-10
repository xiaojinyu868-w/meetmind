/**
 * flashcard-deck-model — 闪卡牌面与一轮练习的纯函数（可单测）。
 *
 * - faceFontSize：长卡面自动缩字（正面 21 → 14px，背面再小一号），不让文字溢出牌面；
 * - 打分历史：Z 撤销上一张（把那张的分数收回、回到那张），纯数据结构；
 * - 飞出方向 / 颜色：记住 = 右 / pine，没记住 = 左 / vermilion，与滑动、键盘 ←→ 一致。
 */

export type MasteryScore = 'missed' | 'got';

/** 按字数分档：CJK 一个字算 1，拉丁字母大约半个字（一个英文单词 ≈ 2.5 个 CJK 宽） */
export function visualLength(text: string): number {
  let length = 0;
  for (const ch of text) {
    if (/[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch)) length += 1;
    else if (/\s/.test(ch)) length += 0.3;
    else length += 0.55;
  }
  return length;
}

const FRONT_STEPS: Array<[number, number]> = [[36, 21], [70, 19], [120, 17], [190, 15.5], [Infinity, 14]];

/** 正面字号（px）；back=true 时背面整体小一号（背面是解释，密一点没关系） */
export function faceFontSize(text: string, back = false): number {
  const length = visualLength(text);
  const size = FRONT_STEPS.find(([limit]) => length <= limit)?.[1] ?? 14;
  return back ? Math.max(13.5, size - 1.5) : size;
}

export interface ScoreHistoryEntry {
  cardId: string;
  index: number;
  previous: MasteryScore | undefined;
}

export interface RoundState {
  scores: Record<string, MasteryScore>;
  history: ScoreHistoryEntry[];
}

export function applyScore(state: RoundState, cardId: string, index: number, value: MasteryScore): RoundState {
  return {
    scores: { ...state.scores, [cardId]: value },
    history: [...state.history, { cardId, index, previous: state.scores[cardId] }],
  };
}

/** 撤销上一张：返回新状态与该回到的下标；没有历史时返回 null */
export function undoScore(state: RoundState): { state: RoundState; index: number } | null {
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const scores = { ...state.scores };
  if (last.previous === undefined) delete scores[last.cardId];
  else scores[last.cardId] = last.previous;
  return { state: { scores, history: state.history.slice(0, -1) }, index: last.index };
}

export function flyDirectionOf(value: MasteryScore): 'left' | 'right' {
  return value === 'got' ? 'right' : 'left';
}
