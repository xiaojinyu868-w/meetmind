// Grader: 时间戳引用校验
// 判断 Tutor 回答里引用的时间戳 [t=MM:SS] 是否落在 fixture 允许的窗口内。
// 这是确定性校验（不走 LLM judge），所以必须稳、必须 0 假阳性。

export interface TimestampCitationCase {
  id: string;
  question: string;
  /** 允许被引用的时间窗，秒 */
  expectedWindow: { start: number; end: number };
  /** 是否必须至少引用一个时间戳。默认 true */
  requireAtLeastOne?: boolean;
}

export interface GraderResult {
  pass: boolean;
  score: number;
  reason: string;
  details?: Record<string, unknown>;
}

const CITE_RE = /\[t=(\d{1,3}):(\d{2})\]/g;

export function extractCitations(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) {
      out.push(minutes * 60 + seconds);
    }
  }
  return out;
}

export function gradeTimestampCitation(
  output: string,
  caseDef: TimestampCitationCase,
): GraderResult {
  const cited = extractCitations(output);
  const { start, end } = caseDef.expectedWindow;
  const requireAtLeastOne = caseDef.requireAtLeastOne ?? true;

  if (cited.length === 0) {
    return requireAtLeastOne
      ? { pass: false, score: 0, reason: 'no citation found', details: { cited } }
      : { pass: true, score: 1, reason: 'no citation expected or required', details: { cited } };
  }

  const invalid = cited.filter((t) => t < start || t > end);
  if (invalid.length > 0) {
    return {
      pass: false,
      score: 0,
      reason: `citation out of window [${start}s, ${end}s]`,
      details: { cited, invalid },
    };
  }

  return {
    pass: true,
    score: 1,
    reason: `${cited.length} citation(s) within window`,
    details: { cited },
  };
}
