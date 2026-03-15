import { parseJsonResponse } from '@/lib/utils';

export interface CommonstackEchoOutput {
  title: string;
  body: string;
}

export interface CommonstackEchoRequest {
  prompt: string;
}

export interface CommonstackEchoResponse {
  content: CommonstackEchoOutput;
  model: string;
  rawContent: string;
  responseId?: string;
}

interface CommonstackEchoConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
}

let validatedConfigKey = '';
const ECHO_SYSTEM_PROMPT =
  '你是一个中文学习回声编辑。只能根据用户给出的学习线索写一条简短的回来理由。' +
  '不要输出与学习线索无关的话题，不要写摘要，不要讲解知识，只返回 JSON。';
const DEFAULT_ECHO_TEMPERATURE = 0.2;

function parseEchoTemperature(rawValue?: string): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return DEFAULT_ECHO_TEMPERATURE;
  return Math.max(0, Math.min(2, parsed));
}

function getCommonstackEchoConfig(): CommonstackEchoConfig | null {
  const apiKey = (process.env.COMMONSTACK_ECHO_API_KEY || '').trim();
  const model = (process.env.COMMONSTACK_ECHO_MODEL || '').trim();
  const baseUrl = (process.env.COMMONSTACK_ECHO_BASE_URL || 'https://api.commonstack.ai/v1')
    .trim()
    .replace(/\/$/, '');
  const temperature = parseEchoTemperature(process.env.COMMONSTACK_ECHO_TEMPERATURE);

  if (!apiKey || !model) {
    return null;
  }

  return {
    apiKey,
    baseUrl,
    model,
    temperature,
  };
}

export function isCommonstackEchoConfigured(): boolean {
  return Boolean(getCommonstackEchoConfig());
}

async function validateModelAvailability(config: CommonstackEchoConfig): Promise<void> {
  const cacheKey = `${config.baseUrl}::${config.model}`;
  if (validatedConfigKey === cacheKey) {
    return;
  }

  const response = await fetch(`${config.baseUrl}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`读取 CommonStack 模型列表失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: string }>;
  };

  const modelIds = Array.isArray(payload.data)
    ? payload.data.map((item) => String(item.id || '').trim()).filter(Boolean)
    : [];

  if (!modelIds.includes(config.model)) {
    throw new Error(`COMMONSTACK_ECHO_MODEL 未在 CommonStack 模型列表中找到：${config.model}`);
  }

  validatedConfigKey = cacheKey;
}

export async function generateCommonstackEcho(
  params: CommonstackEchoRequest
): Promise<CommonstackEchoResponse> {
  const config = getCommonstackEchoConfig();
  if (!config) {
    throw new Error('CommonStack Echo 未配置，请检查 COMMONSTACK_ECHO_API_KEY 和 COMMONSTACK_ECHO_MODEL');
  }

  await validateModelAvailability(config);

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      messages: [
        {
          role: 'system',
          content: ECHO_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: params.prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'daily_echo',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
            },
            required: ['title', 'body'],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`CommonStack Echo 调用失败（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
  }

  const payload = (await response.json()) as {
    id?: string;
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const rawContent = String(payload.choices?.[0]?.message?.content || '').trim();
  const parsed = parseJsonResponse<CommonstackEchoOutput>(rawContent);
  if (!parsed?.title || !parsed?.body) {
    throw new Error('CommonStack Echo 返回了无法解析的 JSON 内容');
  }

  return {
    content: parsed,
    model: config.model,
    rawContent,
    responseId: payload.id,
  };
}
