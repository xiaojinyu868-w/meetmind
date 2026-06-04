/**
 * LLM 服务 - 真实 AI 模型调用
 * 
 * 支持模型：
 * - 阶跃星辰 StepFun (step-3.7-flash)
 * - DeepSeek (DeepSeek-V4-Flash, DeepSeek-V4-Pro)
 * - 通义千问 (Qwen3.6-Plus-A, Qwen3.5-397B-A17B-Pro, Qwen3-VL-235B-A22B-Instruct-A, Qwen3-Max-A, qwen3.5-omni-plus)
 * - 火山方舟 (VOLCENGINE_ARK_MODEL)
 * - 中转站聚合模型 (RELAY_MODEL，例如 gemini-3-pro-image-preview)
 */

import { LLMConfig, type ModelConfig, type ModelProvider } from '@/lib/config';
import { createLogger } from '@/lib/logger';
const log = createLogger('llm');


// 重导出类型和配置
export type { ModelConfig, ModelProvider };

// 从统一配置获取模型列表
export const AVAILABLE_MODELS: ModelConfig[] = LLMConfig.models;

// 获取默认模型ID（真相源：app.config 的 ModelDefaults，环境变量驱动）
export const DEFAULT_MODEL_ID = LLMConfig.defaultModel;
export const DEFAULT_WORKSHOP_MODEL_ID = LLMConfig.workshopModel;

/**
 * 把请求的 modelId 解析为「一定可用」的 modelConfig。
 *
 * 历史 localStorage / 旧设置 / 上游传入的过期 model 名（如 qwen3.6-plus、没 key 的
 * DeepSeek-V4-Flash）不再让 chat() throw `未知模型` 把整条链路打成 500，而是回落到
 * 当前默认模型并记一条 warn。这是兜底，不是主路径——前端应通过 /api/llm/models 取可用列表。
 */
function resolveModelConfigOrDefault(modelId: string): ModelConfig {
  const exact = getModelConfig(modelId);
  if (exact) return exact;
  const fallback = getModelConfig(DEFAULT_MODEL_ID) || AVAILABLE_MODELS[0];
  log.warn(`[LLM] 未知模型 "${modelId}"，回落到默认模型 "${fallback?.id}"`);
  return fallback;
}

function resolveLlmHttpTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.LLM_HTTP_TIMEOUT_MS || '', 10);
  if (!Number.isFinite(parsed)) return 180_000;
  return Math.min(10 * 60_000, Math.max(30_000, parsed));
}

const LLM_HTTP_TIMEOUT_MS = resolveLlmHttpTimeoutMs();

// ==================== 消息类型定义 ====================

/** 多模态内容项 - 文本 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

/** 多模态内容项 - 图片 */
export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;  // base64 data URL 或 http(s) URL
  };
}

/** 多模态内容项 - 音频 */
export interface AudioContentPart {
  type: 'input_audio';
  input_audio: {
    data: string; // http(s) URL 或 base64 数据
    format?: string;
  };
}

/** 多模态内容 */
export type MultimodalContent = TextContentPart | ImageContentPart | AudioContentPart;

/** 聊天消息 - 支持纯文本和多模态 */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | MultimodalContent[];  // 纯文本或多模态内容数组
}

/** LLM 响应 */
export interface LLMResponse {
  content: string;
  model: string;
  thinkingContent?: string;  // 思考模式的思考过程
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** 流式输出的 chunk 类型 */
export interface StreamChunk {
  type: 'thinking' | 'content';
  content: string;
}

// ==================== 辅助函数 ====================

/** 获取模型配置 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

/** 检查模型是否支持多模态 */
export function isMultimodalModel(modelId: string): boolean {
  const config = getModelConfig(modelId);
  return config?.supportsMultimodal ?? false;
}

/** DeepSeek 官方域名只接受小写模型名；其余域名沿用原始 modelId。 */
function resolveDeepSeekApiModelName(baseUrl: string, modelId: string): string {
  return /api\.deepseek\.com/i.test(baseUrl) ? modelId.toLowerCase() : modelId;
}

/** 获取 API 配置 */
function getApiConfig(provider: ModelProvider) {
  switch (provider) {
    case 'stepfun':
      return {
        baseUrl: process.env.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1',
        apiKey: process.env.STEPFUN_API_KEY || '',
      };
    case 'deepseek':
      return {
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        apiKey: process.env.DEEPSEEK_API_KEY || '',
      };
    case 'qwen':
      return {
        baseUrl: process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: process.env.DASHSCOPE_API_KEY || '',
      };
    case 'volcengine':
      return {
        baseUrl: process.env.VOLCENGINE_ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: process.env.VOLCENGINE_ARK_API_KEY || '',
      };
    case 'relay':
      return {
        baseUrl: process.env.RELAY_BASE_URL || '',
        apiKey: process.env.RELAY_API_KEY || '',
      };
  }
}

/** 将消息内容转换为纯文本（用于不支持多模态的模型） */
function contentToText(content: string | MultimodalContent[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part): part is TextContentPart => part.type === 'text')
    .map(part => part.text)
    .join('\n');
}

/** 构建 OpenAI 兼容格式的消息（用于 Qwen / 火山 / 中转站） */
function buildOpenAIMessages(messages: ChatMessage[], supportsMultimodal: boolean) {
  return messages.map(m => ({
    role: m.role,
    content: supportsMultimodal ? m.content : contentToText(m.content),
  }));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = LLM_HTTP_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`模型请求超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==================== API 调用函数 ====================

/**
 * 调用阶跃星辰 StepFun API（OpenAI 兼容格式）
 * 文档：https://platform.stepfun.com/docs/zh/quickstart/overview
 */
async function callStepFun(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }
): Promise<LLMResponse> {
  const config = getApiConfig('stepfun');

  if (!config.apiKey) {
    throw new Error('STEPFUN_API_KEY 未配置');
  }

  const supportsMultimodal = isMultimodalModel(modelId);
  const formattedMessages = buildOpenAIMessages(messages, supportsMultimodal);

  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages: formattedMessages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? 2000,
  };

  if (options?.responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }

  const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`StepFun API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason && finishReason !== 'stop') {
    log.warn(`[LLM] finish_reason=${finishReason}, model=${modelId}, requested max_tokens=${requestBody.max_tokens}`);
  }

  return {
    content: data.choices?.[0]?.message?.content || '',
    model: modelId,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * 调用 DeepSeek API (OpenAI 兼容格式)
 */
async function callDeepSeek(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }
): Promise<LLMResponse> {
  const config = getApiConfig('deepseek');
  const modelConfig = getModelConfig(modelId);

  if (!config.apiKey) {
    throw new Error('DEEPSEEK_API_KEY 未配置');
  }

  const enableThinking = modelConfig?.enableThinking ?? false;
  const requestBody: Record<string, unknown> = {
    model: resolveDeepSeekApiModelName(config.baseUrl, modelId),
    messages: buildOpenAIMessages(messages, false),
    max_tokens: options?.maxTokens ?? (enableThinking ? 32768 : 2000),
  };

  if (options?.temperature !== undefined) {
    requestBody.temperature = options.temperature;
  }

  if (options?.responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }

  if (enableThinking) {
    requestBody.thinking = { type: 'enabled' };
    requestBody.reasoning_effort = 'high';
  }

  const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`DeepSeek API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason && finishReason !== 'stop') {
    log.warn(`[LLM] finish_reason=${finishReason}, model=${modelId}, requested max_tokens=${requestBody.max_tokens}`);
  }

  return {
    content: data.choices?.[0]?.message?.content || '',
    model: modelId,
    thinkingContent: data.choices?.[0]?.message?.reasoning_content,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * 调用通义千问 API (OpenAI 兼容格式)
 * 支持多模态：qwen3-vl-plus-2025-12-19
 * 支持思考模式：qwen3.7-plus, qwen3-max-2026-01-23
 */
async function callQwen(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }
): Promise<LLMResponse> {
  const config = getApiConfig('qwen');
  const modelConfig = getModelConfig(modelId);
  
  if (!config.apiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置');
  }

  const supportsMultimodal = isMultimodalModel(modelId);
  const enableThinking = modelConfig?.enableThinking ?? false;
  const formattedMessages = buildOpenAIMessages(messages, supportsMultimodal);

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages: formattedMessages,
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.maxTokens ?? (enableThinking ? 32768 : 2000),
  };

  // JSON 模式：让 API 保证输出合法 JSON
  if (options?.responseFormat === 'json_object') {
    requestBody.response_format = { type: 'json_object' };
  }

  // Qwen 默认思考行为会影响首包时延，这里显式声明开关，避免服务端默认值漂移。
  requestBody.enable_thinking = enableThinking;

  // 思考模式配置
  if (enableThinking) {
    // 启用思考模式
    requestBody.extra_body = { enable_thinking: true };
    // 仅 qwen3-max 支持内置工具（联网搜索、网页信息提取、代码解释器）
    if (modelConfig?.supportsBuiltinTools) {
      requestBody.tools = [
        { type: 'web_search' },
        { type: 'web_extractor' },
        { type: 'code_interpreter' }
      ];
      requestBody.search_strategy = 'agent_max';
    }
  }

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`通义千问 API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();

  const finishReason = data.choices?.[0]?.finish_reason;
  if (finishReason && finishReason !== 'stop') {
    log.warn(`[LLM] finish_reason=${finishReason}, model=${modelId}, requested max_tokens=${requestBody.max_tokens}`);
  }
  
  // 思考模式可能返回 reasoning_content，需要处理
  const responseContent = data.choices[0]?.message?.content || '';
  const thinkingContent = data.choices[0]?.message?.reasoning_content;
  
  // 如果有思考内容，可以记录日志
  if (thinkingContent) {
  }
  
  return {
    content: responseContent,
    model: modelId,
    thinkingContent,  // 返回思考内容
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * 调用中转站 API（OpenAI 兼容）
 */
async function callRelay(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LLMResponse> {
  const config = getApiConfig('relay');

  if (!config.apiKey) {
    throw new Error('RELAY_API_KEY 未配置');
  }

  if (!config.baseUrl) {
    throw new Error('RELAY_BASE_URL 未配置');
  }

  const supportsMultimodal = isMultimodalModel(modelId);
  const formattedMessages = buildOpenAIMessages(messages, supportsMultimodal);

  const response = await fetchWithTimeout(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`中转站 API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  return {
    content: data.choices[0]?.message?.content || '',
    model: modelId,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

/**
 * 调用火山方舟（OpenAI 兼容接口）
 */
async function callVolcengine(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LLMResponse> {
  const config = getApiConfig('volcengine');

  if (!config.apiKey) {
    throw new Error('VOLCENGINE_ARK_API_KEY 未配置');
  }

  const supportsMultimodal = isMultimodalModel(modelId);
  const formattedMessages = buildOpenAIMessages(messages, supportsMultimodal);

  const response = await fetchWithTimeout(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`火山方舟 API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();

  return {
    content: data.choices?.[0]?.message?.content || '',
    model: modelId,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      totalTokens: data.usage.total_tokens,
    } : undefined,
  };
}

// ==================== 统一调用接口 ====================

/**
 * 统一 LLM 调用接口
 * 自动根据模型类型处理多模态消息
 */
export async function chat(
  messages: ChatMessage[],
  modelId: string = DEFAULT_MODEL_ID,
  options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' | 'text' }
): Promise<LLMResponse> {
  const modelConfig = resolveModelConfigOrDefault(modelId);
  const resolvedId = modelConfig.id;

  switch (modelConfig.provider) {
    case 'stepfun':
      return callStepFun(messages, resolvedId, options);
    case 'deepseek':
      return callDeepSeek(messages, resolvedId, options);
    case 'qwen':
      return callQwen(messages, resolvedId, options);
    case 'volcengine':
      return callVolcengine(messages, resolvedId, options);
    case 'relay':
      return callRelay(messages, resolvedId, options);
    default:
      throw new Error(`不支持的模型提供商: ${modelConfig.provider}`);
  }
}

/**
 * 流式调用 LLM
 * 支持：StepFun / DeepSeek / 通义千问 / 火山方舟 / 中转站（OpenAI 兼容）
 * 支持思考模式：qwen3 会输出 reasoning_content
 *
 * 默认开启 word-level smoothing：把 LLM 一次塞过来的大 chunk 打散成"按词"
 * 平滑输出，前端视觉上字符连续刷出，不再"一坨一坨"。chunk 之间的 sleep 很
 * 短（10ms），不会显著拖慢总时长，但能显著改善"丝滑感"。
 *
 * 与 AI SDK v6 `streamText({ experimental_transform: smoothStream(...) })` 同款
 * 思路；本仓库的 `chatStream` 走自定义 SSE 协议（type: 'content' | 'thinking'），
 * 没法直接套 smoothStream Transform，所以自己实现一个最小版。
 *
 * 如果调用方需要"一次拿到全部 token、不要平滑"（比如累加成完整字符串再 JSON parse），
 * 传 `options.smooth: 'off'` 即可关闭。
 */
export async function* chatStream(
  messages: ChatMessage[],
  modelId: string = DEFAULT_MODEL_ID,
  options?: { temperature?: number; maxTokens?: number; smooth?: 'word' | 'off' }
): AsyncGenerator<StreamChunk> {
  const smoothMode = options?.smooth ?? 'word';
  const raw = chatStreamRaw(messages, modelId, options);
  if (smoothMode === 'off') {
    yield* raw;
    return;
  }
  yield* smoothChunks(raw);
}

/**
 * 把 LLM 大 chunk 打散成"按词"流出，词与词之间 sleep ~10ms。
 * - 中文：以单字为词单位（每个汉字逐个露出）
 * - 英文/数字：以连续字母数字段为词单位
 * - 标点 / 空格：作为独立的小段透传
 */
async function* smoothChunks(
  source: AsyncGenerator<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  const DELAY_MS = 10;
  // /^.../ 用 regex 拿到 buf 开头的一个"完整词"，剩下留作下次（防止英文词被截半）
  const WORD_REGEX = /^([\p{Script=Han}])|^([A-Za-z0-9_]+)|^(\s+)|^([^\p{L}\p{N}\s])/u;
  let buf = '';
  let lastFlush = 0;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for await (const chunk of source) {
    if (chunk.type !== 'content') {
      // thinking 帧直接透传，不平滑
      yield chunk;
      continue;
    }
    buf += chunk.content;
    while (buf.length > 0) {
      const m = WORD_REGEX.exec(buf);
      if (!m) {
        // 没匹配（极少发生，比如出现编码异常字符），就一次性 flush 剩余
        yield { type: 'content', content: buf };
        buf = '';
        break;
      }
      const piece = m[0];
      // 留一点尾巴：英文连续字母可能还没结束（buf 末尾是字母时），等下一个 chunk 拼上再 flush
      if (
        buf.length === piece.length &&
        /[A-Za-z0-9_]$/.test(piece) &&
        !/^\s/.test(piece)
      ) {
        // 整个 buf 都是字母收尾——可能词没完，等下一 chunk
        break;
      }
      buf = buf.slice(piece.length);
      yield { type: 'content', content: piece };
      const now = Date.now();
      if (now - lastFlush >= DELAY_MS) {
        await sleep(DELAY_MS);
        lastFlush = Date.now();
      }
    }
  }
  // 收尾 flush
  if (buf) yield { type: 'content', content: buf };
}

async function* chatStreamRaw(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<StreamChunk> {
  const modelConfig = resolveModelConfigOrDefault(modelId);
  const resolvedId = modelConfig.id;

  // DeepSeek / 通义千问 / 火山方舟 / 中转站都支持 OpenAI 兼容的流式 API
  const config = getApiConfig(modelConfig.provider);
  
  if (!config.apiKey) {
    throw new Error(
      `${
        modelConfig.provider === 'stepfun'
          ? 'STEPFUN_API_KEY'
          : modelConfig.provider === 'deepseek'
            ? 'DEEPSEEK_API_KEY'
            : modelConfig.provider === 'qwen'
              ? 'DASHSCOPE_API_KEY'
              : modelConfig.provider === 'volcengine'
                ? 'VOLCENGINE_ARK_API_KEY'
                : 'RELAY_API_KEY'
      } 未配置`
    );
  }

  if (!config.baseUrl) {
    throw new Error(`${modelConfig.provider === 'relay' ? 'RELAY_BASE_URL' : '模型 Base URL'} 未配置`);
  }

  const supportsMultimodal = isMultimodalModel(resolvedId);
  const enableThinking = modelConfig.enableThinking ?? false;
  const formattedMessages = buildOpenAIMessages(messages, supportsMultimodal);

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model: modelConfig.provider === 'deepseek'
      ? resolveDeepSeekApiModelName(config.baseUrl, resolvedId)
      : resolvedId,
    messages: formattedMessages,
    temperature: options?.temperature ?? 0.7,
    stream: true,
  };

  requestBody.max_tokens = options?.maxTokens ?? (enableThinking ? 32768 : 2000);

  if (modelConfig.provider === 'qwen') {
    // 显式传递开关，避免服务端默认开启思考导致首包变慢。
    requestBody.enable_thinking = enableThinking;
  }

  if (enableThinking && modelConfig.provider === 'deepseek') {
    requestBody.thinking = { type: 'enabled' };
    requestBody.reasoning_effort = 'high';
  }

  // 思考模式配置
  if (enableThinking && modelConfig.provider === 'qwen') {
    // 仅 qwen3-max 支持内置工具
    if (modelConfig.supportsBuiltinTools) {
      requestBody.tools = [
        { type: 'web_search' },
        { type: 'web_extractor' },
        { type: 'code_interpreter' }
      ];
      requestBody.search_strategy = 'agent_max';
    }
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`${modelConfig.name} API 错误: ${response.status} - ${error}`);
  }

  if (!response.body) {
    throw new Error('无响应体');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 保留不完整的行

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta;
        
        // 处理思考内容（qwen3 思考模式使用 reasoning_content 字段）
        if (delta?.reasoning_content) {
          yield { type: 'thinking', content: delta.reasoning_content };
        }
        
        // 处理正常内容
        if (delta?.content) {
          yield { type: 'content', content: delta.content };
        }
      } catch {
        // 忽略解析错误（不完整的JSON）
      }
    }
  }
}

// ==================== 导出服务对象 ====================

export const llmService = {
  chat,
  chatStream,
  getAvailableModels: () => AVAILABLE_MODELS,
  getModelConfig,
  isMultimodalModel,
  DEFAULT_MODEL_ID,
};
