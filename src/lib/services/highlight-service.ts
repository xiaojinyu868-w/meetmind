/**
 * AI 精选片段服务 (Highlight Reels)
 * 
 * 从课堂录音转录文本中自动提取关键片段
 * 支持 Smart（质量优先）和 Fast（速度优先）两种生成模式
 */

import { chat, type ChatMessage } from './llm-service';
import type { TranscriptSegment } from '@/types';
import type { 
  HighlightTopic, 
  HighlightSegment, 
  TopicGenerationMode, 
  TopicCandidate,
  ImportanceLevel 
} from '@/types';
import { FeatureConfig } from '@/lib/config';
import { 
  formatTimestamp,
  parseTimestampRange,
  formatTranscriptWithTimestamps,
  chunkTranscript,
  cleanText,
  calculateSimilarity,
  type TranscriptChunk,
} from '@/lib/utils';
import { parseJsonResponse } from '@/lib/utils';

// ============ 配置常量（从统一配置读取） ============
const DEFAULT_MODEL = FeatureConfig.highlights.defaultModel;
const FAST_MODEL = FeatureConfig.highlights.fastModel;
// 分块处理配置（预留供未来长音频分片使用）
const _DEFAULT_CHUNK_DURATION_MS = FeatureConfig.highlights.chunkMaxCandidates > 0 ? 5 * 60 * 1000 : 5 * 60 * 1000;
const _DEFAULT_CHUNK_OVERLAP_MS = 45 * 1000;
void _DEFAULT_CHUNK_DURATION_MS; // 预留配置
void _DEFAULT_CHUNK_OVERLAP_MS; // 预留配置
const CHUNK_MAX_CANDIDATES = FeatureConfig.highlights.chunkMaxCandidates;
const DEFAULT_MAX_TOPICS = FeatureConfig.highlights.maxTopics;
const DEFAULT_MIN_TOPICS = FeatureConfig.highlights.minTopics;

// ============ 类型定义 ============

export interface GenerateTopicsOptions {
  sessionInfo?: {
    subject?: string;
    topic?: string;
    teacher?: string;
  };
  mode?: TopicGenerationMode;
  maxTopics?: number;
  minTopics?: number;
  theme?: string;           // 按主题筛选
  excludeTopicKeys?: Set<string>;  // 排除已有主题
  model?: string;
}

export interface GenerateTopicsResult {
  topics: HighlightTopic[];
  candidates?: TopicCandidate[];
  modelUsed: string;
}

interface RawTopic {
  title: string;
  quote?: {
    timestamp: string;
    text: string;
  };
}

// ============ Prompt 构建 ============

/**
 * 构建 Smart 模式 Prompt（单次全文处理）
 */
function buildSmartPrompt(
  segments: TranscriptSegment[],
  options: GenerateTopicsOptions
): string {
  const transcriptText = formatTranscriptWithTimestamps(segments);
  const maxTopics = options.maxTopics ?? DEFAULT_MAX_TOPICS;
  const minTopics = options.minTopics ?? DEFAULT_MIN_TOPICS;
  
  const themeGuidance = options.theme 
    ? `<themeFilter>只选择与"${options.theme}"相关的内容</themeFilter>` 
    : '';

  return `<task>
<role>你是一位专业的内容策划师，负责从音视频转录中提取精华片段。</role>
<context>
这是一段录音的转录文本。
</context>
<goal>从转录文本中提取 ${minTopics}-${maxTopics} 个最有价值的片段。根据实际内容自行判断主题，找出值得回顾的重点。</goal>
<instructions>
  <step name="识别主题">
    <description>分析整个转录文本，找出最有价值的内容片段。</description>
    <criteria>
      <item>重要概念：核心定义、关键信息</item>
      <item>关键对话：重要的问答或讨论</item>
      <item>实例说明：生动的例子或具体案例</item>
      <item>方法技巧：实用的方法或建议</item>
      <item>总结要点：重点强调或总结性内容</item>
    </criteria>
  </step>
  <step name="选择片段">
    <description>为每个主题选择最能说明问题的片段。</description>
    <criteria>
      <item>片段应该是连续的，时长约 10-60 秒</item>
      <item>必须是原文逐字引用，不能改写或省略</item>
      <item>片段应该能独立理解，有完整的上下文</item>
    </criteria>
  </step>
</instructions>
<qualityControl>
  <item>每个片段标题简洁有力，不超过15个字</item>
  <item>片段之间不应有内容重叠</item>
  <item>片段应分布在录音的不同时间段</item>
  <item>必须返回至少1个片段，即使内容较短</item>
</qualityControl>
${themeGuidance}
<outputFormat>
返回严格的 JSON 数组，格式如下：
[
  {
    "title": "片段标题",
    "quote": {
      "timestamp": "[MM:SS-MM:SS]",
      "text": "原文引用内容（必须与转录完全一致）"
    }
  }
]
不要包含任何 markdown 标记或其他说明文字。如果转录有内容，必须返回至少1个片段。
</outputFormat>
<transcript><![CDATA[
${transcriptText}
]]></transcript>
</task>`;
}

/**
 * 构建 Chunk 级别 Prompt（Fast 模式分块处理）
 */
function buildChunkPrompt(
  chunk: TranscriptChunk,
  maxCandidates: number,
  theme?: string
): string {
  const transcriptText = formatTranscriptWithTimestamps(chunk.segments);
  const chunkWindow = `${formatTimestamp(chunk.startMs)} - ${formatTimestamp(chunk.endMs)}`;
  
  const themeInstruction = theme 
    ? `<item>只关注与"${theme}"相关的内容</item>` 
    : '';

  return `<task>
<role>你是一位内容策划师，正在审阅录音转录的一部分。</role>
<context>
片段时间范围: ${chunkWindow}
</context>
<goal>从这段转录中找出最多 ${maxCandidates} 个值得标记的重点内容。</goal>
<instructions>
  <item>只使用本片段中的内容。如果没有突出内容，返回空数组。</item>
  <item>每个重点需要一个简洁的标题（不超过15字）和一段连续的原文引用（约10-60秒）。</item>
  <item>引用必须与转录完全匹配，不能改写。</item>
  <item>使用 [MM:SS-MM:SS] 格式的绝对时间戳。</item>
  ${themeInstruction}
</instructions>
<outputFormat>返回严格的 JSON 数组：[{"title":"string","quote":{"timestamp":"[MM:SS-MM:SS]","text":"原文引用"}}]</outputFormat>
<transcriptChunk><![CDATA[
${transcriptText}
]]></transcriptChunk>
</task>`;
}

/**
 * 构建 Reduce Prompt（合并筛选候选项）
 */
function buildReducePrompt(
  candidates: TopicCandidate[],
  maxTopics: number
): string {
  const candidateBlock = candidates
    .map((c, i) => `${i + 1}. 标题: ${c.title}\n   时间: ${c.quote.timestamp}\n   引用: ${c.quote.text.slice(0, 100)}...`)
    .join('\n\n');

  return `<task>
<role>你是一位内容编辑，负责整理最终的精华片段列表。</role>
<context>
你有 ${candidates.length} 个候选片段。
</context>
<goal>从中选择最优质、最有代表性的 ${maxTopics} 个片段。</goal>
<instructions>
  <item>选择最有价值、最独特的片段。</item>
  <item>如果两个候选内容重叠，保留更好的那个。</item>
  <item>可以优化标题使其更清晰，但必须保持原有的引用文本和时间戳。</item>
  <item>返回格式：[{"candidateIndex": 数字, "title": "优化后的标题"}]，索引从1开始。</item>
</instructions>
<candidates><![CDATA[
${candidateBlock}
]]></candidates>
</task>`;
}

// ============ 核心处理逻辑 ============

/**
 * 在文本中查找子串的位置（模糊匹配）
 * 返回 { startIdx, endIdx, matchedText } 或 null
 */
function findSubstringPosition(
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

/**
 * 检查两个时间范围是否有交集
 */
function hasTimeOverlap(
  seg: { startMs: number; endMs: number },
  range: { startMs: number; endMs: number },
  tolerance: number
): boolean {
  return seg.endMs >= range.startMs - tolerance && seg.startMs <= range.endMs + tolerance;
}

/**
 * 基于语速计算精确的字符级时间位置
 * @param segment 转录片段
 * @param charStartIdx 字符起始索引（在清洗后的文本中）
 * @param charEndIdx 字符结束索引
 * @returns 精确的毫秒时间范围
 */
function calculatePreciseTime(
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

/**
 * 在转录中定位引用文本（精确版）
 * 
 * 算法流程：
 * 1. 时间戳作为锚点，筛选候选片段（±30秒容差）
 * 2. 对候选片段（单个及连续组合）计算文本相似度
 * 3. 选择最佳匹配，用文本位置矫正时间戳
 * 4. 基于语速推算精确的字符级时间
 * 5. 添加 2 秒播放缓冲
 */
function findQuoteInTranscript(
  segments: TranscriptSegment[],
  quote: { timestamp: string; text: string }
): HighlightSegment[] {
  console.log('[findQuoteInTranscript] 查找:', quote.timestamp, quote.text?.slice(0, 30) + '...');
  
  if (!quote.text || quote.text.length < 3) {
    console.log('[findQuoteInTranscript] 引用文本过短，跳过');
    return [];
  }
  
  const timeRange = parseTimestampRange(quote.timestamp);
  const TOLERANCE_MS = 30000; // 30秒容差
  const BUFFER_MS = 2000; // 2秒播放缓冲
  
  // Step 1: 筛选候选片段
  let candidates: TranscriptSegment[];
  if (timeRange) {
    console.log('[findQuoteInTranscript] 时间范围:', timeRange.startMs, '-', timeRange.endMs);
    // 使用时间范围交集筛选
    candidates = segments.filter(seg => hasTimeOverlap(seg, timeRange, TOLERANCE_MS));
    
    // 如果时间范围内没有候选，扩大搜索范围
    if (candidates.length === 0) {
      console.log('[findQuoteInTranscript] 时间范围内无候选，扩大搜索');
      candidates = segments;
    }
  } else {
    console.log('[findQuoteInTranscript] 时间戳解析失败，搜索全部片段');
    candidates = segments;
  }
  
  console.log('[findQuoteInTranscript] 候选片段数:', candidates.length);
  
  // Step 2: 计算所有可能匹配的相似度（单片段 + 连续组合）
  interface MatchResult {
    segments: TranscriptSegment[];
    startIdx: number;
    endIdx: number;
    similarity: number;
    combinedText: string;
  }
  
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
    
    // 确保是连续的（在原始 segments 中相邻）
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
    console.log('[findQuoteInTranscript] 无有效匹配，最高相似度:', matches[0]?.similarity?.toFixed(2) || 0);
    return [];
  }
  
  const bestMatch = matches[0];
  console.log('[findQuoteInTranscript] 最佳匹配:', {
    segmentCount: bestMatch.segments.length,
    similarity: bestMatch.similarity.toFixed(2),
    text: bestMatch.combinedText.slice(0, 50) + '...'
  });
  
  // Step 4: 基于语速精确定位
  let preciseStartMs: number;
  let preciseEndMs: number;
  
  // 在组合文本中查找引用文本的位置
  const position = findSubstringPosition(bestMatch.combinedText, quote.text);
  
  if (position && bestMatch.segments.length === 1) {
    // 单片段：直接计算精确时间
    const seg = bestMatch.segments[0];
    const precise = calculatePreciseTime(seg, position.startIdx, position.endIdx);
    preciseStartMs = precise.startMs;
    preciseEndMs = precise.endMs;
    console.log('[findQuoteInTranscript] 单片段精确定位:', preciseStartMs, '-', preciseEndMs);
  } else if (position && bestMatch.segments.length > 1) {
    // 多片段：计算跨片段的精确时间
    let charOffset = 0;
    
    // 找到 startIdx 落在哪个片段
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
    
    // 找到 endIdx 落在哪个片段
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
    console.log('[findQuoteInTranscript] 多片段精确定位:', preciseStartMs, '-', preciseEndMs);
  } else {
    // 无法精确定位，使用片段边界
    preciseStartMs = bestMatch.segments[0].startMs;
    preciseEndMs = bestMatch.segments[bestMatch.segments.length - 1].endMs;
    console.log('[findQuoteInTranscript] 使用片段边界:', preciseStartMs, '-', preciseEndMs);
  }
  
  // Step 5: 添加 2 秒播放缓冲
  const finalStartMs = Math.max(0, preciseStartMs - BUFFER_MS);
  const finalEndMs = preciseEndMs;
  
  console.log('[findQuoteInTranscript] 最终时间（含缓冲）:', finalStartMs, '-', finalEndMs);
  
  return [{
    start: finalStartMs,
    end: finalEndMs,
    text: bestMatch.combinedText,
    startSegmentIdx: bestMatch.startIdx,
    endSegmentIdx: bestMatch.endIdx,
    confidence: bestMatch.similarity
  }];
}

/**
 * 根据片段位置推断重要程度
 */
function inferImportance(
  segments: HighlightSegment[],
  totalDuration: number
): ImportanceLevel {
  if (segments.length === 0) return 'medium';
  
  const segmentDuration = segments[0].end - segments[0].start;
  const position = segments[0].start / totalDuration;
  
  // 较长的片段通常更重要
  if (segmentDuration > 60000) return 'high';
  
  // 课堂开头和结尾的总结通常重要
  if (position < 0.1 || position > 0.85) return 'high';
  
  return 'medium';
}

/**
 * 去重候选项
 */
function dedupeCandidates(candidates: TopicCandidate[]): TopicCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(c => {
    const key = c.quote.timestamp + c.title.slice(0, 10);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============ 主要导出函数 ============

/**
 * 从转录文本生成精选片段
 */
export async function generateHighlightTopics(
  sessionId: string,
  segments: TranscriptSegment[],
  options: GenerateTopicsOptions = {}
): Promise<GenerateTopicsResult> {
  console.log('[highlightService] 开始生成精选片段');
  console.log('[highlightService] 参数:', {
    sessionId,
    segmentsCount: segments.length,
    mode: options.mode,
    theme: options.theme
  });
  
  if (segments.length === 0) {
    console.log('[highlightService] 无片段，返回空结果');
    return { topics: [], modelUsed: '' };
  }
  
  const mode = options.mode ?? 'fast';
  const model = options.model ?? (mode === 'smart' ? DEFAULT_MODEL : FAST_MODEL);
  const maxTopics = options.maxTopics ?? DEFAULT_MAX_TOPICS;
  
  const totalDuration = segments[segments.length - 1].endMs;
  const isShortSession = totalDuration <= 30 * 60 * 1000; // 30分钟以内
  
  console.log('[highlightService] 使用模式:', mode, '模型:', model, '总时长:', totalDuration);
  
  let rawTopics: RawTopic[] = [];
  let candidates: TopicCandidate[] | undefined;
  
  // Smart 模式或短课程：单次全文处理
  if (mode === 'smart' || isShortSession) {
    console.log('[highlightService] 使用 Smart 模式（单次全文处理）');
    const prompt = buildSmartPrompt(segments, options);
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    
    console.log('[highlightService] ========== LLM 请求开始 ==========');
    console.log('[highlightService] Prompt 长度:', prompt.length);
    console.log('[highlightService] Prompt 前 500 字符:\n', prompt.slice(0, 500));
    console.log('[highlightService] Prompt 后 500 字符:\n', prompt.slice(-500));
    
    try {
      const response = await chat(messages, model, { temperature: 0.3, maxTokens: 4000 });
      console.log('[highlightService] ========== LLM 响应 ==========');
      console.log('[highlightService] 响应长度:', response.content.length);
      console.log('[highlightService] 完整响应内容:\n', response.content);
      console.log('[highlightService] ========== 响应结束 ==========');
      
      rawTopics = parseJsonResponse<RawTopic[]>(response.content) ?? [];
      console.log('[highlightService] JSON 解析结果:', JSON.stringify(rawTopics, null, 2));
      console.log('[highlightService] 解析得到', rawTopics.length, '个原始主题');
    } catch (llmError) {
      console.error('[highlightService] LLM 调用失败:', llmError);
      throw llmError;
    }
  } 
  // Fast 模式：分块处理 + Map-Reduce
  else {
    console.log('[highlightService] 使用 Fast 模式（分块处理）');
    const chunks = chunkTranscript(segments);
    console.log('[highlightService] 分成', chunks.length, '个块');
    
    // 并行处理每个块
    const chunkResults = await Promise.all(
      chunks.map(async (chunk, chunkIdx) => {
        const prompt = buildChunkPrompt(chunk, CHUNK_MAX_CANDIDATES, options.theme);
        const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
        
        console.log(`[highlightService] ========== 块 ${chunkIdx} LLM 请求 ==========`);
        console.log(`[highlightService] 块 ${chunkIdx} Prompt 长度:`, prompt.length);
        
        try {
          const response = await chat(messages, FAST_MODEL, { temperature: 0.3, maxTokens: 1000 });
          console.log(`[highlightService] ========== 块 ${chunkIdx} LLM 响应 ==========`);
          console.log(`[highlightService] 块 ${chunkIdx} 响应长度:`, response.content.length);
          console.log(`[highlightService] 块 ${chunkIdx} 响应内容:\n`, response.content);
          
          const parsed = parseJsonResponse<RawTopic[]>(response.content);
          console.log(`[highlightService] 块 ${chunkIdx} 解析结果:`, JSON.stringify(parsed, null, 2));
          
          return (parsed ?? []).map(t => ({
            key: `${chunk.chunkIndex}-${t.title.slice(0, 10)}`,
            title: t.title,
            quote: t.quote!
          }));
        } catch (e) {
          console.error(`[highlightService] 块 ${chunkIdx} 处理失败:`, e);
          return [];
        }
      })
    );
    
    // 去重并合并候选项
    candidates = dedupeCandidates(chunkResults.flat().filter(c => c.quote));
    console.log('[highlightService] 去重后候选项:', candidates.length);
    console.log('[highlightService] 候选项详情:', JSON.stringify(candidates, null, 2));
    
    if (candidates.length > maxTopics) {
      // 使用 Reduce 筛选
      const reducePrompt = buildReducePrompt(candidates, maxTopics);
      const reduceMessages: ChatMessage[] = [{ role: 'user', content: reducePrompt }];
      
      const reduceResponse = await chat(reduceMessages, model, { temperature: 0.2, maxTokens: 1000 });
      const selections = parseJsonResponse<Array<{ candidateIndex: number; title: string }>>(reduceResponse.content);
      
      if (selections) {
        rawTopics = selections
          .filter(s => s.candidateIndex > 0 && s.candidateIndex <= candidates!.length)
          .map(s => ({
            title: s.title,
            quote: candidates![s.candidateIndex - 1].quote
          }));
      } else {
        // 降级：直接取前 N 个
        rawTopics = candidates.slice(0, maxTopics).map(c => ({
          title: c.title,
          quote: c.quote
        }));
      }
    } else {
      rawTopics = candidates.map(c => ({
        title: c.title,
        quote: c.quote
      }));
    }
  }
  
  console.log('[highlightService] 原始主题数:', rawTopics.length);
  console.log('[highlightService] 原始主题详情:', JSON.stringify(rawTopics, null, 2));
  
  // 转换为 HighlightTopic 格式
  const now = new Date().toISOString();
  
  console.log('[highlightService] ========== 开始转换主题 ==========');
  
  const topics: HighlightTopic[] = rawTopics
    .filter(t => {
      const hasQuote = !!t.quote;
      console.log(`[highlightService] 主题 "${t.title}" 有 quote: ${hasQuote}`);
      return hasQuote;
    })
    .map((t, index) => {
      console.log(`[highlightService] 处理主题 ${index}: "${t.title}"`);
      console.log(`[highlightService] quote:`, JSON.stringify(t.quote));
      
      const highlightSegments = findQuoteInTranscript(segments, t.quote!);
      console.log(`[highlightService] 找到 ${highlightSegments.length} 个匹配片段`);
      
      const duration = highlightSegments.length > 0 
        ? highlightSegments[0].end - highlightSegments[0].start 
        : 0;
      
      return {
        id: crypto.randomUUID(),
        sessionId,
        title: t.title,
        importance: inferImportance(highlightSegments, totalDuration),
        duration,
        segments: highlightSegments,
        quote: t.quote,
        createdAt: now,
        updatedAt: now
      };
    })
    .filter(t => {
      const hasSegments = t.segments.length > 0;
      console.log(`[highlightService] 主题 "${t.title}" 有 segments: ${hasSegments}`);
      return hasSegments;
    })
    .sort((a, b) => (a.segments[0]?.start ?? 0) - (b.segments[0]?.start ?? 0));
  
  console.log('[highlightService] ========== 转换完成 ==========');
  console.log('[highlightService] 最终主题数:', topics.length);
  console.log('[highlightService] 最终主题:', JSON.stringify(topics.map(t => ({ title: t.title, segmentsCount: t.segments.length })), null, 2));
  
  return {
    topics,
    candidates,
    modelUsed: model
  };
}

/**
 * 按主题重新生成片段
 */
export async function regenerateByTheme(
  sessionId: string,
  segments: TranscriptSegment[],
  theme: string,
  options: Omit<GenerateTopicsOptions, 'theme'> = {}
): Promise<GenerateTopicsResult> {
  return generateHighlightTopics(sessionId, segments, {
    ...options,
    theme,
    mode: 'smart' // 主题筛选使用 Smart 模式
  });
}

export const highlightService = {
  generateTopics: generateHighlightTopics,
  regenerateByTheme
};
