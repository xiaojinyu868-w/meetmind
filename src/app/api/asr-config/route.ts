import { NextResponse } from 'next/server';

// 与 server.js 的实时 ASR 代理保持同一套族分派逻辑：
// qwen-audio-3.0* / fun-asr* 走 duplex 任务协议（/api-ws/v1/inference），
// qwen3-asr* 走旧 Omni Realtime 协议（/api-ws/v1/realtime?model=）。
function isDuplexAsrModel(model: string): boolean {
  return /^(qwen-audio-3\.0|fun-asr)/i.test(model.trim());
}

export async function GET() {
  const apiKey = process.env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: '服务端未配置 DASHSCOPE_API_KEY' },
      { status: 500 }
    );
  }

  const wsModel = process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen-audio-3.0-asr-flash-streaming';
  const sampleRate = Number(process.env.DASHSCOPE_ASR_WS_SR || '16000');
  const wsUrl =
    process.env.DASHSCOPE_ASR_WS_URL ||
    (isDuplexAsrModel(wsModel)
      ? 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
      : 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime');

  return NextResponse.json({
    wsUrl,
    available: true,
    model: wsModel,
    sampleRate,
  });
}
