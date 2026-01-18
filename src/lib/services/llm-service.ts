/**
 * LLM 服务 - 真实 AI 模型调用
 * 
 * 支持模型：
 * - 通义千问 (qwen3-vl-plus, qwen3-max)
 * - Gemini (gemini-3-pro, gemini-3-flash)
 * - OpenAI (gpt-5.2, gpt-5.2-mini)
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
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
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
    case 'gemini':
      return {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
      };
    case 'openai':
      return {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: process.env.OPENAI_API_KEY || '',
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

/** 构建 OpenAI 兼容格式的消息（用于 Qwen 和 OpenAI） */
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
 */
async function callQwen(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LLMResponse> {
  const config = getApiConfig('qwen');
  
  if (!config.apiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置');
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
    throw new Error(`通义千问 API 错误: ${response.status} - ${error}`);
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
 * 调用 Gemini API
 * 支持多模态：gemini-3-pro, gemini-3-flash
 */
async function callGemini(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LLMResponse> {
  const config = getApiConfig('gemini');
  
  if (!config.apiKey) {
    throw new Error('GOOGLE_API_KEY 未配置');
  }

  // 转换消息格式为 Gemini 格式
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
      
      if (typeof m.content === 'string') {
        parts.push({ text: m.content });
      } else {
        for (const part of m.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            // 解析 base64 data URL
            const url = part.image_url.url;
            if (url.startsWith('data:')) {
              const matches = url.match(/^data:([^;]+);base64,(.+)$/);
              if (matches) {
                parts.push({
                  inlineData: {
                    mimeType: matches[1],
                    data: matches[2],
                  },
                });
              }
            } else {
              // 对于 http URL，Gemini 需要使用 fileData，这里简化处理
              parts.push({ text: `[图片: ${url}]` });
            }
          }
        }
      }
      
      return {
        role: m.role === 'assistant' ? 'model' : 'user',
        parts,
      };
    });

  // 系统消息作为 systemInstruction
  const systemMessage = messages.find(m => m.role === 'system');

  const response = await fetch(
    `${config.baseUrl}/models/${modelId}:generateContent?key=${config.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        systemInstruction: systemMessage ? {
          parts: [{ text: contentToText(systemMessage.content) }],
        } : undefined,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxTokens ?? 2000,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API 错误: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    model: modelId,
    usage: data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      totalTokens: data.usageMetadata.totalTokenCount,
    } : undefined,
  };
}

/**
 * 调用 OpenAI API
 * 支持多模态：gpt-5.2, gpt-5.2-mini
 */
async function callOpenAI(
  messages: ChatMessage[],
  modelId: string,
  options?: { temperature?: number; maxTokens?: number }
): Promise<LLMResponse> {
  const config = getApiConfig('openai');
  
  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY 未配置');
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
      max_completion_tokens: options?.maxTokens ?? 2000,  // GPT-5.2 使用 max_completion_tokens
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API 错误: ${response.status} - ${error}`);
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
    case 'gemini':
      return callGemini(messages, modelId, options);
    case 'openai':
      return callOpenAI(messages, modelId, options);
    default:
      throw new Error(`不支持的模型提供商: ${modelConfig.provider}`);
  }
}

/**
 * 流式调用 LLM (通义千问)
 */
export async function* chatStream(
  messages: ChatMessage[],
  modelId: string = DEFAULT_MODEL_ID,
  options?: { temperature?: number; maxTokens?: number }
): AsyncGenerator<string> {
  const modelConfig = getModelConfig(modelId);
  
  if (!modelConfig || modelConfig.provider !== 'qwen') {
    // 目前只支持通义千问的流式调用
    const response = await chat(messages, modelId, options);
    yield response.content;
    return;
  }

  const config = getApiConfig('qwen');
  
  if (!config.apiKey) {
    throw new Error('DASHSCOPE_API_KEY 未配置');
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
      stream: true,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`通义千问 API 错误: ${response.status} - ${error}`);
  }

  if (!response.body) {
    throw new Error('无响应体');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '));

    for (const line of lines) {
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield content;
        }
      } catch {
        // 忽略解析错误
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
