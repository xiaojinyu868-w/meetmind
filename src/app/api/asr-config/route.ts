import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: '服务端未配置 DASHSCOPE_API_KEY' },
      { status: 500 }
    );
  }

  const wsModel = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen3-asr-flash-realtime-2026-02-10';
  const sampleRate = Number(process.env.DASHSCOPE_ASR_WS_SR || '16000');

  return NextResponse.json({
    wsUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
    available: true,
    model: wsModel,
    sampleRate,
  });
}
