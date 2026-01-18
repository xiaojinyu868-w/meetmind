/**
 * 转录文本工具函数
 * 
 * 统一管理转录片段格式化、处理逻辑
 */

import { formatTimestamp } from './time-utils';

/**
 * 基础转录片段接口（兼容 DB 层和应用层）
 * DB 层的 id 是 number | undefined，应用层是 string
 * 工具函数只需要 text 和时间相关字段
 */
export interface BaseTranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
  speakerId?: string;
  isFinal?: boolean;
}

/**
 * 将转录片段格式化为带时间戳的文本
 * 格式: [MM:SS] 文本内容
 */
export function formatTranscriptWithTimestamps(segments: BaseTranscriptSegment[]): string {
  return segments
    .map(seg => `[${formatTimestamp(seg.startMs)}] ${seg.text}`)
    .join('\n');
}

/**
 * 将转录片段合并为纯文本
 */
export function mergeTranscriptText(segments: BaseTranscriptSegment[]): string {
  return segments.map(seg => seg.text).join(' ');
}

/**
 * 清洗文本，只保留中文、英文、数字
 */
export function cleanText(text: string): string {
  return text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase();
}

/**
 * 计算两个字符串的相似度（基于最长公共子串）
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const s1 = cleanText(str1);
  const s2 = cleanText(str2);
  
  if (s1.length === 0 || s2.length === 0) return 0;
  
  // 使用动态规划计算最长公共子串
  const shorter = s1.length < s2.length ? s1 : s2;
  const longer = s1.length < s2.length ? s2 : s1;
  
  let maxLen = 0;
  const dp = new Array(shorter.length + 1).fill(0);
  
  for (let i = 1; i <= longer.length; i++) {
    for (let j = shorter.length; j >= 1; j--) {
      if (longer[i - 1] === shorter[j - 1]) {
        dp[j] = dp[j - 1] + 1;
        maxLen = Math.max(maxLen, dp[j]);
      } else {
        dp[j] = 0;
      }
    }
  }
  
  return maxLen / shorter.length;
}

/**
 * 将转录分块
 */
export interface TranscriptChunk {
  segments: BaseTranscriptSegment[];
  startMs: number;
  endMs: number;
  chunkIndex: number;
}

export function chunkTranscript(
  segments: BaseTranscriptSegment[],
  chunkDurationMs: number = 5 * 60 * 1000,
  overlapMs: number = 45 * 1000
): TranscriptChunk[] {
  if (segments.length === 0) return [];
  
  const chunks: TranscriptChunk[] = [];
  const totalDuration = segments[segments.length - 1].endMs;
  
  let chunkStart = 0;
  let chunkIndex = 0;
  
  while (chunkStart < totalDuration) {
    const chunkEnd = Math.min(chunkStart + chunkDurationMs, totalDuration);
    
    const chunkSegments = segments.filter(
      seg => seg.startMs >= chunkStart && seg.startMs < chunkEnd
    );
    
    if (chunkSegments.length > 0) {
      chunks.push({
        segments: chunkSegments,
        startMs: chunkStart,
        endMs: chunkEnd,
        chunkIndex
      });
    }
    
    chunkStart = chunkEnd - overlapMs;
    chunkIndex++;
  }
  
  return chunks;
}

/**
 * 在转录中查找最匹配的片段
 */
export function findBestMatchingSegment<T extends BaseTranscriptSegment>(
  segments: T[],
  text: string,
  threshold: number = 0.5
): T | null {
  let bestMatch: T | null = null;
  let bestSimilarity = threshold;
  
  for (const segment of segments) {
    const similarity = calculateSimilarity(segment.text, text);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = segment;
    }
  }
  
  return bestMatch;
}

/**
 * 获取指定时间范围内的转录文本
 */
export function getTranscriptInRange<T extends BaseTranscriptSegment>(
  segments: T[],
  startMs: number,
  endMs: number
): T[] {
  return segments.filter(
    seg => seg.startMs >= startMs && seg.endMs <= endMs
  );
}

/**
 * 计算转录总时长
 */
export function getTranscriptDuration(segments: BaseTranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  return segments[segments.length - 1].endMs - segments[0].startMs;
}

/**
 * 统计转录字数
 */
export function countTranscriptWords(segments: BaseTranscriptSegment[]): number {
  return segments.reduce((count, seg) => {
    // 中文按字符计数，英文按空格分词计数
    const chinese = seg.text.match(/[\u4e00-\u9fa5]/g) || [];
    const english = seg.text.match(/[a-zA-Z]+/g) || [];
    return count + chinese.length + english.length;
  }, 0);
}
