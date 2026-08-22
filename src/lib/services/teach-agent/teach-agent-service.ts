/**
 * teach-agent 服务 —— 「课 = agent 的工具调用轨迹」（v28 定稿）。
 *
 * 一节课 = 一次 streamText 运行：agent 的自然文本输出是老师讲的话（逐段 TTS），
 * 工具调用是板书（write/circle/... 原子工具）。轨迹不自建格式——就是 AI SDK
 * 原生 ModelMessage[]，跑完由 to-board-script walker 机械装配成 BoardScript，
 * 现有播放器零改动播放。
 *
 * 产出：SSE 事件流（meta/text/tool/image/done/error）。image 工具只记 prompt，
 * 跑完后统一调 dashscope 生图、落盘 public/uploads/teach-agent/、按 toolCallId 回填。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createOpenAI } from '@ai-sdk/openai';
import { hasToolCall, stepCountIs, streamText, type ModelMessage } from 'ai';
import { createLogger } from '@/lib/logger';
import type { BoardScript } from '@/lib/ai-native/plugins/board-script';
import { generateDashscopeImage } from '@/lib/services/dashscope-image-service';
import { createBoardEnv, createTeachTools } from './tools';
import { collectImageJobs, messagesToBoardScript, type ImageUrlMap } from './to-board-script';

const log = createLogger('teach-agent');

const TEACH_MODEL = process.env.TEACH_AGENT_MODEL?.trim() || 'kimi/kimi-k3';
const TEACH_BASE_URL =
  process.env.TEACH_AGENT_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MAX_STEPS = 60;
const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads', 'teach-agent');

export type TeachAgentEvent =
  | { type: 'meta'; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; tool: string; ok: boolean }
  | { type: 'image'; done: number; total: number }
  | { type: 'error'; error: 'failed' }
  | {
      type: 'done';
      title: string;
      script: BoardScript;
      steps: number;
      images: number;
      finishSummary?: string;
      /** 完整轨迹（AI SDK 原生格式）——续讲/复盘用；路由转发给前端时应剥掉 */
      messages: ModelMessage[];
    };

export interface TeachAgentParams {
  /** 课题（如"一元二次方程求根公式与判别式"） */
  topic: string;
  /** 可选素材（题目文本 / 转录摘录等） */
  material?: string;
  model?: string;
}

let systemPromptCache: string | null = null;

/** system prompt 在磁盘上（skills/board-teaching.md），可独立迭代不改代码 */
async function loadSystemPrompt(): Promise<string> {
  if (systemPromptCache) return systemPromptCache;
  systemPromptCache = await readFile(path.join(process.cwd(), 'skills', 'board-teaching.md'), 'utf8');
  return systemPromptCache;
}

/** 课名：agent 写的第一个 title 板书；没写就用课题截断 */
function deriveTitle(messages: ModelMessage[], topic: string): string {
  for (const message of messages) {
    if (message.role !== 'assistant' || typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type === 'tool-call' && part.toolName === 'write') {
        const input = part.input as { role?: string; text?: string };
        if (input.role === 'title' && input.text?.trim()) return input.text.trim().slice(0, 30);
      }
    }
  }
  return topic.trim().slice(0, 30) || '板书精讲';
}

/** 跑一次 agent 生成一节课，事件经 SSE 流出。 */
export async function* streamTeachLesson(
  params: TeachAgentParams,
): AsyncGenerator<TeachAgentEvent> {
  const modelId = params.model?.trim() || TEACH_MODEL;
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    yield { type: 'error', error: 'failed' };
    return;
  }

  const env = createBoardEnv();
  const tools = createTeachTools(env);
  const model = createOpenAI({ apiKey, baseURL: TEACH_BASE_URL }).chat(modelId);

  const userPrompt = params.material?.trim()
    ? `课题：${params.topic.trim()}\n\n素材：\n${params.material.trim()}\n\n请开始讲这节课。`
    : `课题：${params.topic.trim()}\n\n请开始讲这节课。`;

  yield { type: 'meta', model: modelId };

  const result = streamText({
    model,
    system: await loadSystemPrompt(),
    prompt: userPrompt,
    tools,
    stopWhen: [stepCountIs(MAX_STEPS), hasToolCall('finish')],
  });

  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      yield { type: 'text', text: part.text };
      continue;
    }
    if (part.type === 'tool-result') {
      const output = part.output as { ok?: boolean } | undefined;
      yield { type: 'tool', tool: part.toolName, ok: output?.ok !== false };
    }
  }

  const response = await result.response;
  const messages = response.messages;
  const title = deriveTitle(messages, params.topic);

  const imageJobs = collectImageJobs(messages);
  const images: ImageUrlMap = {};
  if (imageJobs.length > 0) {
    let done = 0;
    // 逐张生成并汇报进度（生图慢，先让前端知道在干什么）
    await mkdir(UPLOAD_DIR, { recursive: true });
    for (const job of imageJobs) {
      try {
        const generated = await generateDashscopeImage({
          prompt: job.prompt,
          stylePreset: 'chalkboard',
          orientation: 'landscape',
        });
        const ext = generated.mimeType.includes('png') ? 'png' : 'jpg';
        const name = `${createHash('sha1').update(job.toolCallId).digest('hex').slice(0, 16)}.${ext}`;
        await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(generated.base64, 'base64'));
        images[job.toolCallId] = `/uploads/teach-agent/${name}`;
      } catch (cause) {
        log.warn('image generation failed', {
          toolCallId: job.toolCallId,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
      done += 1;
      yield { type: 'image', done, total: imageJobs.length };
    }
  }

  const { script, stats } = messagesToBoardScript(messages, { title, images });
  if (stats.droppedActions > 0) log.warn('walker dropped actions', stats);

  const steps = (await result.steps).length;
  log.info('lesson generated', {
    model: modelId,
    title,
    steps,
    pages: script.pages.length,
    images: Object.keys(images).length,
    finishSummary: env.finishSummary,
  });

  yield {
    type: 'done',
    title,
    script,
    steps,
    images: Object.keys(images).length,
    ...(env.finishSummary ? { finishSummary: env.finishSummary } : {}),
    messages,
  };
}
