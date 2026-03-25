/**
 * AI 精选片段服务 (Highlight Reels)
 * 
 * 从课堂录音转录文本中自动提取关键片段
 * 支持 Smart（质量优先）和 Fast（速度优先）两种生成模式
 *
 * 子模块：
 *   highlight-prompts.ts  — Prompt 模板 + 配置常量
 *   highlight-matchers.ts — 引用匹配器（子串定位 + 精确时间推算）
 */

import { chat, type ChatMessage } from './llm-service';
import type { TranscriptSegment } from '@/lib/db';
import type { 
  HighlightTopic, 
  TopicGenerationMode, 
  TopicCandidate,
} from '@/types';
import { chunkTranscript } from '@/lib/utils';
import { parseJsonResponse } from '@/lib/utils';
import { createLogger } from '@/lib/logger';

import {
  DEFAULT_MODEL,
  FAST_MODEL,
  CHUNK_MAX_CANDIDATES,
  DEFAULT_MAX_TOPICS,
  buildSmartPrompt,
  buildChunkPrompt,
  buildReducePrompt,
} from './highlight-prompts';

import {
  findQuoteInTranscript,
  inferImportance,
  dedupeCandidates,
} from './highlight-matchers';

const log = createLogger('highlight');

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
  theme?: string;
  excludeTopicKeys?: Set<string>;
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

// ============ 主要导出函数 ============

/**
 * 从转录文本生成精选片段
 */
export async function generateHighlightTopics(
  sessionId: string,
  segments: TranscriptSegment[],
  options: GenerateTopicsOptions = {}
): Promise<GenerateTopicsResult> {
  
  if (segments.length === 0) {
    return { topics: [], modelUsed: '' };
  }
  
  const mode = options.mode ?? 'fast';
  const model = options.model ?? (mode === 'smart' ? DEFAULT_MODEL : FAST_MODEL);
  const maxTopics = options.maxTopics ?? DEFAULT_MAX_TOPICS;
  
  const totalDuration = segments[segments.length - 1].endMs;
  const isShortSession = totalDuration <= 30 * 60 * 1000;
  
  let rawTopics: RawTopic[] = [];
  let candidates: TopicCandidate[] | undefined;
  
  // Smart 模式或短课程：单次全文处理
  if (mode === 'smart' || isShortSession) {
    const prompt = buildSmartPrompt(segments, options);
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    
    try {
      const response = await chat(messages, model, { temperature: 0.3, maxTokens: 4000 });
      rawTopics = parseJsonResponse<RawTopic[]>(response.content) ?? [];
    } catch (llmError) {
      log.error('[highlightService] LLM 调用失败:', llmError);
      throw llmError;
    }
  } 
  // Fast 模式：分块处理 + Map-Reduce
  else {
    const chunks = chunkTranscript(segments);
    
    const chunkResults = await Promise.all(
      chunks.map(async (chunk, chunkIdx) => {
        const prompt = buildChunkPrompt(chunk, CHUNK_MAX_CANDIDATES, options.theme);
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
          log.error(`[highlightService] 块 ${chunkIdx} 处理失败:`, e);
          return [];
        }
      })
    );
    
    candidates = dedupeCandidates(chunkResults.flat().filter(c => c.quote));
    
    if (candidates.length > maxTopics) {
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
  
  // 转换为 HighlightTopic 格式
  const now = new Date().toISOString();
  
  const topics: HighlightTopic[] = rawTopics
    .filter(t => {
      const hasQuote = !!t.quote;
      return hasQuote;
    })
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
    .filter(t => {
      const hasSegments = t.segments.length > 0;
      return hasSegments;
    })
    .sort((a, b) => (a.segments[0]?.start ?? 0) - (b.segments[0]?.start ?? 0));
  
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
    mode: 'smart'
  });
}

export const highlightService = {
  generateTopics: generateHighlightTopics,
  regenerateByTheme
};
