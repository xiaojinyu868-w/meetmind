/**
 * DashScope 图像生成服务（阿里云百炼）
 *
 * 默认 qwen-image-3.0-pro（千问图像 3.0，multimodal-generation 同步接口，
 * 长文渲染最强）；该模型处于邀测阶段，账号未开通时自动降级到
 * qwen-image-plus（image-synthesis 异步任务），邀测开通后零改动自动生效。
 *
 * 同一套生图提示词（buildImagePrompt，与 Gemini 共用），
 * 返回与 GeminiImageResult 同构的结果，路由层可无缝切换。
 */

import type { GeminiImageParams, GeminiImageResult } from '@/lib/services/gemini-image-service';
import { buildImagePrompt } from '@/lib/services/gemini-image-service';
import { createLogger } from '@/lib/logger';

const log = createLogger('dashscope-image');

const MM_GENERATION_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const IMAGE_SYNTHESIS_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const TASK_URL = 'https://dashscope.aliyuncs.com/api/v1/tasks';

const MODEL = process.env.DASHSCOPE_IMAGE_MODEL?.trim() || 'qwen-image-3.0-pro';
const FALLBACK_MODEL = process.env.DASHSCOPE_IMAGE_FALLBACK_MODEL?.trim() || 'qwen-image-plus';

const MAX_WAIT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const SIZE_BY_ORIENTATION: Record<string, string> = {
  landscape: '1280*720',
  portrait: '720*1280',
  square: '1024*1024',
};

export function isDashscopeImageEnabled(): boolean {
  return Boolean(process.env.DASHSCOPE_API_KEY?.trim());
}

export function getDashscopeImageModel(): string {
  return MODEL;
}

async function downloadImage(url: string): Promise<{ base64: string; mimeType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`图片下载失败：HTTP ${response.status}`);
  }
  const mimeType = response.headers.get('content-type') || 'image/png';
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    base64: buffer.toString('base64'),
    mimeType: mimeType.startsWith('image/') ? mimeType : 'image/png',
  };
}

/** qwen-image-3.0-pro：multimodal-generation 同步接口 */
async function generateWithPro(prompt: string, size: string, apiKey: string): Promise<GeminiImageResult> {
  const response = await fetch(MM_GENERATION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { prompt_extend: true, size, n: 1 },
    }),
  });
  const data = await response.json().catch(() => ({})) as {
    output?: { choices?: Array<{ message?: { content?: Array<{ image?: string }> } }> };
    usage?: { width?: number; height?: number };
    request_id?: string;
    code?: string;
    message?: string;
  };
  if (!response.ok || data.code) {
    const error = new Error(data.message || `HTTP ${response.status}`);
    (error as Error & { code?: string }).code = data.code || String(response.status);
    throw error;
  }
  const imageUrl = data.output?.choices?.[0]?.message?.content?.[0]?.image;
  if (!imageUrl) throw new Error('图像任务完成但未返回图片地址');

  const image = await downloadImage(imageUrl);
  log.info('image generated (pro)', { model: MODEL, bytes: image.base64.length, size });
  return {
    ...image,
    requestId: data.request_id || '',
    model: MODEL,
  };
}

async function submitTask(prompt: string, size: string, apiKey: string): Promise<string> {
  const response = await fetch(IMAGE_SYNTHESIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      input: { prompt },
      parameters: { size, n: 1 },
    }),
  });
  const data = await response.json().catch(() => ({})) as {
    output?: { task_id?: string };
    code?: string;
    message?: string;
  };
  const taskId = data.output?.task_id;
  if (!response.ok || !taskId) {
    throw new Error(`图像任务提交失败：${data.message || data.code || `HTTP ${response.status}`}`);
  }
  return taskId;
}

async function waitForImageUrl(taskId: string, apiKey: string): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const response = await fetch(`${TASK_URL}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({})) as {
      output?: {
        task_status?: string;
        results?: Array<{ url?: string }>;
        message?: string;
      };
    };
    const status = data.output?.task_status;
    if (status === 'SUCCEEDED') {
      const url = data.output?.results?.[0]?.url;
      if (!url) throw new Error('图像任务完成但未返回图片地址');
      return url;
    }
    if (status === 'FAILED') {
      throw new Error(`图像任务失败：${data.output?.message || '未知原因'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('图像生成超时，请稍后重试');
}

/** qwen-image-plus：image-synthesis 异步任务接口（pro 邀测未开通时的降级通道） */
async function generateWithPlus(prompt: string, size: string, apiKey: string): Promise<GeminiImageResult> {
  const taskId = await submitTask(prompt, size, apiKey);
  const imageUrl = await waitForImageUrl(taskId, apiKey);
  const image = await downloadImage(imageUrl);
  log.info('image generated (plus fallback)', { model: FALLBACK_MODEL, bytes: image.base64.length, size });
  return {
    ...image,
    requestId: taskId,
    model: FALLBACK_MODEL,
  };
}

function isAccessDenied(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const message = error instanceof Error ? error.message : String(error);
  return code === 'AccessDenied' || code === '403' || /access denied/i.test(message);
}

export async function generateDashscopeImage(params: GeminiImageParams): Promise<GeminiImageResult> {
  const apiKey = process.env.DASHSCOPE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，无法生成图片。');
  }
  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error('缺少生图提示词。');
  }

  const fullPrompt = buildImagePrompt(params);
  const size = SIZE_BY_ORIENTATION[params.orientation || 'landscape'] || SIZE_BY_ORIENTATION.landscape;

  try {
    return await generateWithPro(fullPrompt, size, apiKey);
  } catch (error) {
    if (!isAccessDenied(error)) throw error;
    log.warn('pro model access denied, falling back to plus', { model: MODEL, fallback: FALLBACK_MODEL });
    return generateWithPlus(fullPrompt, size, apiKey);
  }
}
