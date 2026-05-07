// Real Qwen3-ASR-Flash caller for the eval runner.
// Only used when DASHSCOPE_API_KEY is set.
// For dry-run, use dryRunCaller instead.
//
// 设计要点：
//   - 走 async (file-trans) 模式——评测场景里我们有本地音频文件，走异步是最合适的
//   - 公网可访问的 URL 是前提；本地评测场景可以选择：
//     (a) 上传到 OSS / 临时 CDN
//     (b) 开一个临时 ngrok（CI 里不可行）
//     (c) 直接用公开数据集的 URL（如 AISHELL 的托管地址）
//   - 如果 audio URL 没提供，这个 caller 会 fail，告诉用户如何填
import pRetry, { AbortError } from 'p-retry';
import { fullJitterDelay } from '@/lib/services/asr/text-utils';
import type { AsrCase } from './runner';

const DASHSCOPE_API_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const ASR_TRANSCRIPTION_URL = `${DASHSCOPE_API_BASE}/services/audio/asr/transcription`;
const TASK_QUERY_URL = `${DASHSCOPE_API_BASE}/tasks`;

interface ASRSentence {
  text: string;
  begin_time?: number;
  end_time?: number;
}

async function submitTask(fileUrl: string, apiKey: string, model: string, context?: string, language: string = 'zh'): Promise<string> {
  const body = {
    model,
    input: { file_url: fileUrl },
    parameters: {
      channel_id: [0],
      language,
      enable_itn: true,
      ...(context ? { corpus: { text: context } } : {}),
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

/**
 * Qwen3-ASR-Flash async caller.
 *
 * 要求 AsrCase 带 `audio`（必须是公网可访问 URL）。
 * Node 本地文件路径不被支持——那样要先上传。
 *
 * 环境变量：
 *   DASHSCOPE_API_KEY — 必填
 *   ASR_MODEL          — 默认 qwen3-asr-flash-filetrans
 */
export async function qwenAsyncCaller(c: AsrCase): Promise<{ hypothesis: string; durationMs: number }> {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY not set');
  if (!c.audio) throw new Error(`case ${c.id} has no audio URL; cannot call real ASR`);
  if (!/^https?:\/\//.test(c.audio)) {
    throw new Error(`case ${c.id} audio must be public URL, got: ${c.audio.slice(0, 50)}`);
  }

  const model = process.env.ASR_MODEL ?? 'qwen3-asr-flash-filetrans';
  const language = c.language ?? 'auto';
  const started = Date.now();

  const taskId = await submitTask(c.audio, apiKey, model, c.context, language === 'auto' ? 'zh' : language);
  const url = await pollTask(taskId, apiKey, 10 * 60 * 1000);
  const text = await fetchTranscription(url);

  return {
    hypothesis: text,
    durationMs: Date.now() - started,
  };
}
