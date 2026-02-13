import type { AppExecutionContext, AppExecutionResult, AppPlugin, AppPluginTools } from '../types';

const KEYWORDS = ['计划', '安排', '路线', '今晚', '复盘', '学习计划'];

function hasPlanningIntent(intent: string): boolean {
  return KEYWORDS.some((word) => intent.includes(word));
}

export const reviewPlanPlugin: AppPlugin = {
  manifest: {
    id: 'review-plan',
    name: '复习计划插件',
    version: '0.1.0',
    description: '把当前上下文压缩为可执行的今晚学习计划。',
    tags: ['student', 'plan', 'review'],
    capabilities: ['timeline-plan', 'task-splitting'],
    enabledByDefault: true,
  },
  canHandle(context: AppExecutionContext): boolean {
    return hasPlanningIntent(context.goal.intent.toLowerCase());
  },
  async run(context: AppExecutionContext, tools: AppPluginTools): Promise<AppExecutionResult> {
    const unresolved =
      context.memory.timeline?.unresolvedAnchorCount ??
      context.input.anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved).length;
    const durationMs =
      context.memory.timeline?.durationMs ??
      context.input.transcript.reduce((max, segment) => Math.max(max, segment.endMs), 0);
    const durationMinutes = Math.max(1, Math.round(durationMs / 60_000));

    const planSummary = tools.summarizeSegments(context.input.transcript.slice(0, 5), 280);

    return {
      pluginId: 'review-plan',
      version: '0.1.0',
      trace: [
        `intent=${context.goal.intent}`,
        `duration_minutes=${durationMinutes}`,
        `unresolved=${unresolved}`,
      ],
      cards: [
        {
          id: 'plan-overview',
          type: 'timeline',
          title: '今晚学习安排',
          body: `当前课堂总时长约 ${durationMinutes} 分钟，未解决困惑点 ${unresolved} 个。建议先补困惑，再做巩固。`,
          priority: 'high',
        },
        {
          id: 'plan-context',
          type: 'insight',
          title: '课堂核心回顾',
          body: planSummary || '暂无可回顾片段。',
          priority: 'medium',
        },
      ],
      tasks: [
        {
          id: 'plan-task-1',
          label: '先处理未解决困惑点',
          reason: '优先堵住理解缺口',
          estimatedMinutes: Math.min(20, Math.max(8, unresolved * 5)),
        },
        {
          id: 'plan-task-2',
          label: '完成2道针对性练习',
          reason: '把理解转换为可迁移能力',
          estimatedMinutes: 15,
        },
        {
          id: 'plan-task-3',
          label: '用要点卡片做3分钟复述',
          reason: '强化长期记忆',
          estimatedMinutes: 3,
        },
      ],
      nextSuggestedPlugins: unresolved > 0 ? ['confusion-drill'] : undefined,
      raw: {
        generatedAt: tools.now(),
      },
    };
  },
};
