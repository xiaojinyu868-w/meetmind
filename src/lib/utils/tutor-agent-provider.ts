type EnvLike = Record<string, string | undefined>;

export interface TutorAgentProviderConfig {
  apiKey: string | undefined;
  baseURL: string;
  modelId: string;
  /** AI SDK v6 的 openai(model) 默认走 Responses API；OpenAI-compatible provider 必须显式走 Chat Completions。 */
  modelApi: 'chat';
  keySource: 'TUTOR_API_KEY' | 'STEPFUN_API_KEY' | 'DEEPSEEK_API_KEY' | 'DASHSCOPE_API_KEY' | 'OPENAI_API_KEY' | 'none';
}

export interface TutorAgentProviderOptions {
  modelId?: string;
}

const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_STEPFUN_BASE_URL = 'https://api.stepfun.com/v1';
const DEFAULT_STEPFUN_MODEL = 'step-3.7-flash';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
const DEFAULT_QWEN_MODEL = 'qwen3.6-plus';

function pickKey(source: TutorAgentProviderConfig['keySource'], value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? { source, value: trimmed } : null;
}

export function isStepFunModel(modelId: string): boolean {
  return /^step-/i.test(modelId);
}

export function isDeepSeekModel(modelId: string): boolean {
  return /^deepseek-/i.test(modelId);
}

export function shouldUseNativeTutorTools(modelId: string): boolean {
  // 不暴露 native tools 的两类模型：
  //
  // 1. **DeepSeek thinking 模型**：要求 provider-specific 的 reasoning_content
  //    在 tool call 之后回写；AI SDK 的 OpenAI-compatible adapter 不会 round-trip
  //    这个字段，会在工具回调后续写时崩。
  //
  // 2. **StepFun（step-*）**：模型本身够快（号称 400 tok/s），但 6 个 tutor tool
  //    description 加起来 ~700 字，会在 prefill 阶段拖慢首包；切到 marker 链路
  //    （`<open_app:KEY/>` + 前端 `/api/apps/execute`）后，TTFT 显著下降，且复用
  //    了课堂同桌已经验证过的同一条产品链路。
  //
  // 对这两类，结构化产物都走 `<open_app:KEY/>` marker，由前端拦截后开窗或嵌入。
  return !isDeepSeekModel(modelId) && !isStepFunModel(modelId);
}

function isStepFunBaseUrl(baseURL: string): boolean {
  return /api\.stepfun\.com/i.test(baseURL);
}

function isDashScopeBaseUrl(baseURL: string): boolean {
  return /dashscope\.aliyuncs\.com/i.test(baseURL);
}

function isDeepSeekBaseUrl(baseURL: string): boolean {
  return /api\.deepseek\.com/i.test(baseURL);
}

function hasKey(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function dedupeProviderConfigs(configs: TutorAgentProviderConfig[]): TutorAgentProviderConfig[] {
  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = `${config.baseURL}::${config.modelId}::${config.keySource}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolveTutorAgentProviderConfig(
  env: EnvLike,
  options: TutorAgentProviderOptions = {},
): TutorAgentProviderConfig {
  const requestedModel = options.modelId?.trim();
  const envModel = (env.TUTOR_MODEL || env.LLM_MODEL || '').trim();
  const hasStepFunKey = hasKey(env.STEPFUN_API_KEY);
  const hasDeepSeekKey = hasKey(env.DEEPSEEK_API_KEY);
  const modelId = requestedModel || envModel ||
    (hasStepFunKey
      ? DEFAULT_STEPFUN_MODEL
      : hasDeepSeekKey
        ? DEFAULT_DEEPSEEK_MODEL
        : DEFAULT_QWEN_MODEL);
  const shouldUseStepFun = isStepFunModel(modelId);
  const shouldUseDeepSeek = isDeepSeekModel(modelId);
  const baseURL = shouldUseStepFun
    ? (env.STEPFUN_BASE_URL || DEFAULT_STEPFUN_BASE_URL).trim()
    : shouldUseDeepSeek
      ? (env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).trim()
      : (env.TUTOR_BASE_URL || env.LLM_BASE_URL || DEFAULT_DASHSCOPE_BASE_URL).trim();

  const explicit = pickKey('TUTOR_API_KEY', env.TUTOR_API_KEY);
  const stepfun = pickKey('STEPFUN_API_KEY', env.STEPFUN_API_KEY);
  const deepseek = pickKey('DEEPSEEK_API_KEY', env.DEEPSEEK_API_KEY);
  const dashscope = pickKey('DASHSCOPE_API_KEY', env.DASHSCOPE_API_KEY);
  const openai = pickKey('OPENAI_API_KEY', env.OPENAI_API_KEY);
  const selected = explicit ||
    (shouldUseStepFun || isStepFunBaseUrl(baseURL)
      ? stepfun || openai || deepseek || dashscope
      : shouldUseDeepSeek || isDeepSeekBaseUrl(baseURL)
        ? deepseek || openai || dashscope || stepfun
        : isDashScopeBaseUrl(baseURL)
          ? dashscope || openai || deepseek || stepfun
          : openai || stepfun || deepseek || dashscope);

  return {
    apiKey: selected?.value,
    baseURL,
    modelId,
    modelApi: 'chat',
    keySource: selected?.source || 'none',
  };
}

export function resolveTutorAgentProviderFallbacks(
  env: EnvLike,
  options: TutorAgentProviderOptions = {},
): TutorAgentProviderConfig[] {
  const primary = resolveTutorAgentProviderConfig(env, options);
  const fallbacks: TutorAgentProviderConfig[] = [primary];

  if (hasKey(env.TUTOR_API_KEY)) return fallbacks;

  const primaryIsStepFun = isStepFunModel(primary.modelId) || isStepFunBaseUrl(primary.baseURL);
  const primaryIsDeepSeek = !primaryIsStepFun && (isDeepSeekModel(primary.modelId) || isDeepSeekBaseUrl(primary.baseURL));
  const primaryIsDashScope = !primaryIsStepFun && !primaryIsDeepSeek && isDashScopeBaseUrl(primary.baseURL);

  // Fallback chain: primary → DeepSeek → DashScope (if the corresponding key exists).
  if (primaryIsStepFun) {
    if (hasKey(env.DEEPSEEK_API_KEY)) {
      fallbacks.push(resolveTutorAgentProviderConfig(env, { modelId: DEFAULT_DEEPSEEK_MODEL }));
    }
    if (hasKey(env.DASHSCOPE_API_KEY)) {
      fallbacks.push(resolveTutorAgentProviderConfig(env, { modelId: DEFAULT_QWEN_MODEL }));
    }
  } else if (primaryIsDeepSeek && hasKey(env.DASHSCOPE_API_KEY)) {
    fallbacks.push(resolveTutorAgentProviderConfig(env, { modelId: DEFAULT_QWEN_MODEL }));
  } else if (primaryIsDashScope && hasKey(env.DEEPSEEK_API_KEY)) {
    fallbacks.push(resolveTutorAgentProviderConfig(env, { modelId: DEFAULT_DEEPSEEK_MODEL }));
  }

  return dedupeProviderConfigs(fallbacks).filter((config) => Boolean(config.apiKey));
}

export function shouldFallbackTutorAgentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message.trim()) return false;
  if (/\b(401|403|unauthorized|forbidden|invalid api key|api key|model not found|no such model|invalid model)\b/i.test(message)) {
    return false;
  }
  return /\b(service is too busy|too busy|overloaded|rate limit|rate limited|429|5\d\d|timeout|timed out|econnreset|etimedout|failed after \d+ attempts)\b/i.test(message);
}

export function formatTutorAgentUserError(error: unknown, options: { attemptedFallback?: boolean } = {}): string {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!shouldFallbackTutorAgentError(message)) return message;
  return options.attemptedFallback
    ? '模型服务刚刚有点忙，已尝试切换备用通道但仍未成功，请稍后再试。'
    : '模型服务刚刚有点忙，请稍后再试。';
}
