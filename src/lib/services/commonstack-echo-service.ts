import { parseJsonResponse } from '@/lib/utils';

// ── 新契约：有骨架的灵魂 ────────────────────────────────
export interface EchoHighlight {
  text: string;            // 金句 / 关键发现的文字
  timestamp?: string;      // 可选时间戳，如 "12:30"
  speaker?: string;        // 可选来源，如 "老师" / "论文"
}

export interface CommonstackEchoOutput {
  echo: string;            // 主体——同桌说的那段话（2-4 句）
  highlights?: EchoHighlight[];  // 金句 / 关键发现（0-3 条）
  takeaway?: string;       // 一句话带走——最精炼的一句
  sources?: string[];      // 关联 captureId（模型可选返回）
  title?: string;          // 可选短标签
  // 兼容旧格式
  body?: string;
  recommendations?: Array<{
    title: string;
    body: string;
  }>;
}

export interface CommonstackEchoRequest {
  prompt: string;
  systemPrompt?: string;   // 不同 kind 可以传不同 system prompt
  temperature?: number;     // 每种 kind 可以独立控温
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

// ── System Prompt：课堂回声专家 ──────────────────────────
// 设计哲学：给模型清晰的骨架，但不限死血肉。
// 骨架 = echo + highlights + takeaway 三层
// 血肉 = 模型自己决定角度：发现、联系、矛盾、金句、意外……
const ECHO_SYSTEM_PROMPT =
  '你是这个学生的同桌。你刚刚和他一起经历了这些学习内容。\n\n' +
  '现在请给他一条「课堂回声」——让他觉得「你也认真听了这节课」。\n\n' +
  '## 输出规则\n' +
  '返回 JSON，包含以下字段：\n\n' +
  '1. **echo**（必填）：你想说的话，2-4 句。像人说话，不像笔记软件。\n' +
  '   - 可以是一个发现、一个联系、一个让人震撼的引用、一个他可能忽略的矛盾\n' +
  '   - 不要总结课堂、不要罗列知识点、不要说"这节课主要讲了"\n\n' +
  '2. **highlights**（选填，0-3 条）：最值得记住的金句或关键发现\n' +
  '   - 每条包含 text（原话或提炼）\n' +
  '   - 如果有时间信息，加 timestamp（如 "12:30"）\n' +
  '   - 如果知道谁说的，加 speaker（如 "老师"、"张教授"）\n' +
  '   - 优先选老师的原话金句 > 关键概念定义 > 意外发现\n\n' +
  '3. **takeaway**（选填）：一句话带走——如果要截图发朋友圈，这一句就够了\n' +
  '   - 简短、有力、让没上这节课的人也想看\n\n' +
  '4. **sources**：关联的 captureId 数组\n\n' +
  '## 风格\n' +
  '- 像聪明的同桌分享笔记，不像AI生成报告\n' +
  '- 引用老师原话时用「」包裹\n' +
  '- 有温度但克制，有发现感但不炫技\n\n' +
  '只返回 JSON，不要 markdown，不要额外解释。';

const DEFAULT_ECHO_TEMPERATURE = 0.6;

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

  const systemPrompt = params.systemPrompt || ECHO_SYSTEM_PROMPT;
  const temperature = params.temperature ?? config.temperature;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: params.prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'echo_response',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              echo: { type: 'string' },
              highlights: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    text: { type: 'string' },
                    timestamp: { type: 'string' },
                    speaker: { type: 'string' },
                  },
                  required: ['text', 'timestamp', 'speaker'],
                },
              },
              takeaway: { type: 'string' },
              sources: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['echo', 'highlights', 'takeaway', 'sources'],
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

  // 兼容新旧两种格式
  const echoText = parsed?.echo || parsed?.body || '';
  if (!echoText) {
    throw new Error('CommonStack Echo 返回了无法解析的 JSON 内容');
  }

  const sources = Array.isArray(parsed?.sources)
    ? parsed.sources.map((s) => String(s).trim()).filter(Boolean)
    : [];

  // 新字段：highlights（金句/关键发现）
  const highlights: EchoHighlight[] = Array.isArray(parsed?.highlights)
    ? (parsed.highlights as Array<Partial<EchoHighlight>>)
        .map((item) => ({
          text: String(item?.text || '').trim(),
          timestamp: item?.timestamp ? String(item.timestamp).trim() : undefined,
          speaker: item?.speaker ? String(item.speaker).trim() : undefined,
        }))
        .filter((item) => item.text.length > 0)
        .slice(0, 3)
    : [];

  // 新字段：takeaway（一句话带走）
  const takeaway = parsed?.takeaway ? String(parsed.takeaway).trim() : undefined;

  // 旧格式兼容
  const recommendations = Array.isArray(parsed?.recommendations)
    ? parsed.recommendations
        .map((item) => ({
          title: String(item?.title || '').trim(),
          body: String(item?.body || '').trim(),
        }))
        .filter((item) => item.title && item.body)
        .slice(0, 2)
    : [];

  return {
    content: {
      echo: echoText,
      highlights,
      takeaway,
      sources,
      title: parsed?.title,
      body: echoText,
      recommendations,
    },
    model: config.model,
    rawContent,
    responseId: payload.id,
  };
}
