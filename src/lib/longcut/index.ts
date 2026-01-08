// LongCut 核心算法统一导出
// 复用自 https://github.com/longcut

// 类型定义
export * from './types';

// 引用匹配算法 (Boyer-Moore + N-gram)
export {
  buildTranscriptIndex,
  findTextInTranscript,
  normalizeWhitespace,
  normalizeForMatching,
  calculateNgramSimilarity,
  boyerMooreSearch,
  mapMatchToSegments,
  mapNormalizedMatchToSegments,
  type TranscriptIndex,
} from './quote-matcher';

// 句子合并算法
export {
  mergeTranscriptSegmentsIntoSentences,
  type MergedSentence,
} from './transcript-sentence-merger';

// 时间戳工具
export {
  parseTimestamp,
  formatTimestamp,
  formatTimestampMs,
  extractTimestamps,
  isTimestamp,
  parseTimestampRange,
  TIMESTAMP_REGEX,
  TIMESTAMP_RANGE_REGEX,
} from './timestamp-utils';

// 主题提取与水合
export {
  hydrateTopicsWithTranscript,
  normalizeTranscript,
} from './topic-utils';
