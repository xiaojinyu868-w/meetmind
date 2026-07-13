export interface LearningProgressExtraction {
  points: string[];
  rawBlock: string;
  textWithoutBlock: string;
}

export function extractLearningProgress(text: string): LearningProgressExtraction | null {
  const startMatch = text.match(/-{2,}学习进展-{2,}/);
  if (!startMatch || typeof startMatch.index !== 'number') return null;
  const startIdx = startMatch.index;
  const afterStart = text.slice(startIdx + startMatch[0].length);
  const endMatch = afterStart.match(/-{2,}结束-{2,}/);
  if (!endMatch || typeof endMatch.index !== 'number') return null;
  const inner = afterStart.slice(0, endMatch.index).trim();
  const points = inner
    .split('\n')
    .map((line) => line.trim().replace(/^[·•\-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line) => line.slice(0, 160));
  if (points.length === 0) return null;

  const blockEnd = startIdx + startMatch[0].length + endMatch.index + endMatch[0].length;
  const before = text.slice(0, startIdx).trim();
  const after = text.slice(blockEnd).trim();
  return {
    points,
    rawBlock: text.slice(startIdx, blockEnd),
    textWithoutBlock: [before, after].filter(Boolean).join('\n\n'),
  };
}
