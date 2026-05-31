/**
 * useEchoActions — 回声操作 hook
 *
 * 从 page.tsx 提取的职责：
 * - refreshDailyEcho: 刷新每日回声（自动/手动）
 * - Echo filter memos: echoFilterOptions / filteredWorkspaceEchoes / historyWorkspaceEchoes 等
 * - Manual echo trigger UI: 按钮渲染 / 反馈视图 / 调试视图
 * - Echo filter chip 自动重置 effect
 *
 * 依赖规则：hooks → stores + types + lib/utils（符合 DOMAIN.md）
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Sparkles, AlertCircle, Clock } from 'lucide-react';

import type {
  WorkspaceEchoMessage,
  DailyEchoRefreshPayload,
} from '@/types/page-types';
import {
  ENABLE_ECHO_MANUAL_TRIGGER,
  mergeWorkspaceEchoes,
  resolveEchoDisplayTime,
  getEchoDebugReasonLabel,
  getEchoQualityWarningLabel,
  buildManualEchoFeedbackFromPayload,
  buildManualEchoErrorFeedback,
  buildManualEchoUnavailableFeedback,
  getManualEchoFeedbackClasses,
  resolveEchoTimeBucket,
  getEchoBucketLabel,
  readJsonApiResponse,
} from '@/lib/utils/page-utils';

import { useEchoStore, useEchoActions as useEchoStoreActions } from '@/stores/echo-store';

// ==================== 类型定义 ====================

export interface UseEchoActionsDeps {
  /** 是否游客快捷入口 */
  isGuestFastEntry: boolean;
  /** 是否正在确认登录状态 */
  isCheckingAuth: boolean;
  /** 是否已认证 */
  isAuthenticated: boolean;
  /** 当前用户 */
  user: { id: string } | null | undefined;
  /** 访问令牌 */
  accessToken: string | null;
}

export interface UseEchoActionsReturn {
  /** 刷新每日回声（自动或手动 force） */
  refreshDailyEcho: (options?: { force?: boolean }) => Promise<DailyEchoRefreshPayload | null>;
  /** 回声筛选标签选项（含"全部"） */
  echoFilterOptions: string[];
  /** 筛选后的回声列表 */
  filteredWorkspaceEchoes: WorkspaceEchoMessage[];
  /** 最新回声 ID */
  latestWorkspaceEchoId: string | null;
  /** 历史回声（不含最新） */
  historyWorkspaceEchoes: WorkspaceEchoMessage[];
  /** 按时段分组的历史回声 */
  groupedWorkspaceEchoes: Record<'today' | 'week' | 'earlier', WorkspaceEchoMessage[]>;
  /** 回声历史分区（用于列表渲染） */
  echoHistorySections: Array<{ key: 'today' | 'week' | 'earlier'; label: string; items: WorkspaceEchoMessage[] }>;
  /** 最新回声摘要（用于中心卡片） */
  latestEchoForCenter: {
    id: string;
    title: string;
    body: string;
    chips: string[];
    recommendations: Array<{ title: string; body: string }>;
    memory: { sourceCaptureCount: number; todayCaptureCount: number; recentCaptureCount: number } | null;
    updatedAt: string;
  } | null;
  /** 最新回声是否是今天生成的 */
  latestEchoIsToday: boolean;
  /** 是否可以请求手动回声 */
  canRequestManualEcho: boolean;
  /** 手动回声按钮文案 */
  manualEchoButtonLabel: string;
  /** 渲染手动回声触发按钮 */
  renderManualEchoTriggerButton: (className: string) => ReactNode;
  /** 手动回声反馈视图 */
  manualEchoFeedbackView: ReactNode;
  /** 手动回声调试视图 */
  manualEchoDebugView: ReactNode;
}

// ==================== Hook 实现 ====================

export function useEchoActions(deps: UseEchoActionsDeps): UseEchoActionsReturn {
  const { isGuestFastEntry, isCheckingAuth, isAuthenticated, user, accessToken } = deps;

  // --- Echo store ---
  const echoActions = useEchoStoreActions();
  const workspaceEchoes = useEchoStore((s) => s.workspaceEchoes);
  const selectedEchoChip = useEchoStore((s) => s.selectedEchoChip);
  const isManualEchoRefreshing = useEchoStore((s) => s.isManualEchoRefreshing);
  const manualEchoDebugNote = useEchoStore((s) => s.manualEchoDebugNote);
  const manualEchoFeedback = useEchoStore((s) => s.manualEchoFeedback);

  const setWorkspaceEchoes = echoActions.setWorkspaceEchoes;
  const setSelectedEchoChip = echoActions.setSelectedEchoChip;
  const setIsManualEchoRefreshing = echoActions.setIsManualEchoRefreshing;
  const setManualEchoDebugNote = echoActions.setManualEchoDebugNote;
  const setManualEchoFeedback = echoActions.setManualEchoFeedback;

  // --- 内部 ref（auto echo dedup） ---
  const autoEchoRefreshPromiseRef = useRef<Promise<DailyEchoRefreshPayload | null> | null>(null);

  // ==================== refreshDailyEcho ====================

  const refreshDailyEcho = useCallback(async (options?: { force?: boolean }) => {
    const force = Boolean(options?.force);
    if (!isAuthenticated || !user?.id || !accessToken) {
      if (force) {
        const feedback = buildManualEchoUnavailableFeedback({
          isGuestFastEntry,
          isCheckingAuth,
        });
        setManualEchoFeedback(feedback);
        setManualEchoDebugNote(
          isGuestFastEntry ? '游客模式下不会发起回声请求' : isCheckingAuth ? '正在确认登录状态' : '当前未登录'
        );
        if (!isCheckingAuth) {
          toast.message(feedback.title);
        }
      }
      return null;
    }

    if (!force && autoEchoRefreshPromiseRef.current) {
      return autoEchoRefreshPromiseRef.current;
    }

    const requestPromise = (async (): Promise<DailyEchoRefreshPayload | null> => {
      if (force) {
        setIsManualEchoRefreshing(true);
        setManualEchoDebugNote('');
        setManualEchoFeedback({
          tone: 'pending',
          title: '正在生成今日回声',
          body: '测试请求已发出，你可以继续收集。',
        });
      }

      try {
        const response = await fetch('/api/workspace/echoes/daily-refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            force,
          }),
        });

        const payload = await readJsonApiResponse<DailyEchoRefreshPayload>(
          response,
          force ? '手动生成回声失败' : '刷新今日回声失败'
        );

        if (!response.ok || !payload.success) {
          throw new Error(payload.error || payload.reason || (force ? '手动生成回声失败' : '刷新今日回声失败'));
        }

        if (payload.echo) {
          setWorkspaceEchoes((prev) => mergeWorkspaceEchoes(prev, [payload.echo!]));
        }

        if (force) {
          setManualEchoFeedback(buildManualEchoFeedbackFromPayload(payload));
          const debug = payload.debug;
          const note = debug
            ? [
                debug.model ? `模型：${debug.model}` : '',
                debug.promptVersion ? `Prompt：${debug.promptVersion}` : '',
                typeof debug.todayCaptureCount === 'number' ? `今天线索：${debug.todayCaptureCount}` : '',
                typeof debug.recentCaptureCount === 'number' ? `补充上下文：${debug.recentCaptureCount}` : '',
                typeof debug.similarityToRecent === 'number' ? `重复度：${debug.similarityToRecent.toFixed(2)}` : '',
                payload.reason && !payload.skipped ? `质量提醒：${getEchoQualityWarningLabel(payload.reason)}` : '',
              ].filter(Boolean).join(' · ')
          : '';
          setManualEchoDebugNote(note || (payload.skipped ? `本次未更新：${getEchoDebugReasonLabel(payload.reason)}` : '回声已刷新'));
          if (payload.echo && !payload.skipped) {
            toast.success('回声已刷新');
          }
        }

        return payload;
      } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (force) {
        setManualEchoFeedback(buildManualEchoErrorFeedback(message));
        setManualEchoDebugNote(message);
        toast.error(message);
      } else {
          console.error('[workspace.echo]', message);
        }
        return null;
      } finally {
        if (force) {
          setIsManualEchoRefreshing(false);
        }
      }
    })();

    if (!force) {
      autoEchoRefreshPromiseRef.current = requestPromise;
    }

    try {
      return await requestPromise;
    } finally {
      if (!force && autoEchoRefreshPromiseRef.current === requestPromise) {
        autoEchoRefreshPromiseRef.current = null;
      }
    }
  }, [accessToken, isAuthenticated, isCheckingAuth, isGuestFastEntry, user?.id]);

  // ==================== Echo filter memos ====================

  const echoFilterOptions = useMemo(() => {
    const counts = new Map<string, number>();
    workspaceEchoes.forEach((echo) => {
      echo.chips.forEach((chip) => {
        if (!chip) return;
        counts.set(chip, (counts.get(chip) || 0) + 1);
      });
    });

    return [
      '全部',
      ...Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([chip]) => chip),
    ];
  }, [workspaceEchoes]);

  const filteredWorkspaceEchoes = useMemo(() => {
    if (selectedEchoChip === '全部') return workspaceEchoes;
    return workspaceEchoes.filter((echo) => echo.chips.includes(selectedEchoChip));
  }, [selectedEchoChip, workspaceEchoes]);

  const latestWorkspaceEchoId = workspaceEchoes[0]?.id || null;

  const historyWorkspaceEchoes = useMemo(() => {
    if (!latestWorkspaceEchoId) return filteredWorkspaceEchoes;
    return filteredWorkspaceEchoes.filter((echo) => echo.id !== latestWorkspaceEchoId);
  }, [filteredWorkspaceEchoes, latestWorkspaceEchoId]);

  const groupedWorkspaceEchoes = useMemo(() => {
    const groups: Record<'today' | 'week' | 'earlier', WorkspaceEchoMessage[]> = {
      today: [],
      week: [],
      earlier: [],
    };

    historyWorkspaceEchoes.forEach((echo) => {
      groups[resolveEchoTimeBucket(resolveEchoDisplayTime(echo))].push(echo);
    });

    return groups;
  }, [historyWorkspaceEchoes]);

  const echoHistorySections = useMemo(
    () =>
      (['today', 'week', 'earlier'] as const)
        .map((bucket) => ({
          key: bucket,
          label: getEchoBucketLabel(bucket),
          items: groupedWorkspaceEchoes[bucket],
        }))
        .filter((section) => section.items.length > 0),
    [groupedWorkspaceEchoes]
  );

  const latestEchoForCenter = useMemo(() => {
    if (workspaceEchoes.length === 0) return null;

    const latest = workspaceEchoes[0];
    return {
      id: latest.id,
      title: latest.title,
      body: latest.body,
      chips: latest.chips,
      recommendations: Array.isArray(latest.recommendations) ? latest.recommendations : [],
      memory: latest.memory || null,
      updatedAt: resolveEchoDisplayTime(latest),
    };
  }, [workspaceEchoes]);

  const latestEchoIsToday = useMemo(() => {
    if (!latestEchoForCenter?.updatedAt) return false;
    return resolveEchoTimeBucket(latestEchoForCenter.updatedAt) === 'today';
  }, [latestEchoForCenter]);

  // ==================== Manual echo trigger ====================

  const canRequestManualEcho = Boolean(isAuthenticated && user?.id && accessToken);

  const manualEchoButtonLabel = useMemo(() => {
    if (isManualEchoRefreshing) return '生成中...';
    if (isCheckingAuth) return '确认中...';
    if (!canRequestManualEcho) {
      return isGuestFastEntry ? '登录后测试' : '登录后生成';
    }
    return '测试生成';
  }, [canRequestManualEcho, isCheckingAuth, isGuestFastEntry, isManualEchoRefreshing]);

  const renderManualEchoTriggerButton = useCallback(
    (className: string) => {
      if (!ENABLE_ECHO_MANUAL_TRIGGER) return null;

      return (
        <button
          type="button"
          disabled={isManualEchoRefreshing}
          onClick={() => {
            void refreshDailyEcho({ force: true });
          }}
          className={className}
        >
          <span className="inline-flex items-center gap-2">
            {isManualEchoRefreshing ? (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
              />
            ) : null}
            <span>{manualEchoButtonLabel}</span>
          </span>
        </button>
      );
    },
    [isManualEchoRefreshing, manualEchoButtonLabel, refreshDailyEcho]
  );

  const manualEchoFeedbackView: ReactNode =
    ENABLE_ECHO_MANUAL_TRIGGER && manualEchoFeedback ? (
      <div
        aria-live="polite"
        role="status"
        className={`mt-3 rounded-[16px] border px-3 py-2.5 ${getManualEchoFeedbackClasses(manualEchoFeedback.tone)}`}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/70">
            {manualEchoFeedback.tone === 'pending' ? (
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-full border-2 border-current border-t-transparent animate-spin"
              />
            ) : manualEchoFeedback.tone === 'success' ? (
              <Sparkles size={12} />
            ) : manualEchoFeedback.tone === 'error' ? (
              <AlertCircle size={12} />
            ) : (
              <Clock size={12} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold leading-5">{manualEchoFeedback.title}</p>
            <p className="text-[11px] leading-5 text-current/75">{manualEchoFeedback.body}</p>
          </div>
        </div>
      </div>
    ) : null;

  const manualEchoDebugView: ReactNode =
    ENABLE_ECHO_MANUAL_TRIGGER && manualEchoDebugNote ? (
      <details className="mt-2 text-[11px] leading-5 text-ink-muted">
        <summary className="list-none cursor-pointer select-none text-ink-muted [&::-webkit-details-marker]:hidden">
          查看测试信息
        </summary>
        <p className="mt-2 rounded-[14px] bg-paper-warm px-3 py-2 text-ink-muted">{manualEchoDebugNote}</p>
      </details>
    ) : null;

  // ==================== Echo filter chip 自动重置 ====================

  useEffect(() => {
    if (!echoFilterOptions.includes(selectedEchoChip)) {
      setSelectedEchoChip('全部');
    }
  }, [echoFilterOptions, selectedEchoChip]);

  // ==================== 返回 ====================

  return {
    refreshDailyEcho,
    echoFilterOptions,
    filteredWorkspaceEchoes,
    latestWorkspaceEchoId,
    historyWorkspaceEchoes,
    groupedWorkspaceEchoes,
    echoHistorySections,
    latestEchoForCenter,
    latestEchoIsToday,
    canRequestManualEcho,
    manualEchoButtonLabel,
    renderManualEchoTriggerButton,
    manualEchoFeedbackView,
    manualEchoDebugView,
  };
}
