/**
 * 课堂摘要服务 (Summary)
 * 
 * 自动生成课堂结构化摘要
 * 包含：主要知识点、重点难点、课堂结构
 */

import { chat, type ChatMessage } from './llm-service';
import type { TranscriptSegment } from '@/lib/db';
import type { ClassSummary, SummaryTakeaway } from '@/types';
import { FeatureConfig } from '@/lib/config';
import { formatTranscriptWithTimestamps } from '@/lib/utils';
import { parseJsonResponse } from '@/lib/utils';

// ============ 配置常量（从统一配置读取） ============

const DEFAULT_MODEL = FeatureConfig.summary.defaultModel;
const MIN_TAKEAWAYS = FeatureConfig.summary.minTakeaways;
const MAX_TAKEAWAYS = FeatureConfig.summary.maxTakeaways;

// ============ 类型定义 ============

export interface GenerateSummaryOptions {
  sessionInfo?: {
    subject?: string;
    topic?: string;
    teacher?: string;
  };
  model?: string;
}

interface RawTakeaway {
  label: string;
  insight: string;
  timestamps: string[];
}

interface RawSummary {
  overview: string;
  takeaways: RawTakeaway[];
  keyDifficulties: string[];
  structure: string[];
}

// ============ Prompt 构建 ============

/**
 * 构建摘要生成 Prompt
 */
function buildSummaryPrompt(
  segments: TranscriptSegment[],
  options: GenerateSummaryOptions
): string {
  const transcriptText = formatTranscriptWithTimestamps(segments);

  return `<task>
<role>你是一位专业的内容分析专家，负责从录音转录中提取结构化摘要。</role>
<context>
这是一段录音的完整转录文本。请根据实际内容自行判断主题和类型。
</context>
<goal>生成一份结构化摘要，帮助用户快速了解录音的核心内容。</goal>
<instructions>
  <step name="内容概要">
    <description>用2-3句话概括录音的主要内容。</description>
  </step>
  <step name="主要要点">
    <description>提取 ${MIN_TAKEAWAYS}-${MAX_TAKEAWAYS} 个核心要点。</description>
    <format>
      <item>label: 要点标题（不超过10个字）</item>
      <item>insight: 简明扼要的说明（1-2句话）</item>
      <item>timestamps: 相关时间戳（1-2个，MM:SS格式）</item>
    </format>
    <criteria>
      <item>只使用转录中明确提到的内容，不要推测</item>
      <item>每个要点应该独立，不重叠</item>
    </criteria>
  </step>
  <step name="重点难点">
    <description>列出2-4个重点或需要关注的内容。</description>
  </step>
  <step name="内容结构">
    <description>简要描述内容的主要环节（3-5个）。</description>
  </step>
</instructions>
<qualityControl>
  <item>语言简洁明了</item>
  <item>所有内容必须基于转录文本，不能编造</item>
  <item>时间戳必须准确对应转录内容</item>
</qualityControl>
<outputFormat>
返回严格的 JSON 对象，格式如下：
{
  "overview": "内容概要文本",
  "takeaways": [
    {
      "label": "要点标题",
      "insight": "简明说明",
      "timestamps": ["MM:SS"]
    }
  ],
  "keyDifficulties": ["重点1", "重点2"],
  "structure": ["环节1", "环节2", "环节3"]
}
不要包含任何 markdown 标记或其他说明文字。
</outputFormat>
<transcript><![CDATA[
${transcriptText}
]]></transcript>
</task>`;
}

/**
 * 构建家长友好版摘要 Prompt
 */
function buildParentFriendlyPrompt(
  segments: TranscriptSegment[],
  options: GenerateSummaryOptions
): string {
  const transcriptText = formatTranscriptWithTimestamps(segments);

  return `<task>
<role>你是一位善于总结的内容分析师。</role>
<context>
这是一段录音的转录文本。
</context>
<goal>用简洁易懂的语言，总结这段录音的核心内容。</goal>
<instructions>
  <item>避免使用过于专业的术语</item>
  <item>重点说明核心内容和要点</item>
  <item>语气专业、清晰</item>
</instructions>
<outputFormat>
返回一段200-300字的文字摘要，可以分段。
</outputFormat>
<transcript><![CDATA[
${transcriptText}
]]></transcript>
</task>`;
}

// ============ 核心处理逻辑 ============

/**
 * 验证并修复 takeaway 格式
 */
function validateTakeaways(takeaways: RawTakeaway[]): SummaryTakeaway[] {
  return takeaways
    .filter(t => t.label && t.insight)
    .map(t => ({
      label: t.label.slice(0, 20),
      insight: t.insight,
      timestamps: Array.isArray(t.timestamps) ? t.timestamps.slice(0, 2) : []
    }))
    .slice(0, MAX_TAKEAWAYS);
}

// ============ 主要导出函数 ============

/**
 * 生成课堂结构化摘要
 */
export async function generateClassSummary(
  sessionId: string,
  segments: TranscriptSegment[],
  options: GenerateSummaryOptions = {}
): Promise<ClassSummary> {
  if (segments.length === 0) {
    throw new Error('转录内容为空');
  }
  
  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildSummaryPrompt(segments, options);
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  
  const response = await chat(messages, model, { temperature: 0.3, maxTokens: 2000 });
  const rawSummary = parseJsonResponse<RawSummary>(response.content);
  
  if (!rawSummary) {
    throw new Error('无法解析摘要响应');
  }
  
  const now = new Date().toISOString();
  
  return {
    id: crypto.randomUUID(),
    sessionId,
    overview: rawSummary.overview || '暂无概要',
    takeaways: validateTakeaways(rawSummary.takeaways || []),
    keyDifficulties: rawSummary.keyDifficulties || [],
    structure: rawSummary.structure || [],
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 生成家长友好版摘要（纯文本）
 */
export async function generateParentSummary(
  segments: TranscriptSegment[],
  options: GenerateSummaryOptions = {}
): Promise<string> {
  if (segments.length === 0) {
    return '暂无课堂内容';
  }
  
  const model = options.model ?? DEFAULT_MODEL;
  const prompt = buildParentFriendlyPrompt(segments, options);
  const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
  
  const response = await chat(messages, model, { temperature: 0.5, maxTokens: 1000 });
  
  return response.content.trim();
}

/**
 * 从现有摘要生成简短版本（用于卡片展示）
 */
export function generateShortSummary(summary: ClassSummary): string {
  const parts: string[] = [];
  
  if (summary.overview) {
    parts.push(summary.overview);
  }
  
  if (summary.takeaways.length > 0) {
    const keyPoints = summary.takeaways
      .slice(0, 3)
      .map(t => `• ${t.label}`)
      .join('\n');
    parts.push(`\n主要知识点：\n${keyPoints}`);
  }
  
  if (summary.keyDifficulties.length > 0) {
    parts.push(`\n重点难点：${summary.keyDifficulties.slice(0, 2).join('、')}`);
  }
  
  return parts.join('\n');
}

export const summaryService = {
  generateSummary: generateClassSummary,
  generateParentSummary,
  generateShortSummary
};
