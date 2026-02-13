import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

export const fallbackPlugin: AppPlugin = {
  manifest: {
    id: 'fallback',
    name: '通用兜底插件',
    version: '0.1.0',
    description: '当没有匹配插件时，输出最小可执行建议。',
    tags: ['fallback'],
    capabilities: ['generic-output'],
    enabledByDefault: true,
  },
  canHandle(_context: AppExecutionContext): boolean {
    return true;
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const summary = tools.summarizeSegments(context.input.transcript.slice(0, 3), 220);

    return {
      pluginId: 'fallback',
      version: '0.1.0',
      trace: [`intent=${context.goal.intent}`, 'strategy=fallback'],
      cards: [
        {
          id: 'fallback-card',
          type: 'insight',
          title: '已进入通用处理流程',
          body: summary || '当前上下文不足，建议继续采集后再执行应用插件。',
          priority: 'medium',
        },
      ],
      tasks: [
        {
          id: 'fallback-task',
          label: '补充更多上下文后重试',
          reason: '插件质量取决于上下文密度',
          estimatedMinutes: 2,
        },
      ],
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
