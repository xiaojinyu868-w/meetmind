'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionResult, DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem } from '@/lib/ai-native/app-catalog';
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

interface CatalogResponse {
  apps?: Array<WorkshopAppCatalogItem & { enabled?: boolean }>;
}

interface ExecuteApiResponse {
  ok?: boolean;
  error?: string;
  result?: AppExecutionResult;
}

interface WorkshopYellowPageProps {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
}

function taskLabel(state: AppTaskState | undefined, generated: boolean): string {
  if (state?.status === 'running') return '生成中';
  if (state?.status === 'success') return '已生成';
  if (state?.status === 'error') return '失败';
  return generated ? '已生成' : '未生成';
}

function readPreferredModel(): string {
  if (typeof window === 'undefined') return DEFAULT_MODEL_ID;
  const model = window.localStorage.getItem(WORKSHOP_MODEL_PREFERENCE)?.trim();
  return model || DEFAULT_MODEL_ID;
}

export function WorkshopYellowPage(props: WorkshopYellowPageProps) {
  const { sessionId, dataSource, transcript, anchors, summaryOverview, keyDifficulties } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [apps, setApps] = useState<Array<WorkshopAppCatalogItem & { enabled?: boolean }>>([]);
  const [generatedMap, setGeneratedMap] = useState<Record<string, boolean>>({});
  const [taskMap, setTaskMap] = useState<Record<string, AppTaskState>>({});
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});

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
  }, [sessionId, visibleApps]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

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

  const runInBackground = useCallback(
    async (app: WorkshopAppCatalogItem) => {
      if (!sessionId) return;
      if (runningMap[app.key]) return;

      if (transcript.length === 0) {
        const failedState: AppTaskState = {
          status: 'error',
          updatedAt: Date.now(),
          error: '当前会话暂无可用课堂内容，请先录音或导入。',
        };
        writeCachedTaskState(sessionId, app.key, failedState);
        setTaskMap((prev) => ({ ...prev, [app.key]: failedState }));
        toast.error('当前会话暂无可用课堂内容，请先录音或导入。');
        return;
      }

      const runningState: AppTaskState = { status: 'running', updatedAt: Date.now() };
      writeCachedTaskState(sessionId, app.key, runningState);
      setTaskMap((prev) => ({ ...prev, [app.key]: runningState }));
      setRunningMap((prev) => ({ ...prev, [app.key]: true }));

      try {
        const response = await fetch('/api/apps/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
        toast.success(`${app.name} 已在后台生成完成`);
      } catch (error) {
        const message = error instanceof Error ? error.message : '生成失败';
        const failedState: AppTaskState = { status: 'error', updatedAt: Date.now(), error: message };
        writeCachedTaskState(sessionId, app.key, failedState);
        setTaskMap((prev) => ({ ...prev, [app.key]: failedState }));
        toast.error(`${app.name} 生成失败：${message}`);
      } finally {
        setRunningMap((prev) => ({ ...prev, [app.key]: false }));
      }
    },
    [anchors, dataSource, keyDifficulties, runningMap, sessionId, summaryOverview, transcript]
  );

  const runningCount = useMemo(
    () =>
      visibleApps.filter((app) => {
        const state = taskMap[app.key];
        return state?.status === 'running' || runningMap[app.key];
      }).length,
    [runningMap, taskMap, visibleApps]
  );

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
          const isGuest = searchParams.get('guest') === '1';
          const href = `/app/matrix/${app.key}?sessionId=${encodeURIComponent(sessionId)}&dataSource=${encodeURIComponent(dataSource)}${isGuest ? '&guest=1' : ''}`;
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
                <Link href={href} className={styles.link}>
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
    </section>
  );
}
