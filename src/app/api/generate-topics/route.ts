/**
 * AI 精选片段生成 API
 * 
 * POST /api/generate-topics
 * 
 * 从课堂转录文本中提取关键片段
 * 支持 Smart（质量优先）和 Fast（速度优先）两种模式
 */

import { NextRequest, NextResponse } from 'next/server';
import { highlightService } from '@/lib/services/highlight-service';
import type { TopicGenerationMode } from '@/types';
import { applyRateLimit } from '@/lib/utils/rate-limit';
import { createLogger } from '@/lib/logger';
const log = createLogger('generate-topics');


// 请求体类型
interface GenerateTopicsRequest {
  sessionId: string;
  transcript: Array<{
    id?: string;
    text: string;
    startMs: number;
    endMs: number;
    confidence?: number;
    isFinal?: boolean;
  }>;
  mode?: TopicGenerationMode;
  maxTopics?: number;
  theme?: string;
  sessionInfo?: {
    subject?: string;
    topic?: string;
    teacher?: string;
  };
  excludeTopicKeys?: string[];
  includeCandidatePool?: boolean;
}

// 响应体类型
interface GenerateTopicsResponse {
  success: boolean;
  topics?: Array<{
    id: string;
    title: string;
    importance: string;
    duration: number;
    segments: Array<{
      start: number;
      end: number;
      text: string;
    }>;
    quote?: {
      timestamp: string;
      text: string;
    };
  }>;
  candidates?: Array<{
    key: string;
    title: string;
    quote: {
      timestamp: string;
      text: string;
    };
  }>;
  modelUsed?: string;
  error?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse<GenerateTopicsResponse>> {
  // 应用速率限制
  const rateLimitResponse = await applyRateLimit(request, 'generateTopics');
  if (rateLimitResponse) return rateLimitResponse as NextResponse<GenerateTopicsResponse>;

  try {
    const body: GenerateTopicsRequest = await request.json();
    
    // 打印前3个转录片段的内容，用于调试
    if (body.transcript && body.transcript.length > 0) {
      body.transcript.slice(0, 3).forEach((seg, i) => {
      });
      
      // 检查是否有空文本
      const emptyCount = body.transcript.filter(s => !s.text || s.text.trim() === '').length;
      if (emptyCount > 0) {
      }
      
      // 计算总文本长度
      const totalTextLength = body.transcript.reduce((sum, s) => sum + (s.text?.length || 0), 0);
    }
    
    // 验证必填字段
    if (!body.sessionId) {
      return NextResponse.json(
        { success: false, error: '缺少 sessionId' },
        { status: 400 }
      );
    }
    
    if (!body.transcript || body.transcript.length === 0) {
      return NextResponse.json(
        { success: false, error: '缺少转录内容' },
        { status: 400 }
      );
    }
    
    // 转换转录格式
    const segments = body.transcript.map((seg, index) => ({
      id: seg.id ? parseInt(seg.id) : index,
      sessionId: body.sessionId,
      userId: 'anonymous',
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
      confidence: seg.confidence ?? 1.0,
      isFinal: seg.isFinal ?? true
    }));
    
    // 生成精选片段
    const result = await highlightService.generateTopics(
      body.sessionId,
      segments,
      {
        mode: body.mode,
        maxTopics: body.maxTopics,
        theme: body.theme,
        sessionInfo: body.sessionInfo,
        excludeTopicKeys: body.excludeTopicKeys 
          ? new Set(body.excludeTopicKeys) 
          : undefined
      }
    );
    
    // 如果没有生成主题，记录警告
    if (result.topics.length === 0) {
      log.warn('[generate-topics] 警告：未生成任何主题！');
    }
    
    // 构建响应
    const response: GenerateTopicsResponse = {
      success: true,
      topics: result.topics.map(topic => ({
        id: topic.id,
        title: topic.title,
        importance: topic.importance,
        duration: topic.duration,
        segments: topic.segments.map(seg => ({
          start: seg.start,
          end: seg.end,
          text: seg.text
        })),
        quote: topic.quote
      })),
      modelUsed: result.modelUsed
    };
    
    // 可选：返回候选池
    if (body.includeCandidatePool && result.candidates) {
      response.candidates = result.candidates;
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    log.error('[generate-topics] 错误:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : '生成失败' 
      },
      { status: 500 }
    );
  }
}

// 支持 OPTIONS 请求（CORS）
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
