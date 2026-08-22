/**
 * AI 家教「上课」线（codex app-server 底座）配置。
 *
 * provider 注册表风格对齐 app.config.ts：一行环境变量（TEACH_PROVIDER）切换底座模型。
 * shim（Responses→Chat 协议翻译）只做转发，上游 baseUrl/apiKey 全部来自这里的
 * provider 定义；codex 侧永远指向本地 shim（model_provider="teach_shim"）。
 *
 * 默认：Gemini 3.7 Flash 经 commonstack（用户拍板 2026-08，价格刊例明确、
 * 中文教学语感三模型最佳；注意 TTFT 4–30s 抖动，见 out/codex-spike/REPORT.md）。
 * 备选：百炼 GLM-5.3（TEACH_PROVIDER=glm-dashscope，复用 DASHSCOPE_API_KEY）。
 */

export interface TeachProviderConfig {
  id: string;
  /** 上游真实模型 id（写进 codex config.toml 的 model 字段，原样透传给上游） */
  model: string;
  /** 上游 OpenAI chat completions 兼容端点（shim 的上游） */
  baseUrl: string;
  /** apiKey 来源环境变量名（shim 转发上游时作 Bearer） */
  apiKeyEnv: string;
  description: string;
}

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

const REGISTRY: Record<string, () => TeachProviderConfig> = {
  'gemini-commonstack': () => ({
    id: 'gemini-commonstack',
    model: env('TEACH_MODEL') || 'google/gemini-3.7-flash',
    baseUrl: env('COMMONSTACK_ECHO_BASE_URL') || 'https://api.commonstack.ai/v1',
    apiKeyEnv: 'COMMONSTACK_ECHO_API_KEY',
    description: 'Gemini 3.7 Flash 经 commonstack 中转（默认；TTFT 抖动大，语感最佳）',
  }),
  'glm-dashscope': () => ({
    id: 'glm-dashscope',
    model: env('TEACH_MODEL') || 'ZHIPU/GLM-5.3',
    baseUrl:
      env('LLM_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    description: '百炼 GLM-5.3（备选；注意 5.3 无缓存命中，见 spike 报告）',
  }),
};

export type TeachProviderId = keyof typeof REGISTRY;

export const TEACH_PROVIDER_IDS = Object.keys(REGISTRY) as TeachProviderId[];

/** 解析当前 provider；TEACH_PROVIDER 未设置/非法时回落 gemini-commonstack */
export function resolveTeachProvider(): TeachProviderConfig {
  const wanted = (process.env.TEACH_PROVIDER || '').trim();
  const factory = REGISTRY[wanted] || REGISTRY['gemini-commonstack'];
  return factory();
}

/** provider 的 apiKey（未配置返回 undefined，由调用方决定报错时机） */
export function teachProviderApiKey(provider: TeachProviderConfig): string | undefined {
  return env(provider.apiKeyEnv);
}

// ── TTS（讲课声音；teach-tts-service.ts 消费） ───────────────────────────────

export interface TeachTtsProviderConfig {
  id: string;
  /** 合成模型 id（随 provider 透传给上游） */
  model: string;
  voice: string;
  /** 语气指令（instruct 系模型；显式空串关闭） */
  instruct: string;
  description: string;
}

const TTS_REGISTRY: Record<string, () => TeachTtsProviderConfig> = {
  'qwen-instruct-flash': () => ({
    id: 'qwen-instruct-flash',
    model: env('TEACH_TTS_MODEL') || 'qwen3-tts-instruct-flash',
    voice: env('TEACH_TTS_VOICE') || 'Cherry',
    instruct:
      env('TEACH_TTS_INSTRUCT') ?? '你正在进行课堂教学，说话自然流畅，提问时语气上扬',
    description: '百炼 qwen3-tts-instruct-flash（默认；教学语气指令实测有效，见 out/tts-spike/REPORT.md）',
  }),
  // 备选接入点：MiniMax speech-2.8（百炼渠道，控制台开通即可）——在
  // teach-tts-service.ts 补 provider 实现后，这里注册一行即可 TEACH_TTS_PROVIDER 切换。
};

export type TeachTtsProviderId = keyof typeof TTS_REGISTRY;

/** 解析 TTS provider；TEACH_TTS_PROVIDER 未设置/非法时回落 qwen-instruct-flash */
export function resolveTeachTtsProvider(): TeachTtsProviderConfig {
  const wanted = (process.env.TEACH_TTS_PROVIDER || '').trim();
  const factory = TTS_REGISTRY[wanted] || TTS_REGISTRY['qwen-instruct-flash'];
  return factory();
}

export const TeachConfig = {
  /** shim 监听端口（仅 127.0.0.1；被占用时假定已有健康 shim 在跑并复用） */
  shimPort: Number(env('TEACH_SHIM_PORT') || 8799),
  /** codex app-server 空闲回收阈值（默认 15 分钟） */
  idleMs: Number(env('TEACH_IDLE_MS') || 15 * 60 * 1000),
  /** codex 二进制路径（默认 node_modules/.bin/codex，@openai/codex 提供） */
  codexBin: env('TEACH_CODEX_BIN'),
  /** CODEX_HOME 根目录（按线程隔离：data/teach-codex/<threadId>/） */
  codexHomeRoot: env('TEACH_CODEX_HOME') || 'data/teach-codex',
  /** 每线程事件日志目录（data/teach-events/<threadId>.jsonl） */
  eventLogDir: env('TEACH_EVENT_LOG_DIR') || 'data/teach-events',
  /** TTS 磁盘缓存目录（内容寻址 <hash>.wav，FIFO 清理） */
  ttsCacheDir: env('TEACH_TTS_CACHE_DIR') || 'data/teach-tts-cache',
  /** Next 自身回调地址（MCP server → 内部工具路由） */
  internalBaseUrl:
    env('TEACH_INTERNAL_BASE_URL') ||
    `http://127.0.0.1:${process.env.PORT || '3001'}`,
} as const;
