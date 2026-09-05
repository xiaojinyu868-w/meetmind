/**
 * 信息图生图 provider 判定与分发（单一真相）。
 *
 * 之前存在两套判定：generate-image 路由默认 DashScope，而 studio-workshop
 * 插件内联生图只认 Gemini——只配 DASHSCOPE_API_KEY 的部署里 execute 永远
 * 返回无图草稿，前端只能进页面二次等图。本模块把判定收敛到一处：
 * `IMAGE_PROVIDER=gemini` 强制 Gemini；否则 DashScope 优先，Gemini 兜底。
 */

import {
  generateGeminiImage,
  isGeminiImageEnabled,
  type GeminiImageParams,
  type GeminiImageResult,
} from '@/lib/services/gemini-image-service';
import {
  generateDashscopeImage,
  isDashscopeImageEnabled,
} from '@/lib/services/dashscope-image-service';

export type InfographicImageProvider = 'dashscope' | 'gemini';

export function resolveInfographicImageProvider(): InfographicImageProvider | null {
  const preferGemini = process.env.IMAGE_PROVIDER?.trim() === 'gemini' && isGeminiImageEnabled();
  if (preferGemini) return 'gemini';
  if (isDashscopeImageEnabled()) return 'dashscope';
  if (isGeminiImageEnabled()) return 'gemini';
  return null;
}

export function isInfographicImageEnabled(): boolean {
  return resolveInfographicImageProvider() !== null;
}

export async function generateInfographicImage(
  params: GeminiImageParams
): Promise<GeminiImageResult> {
  const provider = resolveInfographicImageProvider();
  if (!provider) {
    throw new Error('未配置图片生成服务的 API Key，请先完成环境变量配置。');
  }
  return provider === 'dashscope' ? generateDashscopeImage(params) : generateGeminiImage(params);
}
