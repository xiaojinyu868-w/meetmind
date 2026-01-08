/**
 * LLM 服务 - 真实 AI 模型调用
 * 
 * 支持模型：
 * - 通义千问 (qwen-turbo, qwen-plus, qwen-max, qwen3-max)
 * - Gemini (gemini-2.0-flash, gemini-1.5-pro)
 * - OpenAI (gpt-4o, gpt-4o-mini)
 */

export type ModelProvider = 'qwen' | 'gemini' | 'openai';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  maxTokens: number;
  recommended?: boolean;
}

// 可用模型列表
export const AVAILABLE_MODELS: ModelConfig[] = [
  // 通义千问系列（推荐）
  {
    id: 'qwen3-max',
    name: '通义千问 3 Max',
    provider: 'qwen',
    description: '最强推理能力，适合复杂教学场景',
    maxTokens: 8192,
    recommended: true,
  },
  {
    id: 'qwen-max',
    name: '通义千问 Max',
    provider: 'qwen',
    description: '高性能，适合深度解释',
    maxTokens: 8192,
  },
  {
    id: 'qwen-plus',
    name: '通义千问 Plus',
    provider: 'qwen',
    description: '均衡性能，日常使用',
    maxTokens: 8192,
  },
  {
    id: 'qwen-turbo',
    name: '通义千问 Turbo',
    provider: 'qwen',
    description: '快速响应，适合简单问答',
    maxTokens: 8192,
  },
  // Gemini 系列
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    description: '快速响应，多模态能力',
    maxTokens: 8192,
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'gemini',
    description: '长上下文，深度理解',
    maxTokens: 8192,
  },
  // OpenAI 系列
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: '最新 GPT-4，全能型',
    maxTokens: 4096,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    description: '轻量快速，性价比高',
    maxTokens: 4096,
  },
];

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// 获取模型配置
function getModelConfig(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

// 获取 API 配置
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

/**
 * 调用通义千问 API (OpenAI 兼容格式)
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
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
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

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
          parts: [{ text: systemMessage.content }],
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 2000,
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

/**
 * 统一 LLM 调用接口
 */
export async function chat(
  messages: ChatMessage[],
  modelId: string = 'qwen3-max',
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
  modelId: string = 'qwen3-max',
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

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
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

// 导出服务对象
export const llmService = {
  chat,
  chatStream,
  getAvailableModels: () => AVAILABLE_MODELS,
  getModelConfig,
};
