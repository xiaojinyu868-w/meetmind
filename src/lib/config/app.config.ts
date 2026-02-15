/**
 * 应用统一配置
 * 
 * 集中管理所有配置常量，支持环境变量覆盖
 * 消除硬编码，提升可维护性
 */

// ==================== 类型定义 ====================

export type ModelProvider = 'qwen' | 'volcengine' | 'relay';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  maxTokens: number;
  recommended?: boolean;
  supportsMultimodal?: boolean;
  enableThinking?: boolean;  // 启用思考模式（qwen3-max-2026-01-23）
}

function hasValue(value: string | undefined): boolean {
  return Boolean((value || '').trim());
}

const hasQwenKey = hasValue(process.env.DASHSCOPE_API_KEY);
const hasVolcArkKey = hasValue(process.env.VOLCENGINE_ARK_API_KEY);
const volcArkModelId = (process.env.VOLCENGINE_ARK_MODEL || '').trim();
const hasRelayKey = hasValue(process.env.RELAY_API_KEY);
const relayModelId = (process.env.RELAY_MODEL || 'gemini-3-pro-image-preview').trim();

const qwenModels: ModelConfig[] = [
  {
    id: 'qwen3-vl-plus-2025-12-19',
    name: '通义千问 3 VL',
    provider: 'qwen',
    description: '多模态视觉模型，支持图片理解',
    maxTokens: 8192,
    recommended: true,
    supportsMultimodal: true,
  },
  {
    id: 'qwen3-max-2026-01-23',
    name: '通义千问 3 Max',
    provider: 'qwen',
    description: '思考模式，支持联网搜索和代码解释器，262K上下文',
    maxTokens: 32768,
    supportsMultimodal: false,
    enableThinking: true,
  },
];

const volcModels: ModelConfig[] = hasVolcArkKey && hasValue(volcArkModelId)
  ? [
      {
        id: volcArkModelId,
        name: '火山方舟模型',
        provider: 'volcengine',
        description: '火山引擎 Ark（OpenAI 兼容接口）',
        maxTokens: 8192,
        supportsMultimodal: true,
      },
    ]
  : [];

const relayModels: ModelConfig[] = hasRelayKey && hasValue(relayModelId)
  ? [
      {
        id: relayModelId,
        name: '中转站模型',
        provider: 'relay',
        description: '中转站聚合模型（可挂载 Gemini 图像模型）',
        maxTokens: 8192,
        supportsMultimodal: true,
      },
    ]
  : [];

const enabledModels: ModelConfig[] = [
  ...(hasQwenKey ? qwenModels : []),
  ...volcModels,
  ...relayModels,
];

const resolvedModels: ModelConfig[] = enabledModels.length > 0 ? enabledModels : qwenModels;
const envDefaultModel = process.env.LLM_MODEL || '';
const resolvedDefaultModel =
  (envDefaultModel && resolvedModels.some((model) => model.id === envDefaultModel)
    ? envDefaultModel
    : undefined) ||
  resolvedModels.find((model) => model.id === 'qwen3-vl-plus-2025-12-19')?.id ||
  resolvedModels.find((model) => model.supportsMultimodal)?.id ||
  resolvedModels[0]?.id ||
  'qwen3-vl-plus-2025-12-19';
const resolvedDefaultVisionModel =
  resolvedModels.find((model) => model.supportsMultimodal)?.id ||
  resolvedModels[0]?.id ||
  'qwen3-vl-plus-2025-12-19';

// ==================== LLM 配置 ====================

export const LLMConfig = {
  // 默认模型
  defaultModel: resolvedDefaultModel,
  defaultVisionModel: resolvedDefaultVisionModel,
  
  // API 配置
  qwen: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  },
  volcengine: {
    apiKey: process.env.VOLCENGINE_ARK_API_KEY || '',
    baseUrl: process.env.VOLCENGINE_ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
  },
  relay: {
    apiKey: process.env.RELAY_API_KEY || '',
    baseUrl: process.env.RELAY_BASE_URL || '',
  },
  
  // 可用模型列表（按已配置密钥自动启用）
  models: resolvedModels as ModelConfig[],
  
  // 获取模型配置
  getModel(modelId: string): ModelConfig | undefined {
    return this.models.find(m => m.id === modelId);
  },
  
  // 获取支持多模态的模型
  getMultimodalModels(): ModelConfig[] {
    return this.models.filter(m => m.supportsMultimodal);
  },
} as const;

// ==================== 认证配置 ====================

export const AuthConfig = {
  // JWT 配置
  jwt: {
    secret: process.env.JWT_SECRET || '',
    expiresIn: parseInt(process.env.JWT_EXPIRES_IN || '7200', 10), // 2小时
    refreshExpiresIn: parseInt(process.env.JWT_REFRESH_EXPIRES_IN || '604800', 10), // 7天
  },
  
  // 密码策略
  password: {
    saltRounds: 16,
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
  },
  
  // 登录限流
  rateLimit: {
    maxAttempts: 5,
    lockDurationMs: 15 * 60 * 1000, // 15分钟
    attemptWindowMs: 10 * 60 * 1000, // 10分钟
  },
  
  // CSRF Token
  csrf: {
    tokenExpiresMs: 60 * 60 * 1000, // 1小时
  },
  
  // 管理员账户（仅开发环境，生产环境必须通过环境变量配置）
  admin: {
    username: process.env.ADMIN_USERNAME || '',
    password: process.env.ADMIN_PASSWORD || '',
  },
  
  // 检查是否配置了必要的认证信息
  isConfigured(): boolean {
    return !!this.jwt.secret && this.jwt.secret !== 'meetmind-jwt-secret-change-in-production';
  },
} as const;

// ==================== ASR 配置 ====================

export const ASRConfig = {
  // 通义千问 ASR
  qwen: {
    model: process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen3-asr-flash-realtime',
    sampleRate: parseInt(process.env.DASHSCOPE_ASR_WS_SR || '16000', 10),
    chunkDurationSec: 180, // 3分钟分块
  },
  
  // 转录分块配置
  chunk: {
    durationMs: 5 * 60 * 1000, // 5分钟
    overlapMs: 45 * 1000, // 45秒重叠
  },
} as const;

// ==================== 功能配置 ====================

export const FeatureConfig = {
  // 精选片段
  highlights: {
    defaultModel: LLMConfig.defaultModel,
    fastModel: LLMConfig.defaultModel,
    maxTopics: 8,
    minTopics: 5,
    chunkMaxCandidates: 2,
  },
  
  // 摘要生成
  summary: {
    defaultModel: LLMConfig.defaultModel,
    minTakeaways: 4,
    maxTakeaways: 6,
  },
  
  // 家长端
  parent: {
    confusionEstimateMinutes: 7, // 每个困惑点预估时间
  },
  
  // AI 家教
  tutor: {
    contextBeforeMs: 60000, // 困惑点前1分钟
    contextAfterMs: 30000, // 困惑点后30秒
  },
  
  // 笔记本服务
  notebook: {
    apiUrl: process.env.NEXT_PUBLIC_NOTEBOOK_API || 'http://localhost:5055',
    enabled: process.env.ENABLE_NOTEBOOK === 'true',
  },
} as const;

// ==================== UI 配置 ====================

export const UIConfig = {
  // 默认标题（不再使用硬编码的课程信息）
  defaultLessonTitle: '课堂录音',
  defaultReviewTitle: '课堂回顾',
  defaultSubject: '课堂', // 默认学科名称
  defaultTeacher: '', // 默认教师名称
  
  // 分页配置
  pagination: {
    defaultPageSize: 20,
    maxPageSize: 100,
  },
  
  // 动画配置
  animation: {
    durationFast: 150,
    durationNormal: 300,
    durationSlow: 500,
  },
} as const;

// ==================== 开发配置 ====================

export const DevConfig = {
  // 是否为开发环境
  isDev: process.env.NODE_ENV === 'development',
  
  // 是否启用调试日志
  enableDebugLog: process.env.DEBUG === 'true',
  
  // 演示模式
  demoMode: process.env.DEMO_MODE === 'true',
} as const;

// ==================== 统一导出 ====================

export const AppConfig = {
  llm: LLMConfig,
  auth: AuthConfig,
  asr: ASRConfig,
  feature: FeatureConfig,
  ui: UIConfig,
  dev: DevConfig,
} as const;

export default AppConfig;
