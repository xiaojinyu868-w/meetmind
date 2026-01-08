/**
 * LongCut 工具函数的本地封装
 * 
 * 这些函数是从 LongCut 项目复制/改造的核心算法
 * 用于在 MeetMind 中直接使用，无需 API 调用
 */

export interface Segment {
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * 格式化时间戳 (毫秒 -> mm:ss)
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 格式化时间范围
 */
export function formatTimeRange(startMs: number, endMs: number): string {
  return `${formatTimestamp(startMs)}-${formatTimestamp(endMs)}`;
}

/**
 * 合并短句为完整段落
 * 复用自 LongCut: lib/transcript-sentence-merger.ts
 */
export function mergeSentences(
  segments: Segment[],
  options: {
    maxGapMs?: number;      // 最大间隔（默认 2000ms）
    maxDurationMs?: number; // 最大段落时长（默认 30000ms）
    minLength?: number;     // 最小字符数（默认 10）
  } = {}
): Segment[] {
  const { 
    maxGapMs = 2000, 
    maxDurationMs = 30000,
    minLength = 10 
  } = options;

  if (segments.length === 0) return [];

  const merged: Segment[] = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i];
    const gap = segment.startMs - current.endMs;
    const mergedDuration = segment.endMs - current.startMs;

    // 如果间隔小且合并后不超长，则合并
    if (gap < maxGapMs && mergedDuration < maxDurationMs) {
      current.text += ' ' + segment.text;
      current.endMs = segment.endMs;
    } else {
      // 只保留足够长的段落
      if (current.text.length >= minLength) {
        merged.push(current);
      }
      current = { ...segment };
    }
  }

  // 添加最后一个
  if (current.text.length >= minLength) {
    merged.push(current);
  }

  return merged;
}

/**
 * 在文本中匹配引用
 * 复用自 LongCut: lib/quote-matcher.ts
 */
export function matchQuotes(
  response: string,
  segments: Segment[]
): Array<{ text: string; startMs: number; endMs: number; matchScore: number }> {
  const matches: Array<{ text: string; startMs: number; endMs: number; matchScore: number }> = [];
  
  // 简化版：查找响应中被引号包围的文本
  const quotePattern = /[「""]([^「""」]+)[」""]/g;
  let match;

  while ((match = quotePattern.exec(response)) !== null) {
    const quotedText = match[1];
    
    // 在 segments 中查找最匹配的
    let bestMatch: Segment | null = null;
    let bestScore = 0;

    for (const segment of segments) {
      const score = calculateSimilarity(quotedText, segment.text);
      if (score > bestScore && score > 0.5) {
        bestScore = score;
        bestMatch = segment;
      }
    }

    if (bestMatch) {
      matches.push({
        text: quotedText,
        startMs: bestMatch.startMs,
        endMs: bestMatch.endMs,
        matchScore: bestScore,
      });
    }
  }

  return matches;
}

/**
 * 计算文本相似度 (简化版 Jaccard)
 */
function calculateSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * 根据时间戳查找对应的段落
 */
export function findSegmentAtTime(
  segments: Segment[],
  timeMs: number
): Segment | null {
  return segments.find(s => s.startMs <= timeMs && s.endMs >= timeMs) || null;
}

/**
 * 获取时间范围内的所有段落
 */
export function getSegmentsInRange(
  segments: Segment[],
  startMs: number,
  endMs: number
): Segment[] {
  return segments.filter(s => 
    (s.startMs >= startMs && s.startMs < endMs) ||
    (s.endMs > startMs && s.endMs <= endMs) ||
    (s.startMs <= startMs && s.endMs >= endMs)
  );
}
