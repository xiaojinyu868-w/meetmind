/**
 * Echo 回声显示层工具函数。
 * 合并回声、调试标签、手动触发反馈、时间分桶。
 */

import type {
  WorkspaceEchoMessage,
  DailyEchoRefreshPayload,
  ManualEchoFeedbackState,
  ManualEchoFeedbackTone,
} from '@/types/page-types';
import { compactText } from './text-and-constants';

export function mergeWorkspaceEchoes(
  previous: WorkspaceEchoMessage[],
  incoming: WorkspaceEchoMessage[],
  limit: number = 16
): WorkspaceEchoMessage[] {
  const normalized = [...incoming, ...previous]
    .filter((item) => item && item.id && item.title && item.body)
    .map((item) => ({
      ...item,
      title: compactText(item.title, 80),
      body: String(item.body || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
      chips: Array.isArray(item.chips) ? item.chips.filter(Boolean).slice(0, 4) : [],
      recommendations: Array.isArray(item.recommendations)
        ? item.recommendations
            .map((recommendation) => ({
              title: String(recommendation?.title || '')
                .replace(/\r\n/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim(),
              body: String(recommendation?.body || '')
                .replace(/\r\n/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim(),
            }))
            .filter((recommendation) => recommendation.title && recommendation.body)
            .slice(0, 2)
        : [],
      memory:
        item.memory &&
        Number.isFinite(item.memory.sourceCaptureCount) &&
        item.memory.sourceCaptureCount > 0
          ? {
              sourceCaptureCount: Math.max(0, item.memory.sourceCaptureCount),
              todayCaptureCount: Math.max(0, item.memory.todayCaptureCount || 0),
              recentCaptureCount: Math.max(0, item.memory.recentCaptureCount || 0),
            }
          : null,
      updatedAt: item.updatedAt || item.createdAt,
    }));

  const unique: WorkspaceEchoMessage[] = [];
  const seen = new Set<string>();
  for (const item of normalized) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    unique.push(item);
  }
  return unique
    .sort(
      (a, b) =>
        new Date(resolveEchoDisplayTime(b)).getTime() - new Date(resolveEchoDisplayTime(a)).getTime()
    )
    .slice(0, limit);
}

export function resolveEchoDisplayTime(item: Pick<WorkspaceEchoMessage, 'createdAt' | 'updatedAt'>): string {
  return item.updatedAt || item.createdAt;
}

export function getEchoDebugReasonLabel(reason?: string): string {
  switch (reason) {
    case 'active':
      return '今天这条回声已经生成好了';
    case 'pending':
      return '今日回声还在生成中';
    case 'context-too-thin':
      return '当前上下文还太薄，先多收一点';
    case 'too-short':
      return '这次结果太短，先保留当前版本';
    case 'too-similar':
      return '这次和最近回声太像，先保留当前版本';
    case 'low-signal':
      return '这次结果不够聚焦，先保留当前版本';
    case 'workspace-missing':
      return '当前工作区不可用';
    case 'config-missing':
      return '回声服务还没配置好';
    default:
      return reason || '已跳过';
  }
}

export function getEchoQualityWarningLabel(reason?: string): string {
  switch (reason) {
    case 'too-short':
      return '这次结果偏短';
    case 'too-similar':
      return '这次和上一版很接近';
    case 'low-signal':
      return '这次结果不够聚焦';
    default:
      return getEchoDebugReasonLabel(reason);
  }
}

export function buildManualEchoFeedbackFromPayload(payload: DailyEchoRefreshPayload): ManualEchoFeedbackState {
  if (payload.echo && !payload.skipped) {
    if (payload.reason === 'too-similar') {
      return {
        tone: 'success',
        title: '测试版已更新',
        body: '这次和上一版很接近，但上面已经换成新结果了。',
      };
    }
    if (payload.reason === 'low-signal') {
      return {
        tone: 'success',
        title: '测试版已更新',
        body: '这次结果有点散，但上面已经换成新结果了。',
      };
    }
    if (payload.reason === 'too-short') {
      return {
        tone: 'success',
        title: '测试版已更新',
        body: '这次结果偏短，但上面已经换成新结果了。',
      };
    }
    return {
      tone: 'success',
      title: '测试生成完成',
      body: '上面已经换成新版本。',
    };
  }

  switch (payload.reason) {
    case 'active':
      return { tone: 'info', title: '今天这条已经有了', body: '先看上面的版本，不必重复生成。' };
    case 'pending':
      return { tone: 'pending', title: '已经发出测试请求', body: '再等几秒，今天这条就会回来。' };
    case 'context-too-thin':
      return { tone: 'info', title: '线索还不够', body: '先再补一句，结果会更像样。' };
    case 'too-short':
      return { tone: 'info', title: '这次结果太空了', body: '先保留当前版本。' };
    case 'too-similar':
      return { tone: 'info', title: '这次没有更好', body: '和当前版本太像了，先不覆盖。' };
    case 'low-signal':
      return { tone: 'info', title: '这次没抓住线索', body: '先保留当前版本，晚点再试。' };
    case 'config-missing':
      return { tone: 'error', title: '回声服务还没接好', body: '先检查 CommonStack 配置。' };
    default:
      return { tone: 'info', title: '这次没有生成出新回声', body: '可以稍后再试。' };
  }
}

export function buildManualEchoErrorFeedback(message: string): ManualEchoFeedbackState {
  return {
    tone: 'error',
    title: '这次生成没成功',
    body: message || '这次没拿到可用结果。',
  };
}

export function buildManualEchoUnavailableFeedback(params: {
  isGuestFastEntry: boolean;
  isCheckingAuth: boolean;
}): ManualEchoFeedbackState {
  if (params.isCheckingAuth) {
    return { tone: 'pending', title: '正在确认账号状态', body: '确认完登录状态后再试。' };
  }
  if (params.isGuestFastEntry) {
    return { tone: 'info', title: '游客模式下不能直接测回声', body: '先登录，再在工作区里触发。' };
  }
  return { tone: 'info', title: '登录后才能测试回声', body: '先登录，再回来试这一条。' };
}

export function getManualEchoFeedbackClasses(tone: ManualEchoFeedbackTone) {
  switch (tone) {
    case 'pending':
      return 'border-[#E8E2D5] bg-[#FDF3C0]/50 text-[#1C1B19]';
    case 'success':
      return 'border-[#E8E2D5] bg-[#D1F4E0]/50 text-[#1C1B19]';
    case 'error':
      return 'border-vermilion/30 bg-vermilion-fog/70 text-vermilion-deep';
    default:
      return 'border-divider bg-white/80 text-ink-secondary';
  }
}

export function resolveEchoTimeBucket(createdAt: string): 'today' | 'week' | 'earlier' {
  const created = new Date(createdAt);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = now.getTime() - created.getTime();

  if (created.getTime() >= startOfToday) return 'today';
  if (diff <= 7 * 24 * 60 * 60 * 1000) return 'week';
  return 'earlier';
}

export function getEchoBucketLabel(bucket: 'today' | 'week' | 'earlier'): string {
  if (bucket === 'today') return '今天';
  if (bucket === 'week') return '最近 7 天';
  return '更早';
}
