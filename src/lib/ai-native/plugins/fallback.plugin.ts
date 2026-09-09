import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

export const fallbackPlugin: AppPlugin = {
  manifest: {
    id: 'fallback',
    name: '通用兜底插件',
    version: '0.1.0',
    description: '当没有匹配插件时，诚实报告 APP_NOT_SUITABLE（不产出假成品）。',
    tags: ['fallback'],
    capabilities: ['generic-output'],
    enabledByDefault: true,
  },
  canHandle(_context: AppExecutionContext): boolean {
    return true;
  },
  async run(_context: AppExecutionContext, _tools: AppPluginTools): Promise<AppExecutionResult> {
    // 2026-09-09：不再产出"已进入通用处理流程"这种假成品。没有插件认领的任务是应用不适合当前内容，
    // 路由把它翻成 200 + ok:false，窗口回安静空态（与 CONTENT_NOT_READY 同一条路）
    throw new Error('APP_NOT_SUITABLE');
  },
};
