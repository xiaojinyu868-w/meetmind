type EnvLike = Record<string, string | undefined>;

export interface TutorAgentProviderConfig {
  apiKey: string | undefined;
  baseURL: string;
  modelId: string;
  keySource: 'TUTOR_API_KEY' | 'DASHSCOPE_API_KEY' | 'OPENAI_API_KEY' | 'none';
}

const DEFAULT_DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

function pickKey(source: TutorAgentProviderConfig['keySource'], value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? { source, value: trimmed } : null;
}

export function resolveTutorAgentProviderConfig(env: EnvLike): TutorAgentProviderConfig {
  const baseURL = (env.TUTOR_BASE_URL || env.LLM_BASE_URL || DEFAULT_DASHSCOPE_BASE_URL).trim();
  const isDashScope = /dashscope\.aliyuncs\.com/i.test(baseURL);

  const explicit = pickKey('TUTOR_API_KEY', env.TUTOR_API_KEY);
  const dashscope = pickKey('DASHSCOPE_API_KEY', env.DASHSCOPE_API_KEY);
  const openai = pickKey('OPENAI_API_KEY', env.OPENAI_API_KEY);
  const selected = explicit || (isDashScope ? dashscope || openai : openai || dashscope);

  return {
    apiKey: selected?.value,
    baseURL,
    modelId: (env.TUTOR_MODEL || 'qwen3.6-plus').trim(),
    keySource: selected?.source || 'none',
  };
}
