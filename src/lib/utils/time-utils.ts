/**
 * 时间工具函数
 * 
 * 统一管理所有时间格式化、解析和范围计算逻辑
 */

/**
 * 基础时间片段接口（用于工具函数，避免循环依赖）
 */
interface TimeSegment {
  startMs: number;
  endMs: number;
}

/**
 * 格式化时间戳（毫秒 -> MM:SS）
 */
export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 格式化时间戳（毫秒 -> HH:MM:SS，用于长时间）
 */
export function formatTimestampLong(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 解析时间戳（MM:SS -> 毫秒）
 */
export function parseTimestamp(timestamp: string): number {
  const match = timestamp.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  return (minutes * 60 + seconds) * 1000;
}

/**
 * 解析时间戳范围 [MM:SS-MM:SS] 或 [MM:SS]
 * 单个时间戳默认片段长度为 defaultDurationMs
 */
export function parseTimestampRange(
  timestamp: string,
  defaultDurationMs: number = 60000
): { startMs: number; endMs: number } | null {
  // 尝试匹配范围格式 [MM:SS-MM:SS]
  const rangeMatch = timestamp.match(/\[?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\]?/);
  if (rangeMatch) {
    const startMs = (parseInt(rangeMatch[1]) * 60 + parseInt(rangeMatch[2])) * 1000;
    const endMs = (parseInt(rangeMatch[3]) * 60 + parseInt(rangeMatch[4])) * 1000;
    return { startMs, endMs };
  }
  
  // 尝试匹配单个时间戳 [MM:SS]
  const singleMatch = timestamp.match(/\[?(\d{1,2}):(\d{2})\]?/);
  if (singleMatch) {
    const startMs = (parseInt(singleMatch[1]) * 60 + parseInt(singleMatch[2])) * 1000;
    return { startMs, endMs: startMs + defaultDurationMs };
  }
  
  return null;
}

/**
 * 格式化时间范围（毫秒 -> [MM:SS-MM:SS]）
 */
export function formatTimeRange(startMs: number, endMs: number): string {
  return `[${formatTimestamp(startMs)}-${formatTimestamp(endMs)}]`;
}

/**
 * 获取时间戳周围的转录片段
 */
export function getContextAroundTimestamp<T extends TimeSegment>(
  segments: T[],
  timestamp: number,
  beforeMs: number = 60000,
  afterMs: number = 30000
): T[] {
  const startTime = Math.max(0, timestamp - beforeMs);
  const endTime = timestamp + afterMs;

  return segments.filter(
    seg => seg.startMs >= startTime && seg.endMs <= endTime
  );
}

/**
 * 计算时长（毫秒 -> 友好格式）
 */
export function formatDurationMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes === 0) {
    return `${seconds}秒`;
  }
  if (seconds === 0) {
    return `${minutes}分钟`;
  }
  return `${minutes}分${seconds}秒`;
}

/**
 * 将毫秒转换为秒
 */
export function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * 将秒转换为毫秒
 */
export function secondsToMs(seconds: number): number {
  return seconds * 1000;
}
