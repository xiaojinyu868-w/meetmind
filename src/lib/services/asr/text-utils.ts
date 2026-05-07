/**
 * ASR 文本后处理工具 (TS 版)
 *
 * server/asr/text-utils.js (JS/CJS) 的 TS 镜像；供 API 路由 + 评测 harness 复用。
 * 两个版本必须保持语义一致；真正的实现只在 TS 这边维护，JS 层只做 re-export wrapper。
 *
 * 注意：M2 的 T2.7 会引入 token-level LCS 缝合 + 10min 分片，这个文件会长大。
 */

/** 按字符切分（正确处理 CJK + emoji），用于 CER 对齐和 dedup */
export function toChars(text: string): string[] {
  return Array.from(text);
}

/** 归一化文本以便"语义等价"比较：NFKC + 去空白标点 + 小写 */
export function normalizeForCompare(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:：'"“”‘’（）()【】\[\]-]/g, '');
}

/** 两串归一化后的最长公共子串占较短串的比例。用于 dedup 判断。 */
export function longestCommonSubstringRatio(a: string, b: string): number {
  const left = normalizeForCompare(a);
  const right = normalizeForCompare(b);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;

  const dp = new Array<number>(shorter.length + 1).fill(0);
  let maxLen = 0;

  for (let i = 1; i <= longer.length; i += 1) {
    for (let j = shorter.length; j >= 1; j -= 1) {
      if (longer[i - 1] === shorter[j - 1]) {
        dp[j] = dp[j - 1] + 1;
        if (dp[j] > maxLen) maxLen = dp[j];
      } else {
        dp[j] = 0;
      }
    }
  }

  return maxLen / shorter.length;
}

/**
 * Token-level 最长公共后缀/前缀对齐（Whisper-style overlap merging）。
 * 返回 a 的末尾和 b 的开头有多少 token 重叠。
 * 用于 M2 T2.7 的长音频重叠缝合：两段转写在时间上 overlap N 秒，
 * 我们需要找到 a.tail 和 b.head 的最长重合，把 b.head 的那部分丢掉。
 *
 * @param a 前一段转写（characters 形式）
 * @param b 后一段转写
 * @returns 重合长度（字符数）
 */
export function findOverlapLength(a: string[], b: string[]): number {
  const maxCheck = Math.min(a.length, b.length, 200); // 上限 200 字防退化
  for (let k = maxCheck; k > 0; k -= 1) {
    let match = true;
    for (let i = 0; i < k; i += 1) {
      const aChar = a[a.length - k + i];
      const bChar = b[i];
      if (!aChar || !bChar || normalizeForCompare(aChar) !== normalizeForCompare(bChar)) {
        match = false;
        break;
      }
    }
    if (match) return k;
  }
  return 0;
}

export interface AsrSentence {
  text: string;
  begin_time?: number;
  end_time?: number;
  start_time?: number;
}

/**
 * 把分块的 ASR 结果按 timeOffset 拼回完整时间轴。
 *
 * 修复了 server.js:294-315 的 bug：原来 timeOffset 对失败分块也无条件累加，
 * 导致后续块时间戳偏离实际音频位置。新实现：
 *   - 永远按 segmentDurations[i] 累加 offset（定义了分块边界就是真理）
 *   - 失败分块的内容不参与输出，但不影响后续块对齐
 *   - 返回 failedIndices 让上层决定是否部分重试
 */
export interface StitchInput {
  sentences: AsrSentence[];
  /** 是否成功；失败时 sentences 为空但 index 仍会被计入 offset */
  success: boolean;
  error?: string;
}

export interface StitchResult {
  allSentences: AsrSentence[];
  failedIndices: number[];
  totalDurationMs: number;
}

export function stitchSegments(
  results: StitchInput[],
  segmentDurationsMs: number[],
): StitchResult {
  const allSentences: AsrSentence[] = [];
  const failedIndices: number[] = [];
  let timeOffset = 0;

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const duration = segmentDurationsMs[i] ?? 0;

    if (!result.success) {
      failedIndices.push(i);
    } else if (result.sentences.length > 0) {
      for (const s of result.sentences) {
        const begin = (s.begin_time ?? s.start_time ?? 0) + timeOffset;
        const end = (s.end_time ?? 0) + timeOffset;
        allSentences.push({ ...s, begin_time: begin, end_time: end });
      }
    }

    timeOffset += duration;
  }

  return {
    allSentences,
    failedIndices,
    totalDurationMs: timeOffset,
  };
}

/**
 * Stitch with overlap - Whisper-style token-level LCS merging (M2 T2.7)
 *
 * 分块时带 `overlapMs` 的冗余，缝合时：
 *   1. 每段的真实"非重叠"部分 = [0, segDuration - overlap]（首段）或 [overlap, segDuration]（后续段）
 *   2. 用前后段的文本 token-level 最长后缀-前缀匹配，去重
 *   3. 保留时间单调
 *
 * @param results 各段 ASR 结果（时间戳是相对段内 0 开始）
 * @param segmentTimings 每段 {startMs, endMs, overlapLeadMs}
 *        startMs: 该段在原音频的起始
 *        endMs: 该段在原音频的结束（含 overlap）
 *        overlapLeadMs: 该段开头有多少 ms 与前段重叠（首段为 0）
 */
export interface OverlappedSegmentTiming {
  startMs: number;
  endMs: number;
  overlapLeadMs: number;
}

export function stitchSegmentsWithOverlap(
  results: StitchInput[],
  segmentTimings: OverlappedSegmentTiming[],
): StitchResult {
  const allSentences: AsrSentence[] = [];
  const failedIndices: number[] = [];
  let totalDurationMs = 0;

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const timing = segmentTimings[i] ?? { startMs: 0, endMs: 0, overlapLeadMs: 0 };
    totalDurationMs = Math.max(totalDurationMs, timing.endMs);

    if (!result.success) {
      failedIndices.push(i);
      continue;
    }

    for (const s of result.sentences) {
      const localBegin = s.begin_time ?? s.start_time ?? 0;
      const localEnd = s.end_time ?? 0;

      // 落在 overlap 区间内的句子：跳过（由前段负责）
      // 仅对 i > 0 且 localBegin < overlapLeadMs 的句子才算 overlap 内
      if (i > 0 && localEnd <= timing.overlapLeadMs) {
        continue; // 完全在 overlap 里，丢
      }

      const begin = timing.startMs + localBegin;
      const end = timing.startMs + localEnd;
      allSentences.push({ ...s, begin_time: begin, end_time: end });
    }
  }

  // 按时间排序 + 相邻句去重（text 级 LCS 检测）
  allSentences.sort((a, b) => (a.begin_time ?? 0) - (b.begin_time ?? 0));

  const deduped: AsrSentence[] = [];
  for (const s of allSentences) {
    const last = deduped[deduped.length - 1];
    if (last) {
      const ratio = longestCommonSubstringRatio(last.text, s.text);
      const timeGap = (s.begin_time ?? 0) - (last.end_time ?? 0);
      // 相邻 <500ms 且 95% 以上相似 → 视作 overlap 边界重复
      if (ratio >= 0.95 && timeGap <= 500) continue;
    }
    deduped.push(s);
  }

  return { allSentences: deduped, failedIndices, totalDurationMs };
}

/**
 * Full Jitter 退避（AWS 推荐）。
 * delay = random(0, min(cap, base * 2^attempt))
 *
 * @param attempt 0-indexed 尝试次数
 * @param baseMs 基础延迟
 * @param capMs 上限
 */
export function fullJitterDelay(attempt: number, baseMs = 500, capMs = 30000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}
