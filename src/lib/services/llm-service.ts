/**
 * LLM 服务 - 真实 AI 模型调用
 * 
 * 支持模型：
 * - 通义千问 (qwen3-vl-plus, qwen3-max-2026-01-23)
 * - 火山方舟 (VOLCENGINE_ARK_MODEL)
 * - 中转站聚合模型 (RELAY_MODEL，例如 gemini-3-pro-image-preview)
 */

import { LLMConfig, type ModelConfig, type ModelProvider } from '@/lib/config';

// 重导出类型和配置
export type { ModelConfig, ModelProvider };

// 从统一配置获取模型列表
export const AVAILABLE_MODELS: ModelConfig[] = LLMConfig.models;

// 获取默认模型ID
export const DEFAULT_MODEL_ID = LLMConfig.defaultVisionModel;

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

/** 多模态内容 */
export type MultimodalContent = TextContentPart | ImageContentPart;

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

/** 获取 API 配置 */
function getApiConfig(provider: ModelProvider) {
  switch (provider) {
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

// ==================== API 调用函数 ====================

/**
 * 调用通义千问 API (OpenAI 兼容格式)
 * 支持多模态：qwen3-vl-plus-2025-12-19
 * 支持思考模式：qwen3-max-2026-01-23
 */
async function callQwen(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
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

  // qwen3-max-2026-01-23 思考模式特殊配置
  if (enableThinking) {
    // 启用思考模式
    requestBody.extra_body = { enable_thinking: true };
    // 添加内置工具（联网搜索、网页信息提取、代码解释器）
    requestBody.tools = [
      { type: 'web_search' },
      { type: 'web_extractor' },
      { type: 'code_interpreter' }
    ];
    // 使用 agent_max 搜索策略（最佳效果）
    requestBody.search_strategy = 'agent_max';
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
  
  // 思考模式可能返回 reasoning_content，需要处理
  const responseContent = data.choices[0]?.message?.content || '';
  const thinkingContent = data.choices[0]?.message?.reasoning_content;
  
  // 如果有思考内容，可以记录日志
  if (thinkingContent) {
    console.log('[LLM] Thinking content:', thinkingContent.substring(0, 200) + '...');
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

  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
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
  options?: { temperature?: number; maxTokens?: number }
): Promise<LLMResponse> {
  const modelConfig = getModelConfig(modelId);
  
  if (!modelConfig) {
    throw new Error(`未知模型: ${modelId}`);
  }

  switch (modelConfig.provider) {
    case 'qwen':
      return callQwen(messages, modelId, options);
    case 'volcengine':
      return callVolcengine(messages, modelId, options);
    case 'relay':
      return callRelay(messages, modelId, options);
    default:
      throw new Error(`不支持的模型提供商: ${modelConfig.provider}`);
  }
}

/**
 * 流式调用 LLM
 * 支持：通义千问、火山方舟、中转站（OpenAI 兼容）
 * 支持思考模式：qwen3 会输出 reasoning_content
 */
export async function* chatStream(
  messages: ChatMessage[],
  modelId: string = DEFAULT_MODEL_ID,
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<StreamChunk> {
  const modelConfig = getModelConfig(modelId);
  
  if (!modelConfig) {
    throw new Error(`未知模型: ${modelId}`);
  }

  // 通义千问 / 火山方舟 / 中转站都支持 OpenAI 兼容的流式 API
  const config = modelConfig.provider === 'qwen'
    ? getApiConfig('qwen')
    : modelConfig.provider === 'volcengine'
      ? getApiConfig('volcengine')
      : getApiConfig('relay');
  
  if (!config.apiKey) {
    throw new Error(
      `${
        modelConfig.provider === 'qwen'
          ? 'DASHSCOPE_API_KEY'
          : modelConfig.provider === 'volcengine'
            ? 'VOLCENGINE_ARK_API_KEY'
            : 'RELAY_API_KEY'
      } 未配置`
    );
  }

  if (!config.baseUrl) {
    throw new Error('RELAY_BASE_URL 未配置');
  }

  const supportsMultimodal = isMultimodalModel(modelId);
  const enableThinking = modelConfig.enableThinking ?? false;
  const formattedMessages = buildOpenAIMessages(messages, supportsMultimodal);

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model: modelId,
    messages: formattedMessages,
    temperature: options?.temperature ?? 0.7,
    stream: true,
  };

  requestBody.max_tokens = options?.maxTokens ?? (enableThinking ? 32768 : 2000);

  // qwen3-max-2026-01-23 思考模式特殊配置
  if (enableThinking && modelConfig.provider === 'qwen') {
    // enable_thinking 需要放在请求体根级别
    requestBody.enable_thinking = true;
    requestBody.tools = [
      { type: 'web_search' },
      { type: 'web_extractor' },
      { type: 'code_interpreter' }
    ];
    requestBody.search_strategy = 'agent_max';
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
