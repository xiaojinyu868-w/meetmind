// flashcards-quality grader —— 一叠卡的质量断言（内容层，2026-09-11）。
//
// 一张好卡：正面是提示不是标题、正面不把答案说出来、背面两行以内、一张卡一个点、同一叠不重复、
// 覆盖要点而不是复述摘要；有掌握轨迹时不稳概念必须有卡。
// rawCards 是模型原始输出（生产会把"正面泄答"的卡剔掉——那是容错，不是质量；eval 看的是模型有没有犯）。

export interface GradedFlashcard {
  front: string;
  back: string;
  hint?: string;
  concept?: string;
}

export interface FlashcardsExpect {
  /** 至少几张（默认 3） */
  minCards?: number;
  /** 这些关键词（不稳概念）必须出现在某张卡的正面 / 背面 / 概念里 */
  mustCover?: string[];
  /** 上次没记住的题面 / 卡面原文：不该原样再出现（runner 从 learner.mastery 的 unstable 里取） */
  avoidRepeating?: string[];
}

/** 两句是否"几乎同一句"：去标点后相等，或字符二元组重合 ≥ 0.8 */
export function nearlySame(a: string, b: string): boolean {
  const ka = frontKey(a);
  const kb = frontKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const grams = (text: string) => {
    const set = new Set<string>();
    for (let i = 0; i < text.length - 1; i += 1) set.add(text.slice(i, i + 2));
    return set;
  };
  const ga = grams(ka);
  const gb = grams(kb);
  if (ga.size === 0 || gb.size === 0) return false;
  let shared = 0;
  ga.forEach((gram) => { if (gb.has(gram)) shared += 1; });
  return shared / Math.min(ga.size, gb.size) >= 0.8;
}

export interface FlashcardsGradeResult {
  pass: boolean;
  score: number;
  reason: string;
  checks: Record<string, boolean>;
}

/** 提示形态：问句，或含疑问词 / 情境引导 */
const PROMPT_SHAPE_PATTERN = /[？?]\s*$|为什么|什么|哪|怎么|如何|多少|是否|区别|举例|例子|说明|解释|条件|how|what|why|which|when|where|who|explain|give an example|difference/i;
/** 复述摘要式正面 */
const SUMMARY_FRONT_PATTERN = /^(这节课|本节课|这堂课|老师(讲|说|提)了|这段(主要)?|课堂(上)?(主要)?(讲|说))/;

export function frontKey(front: string): string {
  return front.replace(/[\s$，。？！、,.?!:：;；「」“”"'()（）《》]/g, '').toLowerCase();
}

/** 与生产 flashcards.plugin.frontRevealsBack 同一判断：背面整体出现在正面、或正反同一句 */
export function frontRevealsBack(front: string, back: string): boolean {
  const f = frontKey(front);
  const b = frontKey(back);
  if (!f || !b) return false;
  return f === b || (b.length >= 4 && f.includes(b));
}

/** 词条式正面：≤6 字、没有任何标点 / 问号 / 疑问词 */
export function isTitleLikeFront(front: string): boolean {
  const text = front.trim();
  return text.length > 0 && text.length <= 6 && !/[？?，。：:、]/.test(text) && !PROMPT_SHAPE_PATTERN.test(text);
}

function containsKeyword(card: GradedFlashcard, keyword: string): boolean {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return [card.front, card.back, card.concept ?? ''].join('\n').toLowerCase().includes(needle);
}

export function gradeFlashcardsQuality(cards: GradedFlashcard[], rawCards: GradedFlashcard[], expect: FlashcardsExpect = {}): FlashcardsGradeResult {
  const minCards = expect.minCards ?? 3;
  const ratio = (ok: number, total: number) => (total === 0 ? 1 : ok / total);
  const raw = rawCards.length > 0 ? rawCards : cards;

  const hard: Record<string, boolean> = {
    enoughCards: cards.length >= minCards,
    everyCardHasBothFaces: cards.every((c) => c.front.trim().length >= 4 && c.back.trim().length >= 2),
    noFrontRevealsBack: !raw.some((c) => frontRevealsBack(c.front, c.back)),
    noTitleLikeFronts: !raw.some((c) => isTitleLikeFront(c.front)),
    noDuplicateFronts: new Set(raw.map((c) => frontKey(c.front)).filter(Boolean)).size === raw.filter((c) => frontKey(c.front)).length,
    // 背面两行以内：牌面每行约 40-45 个汉字，120 字是绝对上限
    backsFitTwoLines: cards.every((c) => c.back.trim().length <= 120),
    noSummaryRestatement: !cards.some((c) => SUMMARY_FRONT_PATTERN.test(c.front.trim())),
    mustCover: (expect.mustCover ?? []).every((keyword) => cards.some((c) => containsKeyword(c, keyword))),
  };
  const soft: Record<string, boolean> = {
    // 一张卡一个点：正面两个问号 = 两张卡硬挤在一起（v1 实测常见；v2 prompt 后偶发一张，软项按比例看）
    frontsSingleQuestion: ratio(cards.filter((c) => (c.front.match(/[？?]/g) ?? []).length <= 1).length, cards.length) >= 0.9,
    // 有掌握轨迹时，上次没记住的那句不该原样再出现在正面（换角度）
    unstableNotRepeatedVerbatim: !(expect.avoidRepeating ?? []).some((previous) => cards.some((c) => nearlySame(c.front, previous))),
    frontsArePrompts: ratio(cards.filter((c) => PROMPT_SHAPE_PATTERN.test(c.front)).length, cards.length) >= 0.7,
    backsShort: ratio(cards.filter((c) => c.back.trim().length <= 70).length, cards.length) >= 0.8,
    hintsDontLeak: cards.filter((c) => c.hint?.trim()).every((c) => !frontRevealsBack(c.hint!, c.back)),
  };

  const checks = { ...hard, ...soft };
  const passedCount = Object.values(checks).filter(Boolean).length;
  const failedHard = Object.entries(hard).filter(([, ok]) => !ok).map(([name]) => name);
  const failedSoft = Object.entries(soft).filter(([, ok]) => !ok).map(([name]) => name);
  return {
    pass: failedHard.length === 0,
    score: passedCount / Object.keys(checks).length,
    reason: failedHard.length === 0 && failedSoft.length === 0
      ? `ok (${cards.length} cards)`
      : `hard failed: [${failedHard.join(', ')}] soft failed: [${failedSoft.join(', ')}]`,
    checks,
  };
}
