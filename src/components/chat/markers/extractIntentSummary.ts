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
  rawBlock: string;
  textWithoutBlock: string;
}

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

  // 如果只有一行（旧格式），lines 就是那一行
  // 如果多行，每行是一个独立"点"
  const points = lines.map((l) => l.slice(0, 120));
  const title = points[0].slice(0, 80);
  const summary = points.length > 1 ? points.slice(1).join('\n') : undefined;

  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  const textWithoutBlock = [before, after].filter(Boolean).join('\n\n');

  return { points, title, summary, rawBlock: text.slice(startIdx, blockEnd), textWithoutBlock };
}
