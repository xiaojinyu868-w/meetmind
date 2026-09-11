/**
 * AI 家教「上课」线（codex app-server 底座）配置。
 *
 * provider 注册表风格对齐 app.config.ts：一行环境变量（TEACH_PROVIDER）切换底座模型。
 * shim（Responses→Chat 协议翻译）只做转发，上游 baseUrl/apiKey 全部来自这里的
 * provider 定义；codex 侧永远指向本地 shim（model_provider="teach_shim"）。
 *
 * 默认：Gemini 3.7 Flash 经 commonstack（用户拍板 2026-08，价格刊例明确、
 * 中文教学语感三模型最佳；注意 TTFT 4–30s 抖动，见 out/codex-spike/REPORT.md）。
 * 备选：OpenAI Next 中转（TEACH_PROVIDER=gemini-openai-next，同模型走
 * api.openai-next.com）；百炼 GLM-5.3（TEACH_PROVIDER=glm-dashscope，复用
 * DASHSCOPE_API_KEY）。
 */

export interface TeachProviderConfig {
  id: string;
  /** 上游真实模型 id（写进 codex config.toml 的 model 字段，原样透传给上游） */
  model: string;
  /** 上游 OpenAI chat completions 兼容端点（shim 的上游） */
  baseUrl: string;
  /** apiKey 来源环境变量名（shim 转发上游时作 Bearer） */
  apiKeyEnv: string;
  /** 合并进上游 chat completions 请求体的额外参数（shim 发出前浅合并，provider 级） */
  upstreamParams?: Record<string, unknown>;
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
  'gemini-openai-next': () => ({
    id: 'gemini-openai-next',
    model: env('TEACH_MODEL') || 'gemini-3.7-flash',
    baseUrl: env('OPENAI_NEXT_BASE_URL') || 'https://api.openai-next.com/v1',
    apiKeyEnv: 'OPENAI_NEXT_API_KEY',
    // 实时教学压 TTFT：该网关上 gemini-3.7-flash 默认 70%+ 输出是 reasoning
    // （TTFT 中位 ~7s）；reasoning_effort=low 实测把推理量压约 1/4。
    // thinking.type=disabled / thinking_budget=0 / enable_thinking=false 均被静默忽略。
    upstreamParams: { reasoning_effort: 'low' },
    description: 'Gemini 3.7 Flash 经 OpenAI Next 中转（OpenAI 兼容协议，注入 reasoning_effort=low）',
  }),
  'glm-flash-dashscope': () => ({
    id: 'glm-flash-dashscope',
    model: env('TEACH_LIVE_MODEL') || 'ZHIPU/GLM-5.3-Flash',
    baseUrl: env('LLM_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    // 2026-09-10 实测（百炼）：该模型「始终思考，不支持关闭」（enable_thinking=false → 400），
    // 默认会先吐 1500+ reasoning tokens 才开口；reasoning_effort=low 把推理压到 0，
    // TTFT 2.4s、正文 ~144 tok/s。live 引擎默认走它（用户拍板 2026-09-10）。
    upstreamParams: { reasoning_effort: 'low' },
    description: '百炼 GLM-5.3-Flash（live 舞台引擎默认；reasoning_effort=low 压 TTFT）',
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

/** 按 id 显式取 provider（非法 id 回落默认）。fenshen 蒸馏线程用它固定 GLM——
 *  Gemini 3 强制 function call 带 thought_signature，shim 透传不了，
 *  带 MCP 工具的线程在 commonstack/Gemini 上会 400（out/fenshen-spike/REPORT.md） */
export function resolveTeachProviderById(id: string): TeachProviderConfig {
  const factory = REGISTRY[id] || REGISTRY['gemini-commonstack'];
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

/**
 * /api/teach/tts 允许调用方按句指定的音色白名单（百炼 qwen3-tts 系列；2026-09-10 三种评委声音实测可用）。
 * 不在名单里的 voice 回落 provider 默认音色——调用方传什么都不该让上游 4xx。
 */
export const TEACH_TTS_VOICE_ALLOWLIST: readonly string[] = ['Cherry', 'Serena', 'Ethan', 'Chelsie', 'Dylan', 'Jada', 'Sunny'];

/** 按句覆盖音色 / 语气（讲给同桌听的三位评委各有声音）；返回一份新的 provider 配置 */
export function resolveTeachTtsProviderFor(overrides: { voice?: string; instruct?: string } = {}): TeachTtsProviderConfig {
  const base = resolveTeachTtsProvider();
  const voice = overrides.voice && TEACH_TTS_VOICE_ALLOWLIST.includes(overrides.voice) ? overrides.voice : base.voice;
  const instruct = typeof overrides.instruct === 'string' ? overrides.instruct.trim().slice(0, 80) : base.instruct;
  return { ...base, voice, instruct };
}

/** live 舞台引擎的 provider（独立于 TEACH_PROVIDER：两条线对模型的要求不同——live 要的是低 TTFT + 会写 SVG） */
export function resolveTeachLiveProvider(): TeachProviderConfig {
  const wanted = (process.env.TEACH_LIVE_PROVIDER || '').trim();
  const factory = REGISTRY[wanted] || REGISTRY['glm-flash-dashscope'];
  return factory();
}

/**
 * live 引擎的模型刊例价（人民币 / 百万 token；默认 = 百炼 GLM-5.3-Flash 北京 2026-09：输入 0.8 / 输出 2.8，
 * https://help.aliyun.com/zh/model-studio/glm-5-3-flash-by-zhipu）。换 provider 请同时改这两个 env。
 */
export function liveCostCny(inputTokens: number, outputTokens: number): number {
  const inPrice = Number(env('TEACH_LIVE_PRICE_IN_CNY_PER_MTOK') || 0.8);
  const outPrice = Number(env('TEACH_LIVE_PRICE_OUT_CNY_PER_MTOK') || 2.8);
  return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
}

export const TeachConfig = {
  /** 教学引擎选择：codex（现役 app-server 底座）/ engine（pi loop + vendor OpenMAIC，P1）/ live（标签流舞台引擎，2026-09） */
  engine: env('TEACH_ENGINE') || 'codex',
  /** live 引擎单轮最大输出 tokens（一轮 = 几句话 + 一两张图，4096 够；SVG 多时上调） */
  liveMaxOutputTokens: Number(env('TEACH_LIVE_MAX_OUTPUT_TOKENS') || 6000),
  /** live 引擎温度：SVG 坐标与 LaTeX 要稳，低一点 */
  liveTemperature: Number(env('TEACH_LIVE_TEMPERATURE') || 0.6),
  /** teach-engine 的 skill 目录（Agent Skills 标准 SKILL.md；目录不存在 = 无技能） */
  skillsDir: env('TEACH_SKILLS_DIR') || 'assets/teach-skills',
  /** teach-engine 人物人格 skill 的发现根（fenshen 蒸馏产物；目录布局契约见
   *  fenshen/fenshen-config.ts：<egoId>/work/skill/SKILL.md 镜像 = 就绪门禁）。
   *  仅配置值约定，不 import fenshen（teach-engine 与 fenshen 零耦合边界不变）。 */
  personaSkillsRoot: env('TEACH_PERSONA_SKILLS_ROOT') || 'data/fenshen-codex',
  /** teach-engine 单轮最大输出 tokens */
  engineMaxOutputTokens: Number(env('TEACH_ENGINE_MAX_OUTPUT_TOKENS') || 4096),
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
  /** 每线程材料包目录（data/teach-materials/<threadId>.json；学生自带材料开课，见 teach-live/live-materials.ts） */
  materialsDir: env('TEACH_MATERIALS_DIR') || 'data/teach-materials',
  /** TTS 磁盘缓存目录（内容寻址 <hash>.wav，FIFO 清理） */
  ttsCacheDir: env('TEACH_TTS_CACHE_DIR') || 'data/teach-tts-cache',
  /** Next 自身回调地址（MCP server → 内部工具路由） */
  internalBaseUrl:
    env('TEACH_INTERNAL_BASE_URL') ||
    `http://127.0.0.1:${process.env.PORT || '3001'}`,
} as const;
