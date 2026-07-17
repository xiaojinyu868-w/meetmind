/**
 * 应用统一配置
 * 
 * 集中管理所有配置常量，支持环境变量覆盖
 * 消除硬编码，提升可维护性
 */

// ==================== 类型定义 ====================

export type ModelProvider = 'stepfun' | 'deepseek' | 'qwen' | 'volcengine' | 'relay';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  description: string;
  maxTokens: number;
  recommended?: boolean;
  supportsMultimodal?: boolean;
  supportsAudioInput?: boolean;
  enableThinking?: boolean;  // 启用思考模式
  supportsBuiltinTools?: boolean;  // 支持内置工具（web_search/code_interpreter，仅 qwen3-max）
  requiresStreaming?: boolean;
}

function hasValue(value: string | undefined): boolean {
  return Boolean((value || '').trim());
}

const hasStepFunKey = hasValue(process.env.STEPFUN_API_KEY);
const hasDeepSeekKey = hasValue(process.env.DEEPSEEK_API_KEY);
const hasQwenKey = hasValue(process.env.DASHSCOPE_API_KEY);
const hasVolcArkKey = hasValue(process.env.VOLCENGINE_ARK_API_KEY);
const volcArkModelId = (process.env.VOLCENGINE_ARK_MODEL || '').trim();
const hasRelayKey = hasValue(process.env.RELAY_API_KEY);
const relayModelId = (process.env.RELAY_MODEL || 'gemini-3-pro-image-preview').trim();

const stepFunModels: ModelConfig[] = [
  {
    id: 'step-3.7-flash',
    name: '阶跃星辰 Step 3.7 Flash',
    provider: 'stepfun',
    description: '阶跃星辰 Step 3.7 Flash，OpenAI 兼容低延迟模型，MeetMind 当前默认 AI（同桌、复习、学习应用）',
    maxTokens: 8192,
    recommended: true,
    supportsMultimodal: false,
    enableThinking: false,
  },
];

const deepseekModels: ModelConfig[] = [
  {
    id: 'DeepSeek-V4-Flash',
    name: 'DeepSeek V4 Flash',
    provider: 'deepseek',
    description: 'DeepSeek V4 低延迟模型，适合课堂同桌、复习问答和轻量学习应用',
    maxTokens: 8192,
    supportsMultimodal: false,
    enableThinking: false,
  },
  {
    id: 'DeepSeek-V4-Pro',
    name: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    description: 'DeepSeek V4 深度能力模型，适合复杂解释、长上下文整理和结构化学习产物',
    maxTokens: 32768,
    supportsMultimodal: false,
    enableThinking: true,
    recommended: true,
  },
];

const qwenModels: ModelConfig[] = [
  {
    id: 'qwen3.6-flash',
    name: '通义千问 3.6 Flash',
    provider: 'qwen',
    description: '阿里云百炼低延迟多模态模型；用于 Ask MeetMind 的轻量直问，复杂学习仍交给 Plus。',
    maxTokens: 8192,
    supportsMultimodal: true,
    enableThinking: false,
    supportsBuiltinTools: true,
  },
  {
    id: 'qwen3.7-plus',
    name: '通义千问 3.7 Plus',
    provider: 'qwen',
    description: '阿里云百炼 qwen3.7-plus，主对话模型（透传 enable_thinking=false 关闭推理，速度对齐普通 Plus；启用前请先在百炼控制台开通）。支持图片输入。',
    maxTokens: 8192,
    // M14.5: qwen3.7-plus 在百炼是多模态模型（OpenAI 兼容接口接受 image_url 内容）
    // 之前误标 false 导致 /api/sources/ingest-image 报"当前没有可用的多模态模型"
    supportsMultimodal: true,
    enableThinking: false,
    recommended: true,
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
  ...(hasStepFunKey ? stepFunModels : []),
  ...(hasDeepSeekKey ? deepseekModels : []),
  ...(hasQwenKey ? qwenModels : []),
  ...volcModels,
  ...relayModels,
];

const resolvedModels: ModelConfig[] = enabledModels.length > 0 ? enabledModels : stepFunModels;

/**
 * 单一真相源：从「已启用模型」里挑一个可用 id。
 *
 * 优先级：环境变量声明（且确实可用）→ recommended 模型 → 第一个可用模型。
 * 任何用途的默认模型都必须经过这里，保证返回的 id 一定在 resolvedModels 里——
 * 这是消除 "未知模型: xxx" / fallback 空壳的根本：默认值永远落在可用集合内。
 */
function pickAvailableModelId(
  preferredEnvId: string | undefined,
  predicate?: (model: ModelConfig) => boolean,
): string {
  const envId = (preferredEnvId || '').trim();
  if (envId && resolvedModels.some((model) => model.id === envId)) return envId;
  if (predicate) {
    const byPredicate = resolvedModels.find(predicate)?.id;
    if (byPredicate) return byPredicate;
  }
  return (
    resolvedModels.find((model) => model.recommended)?.id ||
    resolvedModels[0]?.id ||
    'step-3.7-flash'
  );
}

const resolvedDefaultModel = pickAvailableModelId(process.env.LLM_MODEL);
const resolvedDefaultVisionModel = pickAvailableModelId(
  process.env.VISION_MODEL,
  (model) => Boolean(model.supportsMultimodal),
);
const resolvedWorkshopModel = pickAvailableModelId(process.env.WORKSHOP_MODEL || process.env.LLM_MODEL);
const resolvedTutorModel = pickAvailableModelId(process.env.TUTOR_MODEL || process.env.LLM_MODEL);
const resolvedTutorProvider = resolvedModels.find((model) => model.id === resolvedTutorModel)?.provider;
const resolvedTutorQuickModel = pickAvailableModelId(
  process.env.TUTOR_QUICK_MODEL,
  (model) => model.provider === resolvedTutorProvider && /flash/i.test(model.id),
);

/**
 * 各用途默认模型集中表（唯一计算默认模型的地方）。
 * 上新模型只需在上面的 *Models 定义里加一条 + 在 .env 指定对应用途 env，无需改散落字面量。
 */
export const ModelDefaults = {
  primary: resolvedDefaultModel,
  vision: resolvedDefaultVisionModel,
  workshop: resolvedWorkshopModel,
  tutor: resolvedTutorModel,
  tutorQuick: resolvedTutorQuickModel,
} as const;

// ==================== LLM 配置 ====================

export const LLMConfig = {
  // 默认模型（各用途集中在 ModelDefaults，这里转出方便消费）
  defaultModel: ModelDefaults.primary,
  defaultVisionModel: ModelDefaults.vision,
  workshopModel: ModelDefaults.workshop,
  tutorModel: ModelDefaults.tutor,
  
  // API 配置
  stepfun: {
    apiKey: process.env.STEPFUN_API_KEY || '',
    baseUrl: process.env.STEPFUN_BASE_URL || 'https://api.stepfun.com/v1',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  },
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
    model: process.env.DASHSCOPE_ASR_WS_MODEL || 'qwen3-asr-flash-realtime-2026-02-10',
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

  // 信息流（M15：替换笔记总结，基于个人上下文的 LLM 驱动信息流）
  feed: {
    defaultModel: LLMConfig.defaultModel,
    maxItems: 6,
    maxProbes: 3,
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
