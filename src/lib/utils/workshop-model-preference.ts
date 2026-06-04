/**
 * Workshop（学习应用）模型偏好解析 —— 前端唯一入口。
 *
 * 设计原则（模型注册表架构清洗）：
 * - 前端**不自己判断模型可用性**。`process.env.*_API_KEY` 是 server-only，浏览器拿不到，
 *   前端硬编码的默认模型会和服务端真相不一致，导致请求里带一个服务端不认识的 model。
 * - 真相源是服务端的 `GET /api/llm/models`（force-static + revalidate）：
 *   `{ models, defaultModel, workshopModel }`。
 * - 本工具：拿用户 localStorage 偏好，只有当它在服务端 models 列表里才采用，否则回落 workshopModel。
 *
 * 这样：历史 localStorage 里的过期 model 名（qwen3.6-plus / 没 key 的 DeepSeek-V4-Flash）
 * 会被自动纠正成当前可用的默认模型，从根上消除 "未知模型: xxx" / fallback 空壳。
 */

export const WORKSHOP_MODEL_PREFERENCE_KEY = 'ai_workshop_model';

interface LlmModelsResponse {
  models: Array<{ id: string }>;
  defaultModel: string;
  workshopModel?: string;
}

let cachedPromise: Promise<LlmModelsResponse | null> | null = null;

async function fetchLlmModels(): Promise<LlmModelsResponse | null> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = fetch('/api/llm/models')
    .then((res) => (res.ok ? (res.json() as Promise<LlmModelsResponse>) : null))
    .catch(() => null);
  return cachedPromise;
}

/**
 * 解析当前应该使用的 workshop 模型 id。
 * 永远返回一个「服务端确认可用」的 id；若网络失败则原样返回偏好（后端仍会容错回落）。
 */
export async function resolveWorkshopModelId(): Promise<string> {
  const saved =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(WORKSHOP_MODEL_PREFERENCE_KEY)?.trim() || ''
      : '';

  const data = await fetchLlmModels();
  if (!data) return saved; // 离线/失败：交给后端容错回落

  const fallback = (data.workshopModel || data.defaultModel || '').trim();
  if (saved && data.models.some((model) => model.id === saved)) return saved;

  // 偏好缺失或已失效：纠正 localStorage 并返回服务端默认
  if (typeof window !== 'undefined' && fallback) {
    window.localStorage.setItem(WORKSHOP_MODEL_PREFERENCE_KEY, fallback);
  }
  return fallback;
}

/** 同步读取（仅用于初始 state，真正发请求前应 await resolveWorkshopModelId）。 */
export function readSavedWorkshopModelId(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(WORKSHOP_MODEL_PREFERENCE_KEY)?.trim() || '';
}
