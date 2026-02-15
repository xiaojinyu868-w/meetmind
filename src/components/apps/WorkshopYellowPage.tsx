'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionResult, DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem, WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { WORKSHOP_APP_CATALOG } from '@/lib/ai-native/app-catalog';
import {
  buildResultCacheKey,
  readCachedTaskState,
  writeCachedAppResult,
  writeCachedTaskState,
  type AppTaskState,
} from '@/components/apps/hooks/useAppExecution';
import styles from './WorkshopYellowPage.module.css';

const WORKSHOP_MODEL_PREFERENCE = 'ai_workshop_model';
const DOCK_STORAGE_PREFIX = 'app_workspace_dock:';

interface CatalogResponse {
  apps?: Array<WorkshopAppCatalogItem & { enabled?: boolean }>;
}

interface ExecuteApiResponse {
  ok?: boolean;
  error?: string;
  result?: AppExecutionResult;
}

type DockTaskStatus = 'running' | 'success' | 'error' | 'cancelled';

interface DockTask {
  appKey: string;
  appName: string;
  status: DockTaskStatus;
  updatedAt: number;
  startedAt: number;
  attempt: number;
  hasResult: boolean;
  message?: string;
}

interface WorkshopYellowPageProps {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  onOpenAppWindow?: (appKey: WorkshopAppKey) => void;
}

function dockStorageKey(sessionId: string): string {
  return `${DOCK_STORAGE_PREFIX}${sessionId}`;
}

function readDockTasks(sessionId: string): Record<string, DockTask> {
  if (typeof window === 'undefined' || !sessionId) return {};
  try {
    const raw = window.localStorage.getItem(dockStorageKey(sessionId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DockTask>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDockTasks(sessionId: string, tasks: Record<string, DockTask>): void {
  if (typeof window === 'undefined' || !sessionId) return;
  window.localStorage.setItem(dockStorageKey(sessionId), JSON.stringify(tasks));
}

function taskLabel(state: AppTaskState | undefined, generated: boolean): string {
  if (state?.status === 'running') return '生成中';
  if (state?.status === 'success') return '已生成';
  if (state?.status === 'error') {
    if ((state.error || '').includes('取消')) return '已取消';
    return '失败';
  }
  return generated ? '已生成' : '未生成';
}

function readPreferredModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID;
  const model = window.localStorage.getItem(WORKSHOP_MODEL_PREFERENCE)?.trim();
  return model || DEFAULT_MODEL_ID;
}

function statusText(status: DockTaskStatus): string {
  if (status === 'running') return '运行中';
  if (status === 'success') return '已完成';
  if (status === 'cancelled') return '已取消';
  return '失败';
}

function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function WorkshopYellowPage(props: WorkshopYellowPageProps) {
  const { sessionId, dataSource, transcript, anchors, summaryOverview, keyDifficulties, onOpenAppWindow } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  const [apps, setApps] = useState<Array<WorkshopAppCatalogItem & { enabled?: boolean }>>([]);
  const [generatedMap, setGeneratedMap] = useState<Record<string, boolean>>({});
  const [taskMap, setTaskMap] = useState<Record<string, AppTaskState>>({});
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [dockTasks, setDockTasks] = useState<Record<string, DockTask>>({});
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const response = await fetch('/api/apps/catalog', { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as CatalogResponse;
      if (cancelled) return;
      if (Array.isArray(data.apps) && data.apps.length > 0) {
        setApps(data.apps);
      } else {
        setApps(WORKSHOP_APP_CATALOG);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleApps = useMemo(() => {
    if (apps.length > 0) return apps;
    return WORKSHOP_APP_CATALOG;
  }, [apps]);

  const appMap = useMemo(() => {
    const map: Record<string, WorkshopAppCatalogItem> = {};
    for (const app of visibleApps) {
      map[app.key] = app;
    }
    return map;
  }, [visibleApps]);

  const isGuest = searchParams.get('guest') === '1';
  const buildAppHref = useCallback(
    (appKey: string) =>
      `/app/matrix/${appKey}?sessionId=${encodeURIComponent(sessionId)}&dataSource=${encodeURIComponent(dataSource)}${
        isGuest ? '&guest=1' : ''
      }`,
    [dataSource, isGuest, sessionId]
  );

  const refreshState = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') return;

    const nextGenerated: Record<string, boolean> = {};
    const nextTasks: Record<string, AppTaskState> = {};

    for (const app of visibleApps) {
      nextGenerated[app.key] = Boolean(window.localStorage.getItem(buildResultCacheKey(sessionId, app.key)));
      const cachedTask = readCachedTaskState(sessionId, app.key);
      if (cachedTask) nextTasks[app.key] = cachedTask;
    }

    setGeneratedMap(nextGenerated);
    setTaskMap(nextTasks);
    setDockTasks((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const app of visibleApps) {
        const existing = next[app.key];
        const cached = nextTasks[app.key];
        const hasResult = nextGenerated[app.key];

        if (!existing && (cached || hasResult)) {
          next[app.key] = {
            appKey: app.key,
            appName: app.name,
            status: cached?.status === 'running' ? 'running' : cached?.status === 'success' ? 'success' : 'error',
            updatedAt: cached?.updatedAt || Date.now(),
            startedAt: cached?.updatedAt || Date.now(),
            attempt: 1,
            hasResult,
            message: cached?.error,
          };
          changed = true;
          continue;
        }

        if (!existing) continue;

        const mappedStatus =
          cached?.status === 'running'
            ? 'running'
            : cached?.status === 'success'
              ? 'success'
              : cached?.status === 'error'
                ? existing.status === 'cancelled'
                  ? 'cancelled'
                  : 'error'
                : existing.status;

        if (existing.status !== mappedStatus || existing.hasResult !== hasResult) {
          next[app.key] = {
            ...existing,
            status: mappedStatus,
            hasResult,
            updatedAt: cached?.updatedAt || existing.updatedAt,
            message: cached?.error || existing.message,
          };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [sessionId, visibleApps]);

  useEffect(() => {
    setDockTasks(readDockTasks(sessionId));
    refreshState();
  }, [refreshState, sessionId]);

  useEffect(() => {
    writeDockTasks(sessionId, dockTasks);
  }, [dockTasks, sessionId]);

  useEffect(() => {
    if (!sessionId || typeof window === 'undefined') return undefined;

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.includes(sessionId)) {
        refreshState();
      }
    };

    const timer = window.setInterval(refreshState, 1500);
    window.addEventListener('storage', onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
    };
  }, [refreshState, sessionId]);

  useEffect(() => {
    for (const app of visibleApps) {
      router.prefetch(`/app/matrix/${app.key}`);
    }
  }, [router, visibleApps]);

  const upsertDockTask = useCallback((app: WorkshopAppCatalogItem, patch: Partial<DockTask>) => {
    setDockTasks((prev) => {
      const current = prev[app.key];
      const next: DockTask = {
        appKey: app.key,
        appName: app.name,
        status: patch.status || current?.status || 'running',
        startedAt: patch.startedAt || current?.startedAt || Date.now(),
        updatedAt: patch.updatedAt || Date.now(),
        attempt: patch.attempt || current?.attempt || 1,
        hasResult: patch.hasResult ?? current?.hasResult ?? false,
        message: patch.message ?? current?.message,
      };
      return { ...prev, [app.key]: next };
    });
  }, []);

  const runInBackground = useCallback(
    async (app: WorkshopAppCatalogItem) => {
      if (!sessionId) return;
      if (runningMap[app.key]) return;

      if (transcript.length === 0) {
        const errorMessage = '当前会话暂无可用课堂内容，请先录音或导入。';
        const failedState: AppTaskState = {
          status: 'error',
          updatedAt: Date.now(),
          error: errorMessage,
        };
        writeCachedTaskState(sessionId, app.key, failedState);
        setTaskMap((prev) => ({ ...prev, [app.key]: failedState }));
        upsertDockTask(app, {
          status: 'error',
          updatedAt: Date.now(),
          message: errorMessage,
          hasResult: Boolean(generatedMap[app.key]),
        });
        toast.error(errorMessage);
        return;
      }

      const controller = new AbortController();
      abortControllersRef.current[app.key] = controller;
      setRunningMap((prev) => ({ ...prev, [app.key]: true }));

      const runningState: AppTaskState = { status: 'running', updatedAt: Date.now() };
      writeCachedTaskState(sessionId, app.key, runningState);
      setTaskMap((prev) => ({ ...prev, [app.key]: runningState }));
      upsertDockTask(app, {
        status: 'running',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        attempt: (dockTasks[app.key]?.attempt || 0) + 1,
        message: undefined,
        hasResult: Boolean(generatedMap[app.key]),
      });

      try {
        const response = await fetch('/api/apps/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            appKey: app.key,
            model: readPreferredModel(),
            goal: {
              intent: app.intent,
              expectedOutput: 'mixed',
              appKey: app.key,
            },
            input: {
              sessionId,
              dataSource,
              transcript,
              anchors,
            },
            memory: {
              summary: summaryOverview,
              keyDifficulties,
            },
          }),
        });

        const data = (await response.json().catch(() => ({}))) as ExecuteApiResponse;
        if (!response.ok || !data.ok || !data.result) {
          throw new Error(data.error || '生成失败');
        }

        writeCachedAppResult(sessionId, app.key, data.result);
        const successState: AppTaskState = { status: 'success', updatedAt: Date.now() };
        writeCachedTaskState(sessionId, app.key, successState);
        setTaskMap((prev) => ({ ...prev, [app.key]: successState }));
        setGeneratedMap((prev) => ({ ...prev, [app.key]: true }));
        upsertDockTask(app, {
          status: 'success',
          updatedAt: Date.now(),
          hasResult: true,
          message: undefined,
        });
        toast.success(`${app.name} 已在后台生成完成`);
      } catch (error) {
        const isAborted =
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && error.name === 'AbortError');

        if (isAborted) {
          const cancelled = { status: 'error' as const, updatedAt: Date.now(), error: '任务已取消' };
          writeCachedTaskState(sessionId, app.key, cancelled);
          setTaskMap((prev) => ({ ...prev, [app.key]: cancelled }));
          upsertDockTask(app, {
            status: 'cancelled',
            updatedAt: Date.now(),
            message: '任务已取消',
          });
          toast.message(`${app.name} 任务已取消`);
        } else {
          const message = error instanceof Error ? error.message : '生成失败';
          const failedState: AppTaskState = { status: 'error', updatedAt: Date.now(), error: message };
          writeCachedTaskState(sessionId, app.key, failedState);
          setTaskMap((prev) => ({ ...prev, [app.key]: failedState }));
          upsertDockTask(app, {
            status: 'error',
            updatedAt: Date.now(),
            message,
          });
          toast.error(`${app.name} 生成失败：${message}`);
        }
      } finally {
        delete abortControllersRef.current[app.key];
        setRunningMap((prev) => ({ ...prev, [app.key]: false }));
      }
    },
    [
      anchors,
      dataSource,
      dockTasks,
      generatedMap,
      keyDifficulties,
      runningMap,
      sessionId,
      summaryOverview,
      transcript,
      upsertDockTask,
    ]
  );

  const cancelTask = useCallback((appKey: string) => {
    const controller = abortControllersRef.current[appKey];
    if (!controller) return;
    controller.abort();
  }, []);

  const retryTask = useCallback(
    (appKey: string) => {
      const app = appMap[appKey];
      if (!app) return;
      void runInBackground(app);
    },
    [appMap, runInBackground]
  );

  const openTaskResult = useCallback(
    (appKey: string) => {
      const app = appMap[appKey];
      if (!app) return;
      if (onOpenAppWindow) {
        onOpenAppWindow(app.key);
        return;
      }
      router.push(buildAppHref(app.key));
    },
    [appMap, buildAppHref, onOpenAppWindow, router]
  );

  const dockList = useMemo(
    () =>
      Object.values(dockTasks)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [dockTasks]
  );

  const runningCount = useMemo(
    () =>
      visibleApps.filter((app) => {
        const state = taskMap[app.key];
        return state?.status === 'running' || runningMap[app.key];
      }).length,
    [runningMap, taskMap, visibleApps]
  );

  const failedCount = useMemo(
    () => dockList.filter((task) => task.status === 'error' || task.status === 'cancelled').length,
    [dockList]
  );

  const completedCount = useMemo(() => dockList.filter((task) => task.status === 'success').length, [dockList]);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h2 className={styles.title}>多样的智能体应用</h2>
        <p className={styles.subTitle}>AI工坊只负责发现与进入，应用可后台并行生成，不打断主学习流。</p>
        <p className={styles.subStatus} data-testid="workshop-task-summary">
          {runningCount > 0 ? `后台任务运行中：${runningCount}` : '后台任务空闲，可继续对话、看时间轴和视频。'}
        </p>
      </header>

      <div className={styles.grid}>
        {visibleApps.map((app) => {
          const generated = generatedMap[app.key];
          const taskState = taskMap[app.key];
          const isRunning = Boolean(runningMap[app.key]) || taskState?.status === 'running';
          const href = buildAppHref(app.key);
          const label = taskLabel(taskState, generated);

          return (
            <article key={app.key} className={styles.card} data-testid={`workshop-card-${app.key}`}>
              <div className={styles.coverWrap}>
                <Image src={app.coverImage} alt={app.name} width={1200} height={630} className={styles.cover} />
              </div>
              <div className={styles.rowTop}>
                <div className={styles.titleGroup}>
                  <p className={styles.category}>{app.category}</p>
                  <p className={styles.headline}>{app.headline}</p>
                </div>
                <span
                  className={`${styles.generated} ${
                    label === '已生成' ? '' : label === '生成中' ? styles.running : styles.notGenerated
                  }`}
                >
                  {label}
                </span>
              </div>
              <div className={styles.tags}>
                {app.tags.slice(0, 3).map((tag) => (
                  <span key={`${app.key}-${tag}`} className={styles.tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <p className={styles.description}>{app.description}</p>
              <div className={styles.actionRow}>
                <button
                  type="button"
                  className={styles.generateButton}
                  data-testid={`workshop-bg-generate-${app.key}`}
                  onClick={() => {
                    void runInBackground(app);
                  }}
                  disabled={isRunning}
                >
                  {isRunning ? '后台生成中...' : '后台生成'}
                </button>
                <Link
                  href={href}
                  className={styles.link}
                  onClick={(event) => {
                    if (!onOpenAppWindow) return;
                    event.preventDefault();
                    onOpenAppWindow(app.key);
                  }}
                >
                  查看应用 <span>›</span>
                </Link>
              </div>
              <p className={styles.metaLine}>输出形态：{app.outputType}</p>
              {taskState?.status === 'error' && taskState.error ? (
                <p className={styles.errorLine} title={taskState.error}>
                  失败原因：{taskState.error}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className={styles.dock}>
        <button
          type="button"
          className={styles.dockToggle}
          onClick={() => setDockOpen((prev) => !prev)}
          data-testid="workshop-dock-toggle"
        >
          <span>任务中心</span>
          <span className={styles.dockStat}>进行中 {runningCount}</span>
          <span className={styles.dockStat}>完成 {completedCount}</span>
          <span className={styles.dockStat}>异常 {failedCount}</span>
        </button>

        {dockOpen ? (
          <aside className={styles.dockPanel} data-testid="workshop-dock-panel">
            <div className={styles.dockPanelHeader}>
              <p className={styles.dockPanelTitle}>后台任务</p>
              <button type="button" className={styles.dockClose} onClick={() => setDockOpen(false)}>
                收起
              </button>
            </div>

            {dockList.length === 0 ? (
              <p className={styles.dockEmpty}>暂无任务，点击任意应用卡片的“后台生成”即可开始。</p>
            ) : (
              <div className={styles.dockTaskList}>
                {dockList.map((task) => {
                  const canOpen = task.status === 'success' || task.hasResult;
                  return (
                    <article
                      key={task.appKey}
                      className={styles.dockTaskItem}
                      data-testid={`workshop-dock-task-${task.appKey}`}
                    >
                      <div className={styles.dockTaskTop}>
                        <p className={styles.dockTaskName}>{task.appName}</p>
                        <span className={`${styles.dockTaskStatus} ${styles[`dockStatus${task.status}`]}`}>
                          {statusText(task.status)}
                        </span>
                      </div>
                      <p className={styles.dockTaskMeta}>
                        第 {task.attempt} 次 · 最近更新 {formatClock(task.updatedAt)}
                      </p>
                      {task.message ? <p className={styles.dockTaskMessage}>{task.message}</p> : null}
                      <div className={styles.dockTaskActions}>
                        {task.status === 'running' ? (
                          <button
                            type="button"
                            className={styles.dockActionSecondary}
                            onClick={() => cancelTask(task.appKey)}
                            data-testid={`workshop-dock-cancel-${task.appKey}`}
                          >
                            取消
                          </button>
                        ) : null}
                        {task.status === 'error' || task.status === 'cancelled' ? (
                          <button
                            type="button"
                            className={styles.dockActionSecondary}
                            onClick={() => retryTask(task.appKey)}
                            data-testid={`workshop-dock-retry-${task.appKey}`}
                          >
                            重试
                          </button>
                        ) : null}
                        {canOpen ? (
                          <button
                            type="button"
                            className={styles.dockActionPrimary}
                            onClick={() => openTaskResult(task.appKey)}
                            data-testid={`workshop-dock-open-${task.appKey}`}
                          >
                            打开结果
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
