/**
 * Highlight Service — Prompt 构建
 *
 * 从 highlight-service.ts 提取，包含 Smart / Chunk / Reduce 三种 Prompt 模板。
 */

import type { TranscriptSegment } from '@/lib/db';
import type { TopicCandidate } from '@/types';
import {
  formatTimestamp,
  formatTranscriptWithTimestamps,
  type TranscriptChunk,
} from '@/lib/utils';
import type { GenerateTopicsOptions } from './highlight-service';

/* ------------------------------------------------------------------ */
/*  Re-export config constants used by main service                    */
/* ------------------------------------------------------------------ */

import { FeatureConfig } from '@/lib/config';

export const DEFAULT_MODEL = FeatureConfig.highlights.defaultModel;
export const FAST_MODEL = FeatureConfig.highlights.fastModel;
export const CHUNK_MAX_CANDIDATES = FeatureConfig.highlights.chunkMaxCandidates;
export const DEFAULT_MAX_TOPICS = FeatureConfig.highlights.maxTopics;
export const DEFAULT_MIN_TOPICS = FeatureConfig.highlights.minTopics;

/* ------------------------------------------------------------------ */
/*  Smart Prompt — 单次全文处理                                         */
/* ------------------------------------------------------------------ */

export function buildSmartPrompt(
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

/* ------------------------------------------------------------------ */
/*  Chunk Prompt — Fast 模式分块处理                                    */
/* ------------------------------------------------------------------ */

export function buildChunkPrompt(
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

/* ------------------------------------------------------------------ */
/*  Reduce Prompt — 合并筛选候选项                                      */
/* ------------------------------------------------------------------ */

export function buildReducePrompt(
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
