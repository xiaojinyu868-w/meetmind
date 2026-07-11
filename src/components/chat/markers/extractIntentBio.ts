/**
 * extractIntentBio —— 从 mode='goal' 首次会面对话提炼的"我了解到的你"块。
 *
 * 新格式（逐条选择）：
 *
 *   ---我了解到的你---
 *   · 你是大三学生，学计算机
 *   · 你对算法课比较吃力
 *   ---结束---
 *
 * 旧格式兼容（整块文本）。
 */

export interface IntentBioExtraction {
  /** 逐条提取的观察点 */
  points: string[];
  /** 兼容旧字段：第一条作为 headline */
  headline: string;
  /** 兼容旧字段：剩余条合并为 detail */
  detail?: string;
  rawBlock: string;
  textWithoutBlock: string;
}

export function extractIntentBio(text: string): IntentBioExtraction | null {
  const startMatch = text.match(/-{2,}我了解到的你-{2,}/);
  if (!startMatch || typeof startMatch.index !== 'number') return null;
  const startIdx = startMatch.index;
  const afterStart = text.slice(startIdx + startMatch[0].length);
  const endMatch = afterStart.match(/-{2,}结束-{2,}/);
  if (!endMatch || typeof endMatch.index !== 'number') return null;
  const inner = afterStart.slice(0, endMatch.index).trim();
  if (!inner) return null;

  const lines = inner
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[·•\-*]\s*/, '').trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const points = lines.map((l) => l.slice(0, 200));
  const headline = points[0].slice(0, 200);
  const detail = points.length > 1 ? points.slice(1).join('\n') : undefined;

  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  const textWithoutBlock = [before, after].filter(Boolean).join('\n\n');

  return { points, headline, detail, rawBlock: text.slice(startIdx, blockEnd), textWithoutBlock };
}
