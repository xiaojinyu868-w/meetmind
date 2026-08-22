/**
 * Qwen-OCR 服务 - 图片文字提取（阿里云百炼 DashScope）
 *
 * 图片摄入链路成本决策（2026-08）：多模态大模型 → qwen-vl-ocr + 廉价文本模型。
 * qwen-vl-ocr 是专为文字提取设计的视觉模型（扫描文档/表格/票据/公式 LaTeX/图表），
 * 价格比通用多模态大模型低一个量级。
 *
 * 调用形态：DashScope 原生 multimodal-generation 同步接口（与 qwen-image-service 同款 HTTP 惯例），
 * messages content 里带 { image: dataUrl, min_pixels, max_pixels } + 自定义 text prompt，
 * 不走 ocr_options 内置任务——自定义 prompt 能一次要齐 Markdown + LaTeX + 图表还原 + 图形描述。
 * 文档：https://help.aliyun.com/zh/model-studio/qwen-vl-ocr-api-reference
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('qwen-ocr');

export interface QwenOcrResult {
  text: string;
  model: string;
  requestId: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

const DEFAULT_OCR_MODEL = process.env.DASHSCOPE_OCR_MODEL?.trim() || 'qwen-vl-ocr';
const OCR_ENDPOINT =
  process.env.DASHSCOPE_OCR_ENDPOINT?.trim() ||
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

// qwen-vl-ocr 每 token 对应 28*28 像素；max_pixels 默认 8192*28*28
const MIN_PIXELS = 4 * 28 * 28;
const MAX_PIXELS = 8192 * 28 * 28;

/** OCR 输出结构化 prompt：正文 Markdown + 公式 LaTeX + 图表数据还原 + 图形文字描述 */
const OCR_PROMPT = [
  '请识别这张图片中的全部内容，按以下要求输出：',
  '1. 正文按原文结构整理为 Markdown（保留标题层级、列表与段落）；',
  '2. 数学、物理、化学公式一律用 LaTeX 表示（行内 $...$，独立公式 $$...$$）；',
  '3. 图表（柱状图/折线图/饼图/表格等）还原数据，用 Markdown 表格或要点列出关键数据与趋势；',
  '4. 纯图形、照片、插图用一句话描述其内容与作用；',
  '5. 看不清的字符用英文问号 ? 代替，不要编造内容，不要输出任何额外解释、前后缀或代码块围栏。',
].join('\n');

function safeTrim(value: string | undefined): string {
  return (value || '').trim();
}

function parsePayloadText(payloadText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payloadText) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 提取 DashScope 原生响应 output.choices[0].message.content 里的全部 text 段 */
function extractOutputText(payload: Record<string, unknown>): string {
  const output = payload.output as Record<string, unknown> | undefined;
  const choices = output?.choices as Array<Record<string, unknown>> | undefined;
  const message = choices?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;

  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string'
          ? ((part as Record<string, unknown>).text as string)
          : ''
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function isQwenOcrAvailable(): boolean {
  return Boolean(safeTrim(process.env.DASHSCOPE_API_KEY));
}

export function getQwenOcrModel(): string {
  return DEFAULT_OCR_MODEL;
}

export interface QwenOcrParams {
  /** data:image/...;base64,... 或 http(s) URL */
  imageUrl: string;
  prompt?: string;
  model?: string;
}

export async function extractTextFromImage(params: QwenOcrParams): Promise<QwenOcrResult> {
  const apiKey = safeTrim(process.env.DASHSCOPE_API_KEY);
  if (!apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，无法进行图片 OCR。');
  }

  const model = params.model?.trim() || DEFAULT_OCR_MODEL;
  const prompt = params.prompt?.trim() || OCR_PROMPT;

  const response = await fetch(OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              {
                image: params.imageUrl,
                min_pixels: MIN_PIXELS,
                max_pixels: MAX_PIXELS,
                enable_rotate: true,
              },
              { text: prompt },
            ],
          },
        ],
      },
    }),
  });

  const payloadText = await response.text();
  const payload = parsePayloadText(payloadText);
  const requestId =
    response.headers.get('x-request-id') ||
    (typeof payload.request_id === 'string' ? payload.request_id : '') ||
    `qwen-ocr-${Date.now()}`;

  if (!response.ok) {
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : typeof payload.code === 'string'
          ? payload.code
          : payloadText || 'Qwen-OCR 接口调用失败';
    throw new Error(`${message} (requestId=${requestId})`);
  }

  const text = extractOutputText(payload);
  if (!text) {
    throw new Error(`Qwen-OCR 响应中未找到文本内容 (requestId=${requestId})`);
  }

  const usageRaw = (payload.usage as Record<string, unknown> | undefined) ?? {};
  const usage =
    typeof usageRaw.input_tokens === 'number' || typeof usageRaw.output_tokens === 'number'
      ? {
          promptTokens: (usageRaw.input_tokens as number) ?? 0,
          completionTokens: (usageRaw.output_tokens as number) ?? 0,
          totalTokens: (usageRaw.total_tokens as number) ?? 0,
        }
      : undefined;

  log.info('qwen-ocr.done', { model, requestId, chars: text.length, usage });

  return { text, model, requestId, usage };
}
