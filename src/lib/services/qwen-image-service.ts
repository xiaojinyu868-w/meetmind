interface GenerateQwenImageParams {
  prompt: string;
  model?: string;
  size?: string;
  stylePreset?: string;
}

export interface QwenImageResult {
  imageUrl: string;
  requestId: string;
  model: string;
}

const DEFAULT_IMAGE_MODEL = process.env.DASHSCOPE_IMAGE_MODEL?.trim() || 'qwen-image-max';
const DEFAULT_IMAGE_SIZE = process.env.DASHSCOPE_IMAGE_SIZE?.trim() || '1024*1024';
const IMAGE_ENDPOINT =
  process.env.DASHSCOPE_IMAGE_ENDPOINT?.trim() ||
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';

function safeTrim(value: string | undefined): string {
  return (value || '').trim();
}

function extractImageUrl(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as Record<string, unknown>;

  const output = data.output as Record<string, unknown> | undefined;
  const outputResults = output?.results as Array<Record<string, unknown>> | undefined;
  const rootData = data.data as Array<Record<string, unknown>> | undefined;

  const candidates: unknown[] = [
    data.imageUrl,
    data.url,
    output?.image_url,
    output?.url,
    outputResults?.[0]?.url,
    rootData?.[0]?.url,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) {
      return candidate;
    }
  }

  return '';
}

export function isQwenImageEnabled(): boolean {
  return Boolean(safeTrim(process.env.DASHSCOPE_API_KEY));
}

export function getQwenImageModel(): string {
  return DEFAULT_IMAGE_MODEL;
}

export async function generateQwenImage(params: GenerateQwenImageParams): Promise<QwenImageResult> {
  const apiKey = safeTrim(process.env.DASHSCOPE_API_KEY);
  if (!apiKey) {
    throw new Error('未配置 DASHSCOPE_API_KEY，无法生成信息图。');
  }

  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error('缺少生图提示词。');
  }

  const model = params.model?.trim() || DEFAULT_IMAGE_MODEL;
  const size = params.size?.trim() || DEFAULT_IMAGE_SIZE;
  const styledPrompt = params.stylePreset ? `${prompt}\n\n风格要求：${params.stylePreset}` : prompt;

  const response = await fetch(IMAGE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-DashScope-Async': 'false',
    },
    body: JSON.stringify({
      model,
      input: {
        prompt: styledPrompt,
      },
      parameters: {
        size,
      },
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const requestId =
    response.headers.get('x-request-id') ||
    (typeof payload.request_id === 'string' ? payload.request_id : '') ||
    `qwen-image-${Date.now()}`;

  if (!response.ok) {
    const message =
      typeof payload.message === 'string'
        ? payload.message
        : typeof payload.code === 'string'
          ? payload.code
          : '文生图接口调用失败';
    throw new Error(`${message} (requestId=${requestId})`);
  }

  const imageUrl = extractImageUrl(payload);
  if (!imageUrl) {
    throw new Error(`文生图返回中未找到图片地址 (requestId=${requestId})`);
  }

  return {
    imageUrl,
    requestId,
    model,
  };
}
