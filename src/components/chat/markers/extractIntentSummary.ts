/**
 * extractIntentSummary —— 从 mode='goal' 的 AI 回复里抽出"我想要的"块。
 *
 * 新格式（逐条选择）：
 *
 *   ---我想要的---
 *   · 我想转行做设计
 *   · 画画一直是我放不下的
 *   · 我想找到每天醒来愿意去做的事
 *   ---结束---
 *
 * 旧格式兼容（整块文本）：
 *
 *   ---我想要的---
 *   我想转行做设计——因为...
 *   ---结束---
 *
 * 返回 points: string[]（每个点独立），同时保持 title/summary 向后兼容。
 */

export interface IntentSummaryExtraction {
  /** 逐条提取的观察点 */
  points: string[];
  /** 兼容旧字段：第一条作为 title */
  title: string;
  /** 兼容旧字段：剩余条合并为 summary */
  summary?: string;
  /**
   * 时间尺度（M15）：AI 在首行用 [短期] / [中期] / [长期] 前缀标记。
   * near = 眼前有明确节点（考试/DDL）；term = 学期/季度；long = 长期方向。
   */
  horizon?: 'near' | 'term' | 'long';
  rawBlock: string;
  textWithoutBlock: string;
}

const HORIZON_MAP: Record<string, 'near' | 'term' | 'long'> = {
  短期: 'near',
  中期: 'term',
  长期: 'long',
};

export function extractIntentSummary(text: string): IntentSummaryExtraction | null {
  const startMatch = text.match(/-{2,}我想要的-{2,}/);
  if (!startMatch || typeof startMatch.index !== 'number') return null;
  const startIdx = startMatch.index;
  const afterStart = text.slice(startIdx + startMatch[0].length);
  const endMatch = afterStart.match(/-{2,}结束-{2,}/);
  if (!endMatch || typeof endMatch.index !== 'number') return null;
  const inner = afterStart.slice(0, endMatch.index).trim();
  if (!inner) return null;

  // 按行拆分，去掉 `· ` / `- ` / `* ` / `• ` 前缀
  const lines = inner
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[·•\-*]\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  // 首行可带时间尺度前缀：[短期] / [中期] / [长期] —— 解析后剥掉，不进展示文本
  let horizon: IntentSummaryExtraction['horizon'];
  const horizonMatch = lines[0].match(/^\[(短期|中期|长期)\]\s*/);
  if (horizonMatch) {
    horizon = HORIZON_MAP[horizonMatch[1]];
    lines[0] = lines[0].slice(horizonMatch[0].length).trim();
    if (!lines[0]) return null;
  }

  // 如果只有一行（旧格式），lines 就是那一行
  // 如果多行，每行是一个独立"点"
  const points = lines.map((l) => l.slice(0, 120));
  const title = points[0].slice(0, 80);
  const summary = points.length > 1 ? points.slice(1).join('\n') : undefined;

  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  const textWithoutBlock = [before, after].filter(Boolean).join('\n\n');

  return { points, title, summary, horizon, rawBlock: text.slice(startIdx, blockEnd), textWithoutBlock };
}
