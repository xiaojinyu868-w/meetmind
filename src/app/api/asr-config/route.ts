/**
 * ASR 配置 API
 * 
 * GET /api/asr-config
 * 返回 ASR 服务的配置信息（包括 WebSocket URL 和认证信息）
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  
  if (!apiKey) {
    return NextResponse.json(
      { error: 'DASHSCOPE_API_KEY 未配置' },
      { status: 500 }
    );
  }

  const wsModel = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen-asr-realtime-v1';
  const sampleRate = Number(process.env.DASHSCOPE_ASR_WS_SR || '16000');

  // 返回 WebSocket 连接所需的配置
  return NextResponse.json({
    wsUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    apiKey: apiKey,  // 注意：生产环境应该使用更安全的方式
    model: wsModel,
    sampleRate,
  });
}
