/**
 * Gemini Image Generation Service
 * 通过 undyingapi 代理调用 Gemini 图像生成模型
 */

/* ---------- types ---------- */

export interface GeminiImageParams {
  prompt: string;
  stylePreset?: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  detailLevel?: 'concise' | 'standard' | 'detailed';
  language?: string;
  scenePreset?: string;
}

export interface GeminiImageResult {
  base64: string;
  mimeType: string;
  requestId: string;
  model: string;
}

/* ---------- constants ---------- */

const GEMINI_API_KEY =
  process.env.GEMINI_IMAGE_API_KEY?.trim() ||
  process.env.GEMINI_API_KEY?.trim() ||
  '';

const BASE_URL =
  process.env.IMAGE_GEN_BASE_URL?.trim() ||
  'https://vip.undyingapi.com/v1beta';

const MODEL =
  process.env.IMAGE_GEN_MODEL?.trim() ||
  'gemini-3.1-flash-image-preview';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1500;
const REQUEST_TIMEOUT_MS = 90_000;

/* ---------- scene presets for education products ---------- */

export const SCENE_PRESETS: Record<
  string,
  { label: string; labelEn: string; promptHint: string; icon: string }
> = {
  infographic: {
    label: '知识信息图',
    labelEn: 'Infographic',
    promptHint:
      '清晰的信息层级结构，图文混排，使用图标与色块区分模块，适合课堂知识总结与分享。风格简洁现代、教育感强。',
    icon: 'bar-chart-3',
  },
  'knowledge-card': {
    label: '知识卡片',
    labelEn: 'Knowledge Card',
    promptHint:
      '精美的单页知识卡片，一张卡片聚焦一个核心概念，大标题+配图+关键要点，适合社交分享和快速复习。',
    icon: 'book-open',
  },
  timeline: {
    label: '时间线',
    labelEn: 'Timeline',
    promptHint:
      '沿时间轴或逻辑线依次排布知识节点，每个节点有小图标+简要文字，适合展示演变过程或步骤流程。',
    icon: 'clock',
  },
  comparison: {
    label: '对比分析图',
    labelEn: 'Comparison Chart',
    promptHint:
      '左右或上下对比布局，用色彩区分两组对象，配合数据标注和图标，适合差异对比和优劣分析。',
    icon: 'git-compare-arrows',
  },
  flowchart: {
    label: '流程图',
    labelEn: 'Flowchart',
    promptHint:
      '用箭头和连接线展示流程步骤，每个节点有简短描述，配色统一清新，适合方法论和决策流程可视化。',
    icon: 'workflow',
  },
  'mind-map': {
    label: '概念地图',
    labelEn: 'Mind Map',
    promptHint:
      '中心放射状布局，核心概念在中央，分支延伸出去，使用不同颜色区分维度，适合知识框架梳理。',
    icon: 'network',
  },
  'review-poster': {
    label: '复习海报',
    labelEn: 'Review Poster',
    promptHint:
      '海报风格，大胆版式，醒目标题，核心公式/要点/图解融入画面，适合考前冲刺和教室张贴。',
    icon: 'pen-line',
  },
  'data-viz': {
    label: '数据可视化',
    labelEn: 'Data Visualization',
    promptHint:
      '包含图表（柱状图、饼图、折线图等）的数据展示图，数据标注清晰，配色专业，适合研究报告和数据汇报。',
    icon: 'trending-up',
  },
};

/* ---------- detail level → prompt modification ---------- */

const DETAIL_HINTS: Record<string, string> = {
  concise:
    '极简风格，只保留最核心的3-5个要点，大量留白，视觉重心突出，适合快速浏览。',
  standard:
    '标准详细度，包含主标题、副标题、6-8个关键知识点，布局均衡，图文并茂。',
  detailed:
    '详尽版本，包含完整知识体系，多级层次结构，丰富的数据标注和辅助说明，适合深度学习。',
};

/* ---------- helpers ---------- */

function isProxyApi(url: string): boolean {
  return url.includes('undyingapi') || url.includes('vip.');
}

function buildUrl(): string {
  const base = BASE_URL.replace(/\/+$/, '');
  const hasVersion = /\/v\d+/.test(base);
  const prefix = hasVersion ? base : `${base}/v1beta`;
  return `${prefix}/models/${MODEL}:generateContent`;
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (isProxyApi(BASE_URL)) {
    headers['Authorization'] = `Bearer ${GEMINI_API_KEY}`;
  } else {
    headers['x-goog-api-key'] = GEMINI_API_KEY;
  }
  return headers;
}

function buildPrompt(params: GeminiImageParams): string {
  const parts: string[] = [];

  // language hint
  const lang = params.language || '中文（简体）';
  parts.push(`请用${lang}生成以下内容的图片。`);

  // scene preset hint
  if (params.scenePreset && SCENE_PRESETS[params.scenePreset]) {
    parts.push(`场景风格：${SCENE_PRESETS[params.scenePreset].promptHint}`);
  }

  // detail level
  if (params.detailLevel && DETAIL_HINTS[params.detailLevel]) {
    parts.push(`详细程度：${DETAIL_HINTS[params.detailLevel]}`);
  }

  // custom style
  if (params.stylePreset) {
    parts.push(`自定义风格要求：${params.stylePreset.trim()}`);
  }

  // main content
  parts.push(`\n内容要求：\n${params.prompt.trim()}`);

  // orientation hint
  const orient = params.orientation || 'landscape';
  const orientLabel =
    orient === 'landscape' ? '横版' : orient === 'portrait' ? '竖版' : '方形';
  parts.push(`\n图片方向：${orientLabel}，请确保内容在该比例下布局合理。`);

  // universal quality
  parts.push(
    '图像质量要求：高清、文字清晰可读、色彩协调、专业设计感。文字必须正确无误，不能出现乱码或拼写错误。'
  );

  return parts.join('\n');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RetryableGeminiError extends Error {}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503;
}

/* ---------- response parsing ---------- */

interface GeminiCandidate {
  content?: {
    parts?: Array<{
      inlineData?: { data?: string; mimeType?: string };
      text?: string;
    }>;
  };
  finishReason?: string;
  safetyRatings?: unknown[];
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  generatedImages?: Array<{ imageBytes?: string }>;
  predictions?: Array<{ bytesBase64Encoded?: string }>;
}

function extractBase64(payload: GeminiResponse): { base64: string; mimeType: string } {
  // Format 1: Gemini standard
  const parts = payload.candidates?.[0]?.content?.parts;
  if (parts) {
    for (const part of parts) {
      if (part.inlineData?.data) {
        return {
          base64: part.inlineData.data,
          mimeType: part.inlineData.mimeType || 'image/png',
        };
      }
    }
  }

  // Format 2: Legacy Imagen
  const imageBytes = payload.generatedImages?.[0]?.imageBytes;
  if (imageBytes) {
    return { base64: imageBytes, mimeType: 'image/png' };
  }

  // Format 3: Vertex AI
  const vertexData = payload.predictions?.[0]?.bytesBase64Encoded;
  if (vertexData) {
    return { base64: vertexData, mimeType: 'image/png' };
  }

  return { base64: '', mimeType: '' };
}

/* ---------- public API ---------- */

export function isGeminiImageEnabled(): boolean {
  return Boolean(GEMINI_API_KEY);
}

export function getGeminiImageModel(): string {
  return MODEL;
}

export function getScenePresets() {
  return SCENE_PRESETS;
}

export async function generateGeminiImage(
  params: GeminiImageParams
): Promise<GeminiImageResult> {
  if (!GEMINI_API_KEY) {
    throw new Error('未配置图片生成服务的 API Key，无法生成图片。');
  }

  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error('缺少生图提示词。');
  }

  const url = buildUrl();
  const headers = buildHeaders();
  const fullPrompt = buildPrompt(params);

  const body = JSON.stringify({
    contents: [
      {
        parts: [{ text: fullPrompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      temperature: 1,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 8192,
    },
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const responseText = await response.text();

      if (responseText.trim().startsWith('<')) {
        throw new Error(`代理返回 HTML 而非 JSON，请检查 IMAGE_GEN_BASE_URL 配置。(attempt=${attempt + 1})`);
      }

      let payload: GeminiResponse;
      try {
        payload = JSON.parse(responseText) as GeminiResponse;
      } catch {
        throw new Error(`JSON 解析失败 (attempt=${attempt + 1}): ${responseText.slice(0, 200)}`);
      }

      if (!response.ok) {
        const errMsg =
          (payload as unknown as { error?: { message?: string } })?.error?.message ||
          responseText.slice(0, 200);

        if (isRetryableStatus(response.status)) {
          throw new RetryableGeminiError(`${response.status}: ${errMsg}`);
        }

        throw new Error(`图片生成 API 错误 (${response.status}): ${errMsg}`);
      }

      const { base64, mimeType } = extractBase64(payload);
      if (!base64) {
        throw new RetryableGeminiError('响应中未包含图片数据');
      }

      return {
        base64,
        mimeType,
        requestId: `gemini-img-${Date.now()}`,
        model: MODEL,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const shouldRetry =
        attempt < MAX_RETRIES - 1 && (
          error instanceof RetryableGeminiError ||
          (error instanceof DOMException && error.name === 'AbortError') ||
          error instanceof TypeError
        );

      if (shouldRetry) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt));
        continue;
      }

      break;
    }
  }

  throw lastError || new Error('图片生成失败（已达到最大重试次数）');
}
