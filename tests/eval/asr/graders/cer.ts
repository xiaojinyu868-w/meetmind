/**
 * Character Error Rate (CER) - 中文 ASR 评测基础指标
 *
 * 公式：CER = (S + D + I) / N
 *   S = 替换（substitution）
 *   D = 删除（deletion）
 *   I = 插入（insertion）
 *   N = reference 字符数
 *
 * 中文处理：按"字符"切分（Array.from 处理 Unicode），而非按词。
 * 对齐：标准 Levenshtein 动态规划，回溯得到 S/D/I 计数。
 *
 * 归一化（可选）：
 *   - 去空格
 *   - 全角转半角
 *   - 标点归一
 *   - 数字中文互转（"二零二六" ↔ "2026"）——先不做，避免过度归一
 */

export interface NormalizeOptions {
  /** 去除所有空白（中文/英文混排常用） */
  stripWhitespace?: boolean;
  /** 全角数字/字母 → 半角 */
  toHalfWidth?: boolean;
  /** 去除所有中英标点 */
  stripPunctuation?: boolean;
  /** 英文转小写 */
  toLowerCase?: boolean;
}

const DEFAULT_NORMALIZE: NormalizeOptions = {
  stripWhitespace: true,
  toHalfWidth: true,
  stripPunctuation: true,
  toLowerCase: true,
};

const FULL_WIDTH_OFFSET = 0xFEE0; // 全角 → 半角
const FULL_WIDTH_SPACE = 0x3000;

const CN_PUNCT = /[，。！？、；：""''「」『』（）【】《》…—·]/g;
const EN_PUNCT = /[,.!?;:"'`()[\]{}<>@#$%^&*\-_+=|\\/~]/g;

export function normalize(text: string, opts: NormalizeOptions = DEFAULT_NORMALIZE): string {
  let s = text;

  if (opts.toHalfWidth) {
    s = s.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - FULL_WIDTH_OFFSET));
    s = s.replace(/　/g, ' '); // full-width space
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _ = FULL_WIDTH_SPACE; // keep constant referenced for clarity
  }

  if (opts.toLowerCase) s = s.toLowerCase();
  if (opts.stripPunctuation) s = s.replace(CN_PUNCT, '').replace(EN_PUNCT, '');
  if (opts.stripWhitespace) s = s.replace(/\s+/g, '');

  return s;
}

/** 将字符串切成"字元"数组（正确处理 CJK + emoji） */
export function toChars(text: string): string[] {
  return Array.from(text);
}

export interface CerResult {
  cer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceLength: number;
  hypothesisLength: number;
  editDistance: number;
}

/**
 * 计算 CER。
 *
 * @param reference 标准答案（ground truth）
 * @param hypothesis ASR 输出
 * @param normalizeOpts 归一化选项；传 null 或 false 跳过归一化
 */
export function computeCer(
  reference: string,
  hypothesis: string,
  normalizeOpts: NormalizeOptions | false = DEFAULT_NORMALIZE,
): CerResult {
  const ref = normalizeOpts === false ? reference : normalize(reference, normalizeOpts);
  const hyp = normalizeOpts === false ? hypothesis : normalize(hypothesis, normalizeOpts);

  const refChars = toChars(ref);
  const hypChars = toChars(hyp);

  const n = refChars.length;
  const m = hypChars.length;

  if (n === 0) {
    return {
      cer: m === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: m,
      referenceLength: 0,
      hypothesisLength: m,
      editDistance: m,
    };
  }

  // dp[i][j] = minimum edit distance of refChars[..i] to hypChars[..j]
  // + ops[i][j] = 'match' | 'sub' | 'del' | 'ins' 用于回溯
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  const ops: string[][] = Array.from({ length: n + 1 }, () => new Array<string>(m + 1).fill(''));

  for (let i = 0; i <= n; i++) {
    dp[i][0] = i;
    ops[i][0] = 'del';
  }
  for (let j = 0; j <= m; j++) {
    dp[0][j] = j;
    ops[0][j] = 'ins';
  }
  ops[0][0] = 'match';

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (refChars[i - 1] === hypChars[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        ops[i][j] = 'match';
      } else {
        const sub = dp[i - 1][j - 1] + 1;
        const del = dp[i - 1][j] + 1;
        const ins = dp[i][j - 1] + 1;
        const best = Math.min(sub, del, ins);
        dp[i][j] = best;
        ops[i][j] = best === sub ? 'sub' : best === del ? 'del' : 'ins';
      }
    }
  }

  // 回溯统计
  let s = 0, d = 0, ins = 0;
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const op = ops[i][j];
    if (op === 'match') { i--; j--; }
    else if (op === 'sub') { s++; i--; j--; }
    else if (op === 'del') { d++; i--; }
    else if (op === 'ins') { ins++; j--; }
    else break;
  }

  const editDistance = dp[n][m];
  return {
    cer: editDistance / n,
    substitutions: s,
    deletions: d,
    insertions: ins,
    referenceLength: n,
    hypothesisLength: m,
    editDistance,
  };
}
