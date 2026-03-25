/**
 * Highlight Service — 引用匹配器
 *
 * 从 highlight-service.ts 提取，包含在转录文本中定位引用的核心算法。
 */

import type { TranscriptSegment } from '@/lib/db';
import type {
  HighlightSegment,
  ImportanceLevel,
  TopicCandidate,
} from '@/types';
import {
  parseTimestampRange,
  cleanText,
  calculateSimilarity,
} from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface MatchResult {
  segments: TranscriptSegment[];
  startIdx: number;
  endIdx: number;
  similarity: number;
  combinedText: string;
}

/* ------------------------------------------------------------------ */
/*  findSubstringPosition — 模糊子串定位                                */
/* ------------------------------------------------------------------ */

export function findSubstringPosition(
  fullText: string,
  searchText: string,
  minMatchRatio: number = 0.6
): { startIdx: number; endIdx: number; matchedText: string } | null {
  const cleanFull = cleanText(fullText);
  const cleanSearch = cleanText(searchText);
  
  if (cleanFull.length === 0 || cleanSearch.length === 0) return null;
  
  // 1. 尝试精确匹配
  const exactIdx = cleanFull.indexOf(cleanSearch);
  if (exactIdx !== -1) {
    return {
      startIdx: exactIdx,
      endIdx: exactIdx + cleanSearch.length,
      matchedText: cleanSearch
    };
  }
  
  // 2. 尝试查找最长公共子串
  let bestMatch = { start: 0, length: 0 };
  
  for (let len = Math.min(cleanSearch.length, cleanFull.length); len >= Math.floor(cleanSearch.length * minMatchRatio); len--) {
    for (let i = 0; i <= cleanSearch.length - len; i++) {
      const substr = cleanSearch.slice(i, i + len);
      const foundIdx = cleanFull.indexOf(substr);
      if (foundIdx !== -1 && len > bestMatch.length) {
        bestMatch = { start: foundIdx, length: len };
        break;
      }
    }
    if (bestMatch.length > 0) break;
  }
  
  if (bestMatch.length >= Math.floor(cleanSearch.length * minMatchRatio)) {
    return {
      startIdx: bestMatch.start,
      endIdx: bestMatch.start + bestMatch.length,
      matchedText: cleanFull.slice(bestMatch.start, bestMatch.start + bestMatch.length)
    };
  }
  
  return null;
}

/* ------------------------------------------------------------------ */
/*  hasTimeOverlap — 时间范围交集检测                                    */
/* ------------------------------------------------------------------ */

export function hasTimeOverlap(
  seg: { startMs: number; endMs: number },
  range: { startMs: number; endMs: number },
  tolerance: number
): boolean {
  return seg.endMs >= range.startMs - tolerance && seg.startMs <= range.endMs + tolerance;
}

/* ------------------------------------------------------------------ */
/*  calculatePreciseTime — 基于语速的字符级时间定位                       */
/* ------------------------------------------------------------------ */

export function calculatePreciseTime(
  segment: TranscriptSegment,
  charStartIdx: number,
  charEndIdx: number
): { startMs: number; endMs: number } {
  const cleanedText = cleanText(segment.text);
  const charCount = cleanedText.length;
  
  if (charCount === 0) {
    return { startMs: segment.startMs, endMs: segment.endMs };
  }
  
  const duration = segment.endMs - segment.startMs;
  const msPerChar = duration / charCount;
  
  const preciseStart = segment.startMs + charStartIdx * msPerChar;
  const preciseEnd = segment.startMs + charEndIdx * msPerChar;
  
  return { startMs: preciseStart, endMs: preciseEnd };
}

/* ------------------------------------------------------------------ */
/*  findQuoteInTranscript — 在转录中精确定位引用文本                      */
/* ------------------------------------------------------------------ */

export function findQuoteInTranscript(
  segments: TranscriptSegment[],
  quote: { timestamp: string; text: string }
): HighlightSegment[] {
  
  if (!quote.text || quote.text.length < 3) {
    return [];
  }
  
  const timeRange = parseTimestampRange(quote.timestamp);
  const TOLERANCE_MS = 30000; // 30秒容差
  const BUFFER_MS = 2000; // 2秒播放缓冲
  
  // Step 1: 筛选候选片段
  let candidates: TranscriptSegment[];
  if (timeRange) {
    candidates = segments.filter(seg => hasTimeOverlap(seg, timeRange, TOLERANCE_MS));
    if (candidates.length === 0) {
      candidates = segments;
    }
  } else {
    candidates = segments;
  }
  
  // Step 2: 计算所有可能匹配的相似度（单片段 + 连续组合）
  const matches: MatchResult[] = [];
  
  // 单片段匹配
  for (let i = 0; i < candidates.length; i++) {
    const seg = candidates[i];
    const similarity = calculateSimilarity(quote.text, seg.text);
    const globalIdx = segments.indexOf(seg);
    
    matches.push({
      segments: [seg],
      startIdx: globalIdx,
      endIdx: globalIdx,
      similarity,
      combinedText: seg.text
    });
  }
  
  // 连续 2 片段组合
  for (let i = 0; i < candidates.length - 1; i++) {
    const seg1 = candidates[i];
    const seg2 = candidates[i + 1];
    
    const idx1 = segments.indexOf(seg1);
    const idx2 = segments.indexOf(seg2);
    if (idx2 !== idx1 + 1) continue;
    
    const combinedText = seg1.text + seg2.text;
    const similarity = calculateSimilarity(quote.text, combinedText);
    
    matches.push({
      segments: [seg1, seg2],
      startIdx: idx1,
      endIdx: idx2,
      similarity,
      combinedText
    });
  }
  
  // 连续 3 片段组合
  for (let i = 0; i < candidates.length - 2; i++) {
    const seg1 = candidates[i];
    const seg2 = candidates[i + 1];
    const seg3 = candidates[i + 2];
    
    const idx1 = segments.indexOf(seg1);
    const idx2 = segments.indexOf(seg2);
    const idx3 = segments.indexOf(seg3);
    if (idx2 !== idx1 + 1 || idx3 !== idx2 + 1) continue;
    
    const combinedText = seg1.text + seg2.text + seg3.text;
    const similarity = calculateSimilarity(quote.text, combinedText);
    
    matches.push({
      segments: [seg1, seg2, seg3],
      startIdx: idx1,
      endIdx: idx3,
      similarity,
      combinedText
    });
  }
  
  // Step 3: 选择最佳匹配
  matches.sort((a, b) => b.similarity - a.similarity);
  
  if (matches.length === 0 || matches[0].similarity < 0.2) {
    return [];
  }
  
  const bestMatch = matches[0];
  
  // Step 4: 基于语速精确定位
  let preciseStartMs: number;
  let preciseEndMs: number;
  
  const position = findSubstringPosition(bestMatch.combinedText, quote.text);
  
  if (position && bestMatch.segments.length === 1) {
    const seg = bestMatch.segments[0];
    const precise = calculatePreciseTime(seg, position.startIdx, position.endIdx);
    preciseStartMs = precise.startMs;
    preciseEndMs = precise.endMs;
  } else if (position && bestMatch.segments.length > 1) {
    let charOffset = 0;
    
    let startSegIdx = 0;
    let startCharInSeg = position.startIdx;
    for (let i = 0; i < bestMatch.segments.length; i++) {
      const segCleanLen = cleanText(bestMatch.segments[i].text).length;
      if (charOffset + segCleanLen > position.startIdx) {
        startSegIdx = i;
        startCharInSeg = position.startIdx - charOffset;
        break;
      }
      charOffset += segCleanLen;
    }
    
    charOffset = 0;
    let endSegIdx = bestMatch.segments.length - 1;
    let endCharInSeg = position.endIdx;
    for (let i = 0; i < bestMatch.segments.length; i++) {
      const segCleanLen = cleanText(bestMatch.segments[i].text).length;
      if (charOffset + segCleanLen >= position.endIdx) {
        endSegIdx = i;
        endCharInSeg = position.endIdx - charOffset;
        break;
      }
      charOffset += segCleanLen;
    }
    
    const startPrecise = calculatePreciseTime(bestMatch.segments[startSegIdx], startCharInSeg, cleanText(bestMatch.segments[startSegIdx].text).length);
    const endPrecise = calculatePreciseTime(bestMatch.segments[endSegIdx], 0, endCharInSeg);
    
    preciseStartMs = startPrecise.startMs;
    preciseEndMs = endPrecise.endMs;
  } else {
    preciseStartMs = bestMatch.segments[0].startMs;
    preciseEndMs = bestMatch.segments[bestMatch.segments.length - 1].endMs;
  }
  
  // Step 5: 添加 2 秒播放缓冲
  const finalStartMs = Math.max(0, preciseStartMs - BUFFER_MS);
  const finalEndMs = preciseEndMs;
  
  return [{
    start: finalStartMs,
    end: finalEndMs,
    text: bestMatch.combinedText,
    startSegmentIdx: bestMatch.startIdx,
    endSegmentIdx: bestMatch.endIdx,
    confidence: bestMatch.similarity
  }];
}

/* ------------------------------------------------------------------ */
/*  inferImportance — 根据片段位置推断重要程度                            */
/* ------------------------------------------------------------------ */

export function inferImportance(
  segments: HighlightSegment[],
  totalDuration: number
): ImportanceLevel {
  if (segments.length === 0) return 'medium';
  
  const segmentDuration = segments[0].end - segments[0].start;
  const position = segments[0].start / totalDuration;
  
  if (segmentDuration > 60000) return 'high';
  if (position < 0.1 || position > 0.85) return 'high';
  
  return 'medium';
}

/* ------------------------------------------------------------------ */
/*  dedupeCandidates — 去重候选项                                       */
/* ------------------------------------------------------------------ */

export function dedupeCandidates(candidates: TopicCandidate[]): TopicCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(c => {
    const key = c.quote.timestamp + c.title.slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
