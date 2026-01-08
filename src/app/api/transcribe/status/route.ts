/**
 * 异步转录任务状态查询 API
 * 
 * GET /api/transcribe/status?taskId=xxx
 * 查询异步转录任务的状态和结果
 */

import { NextRequest, NextResponse } from 'next/server';
import { qwenASRService } from '@/lib/services/qwen-asr-service';

export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('taskId');
  
  if (!taskId) {
    return NextResponse.json(
      { error: '未提供任务 ID' },
      { status: 400 }
    );
  }
  
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DASHSCOPE_API_KEY 未配置' },
      { status: 500 }
    );
  }
  
  console.log('[Transcribe Status] Querying task:', taskId);
  
  try {
    const result = await qwenASRService.queryTask(taskId, apiKey);
    
    console.log('[Transcribe Status] Task status:', result.status);
    
    if (result.status === 'SUCCEEDED' && result.result) {
      // 解析结果
      const sentences = result.result.sentences || [];
      const segments = sentences.map((s: { text: string; start_time: number; end_time: number }, i: number) => ({
        id: `seg-${i}`,
        text: s.text,
        startMs: s.start_time,
        endMs: s.end_time,
        confidence: 0.95,
        isFinal: true,
      }));
      
      return NextResponse.json({
        success: true,
        status: 'SUCCEEDED',
        text: result.result.text || sentences.map((s: { text: string }) => s.text).join(' '),
        sentences: sentences,
        segments: segments,
        totalDuration: segments[segments.length - 1]?.endMs || 0,
      });
    }
    
    if (result.status === 'FAILED') {
      return NextResponse.json({
        success: false,
        status: 'FAILED',
        error: result.error || '转录失败',
      });
    }
    
    // 仍在处理中
    return NextResponse.json({
      success: true,
      status: result.status,
      message: result.status === 'RUNNING' ? '正在转录...' : '等待处理...',
    });
    
  } catch (error) {
    console.error('[Transcribe Status] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '查询失败' },
      { status: 500 }
    );
  }
}
