/**
 * extractIntentOptions —— 从 mode='goal' 的 AI 回复里抽出"选项"块。
 *
 * 目标共建是选择题驱动的对话：AI 每轮回复末尾给出 2-4 个短选项，
 * 用户点选即作答（果冻按钮），不必打字。格式：
 *
 *   ---选项---
 *   · 一门课 / 一场考试
 *   · 一项想练的技能
 *   · 都不是，我自己说
 *   ---结束---
 *
 * 返回 options: string[] 与去掉选项块后的可见文本。
 * 流式进行中（块未闭合）返回 null —— 调用方应配合 stripPartialIntentOptions
 * 把半截 marker 从可见文本里剃掉，避免用户看到原始标记。
 */

export interface IntentOptionsExtraction {
  options: string[];
  rawBlock: string;
  textWithoutBlock: string;
}

const MAX_OPTIONS = 4;
const MAX_OPTION_LEN = 24;

export function extractIntentOptions(text: string): IntentOptionsExtraction | null {
  const startMatch = text.match(/-{2,}选项-{2,}/);
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

  const options = lines.slice(0, MAX_OPTIONS).map((l) => l.slice(0, MAX_OPTION_LEN));

  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  const textWithoutBlock = [before, after].filter(Boolean).join('\n\n');

  return { options, rawBlock: text.slice(startIdx, blockEnd), textWithoutBlock };
}

/**
 * 流式期间选项块还没闭合时，把半截 `---选项---…` 从可见文本尾部剃掉。
 * 已闭合的块由 extractIntentOptions 处理，这里只兜底"未闭合"的情况。
 */
export function stripPartialIntentOptions(text: string): string {
  const idx = text.search(/-{2,}选项-{2,}/);
  if (idx < 0) return text;
  // 块已闭合则原样返回（交给 extractIntentOptions）
  const rest = text.slice(idx);
  if (/-{2,}结束-{2,}/.test(rest)) return text;
  return text.slice(0, idx).trimEnd();
}

const INTENT_BLOCK_MARKERS = ['选项', '我想要的', '我了解到的你'] as const;

/**
 * 流式期间把三种 intent marker（选项 / 我想要的 / 我了解到的你）的
 * 未闭合半截块全部从可见文本尾部剃掉，避免用户看到原始标记。
 */
export function stripPartialIntentBlocks(text: string): string {
  let out = text;
  for (const marker of INTENT_BLOCK_MARKERS) {
    const re = new RegExp(`-{2,}${marker}-{2,}`);
    const idx = out.search(re);
    if (idx < 0) continue;
    const rest = out.slice(idx);
    if (/-{2,}结束-{2,}/.test(rest)) continue;
    out = out.slice(0, idx).trimEnd();
  }
  return out;
}
