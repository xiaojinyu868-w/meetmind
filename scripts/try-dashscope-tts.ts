#!/usr/bin/env npx tsx
/**
 * try-dashscope-tts.ts —— DashScope（百炼）TTS 最小验证
 *
 * 用 DASHSCOPE_API_KEY 合成一句「同学们好，我们开始上课」，
 * SSE 流式 + word_timestamp_enabled（字级时间戳），打印：
 * HTTP 状态、SSE 事件结构样例（时间戳字段长什么样）、音频字节数。
 *
 * 用法：npx tsx scripts/try-dashscope-tts.ts
 * 注意：严禁打印 .env 内容；只打印状态、结构、时长。
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';

const ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';
const TEXT = '同学们好，我们开始上课。今天看 Jane Bond 这个例子。';

const CANDIDATES: Array<{ model: string; voice: string }> = [
  { model: 'cosyvoice-v3.5-flash', voice: 'longanpei' }, // 青少年教师女
  { model: 'cosyvoice-v3.5-flash', voice: 'longanya_v3' }, // 高雅气质女
  { model: 'cosyvoice-v3.5-flash', voice: 'longanwen_v3' }, // 优雅知性女
];

async function tryOne(model: string, voice: string, apiKey: string): Promise<boolean> {
  console.log(`--- 尝试 model=${model} voice=${voice}`);
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'enable',
    },
    body: JSON.stringify({
      model,
      input: {
        text: TEXT,
        voice,
        format: 'mp3',
        sample_rate: 24000,
        word_timestamp_enabled: true,
      },
    }),
  });

  console.log(`http_status: ${response.status} content-type: ${response.headers.get('content-type')}`);
  if (!response.ok || !response.body) {
    console.log(`error body: ${(await response.text()).slice(0, 300)}`);
    return false;
  }

  // 解析 SSE 事件流
  const audioChunks: Buffer[] = [];
  let printedStructure = false;
  let timestampSample = '';
  let eventCount = 0;
  const raw = await response.text();
  for (const block of raw.split('\n\n')) {
    const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(dataLine.slice(5)) as Record<string, unknown>;
    } catch {
      continue;
    }
    eventCount += 1;
    const output = event.output as Record<string, unknown> | undefined;
    if (!printedStructure && output) {
      console.log(`event keys: ${Object.keys(event).join(',')}; output keys: ${Object.keys(output).join(',')}`);
      printedStructure = true;
    }
    if (output && typeof output.audio === 'string') {
      audioChunks.push(Buffer.from(output.audio, 'base64'));
    }
    if (output && output.timestamp && !timestampSample) {
      timestampSample = JSON.stringify(output.timestamp).slice(0, 500);
    }
    if (output && output.finish_reason) {
      console.log(`finish_reason: ${String(output.finish_reason)}`);
    }
  }

  console.log(`events: ${eventCount}, audio_bytes: ${audioChunks.reduce((s, b) => s + b.length, 0)}`);
  if (timestampSample) console.log(`timestamp sample: ${timestampSample}`);
  if (audioChunks.length > 0) {
    writeFileSync('out/try-dashscope-tts.mp3', Buffer.concat(audioChunks));
    console.log('written: out/try-dashscope-tts.mp3');
    return true;
  }
  return false;
}

async function main() {
  const apiKey = (process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    console.error('DASHSCOPE_API_KEY 未配置');
    process.exit(1);
  }
  for (const candidate of CANDIDATES) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryOne(candidate.model, candidate.voice, apiKey);
    if (ok) {
      console.log(`SUCCESS: model=${candidate.model} voice=${candidate.voice}`);
      return;
    }
  }
  console.error('所有候选音色均失败');
  process.exit(1);
}

main().catch((error) => {
  console.error('请求失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
