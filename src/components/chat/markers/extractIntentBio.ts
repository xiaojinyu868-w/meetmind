/**
 * extractIntentBio —— 从 mode='goal' 首次会面对话提炼的"我了解到的你"块。
 *
 * 形态（prompt 约定见 tutor-prompts.ts MODE_GOAL_SEGMENT 路径 A）：
 *
 *   ---我了解到的你---
 *   一句话核心：身份 + 阶段 + 当前主要状态
 *   （可选 1-2 行 detail）
 *   ---结束---
 *
 * 与 extractIntentSummary（"---我想要的---"）平行。两者 marker 不冲突，
 * 一条消息也可能两者都有（罕见，但允许）。这里只负责抽 bio 块。
 */

export interface IntentBioExtraction {
  /** 一句话核心，第二人称（你是…） */
  headline: string;
  /** 可选详情 */
  detail?: string;
  /** 原始片段（含起止 marker） */
  rawBlock: string;
  /** 去掉块后的剩余文本（用于消息气泡显示） */
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
    .filter(Boolean);
  if (lines.length === 0) return null;
  const headline = lines[0].replace(/^[-•·*]\s*/, '').slice(0, 200);
  const detail = lines.slice(1).join('\n').trim() || undefined;
  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  const textWithoutBlock = [before, after].filter(Boolean).join('\n\n');
  return {
    headline,
    detail,
    rawBlock: text.slice(startIdx, blockEnd),
    textWithoutBlock,
  };
}
