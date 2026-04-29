/**
 * Academic Service OS 统一模型口径
 *
 * 这里集中声明 Academic 各个场景使用哪个模型，方便未来统一切换。
 *
 * 当前默认：qwen3.6-plus（2026.04 发布，混合架构，Agent 能力升级；fallback 3.5-plus）
 * 视频理解：qwen3.5-plus 支持 video_url；也可覆盖为 qwen3-vl-plus-2025-12-19
 */

import { LLMConfig } from '@/lib/config';

/** Coaching Twin 文本对话主模型 */
export const COACHING_CHAT_MODEL = pickModel('qwen3.6-plus', 'qwen3.5-plus');

/** 视频理解 / 多模态理解 */
export const VIDEO_UNDERSTAND_MODEL = pickModel('qwen3.5-plus', 'qwen3-vl-plus-2025-12-19');

/** 文档拆分 / 结构化抽取 */
export const DOCUMENT_EXTRACT_MODEL = pickModel('qwen3.6-plus', 'qwen3.5-plus');

/** Persona Pack 生成 / 反馈摘要 */
export const SYNTHESIS_MODEL = pickModel('qwen3.6-plus', 'qwen3.5-plus');

function pickModel(preferred: string, fallback: string): string {
  const preferredExists = LLMConfig.models.some((m) => m.id === preferred);
  if (preferredExists) return preferred;
  const fallbackExists = LLMConfig.models.some((m) => m.id === fallback);
  if (fallbackExists) return fallback;
  return LLMConfig.defaultModel;
}
