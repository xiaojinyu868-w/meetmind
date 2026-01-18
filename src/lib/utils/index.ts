/**
 * 工具函数统一导出
 */

// 时间工具
export {
  formatTimestamp,
  formatTimestampLong,
  parseTimestamp,
  parseTimestampRange,
  formatTimeRange,
  getContextAroundTimestamp,
  formatDurationMs,
  msToSeconds,
  secondsToMs,
} from './time-utils';

// JSON 工具
export {
  parseJsonResponse,
  safeStringify,
  deepClone,
  isValidJson,
  mergeJson,
} from './json-utils';

// 转录工具
export {
  formatTranscriptWithTimestamps,
  mergeTranscriptText,
  cleanText,
  calculateSimilarity,
  chunkTranscript,
  findBestMatchingSegment,
  getTranscriptInRange,
  getTranscriptDuration,
  countTranscriptWords,
  type TranscriptChunk,
} from './transcript-utils';
