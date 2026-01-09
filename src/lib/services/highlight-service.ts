/**
 * AI 精选片段服务 (Highlight Reels)
 * 
 * 从课堂录音转录文本中自动提取关键片段
 * 支持 Smart（质量优先）和 Fast（速度优先）两种生成模式
 */

import { chat, type ChatMessage } from './llm-service';
import type { TranscriptSegment } from '@/lib/db';
import type { 
  HighlightTopic, 
  HighlightSegment, 
  TopicGenerationMode, 
  TopicCandidate,
  ImportanceLevel 
} from '@/types';

// ============ 配置常量 ============

const DEFAULT_MODEL = 'qwen3-max';
const FAST_MODEL = 'qwen-turbo';
const DEFAULT_CHUNK_DURATION_MS = 5 * 60 * 1000; // 5分钟
const DEFAULT_CHUNK_OVERLAP_MS = 45 * 1000; // 45秒重叠
const CHUNK_MAX_CANDIDATES = 2;
const DEFAULT_MAX_TOPICS = 8;
const DEFAULT_MIN_TOPICS = 5;

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

interface TranscriptChunk {
  segments: TranscriptSegment[];
  startMs: number;
  endMs: number;
  chunkIndex: number;
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
 * 格式化时间戳 (毫秒 -> MM:SS)
 */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * 将转录片段格式化为带时间戳的文本
 */
function formatTranscriptWithTimestamps(segments: TranscriptSegment[]): string {
  return segments
    .map(seg => `[${formatTimestamp(seg.startMs)}] ${seg.text}`)
    .join('\n');
}

/**
 * 构建课堂信息块
 */
function buildSessionInfoBlock(sessionInfo?: GenerateTopicsOptions['sessionInfo']): string {
  if (!sessionInfo) return '';
  
  const parts: string[] = [];
  if (sessionInfo.subject) parts.push(`学科: ${sessionInfo.subject}`);
  if (sessionInfo.topic) parts.push(`主题: ${sessionInfo.topic}`);
  if (sessionInfo.teacher) parts.push(`教师: ${sessionInfo.teacher}`);
  
  return parts.length > 0 ? parts.join('\n') : '';
}

/**
 * 构建 Smart 模式 Prompt（单次全文处理）
 */
function buildSmartPrompt(
  segments: TranscriptSegment[],
  options: GenerateTopicsOptions
): string {
  const transcriptText = formatTranscriptWithTimestamps(segments);
  const sessionInfoBlock = buildSessionInfoBlock(options.sessionInfo);
  const maxTopics = options.maxTopics ?? DEFAULT_MAX_TOPICS;
  const minTopics = options.minTopics ?? DEFAULT_MIN_TOPICS;
  
  const themeGuidance = options.theme 
    ? `<themeFilter>只选择与"${options.theme}"相关的内容</themeFilter>` 
    : '';

  return `<task>
<role>你是一位专业的教育内容策划师，正在为学生整理课堂精华片段。</role>
<context>
${sessionInfoBlock}
这是一段课堂录音的转录文本。
</context>
<goal>从转录文本中提取 ${minTopics}-${maxTopics} 个最有价值的知识点片段，帮助学生快速回顾课堂重点。</goal>
<instructions>
  <step name="识别主题">
    <description>分析整个转录文本，找出最有价值的知识点。</description>
    <criteria>
      <item>重要概念：核心定义、关键原理</item>
      <item>难点解析：容易混淆或理解困难的内容</item>
      <item>实例说明：生动的例子或类比</item>
      <item>方法技巧：解题方法、记忆技巧</item>
      <item>总结归纳：老师的重点强调或总结</item>
    </criteria>
  </step>
  <step name="选择片段">
    <description>为每个主题选择最能说明问题的片段。</description>
    <criteria>
      <item>片段应该是连续的，时长约 30-90 秒</item>
      <item>必须是原文逐字引用，不能改写或省略</item>
      <item>片段应该能独立理解，有完整的上下文</item>
      <item>优先选择老师讲解清晰、重点突出的部分</item>
    </criteria>
  </step>
</instructions>
<qualityControl>
  <item>每个片段标题简洁有力，不超过15个字</item>
  <item>片段之间不应有内容重叠</item>
  <item>片段应分布在课堂的不同时间段</item>
  <item>如果内容不足，宁可少选也不要凑数</item>
</qualityControl>
${themeGuidance}
<outputFormat>
返回严格的 JSON 数组，格式如下：
[
  {
    "title": "片段标题",
    "quote": {
      "timestamp": "[MM:SS-MM:SS]",
      "text": "原文引用内容"
    }
  }
]
不要包含任何 markdown 标记或其他说明文字。
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
  sessionInfo?: GenerateTopicsOptions['sessionInfo'],
  theme?: string
): string {
  const transcriptText = formatTranscriptWithTimestamps(chunk.segments);
  const sessionInfoBlock = buildSessionInfoBlock(sessionInfo);
  const chunkWindow = `${formatTimestamp(chunk.startMs)} - ${formatTimestamp(chunk.endMs)}`;
  
  const themeInstruction = theme 
    ? `<item>只关注与"${theme}"相关的内容</item>` 
    : '';

  return `<task>
<role>你是一位教育内容策划师，正在审阅课堂转录的一部分。</role>
<context>
${sessionInfoBlock}
片段时间范围: ${chunkWindow}
</context>
<goal>从这段转录中找出最多 ${maxCandidates} 个值得标记的知识点。</goal>
<instructions>
  <item>只使用本片段中的内容。如果没有突出内容，返回空数组。</item>
  <item>每个知识点需要一个简洁的标题（不超过15字）和一段连续的原文引用（约30-60秒）。</item>
  <item>引用必须与转录完全匹配，不能改写。</item>
  <item>使用 [MM:SS-MM:SS] 格式的绝对时间戳。</item>
  <item>优先选择：核心概念、难点解析、生动例子、方法技巧。</item>
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
  maxTopics: number,
  sessionInfo?: GenerateTopicsOptions['sessionInfo']
): string {
  const sessionInfoBlock = buildSessionInfoBlock(sessionInfo);
  
  const candidateBlock = candidates
    .map((c, i) => `${i + 1}. 标题: ${c.title}\n   时间: ${c.quote.timestamp}\n   引用: ${c.quote.text.slice(0, 100)}...`)
    .join('\n\n');

  return `<task>
<role>你是一位资深教育编辑，正在为学生整理最终的课堂精华列表。</role>
<context>
${sessionInfoBlock}
你有 ${candidates.length} 个候选知识点。
</context>
<goal>从中选择最优质、最有代表性的 ${maxTopics} 个片段。</goal>
<instructions>
  <item>选择最强、最独特的知识点。</item>
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
 * 将转录分块
 */
function chunkTranscript(
  segments: TranscriptSegment[],
  chunkDurationMs: number = DEFAULT_CHUNK_DURATION_MS,
  overlapMs: number = DEFAULT_CHUNK_OVERLAP_MS
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
 * 解析 AI 响应中的 JSON
 */
function parseJsonResponse<T>(content: string): T | null {
  try {
    // 尝试直接解析
    return JSON.parse(content);
  } catch {
    // 尝试提取 JSON 部分
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 解析时间戳范围 [MM:SS-MM:SS] 或 [MM:SS] -> { startMs, endMs }
 */
function parseTimestampRange(timestamp: string): { startMs: number; endMs: number } | null {
  // 尝试匹配范围格式 [MM:SS-MM:SS]
  const rangeMatch = timestamp.match(/\[?(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\]?/);
  if (rangeMatch) {
    const startMs = (parseInt(rangeMatch[1]) * 60 + parseInt(rangeMatch[2])) * 1000;
    const endMs = (parseInt(rangeMatch[3]) * 60 + parseInt(rangeMatch[4])) * 1000;
    return { startMs, endMs };
  }
  
  // 尝试匹配单个时间戳 [MM:SS]，默认片段长度 60 秒
  const singleMatch = timestamp.match(/\[?(\d{1,2}):(\d{2})\]?/);
  if (singleMatch) {
    const startMs = (parseInt(singleMatch[1]) * 60 + parseInt(singleMatch[2])) * 1000;
    return { startMs, endMs: startMs + 60000 };
  }
  
  return null;
}

/**
 * 在转录中定位引用文本
 */
function findQuoteInTranscript(
  segments: TranscriptSegment[],
  quote: { timestamp: string; text: string }
): HighlightSegment[] {
  console.log('[findQuoteInTranscript] 查找:', quote.timestamp, quote.text.slice(0, 30) + '...');
  
  const timeRange = parseTimestampRange(quote.timestamp);
  if (!timeRange) {
    console.log('[findQuoteInTranscript] 无法解析时间戳:', quote.timestamp);
    return [];
  }
  
  console.log('[findQuoteInTranscript] 时间范围:', timeRange.startMs, '-', timeRange.endMs);
  
  // 找到时间范围内的片段（放宽容差到 10 秒）
  let matchingSegments = segments.filter(
    seg => seg.startMs >= timeRange.startMs - 10000 && seg.startMs <= timeRange.endMs + 10000
  );
  
  // 如果没找到，尝试更宽松的匹配
  if (matchingSegments.length === 0) {
    console.log('[findQuoteInTranscript] 精确匹配失败，尝试宽松匹配');
    matchingSegments = segments.filter(
      seg => seg.startMs >= timeRange.startMs - 30000 && seg.startMs <= timeRange.endMs + 30000
    );
  }
  
  // 如果还是没找到，尝试文本匹配
  if (matchingSegments.length === 0 && quote.text) {
    console.log('[findQuoteInTranscript] 时间匹配失败，尝试文本匹配');
    const quoteWords = quote.text.slice(0, 20).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
    matchingSegments = segments.filter(seg => {
      const segWords = seg.text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
      return segWords.includes(quoteWords) || quoteWords.includes(segWords.slice(0, 10));
    });
  }
  
  if (matchingSegments.length === 0) {
    console.log('[findQuoteInTranscript] 未找到匹配片段');
    return [];
  }
  
  console.log('[findQuoteInTranscript] 找到', matchingSegments.length, '个匹配片段');
  
  return [{
    start: matchingSegments[0].startMs,
    end: matchingSegments[matchingSegments.length - 1].endMs,
    text: matchingSegments.map(s => s.text).join(' '),
    startSegmentIdx: segments.indexOf(matchingSegments[0]),
    endSegmentIdx: segments.indexOf(matchingSegments[matchingSegments.length - 1]),
    confidence: 0.9
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
  
  const mode = options.mode ?? 'smart';
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
    
    console.log('[highlightService] 调用 LLM...');
    const response = await chat(messages, model, { temperature: 0.3, maxTokens: 4000 });
    console.log('[highlightService] LLM 响应长度:', response.content.length);
    
    rawTopics = parseJsonResponse<RawTopic[]>(response.content) ?? [];
    console.log('[highlightService] 解析得到', rawTopics.length, '个原始主题');
  } 
  // Fast 模式：分块处理 + Map-Reduce
  else {
    console.log('[highlightService] 使用 Fast 模式（分块处理）');
    const chunks = chunkTranscript(segments);
    console.log('[highlightService] 分成', chunks.length, '个块');
    
    // 并行处理每个块
    const chunkResults = await Promise.all(
      chunks.map(async (chunk) => {
        const prompt = buildChunkPrompt(chunk, CHUNK_MAX_CANDIDATES, options.sessionInfo, options.theme);
        const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
        
        try {
          const response = await chat(messages, FAST_MODEL, { temperature: 0.3, maxTokens: 1000 });
          const parsed = parseJsonResponse<RawTopic[]>(response.content);
          return (parsed ?? []).map(t => ({
            key: `${chunk.chunkIndex}-${t.title.slice(0, 10)}`,
            title: t.title,
            quote: t.quote!
          }));
        } catch (e) {
          console.error('[highlightService] 块处理失败:', e);
          return [];
        }
      })
    );
    
    // 去重并合并候选项
    candidates = dedupeCandidates(chunkResults.flat().filter(c => c.quote));
    console.log('[highlightService] 去重后候选项:', candidates.length);
    
    if (candidates.length > maxTopics) {
      // 使用 Reduce 筛选
      const reducePrompt = buildReducePrompt(candidates, maxTopics, options.sessionInfo);
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
  
  // 转换为 HighlightTopic 格式
  const now = new Date().toISOString();
  const topics: HighlightTopic[] = rawTopics
    .filter(t => t.quote)
    .map((t, index) => {
      const highlightSegments = findQuoteInTranscript(segments, t.quote!);
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
    .filter(t => t.segments.length > 0)
    .sort((a, b) => (a.segments[0]?.start ?? 0) - (b.segments[0]?.start ?? 0));
  
  console.log('[highlightService] 最终主题数:', topics.length);
  
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
