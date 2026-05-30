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
  // DeepSeek thinking models require provider-specific reasoning_content to be
  // sent back after tool calls. AI SDK's OpenAI-compatible adapter does not
  // round-trip that field, so native multi-step tools can fail after the first
  // tool call. Structured products still work through <open_app:KEY/> +
  // /api/apps/execute, which avoids the broken tool-call continuation path.
  return !isDeepSeekModel(modelId);
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
