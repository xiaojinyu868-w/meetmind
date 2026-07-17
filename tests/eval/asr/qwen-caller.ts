// Real Qwen3-ASR-Flash caller for the eval runner.
// Only used when DASHSCOPE_API_KEY is set.
// For dry-run, use dryRunCaller instead.
//
// 设计要点：
//   - 公网 URL 走 async filetrans，适合长音频；
//   - 仓库内短 fixture 直接走 batch data URI，不依赖 OSS/ngrok；
//   - ASR_EVAL_TRANSPORT=realtime 时，以真实速度回放 PCM 到产品 WS proxy，
//     同时测 CER、first partial 与 final lag。
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, resolve } from 'node:path';
import pRetry, { AbortError } from 'p-retry';
import WebSocket from 'ws';
import { fullJitterDelay } from '@/lib/services/asr/text-utils';
import type { AsrCallerResponse, AsrCase } from './runner';

const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;
const SYNC_ASR_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

interface ASRSentence {
  text: string;
  begin_time?: number;
  end_time?: number;
}

async function submitTask(fileUrl: string, apiKey: string, model: string, language: 'zh' | 'en' | 'auto' = 'auto'): Promise<string> {
  const languageParam = language === 'auto' ? {} : { language };
  const body = {
    model,
    input: { file_url: fileUrl },
    parameters: {
      channel_id: [0],
      ...languageParam,
      enable_itn: true,
    },
  };

  const response = await fetch(ASR_TRANSCRIPTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`submit failed: HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = (await response.json()) as { output?: { task_id?: string } };
  const taskId = json.output?.task_id;
  if (!taskId) throw new Error('missing task_id in response');
  return taskId;
}

async function pollTask(taskId: string, apiKey: string, maxWaitMs: number): Promise<string> {
  const started = Date.now();
  return pRetry(
    async (attempt) => {
      if (Date.now() - started > maxWaitMs) {
        throw new AbortError(`poll timeout after ${maxWaitMs}ms`);
      }
      const resp = await fetch(`${TASK_QUERY_URL}/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!resp.ok) throw new Error(`poll HTTP ${resp.status}`);
      const json = (await resp.json()) as {
        output?: { task_status?: string; result?: { transcription_url?: string }; message?: string };
      };
      const status = json.output?.task_status;
      if (status === 'SUCCEEDED' && json.output?.result?.transcription_url) {
        return json.output.result.transcription_url;
      }
      if (status === 'FAILED') {
        throw new AbortError(`task failed: ${json.output?.message ?? 'unknown'}`);
      }
      const delay = fullJitterDelay(Math.min(attempt, 8), 1000, 10000);
      await new Promise((r) => setTimeout(r, delay));
      throw new Error(`task ${status}`);
    },
    { retries: 120, factor: 1, minTimeout: 0, maxTimeout: 0 },
  );
}

async function fetchTranscription(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch result HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    transcripts?: Array<{ sentences?: ASRSentence[] }>;
  };
  const sentences: ASRSentence[] = [];
  for (const t of data.transcripts ?? []) {
    if (Array.isArray(t.sentences)) sentences.push(...t.sentences);
  }
  return sentences.map((s) => s.text.trim()).join('');
}

function getAudioMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    case '.ogg': return 'audio/ogg';
    case '.webm': return 'audio/webm';
    case '.flac': return 'audio/flac';
    default: return 'audio/mpeg';
  }
}

export function extractTextFromSyncResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const root = payload as Record<string, unknown>;
  const output = root.output as Record<string, unknown> | undefined;

  if (typeof output?.text === 'string' && output.text.trim()) {
    return output.text.trim();
  }

  const choices = output?.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const message = (choices[0] as Record<string, unknown>).message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      const text = (item as Record<string, unknown>).text;
      return typeof text === 'string' ? text.trim() : '';
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

function buildLocalAudioDataUri(audioPath: string): string {
  const resolvedPath = isAbsolute(audioPath) ? audioPath : resolve(process.cwd(), audioPath);
  const encoded = readFileSync(resolvedPath).toString('base64');
  return `data:${getAudioMimeType(resolvedPath)};base64,${encoded}`;
}

export interface Pcm16Wav {
  pcm: Buffer;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
}

/** 只接受评测 fixture 的 16kHz / mono / PCM16 WAV，避免把压缩数据误发进 realtime。 */
export function readPcm16Wav(audioPath: string): Pcm16Wav {
  const resolvedPath = isAbsolute(audioPath) ? audioPath : resolve(process.cwd(), audioPath);
  const wav = readFileSync(resolvedPath);
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`realtime fixture must be a RIFF/WAVE file: ${audioPath}`);
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let pcm: Buffer | null = null;

  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString('ascii', offset, offset + 4);
    const chunkSize = wav.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(wav.length, dataStart + chunkSize);
    if (chunkId === 'fmt ' && chunkSize >= 16) {
      audioFormat = wav.readUInt16LE(dataStart);
      channelCount = wav.readUInt16LE(dataStart + 2);
      sampleRate = wav.readUInt32LE(dataStart + 4);
      bitsPerSample = wav.readUInt16LE(dataStart + 14);
    } else if (chunkId === 'data') {
      pcm = wav.subarray(dataStart, dataEnd);
    }
    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  if (!pcm || audioFormat !== 1 || sampleRate !== 16000 || channelCount !== 1 || bitsPerSample !== 16) {
    throw new Error(
      `realtime fixture must be PCM16 mono 16kHz: format=${audioFormat} rate=${sampleRate} channels=${channelCount} bits=${bitsPerSample}`,
    );
  }
  return { pcm, sampleRate, channelCount, bitsPerSample };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function transcribeRealtimeLocal(c: AsrCase): Promise<AsrCallerResponse> {
  if (!c.audio) throw new Error(`case ${c.id} has no audio path`);
  const { pcm, sampleRate } = readPcm16Wav(c.audio);
  const wsUrl = process.env.ASR_EVAL_WS_URL
    ?? `ws://127.0.0.1:${process.env.PORT ?? '3001'}/api/asr-stream`;
  const chunkMs = 40;
  const bytesPerSample = 2;
  const chunkBytes = Math.round((sampleRate * chunkMs / 1000) * bytesPerSample);

  return new Promise<AsrCallerResponse>((resolveResult, rejectResult) => {
    const ws = new WebSocket(wsUrl);
    const finalSegments: string[] = [];
    let settled = false;
    let audioStartedAt = 0;
    let audioEndedAt = 0;
    let lastFinalAt = 0;
    let firstPartialMs: number | undefined;

    const hardTimeout = setTimeout(() => {
      finish(new Error(`realtime eval timed out: ${c.id}`));
    }, Math.max(45_000, (c.audioDurationMs ?? 0) + 25_000));

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      if (error) {
        rejectResult(error);
        return;
      }
      const hypothesis = finalSegments.join(' ').trim();
      if (!hypothesis) {
        rejectResult(new Error(`realtime eval returned empty transcription: ${c.id}`));
        return;
      }
      resolveResult({
        hypothesis,
        durationMs: Date.now() - audioStartedAt,
        firstPartialMs,
        finalLagMs: audioEndedAt > 0 ? Math.max(0, lastFinalAt - audioEndedAt) : undefined,
      });
    };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'context-hint',
        contextHint: c.context?.trim() ?? '',
        languageMode: c.language ?? 'auto',
      }));
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      if (message.event === 'ready' && audioStartedAt === 0) {
        audioStartedAt = Date.now();
        void (async () => {
          for (let offset = 0; offset < pcm.length; offset += chunkBytes) {
            if (settled || ws.readyState !== WebSocket.OPEN) return;
            ws.send(pcm.subarray(offset, Math.min(pcm.length, offset + chunkBytes)));
            await delay(chunkMs);
          }
          audioEndedAt = Date.now();
          if (!settled && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ action: 'stop' }));
          }
        })().catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error(String(error)));
        });
        return;
      }

      if (message.event === 'interim') {
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (text && firstPartialMs === undefined && audioStartedAt > 0) {
          firstPartialMs = Date.now() - audioStartedAt;
        }
        return;
      }

      if (message.event === 'result') {
        const sentence = message.sentence as { text?: unknown } | undefined;
        const text = typeof sentence?.text === 'string' ? sentence.text.trim() : '';
        if (text) {
          if (firstPartialMs === undefined && audioStartedAt > 0) {
            firstPartialMs = Date.now() - audioStartedAt;
          }
          finalSegments.push(text);
          lastFinalAt = Date.now();
        }
        return;
      }

      if (message.event === 'error' || message.event === 'auth_failed') {
        finish(new Error(String(message.error ?? 'realtime ASR error')));
        return;
      }
      if (message.event === 'finished') finish();
    });

    ws.on('error', (error) => finish(error));
    ws.on('close', () => {
      if (!settled && audioEndedAt > 0 && finalSegments.length > 0) finish();
    });
  });
}

async function transcribeLocalAudio(c: AsrCase, apiKey: string): Promise<string> {
  if (!c.audio) throw new Error(`case ${c.id} has no audio path`);
  const messages: Array<{
    role: 'system' | 'user';
    content: Array<{ audio?: string; text?: string }>;
  }> = [];

  if (c.context?.trim()) {
    messages.push({
      role: 'system',
      content: [{
        text: `你正在转写课堂音频。以下是课程背景与术语表，请优先按该上下文识别专业词汇：${c.context.trim()}`,
      }],
    });
  }
  messages.push({
    role: 'user',
    content: [{ audio: buildLocalAudioDataUri(c.audio) }],
  });

  const asrOptions: Record<string, unknown> = { enable_itn: true };
  if (c.language && c.language !== 'auto') asrOptions.language = c.language;
  const body = {
    model: process.env.ASR_BATCH_MODEL
      ?? process.env.DASHSCOPE_ASR_BATCH_MODEL
      ?? 'qwen3-asr-flash-2026-02-10',
    input: { messages },
    parameters: { asr_options: asrOptions },
  };

  const response = await fetch(SYNC_ASR_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`local batch failed: HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
  const text = extractTextFromSyncResponse(JSON.parse(responseText));
  if (!text) throw new Error('local batch returned empty transcription');
  return text;
}

/**
 * Qwen3-ASR-Flash async caller.
 *
 * 要求 AsrCase 带 `audio`：
 * - 公网 URL 走 filetrans，适合长音频；
 * - 仓库本地路径走 batch data URI，适合冻结的短噪声 fixture。
 *
 * 环境变量：
 *   DASHSCOPE_API_KEY — 必填
 *   ASR_MODEL          — 默认 qwen3-asr-flash-filetrans-2025-11-17
 */
export async function qwenAsyncCaller(c: AsrCase): Promise<AsrCallerResponse> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');
  if (!c.audio) throw new Error(`case ${c.id} has no audio; cannot call real ASR`);

  const started = Date.now();
  if (!/^https?:\/\//.test(c.audio)) {
    if (process.env.ASR_EVAL_TRANSPORT === 'realtime') {
      return transcribeRealtimeLocal(c);
    }
    const hypothesis = await transcribeLocalAudio(c, apiKey);
    return { hypothesis, durationMs: Date.now() - started };
  }

  const model = process.env.ASR_MODEL
    ?? process.env.DASHSCOPE_ASR_FILE_MODEL
    ?? 'qwen3-asr-flash-filetrans-2025-11-17';
  const language = c.language ?? 'auto';
  // filetrans 当前不支持 corpus 精度增强；auto 必须省略 language，不能偷偷固定成中文。
  const taskId = await submitTask(c.audio, apiKey, model, language);
  const url = await pollTask(taskId, apiKey, 10 * 60 * 1000);
  const text = await fetchTranscription(url);

  return {
    hypothesis: text,
    durationMs: Date.now() - started,
  };
}
