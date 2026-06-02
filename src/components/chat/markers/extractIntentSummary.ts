/**
 * extractIntentSummary —— 从 mode='goal' 的 AI 回复里抽出"我想要的"块。
 *
 * 形态（prompt 约定见 tutor-prompts.ts MODE_GOAL_SEGMENT）：
 *
 *   ---我想要的---
 *   一句话标题
 *   （可选多行 detail）
 *   ---结束---
 *
 * 容错：
 *   - 流式过程中只下了开头标记没下结束标记 → 返回 null（等下完再展示卡片）
 *   - 块内空白行 → 自动 trim
 *
 * 返回：
 *   - title：第一行（去掉 list 前缀，最多 80 字）
 *   - summary：剩余行
 *   - rawBlock：原始片段（包含起止 marker，方便消费者做替换）
 *   - textWithoutBlock：去掉块后的剩余文本（用于消息气泡显示——避免重复）
 */

export interface IntentSummaryExtraction {
  title: string;
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
  const lines = inner
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const title = lines[0].replace(/^[-•·*]\s*/, '').slice(0, 80);
  const summary = lines.slice(1).join('\n').trim() || undefined;
  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  const textWithoutBlock = [before, after].filter(Boolean).join('\n\n');
  return {
    title,
    summary,
    rawBlock: text.slice(startIdx, blockEnd),
    textWithoutBlock,
  };
}
