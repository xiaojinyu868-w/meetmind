// 判分准确率 grader —— teach eval 门禁核心指标。
// 从判分轮口播全文 + 该轮新落板文本中按出现顺序提取逐题判定（对/部分对/错），
// 与 expect.verdicts 逐题比对；没判出来的题按 wrong 计（没判 = 门禁不认）。
import type { TeachCaseExpect, TurnCapture } from '../runner';

export type Verdict = 'correct' | 'partial' | 'wrong';

export interface GradeResult {
  pass: boolean;
  score: number;
  reason: string;
}

// 模式优先级：partial > wrong > correct。「不对」含「对」、「不正确」含「正确」，
// 靠重叠区间去重解决：先命中的长词吃掉其区间内的短词命中。
const PATTERNS: Array<[Verdict, RegExp]> = [
  ['partial', /部分对|部分正确|半对|不完全对|只对了一半|对了一半/g],
  ['wrong', /不对|答错|错误|不正确|✗|×/g],
  ['correct', /答对|正确|✓|√/g],
];

/** 同一题判定词的局部窗口：同 verdict 命中相距 <10 字视为重复（"答对了 ✓"）。 */
const DEDUP_WINDOW = 10;

interface Hit {
  index: number;
  length: number;
  verdict: Verdict;
}

function scanHits(text: string): Hit[] {
  const hits: Hit[] = [];
  for (const [verdict, re] of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ index: m.index, length: m[0].length, verdict });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits;
}

/** 排序 + 去重后的有效判定序列（未截断到 count）。 */
export function scanVerdicts(text: string): Verdict[] {
  const kept: Hit[] = [];
  for (const h of scanHits(text)) {
    const last = kept[kept.length - 1];
    if (!last) {
      kept.push(h);
      continue;
    }
    // 落在上一命中区间内部（不正确→正确、部分正确→正确）：被长词吃掉
    if (h.index < last.index + last.length) continue;
    // 同 verdict 近距离重复：同一题的强调，不另计
    if (h.verdict === last.verdict && h.index - last.index < DEDUP_WINDOW) continue;
    kept.push(h);
  }
  return kept.map((h) => h.verdict);
}

/**
 * 按出现顺序提取 count 个判定；不足 count 的按 'wrong' 补齐
 * （老师没判的题不能当对处理）。
 */
export function parseVerdicts(text: string, count: number): Verdict[] {
  const found = scanVerdicts(text);
  const out = found.slice(0, count);
  while (out.length < count) out.push('wrong');
  return out;
}

/** 判分轮全文 = 口播 + 该轮新落板的 wb_draw_text/wb_draw_latex 内容。 */
function gradingTurnText(turn: TurnCapture): string {
  const boardText = turn.events
    .filter(
      (e) =>
        e.kind === 'tool-call' && (e.name === 'wb_draw_text' || e.name === 'wb_draw_latex'),
    )
    .map((e) => String(e.args?.content ?? e.args?.latex ?? ''))
    .join('\n');
  return `${turn.speechText}\n${boardText}`;
}

export function gradeGradingAccuracy(
  turns: TurnCapture[],
  expect: TeachCaseExpect,
): GradeResult {
  const expected = expect.verdicts;
  if (expected.length === 0) {
    return { pass: true, score: 1, reason: '无期望判定，跳过' };
  }
  const text = gradingTurnText(turns[turns.length - 1]);
  const found = scanVerdicts(text);
  const parsed = parseVerdicts(text, expected.length);

  const matches = parsed.filter((v, i) => v === expected[i]).length;
  const pass = matches === expected.length;
  const reasons: string[] = [];
  if (!pass) {
    reasons.push(`期望 [${expected.join(',')}] 实得 [${parsed.join(',')}]`);
  }
  if (found.length < expected.length) {
    reasons.push(`只提取到 ${found.length}/${expected.length} 个判定，缺失按 wrong 计`);
  }
  return {
    pass,
    score: matches / expected.length,
    reason: pass
      ? `判分 ${matches}/${expected.length} 与期望一致`
      : reasons.join('；'),
  };
}
