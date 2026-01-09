/**
 * 课堂摘要生成 API
 * 
 * POST /api/generate-summary
 * 
 * 自动生成课堂结构化摘要
 * 包含：概要、主要知识点、重点难点、课堂结构
 */

import { NextRequest, NextResponse } from 'next/server';
import { summaryService } from '@/lib/services/summary-service';

// 请求体类型
interface GenerateSummaryRequest {
  sessionId: string;
  transcript: Array<{
    id?: string;
    text: string;
    startMs: number;
    endMs: number;
    confidence?: number;
    isFinal?: boolean;
  }>;
  sessionInfo?: {
    subject?: string;
    topic?: string;
    teacher?: string;
  };
  format?: 'structured' | 'parent';  // structured: 结构化JSON, parent: 家长友好文本
}

// 结构化响应
interface StructuredSummaryResponse {
  success: boolean;
  summary?: {
    id: string;
    overview: string;
    takeaways: Array<{
      label: string;
      insight: string;
      timestamps: string[];
    }>;
    keyDifficulties: string[];
    structure: string[];
  };
  error?: string;
}

// 家长友好响应
interface ParentSummaryResponse {
  success: boolean;
  content?: string;
  error?: string;
}

type GenerateSummaryResponse = StructuredSummaryResponse | ParentSummaryResponse;

export async function POST(request: NextRequest): Promise<NextResponse<GenerateSummaryResponse>> {
  try {
    const body: GenerateSummaryRequest = await request.json();
    
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
      text: seg.text,
      startMs: seg.startMs,
      endMs: seg.endMs,
      confidence: seg.confidence ?? 1.0,
      isFinal: seg.isFinal ?? true
    }));
    
    const format = body.format ?? 'structured';
    
    // 家长友好格式
    if (format === 'parent') {
      const content = await summaryService.generateParentSummary(
        segments,
        { sessionInfo: body.sessionInfo }
      );
      
      return NextResponse.json({
        success: true,
        content
      });
    }
    
    // 结构化格式
    const summary = await summaryService.generateSummary(
      body.sessionId,
      segments,
      { sessionInfo: body.sessionInfo }
    );
    
    return NextResponse.json({
      success: true,
      summary: {
        id: summary.id,
        overview: summary.overview,
        takeaways: summary.takeaways,
        keyDifficulties: summary.keyDifficulties,
        structure: summary.structure
      }
    });
    
  } catch (error) {
    console.error('生成摘要失败:', error);
    
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
