/**
 * llm-usage-hook — LLM 用量计量钩子注册点
 *
 * 客户端安全：本模块无任何服务端依赖（不碰 prisma / async_hooks），
 * 因此 llm-service 可以静态引用它而不把计量实现拉进浏览器 bundle
 * （客户端链路：page.tsx → Workshop 窗口 → ai-native plugins → llm-service）。
 *
 * 服务端启动时由 point-meter 自注册；未注册时 emitLLMUsage 是空操作，
 * 计量永远不阻塞业务调用。
 */

export interface LLMUsageRecord {
  /** 功能归属；留空时由计量实现从 AsyncLocalStorage 上下文补齐 */
  feature: string;
  modelId: string;
  usage: { promptTokens?: number; completionTokens?: number };
}

export type LLMUsageHook = (record: LLMUsageRecord) => void;

let usageHook: LLMUsageHook | null = null;

export function registerLLMUsageHook(hook: LLMUsageHook): void {
  usageHook = hook;
}

export function emitLLMUsage(record: LLMUsageRecord): void {
  try {
    usageHook?.(record);
  } catch {
    /* 计量失败静默，绝不阻塞业务 */
  }
}
