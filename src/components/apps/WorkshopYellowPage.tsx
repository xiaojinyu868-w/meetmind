'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  Zap,
  RotateCw,
  ExternalLink,
  ClipboardList,
  Play,
  RotateCcw,
  ListTodo,
  Layers,
  BookMarked,
  Sparkles,
  Network,
  Image as ImageIcon,
  Headphones,
  LineChart,
} from 'lucide-react';
import { resolveWorkshopModelId } from '@/lib/utils/workshop-model-preference';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionResult, ContextTier, DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem, WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { WORKSHOP_APP_CATALOG } from '@/lib/ai-native/app-catalog';
import { isAppSupportedAtTier } from '@/lib/ai-native/context-pack';
import {
  buildResultCacheKey,
  readCachedTaskState,
  writeCachedAppResult,
  writeCachedTaskState,
  type AppTaskState,
} from '@/components/apps/hooks/useAppExecution';
import styles from './WorkshopYellowPage.module.css';
import { useAuth } from '@/lib/hooks/useAuth';
import { OctoCrystalDispatcher } from '@/components/share/OctoCrystalDispatcher';

const DOCK_STORAGE_PREFIX = 'app_workspace_dock:';

/* ------------------------------------------------------------------ */
/*  AppHero — 取代静态 cover.svg 的内联视觉身份                          */
/*                                                                    */
/*  原因：之前每个 app 一张 SVG（如 flashcards-cover.svg 把两张卡硬叠         */
/*  在一起）——既无法统一 taste 又会被裁切错位。改为内联 = 大 lucide icon    */
/*  + 极淡 tint + 一句 outputType。每个 app 各一种 ceremony 调，但保持      */
/*  低饱和度（与 95% 平涂极简的 taste 一致）。                              */
/* ------------------------------------------------------------------ */

interface AppHeroVisual {
  Icon: typeof Layers;
  /** 极淡的 ceremony tint，hero 区背景；见 design system 第 5 节调色板 */
  tintBg: string;
  /** Icon 颜色，比 tint 深 1-2 阶 */
  iconColor: string;
}

const HERO_VISUALS: Record<WorkshopAppKey, AppHeroVisual> = {
  // v7：每个 app 都用极淡 pine fog 或 vermilion fog 为底，icon 用相应深色
  // 双签名色家族化——告诉用户"这是同一套设计系统的 7 个工具"，而不是 7 张壁纸
  flashcards: { Icon: Layers, tintBg: '#F2F6F3', iconColor: '#2D4F3E' },          // 闪卡 = 沉淀（pine 主）
  cheatsheet: { Icon: BookMarked, tintBg: '#FBF2EF', iconColor: '#B5483C' },      // 速查 = 标注此刻（vermilion）
  quiz: { Icon: Sparkles, tintBg: '#FBF2EF', iconColor: '#B5483C' },              // 测验 = 红笔批改（vermilion）
  mindmap: { Icon: Network, tintBg: '#F2F6F3', iconColor: '#2D4F3E' },            // 思维 = 知识网（pine）
  infographic: { Icon: ImageIcon, tintBg: '#F2F6F3', iconColor: '#2D4F3E' },      // 信息图 = pine
  'audio-overview': { Icon: Headphones, tintBg: '#FBF2EF', iconColor: '#B5483C' },// 播客 = vermilion (此刻聆听)
  'study-report': { Icon: LineChart, tintBg: '#F2F6F3', iconColor: '#2D4F3E' },   // 报告 = pine（沉淀）
};

function AppHero({ appKey, outputType }: { appKey: WorkshopAppKey; outputType: string }) {
  const visual = HERO_VISUALS[appKey];
  const { Icon } = visual;
  return (
    <div
      className={styles.coverWrap}
      style={{ background: visual.tintBg, borderColor: 'transparent' }}
    >
      <div className={styles.heroInner}>
        <Icon size={42} strokeWidth={1.4} style={{ color: visual.iconColor }} />
        <span className={styles.heroOutputType} style={{ color: visual.iconColor }}>
          {outputType}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  StatusDot — 极简状态指示，替换原来的厚边框 chip                        */
/*                                                                    */
/*  与 AppWindowShell.StatusIndicator 同源 taste。                       */
/* ------------------------------------------------------------------ */

interface StatusDotProps {
  status: 'idle' | 'running' | 'success' | 'error';
  label: string;
}

function StatusDot({ status, label }: StatusDotProps) {
  // v7 状态色：pine = 沉淀 / 完成；vermilion = 朱批提醒（错误）
  const config: Record<StatusDotProps['status'], { color: string; pulse: boolean }> = {
    running: { color: '#2D4F3E', pulse: true },   // pine
    success: { color: '#2D4F3E', pulse: false },  // pine
    error: { color: '#B5483C', pulse: false },    // vermilion 朱批提醒
    idle: { color: '#8E8B82', pulse: false },     // ink-muted
  };
  const { color, pulse } = config[status];
  return (
    <span className={styles.statusDot}>
      <span className={styles.statusDotMark} aria-hidden>
        {pulse ? (
          <span
            className={styles.statusDotPulse}
            style={{ background: color }}
          />
        ) : null}
        <span
          className={styles.statusDotCore}
          style={{ background: color }}
        />
      </span>
      <span className={styles.statusDotLabel}>{label}</span>
    </span>
  );
}

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

function parseClientTimeoutMs(
  envValue: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(envValue || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const WORKSHOP_EXEC_TIMEOUT_DEFAULT_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_TIMEOUT_MS,
  180 * 1000,
  30 * 1000,
  10 * 60 * 1000
);
const WORKSHOP_EXEC_TIMEOUT_PODCAST_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_PODCAST_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000
);

function resolveWorkshopTimeoutMs(appKey: string): number {
  return appKey === 'audio-overview' ? WORKSHOP_EXEC_TIMEOUT_PODCAST_MS : WORKSHOP_EXEC_TIMEOUT_DEFAULT_MS;
}

interface WorkshopYellowPageProps {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  onOpenAppWindow?: (appKey: WorkshopAppKey) => void;
  /**
   * 当前矩阵展示的层（PRD v1.1 §3 / §8）。
   *
   * 默认 'class' —— 本期所有调用点都在课堂复习页，未来单元/考试层落地时
   * 会从对应路由传入对应 tier。catalog 中应用的 supportedTiers 字段决定
   * 该 tier 下哪些应用应展示。
   */
  tier?: ContextTier;
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

function formatElapsed(startMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function readResultPreview(sessionId: string, appKey: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.localStorage.getItem(buildResultCacheKey(sessionId, appKey));
    if (!raw) return '';
    const parsed = JSON.parse(raw) as AppExecutionResult;
    if (parsed.render?.title) return parsed.render.title;
    if (parsed.cards?.length > 0) {
      return parsed.cards[0].title || parsed.cards[0].body?.slice(0, 40) || '';
    }
    return '';
  } catch {
    return '';
  }
}

function ElapsedTimer({ startMs }: { startMs: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className={styles.elapsed}>{formatElapsed(startMs, now)}</span>;
}

export function WorkshopYellowPage(props: WorkshopYellowPageProps) {
  const {
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    onOpenAppWindow,
    tier = 'class',
  } = props;
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken } = useAuth();
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
    const source = apps.length > 0 ? apps : WORKSHOP_APP_CATALOG;
    // 按当前 tier 过滤：本期 tier='class'，所有 catalog 应用都含 'class'，不会被过滤掉
    // 未来 unit/exam tier 上线后，这里自动只展示该 tier 支持的应用（PRD v1.1 §8.5）
    const filtered = source.filter((app) =>
      isAppSupportedAtTier((app as WorkshopAppCatalogItem).supportedTiers, tier)
    );
    // 课堂播客降级（PRD v1.1 §5.5）：在卡片网格里排到最后，视觉次级化
    // 它生成成本最高、不属于"桌前主流复习"，应该被理性的人主动去找而不是先看见
    return [...filtered].sort((a, b) => {
      if (a.key === 'audio-overview') return 1;
      if (b.key === 'audio-overview') return -1;
      return 0;
    });
  }, [apps, tier]);

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

      let timeoutTriggered = false;
      try {
        const timeoutMs = resolveWorkshopTimeoutMs(app.key);
        const preferredModel = await resolveWorkshopModelId();
        const requestBody = JSON.stringify({
          appKey: app.key,
          model: preferredModel,
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
        });
        const yhHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (accessToken) {
          yhHeaders['Authorization'] = `Bearer ${accessToken}`;
        }

        const timeoutId = window.setTimeout(() => {
          timeoutTriggered = true;
          controller.abort();
        }, timeoutMs);

        let response: Response;
        try {
          response = await fetch('/api/apps/execute', {
            method: 'POST',
            headers: yhHeaders,
            signal: controller.signal,
            body: requestBody,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        // 如实暴露失败原因，不掩盖：
        // - route 正常报错时返回 { ok:false, error }，直接用后端给的 error；
        // - 后端没正常响应（502/504/进程重启返回 HTML）时 response.json() 会失败，
        //   此时把真实 HTTP 状态 + 响应片段带出来，便于定位是网关还是上游挂了，
        //   而不是退回无信息量的字面量 "生成失败"。
        const rawBody = await response.text();
        let data: ExecuteApiResponse = {};
        try {
          data = JSON.parse(rawBody) as ExecuteApiResponse;
        } catch {
          data = {};
        }

        if (!response.ok || !data.ok || !data.result) {
          const backendError = data.error?.trim();
          const snippet = !backendError && rawBody ? `：${rawBody.slice(0, 120).replace(/\s+/g, ' ').trim()}` : '';
          throw new Error(backendError || `服务端返回 HTTP ${response.status}${snippet}`);
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
        toast.success(`${app.name} 已生成完成`, {
          action:
            onOpenAppWindow || app.key === 'infographic'
              ? {
                  label: '打开结果',
                  onClick: () => {
                    if (app.key === 'infographic') {
                      router.push(buildAppHref(app.key));
                      return;
                    }
                    onOpenAppWindow?.(app.key);
                  },
                }
              : undefined,
        });
      } catch (error) {
        const isAborted =
          (error instanceof DOMException && error.name === 'AbortError') ||
          (error instanceof Error && error.name === 'AbortError');

        if (isAborted) {
          const timeoutMessage = `生成超时（${Math.round(resolveWorkshopTimeoutMs(app.key) / 1000)}s），请重试或切换模型。`;
          const cancelled = {
            status: 'error' as const,
            updatedAt: Date.now(),
            error: timeoutTriggered ? timeoutMessage : '任务已取消',
          };
          writeCachedTaskState(sessionId, app.key, cancelled);
          setTaskMap((prev) => ({ ...prev, [app.key]: cancelled }));
          upsertDockTask(app, {
            status: timeoutTriggered ? 'error' : 'cancelled',
            updatedAt: Date.now(),
            message: timeoutTriggered ? timeoutMessage : '任务已取消',
          });
          if (timeoutTriggered) {
            toast.error(`${app.name} ${timeoutMessage}`);
          } else {
            toast.message(`${app.name} 任务已取消`);
          }
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
      onOpenAppWindow,
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

  const openAppSurface = useCallback(
    (appKey: WorkshopAppKey) => {
      if (onOpenAppWindow) {
        onOpenAppWindow(appKey);
        return;
      }
      router.push(buildAppHref(appKey));
    },
    [buildAppHref, onOpenAppWindow, router]
  );

  const openTaskResult = useCallback(
    (appKey: string) => {
      const app = appMap[appKey];
      if (!app) return;
      if (app.key === 'infographic') {
        router.push(buildAppHref(app.key));
        return;
      }
      openAppSurface(app.key);
    },
    [appMap, buildAppHref, openAppSurface, router]
  );

  const generateAll = useCallback(() => {
    // 课堂播客降级（PRD v1.1 §5.5）：移出"先做一版都做"批量入口。
    // 它生成时间长（≥3 分钟）+ 用户场景是"通勤/吃饭单点听"而非桌前批量复习。
    // 用户仍可在卡片"先做一版"按钮里单独触发。
    const pending = visibleApps.filter(
      (app) =>
        app.key !== 'audio-overview' &&
        !runningMap[app.key] &&
        !generatedMap[app.key]
    );
    if (pending.length === 0) {
      toast.message('所有应用已生成或正在生成中');
      return;
    }
    for (const app of pending) {
      void runInBackground(app);
    }
    toast.success(`已启动 ${pending.length} 个后台任务`);
  }, [generatedMap, runInBackground, runningMap, visibleApps]);

  const dockList = useMemo(
    () =>
      Object.values(dockTasks)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8),
    [dockTasks]
  );

  const retryAllFailed = useCallback(() => {
    const failed = dockList.filter((t) => t.status === 'error' || t.status === 'cancelled');
    if (failed.length === 0) return;
    for (const task of failed) {
      retryTask(task.appKey);
    }
    toast.success(`正在重试 ${failed.length} 个失败任务`);
  }, [dockList, retryTask]);

  const clearCompleted = useCallback(() => {
    setDockTasks((prev) => {
      const next: Record<string, DockTask> = {};
      for (const [key, task] of Object.entries(prev)) {
        if (task.status !== 'success') next[key] = task;
      }
      return next;
    });
    toast.success('已清除完成任务');
  }, []);

  const runningCount = useMemo(
    () =>
      visibleApps.filter((app) => {
        const state = taskMap[app.key];
        return state?.status === 'running' || runningMap[app.key];
      }).length,
    [runningMap, taskMap, visibleApps]
  );

  const generatedCount = useMemo(
    () => visibleApps.filter((app) => generatedMap[app.key]).length,
    [generatedMap, visibleApps]
  );

  const failedCount = useMemo(
    () => dockList.filter((task) => task.status === 'error' || task.status === 'cancelled').length,
    [dockList]
  );

  const completedCount = useMemo(() => dockList.filter((task) => task.status === 'success').length, [dockList]);
  const canBatchGenerate = visibleApps.some((app) => !runningMap[app.key] && !generatedMap[app.key]);

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>这节课能做什么</p>
        <h2 className={styles.title}>学习应用</h2>
        <p className={styles.subTitle}>
          把这节课变成练习、导图、播客和复习材料。先做一版，也可以进去慢慢看。
        </p>
        <p className={styles.subStatus} data-testid="workshop-task-summary">
          {`${visibleApps.length} 个应用 · 已做好 ${generatedCount} 个${runningCount > 0 ? ` · 正在做 ${runningCount} 个` : ''}${failedCount > 0 ? ` · 需要处理 ${failedCount} 个` : ''}`}
        </p>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.generateAllButton}
            onClick={generateAll}
            disabled={!canBatchGenerate}
            data-testid="workshop-generate-all"
          >
            <Zap size={14} strokeWidth={1.75} className="inline mr-1" />
            把还没做的都做一版
          </button>
        </div>
      </header>

      {/* v3.0 SharedAgent · 「递结晶」入口
          仪式时刻：Octo Buddy 抱着今天的结晶出现，让你挑一个递给同学。
          隐私：只读 cheatsheet/mindmap/quiz/infographic 的本地缓存，不读 flashcards/study-report。
          详见 roadmap/v3.0-virality-agent.md */}
      <OctoCrystalDispatcher
        sessionId={sessionId}
        transcript={transcript}
        summary={summaryOverview}
      />

      <div className={styles.grid}>
        {visibleApps.map((app) => {
          const generated = generatedMap[app.key];
          const taskState = taskMap[app.key];
          const isRunning = Boolean(runningMap[app.key]) || taskState?.status === 'running';
          const label = taskLabel(taskState, generated);
          const dockTask = dockTasks[app.key];
          const isFailed = taskState?.status === 'error' && !isRunning;
          const preview = generated ? readResultPreview(sessionId, app.key) : '';
          const cardClassName = [
            styles.card,
            generated ? styles.cardGenerated : '',
            isRunning ? styles.cardRunning : '',
            isFailed ? styles.cardFailed : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <article key={app.key} className={cardClassName} data-testid={`workshop-card-${app.key}`}>
              {/* R9-3 横向 list-item 布局：cover (48px) | cardBody (1fr) | actionRow (auto) */}
              <AppHero appKey={app.key} outputType={app.outputType} />

              <div className={styles.cardBody}>
                <div className={styles.rowTop}>
                  <div className={styles.titleGroup}>
                    <p className={styles.category}>{app.category}</p>
                    <p className={styles.appName} title={app.name}>{app.name}</p>
                  </div>
                  {isRunning && dockTask ? (
                    <span className={styles.statusDot}>
                      <span className={styles.statusDotMark} aria-hidden>
                        <span
                          className={styles.statusDotPulse}
                          style={{ background: '#2D4F3E' }}
                        />
                        <span
                          className={styles.statusDotCore}
                          style={{ background: '#2D4F3E' }}
                        />
                      </span>
                      <span className={`${styles.statusDotLabel} tabular-nums`}>
                        <ElapsedTimer startMs={dockTask.startedAt} />
                      </span>
                    </span>
                  ) : (
                    <StatusDot
                      status={
                        isFailed ? 'error' : generated ? 'success' : 'idle'
                      }
                      label={isFailed ? '没做好' : generated ? '做好了' : '待开始'}
                    />
                  )}
                </div>
                <div className={styles.tags}>
                  {app.tags.slice(0, 3).map((tag) => (
                    <span key={`${app.key}-${tag}`} className={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
                <p className={styles.description} title={app.description}>{app.description}</p>
                {preview ? (
                  <div className={styles.previewBlock}>
                    <p className={styles.previewLabel}>最近结果</p>
                    <p className={styles.previewLine} title={preview}>
                      <ClipboardList size={12} strokeWidth={1.75} className="inline mr-1 align-text-bottom" />
                      {preview.length > 50 ? preview.slice(0, 50) + '...' : preview}
                    </p>
                  </div>
                ) : null}
                {taskState?.status === 'error' && taskState.error ? (
                  <p className={styles.errorLine} title={taskState.error}>
                    上次没做完，再试一次试试
                  </p>
                ) : null}
              </div>

              <div className={styles.actionRow}>
                {isRunning ? (
                  <button
                    type="button"
                    className={styles.primaryAction}
                    onClick={() => setDockOpen(true)}
                    data-testid={`workshop-inline-progress-${app.key}`}
                  >
                    <ListTodo size={12} strokeWidth={1.75} className="inline mr-0.5" />
                    查看进度
                  </button>
                ) : isFailed ? (
                  /* 失败：单按钮「再做一版」。删除原本的次级"进去看看"——
                     失败的产物没什么好看的，给用户一个清晰动作就够了 */
                  <button
                    type="button"
                    className={styles.primaryAction}
                    onClick={() => retryTask(app.key)}
                    data-testid={`workshop-inline-retry-${app.key}`}
                  >
                    <RotateCcw size={12} strokeWidth={1.75} className="inline mr-0.5" />
                    再做一版
                  </button>
                ) : generated ? (
                  <button
                    type="button"
                    className={styles.primaryAction}
                    onClick={() => openTaskResult(app.key)}
                    data-testid={`workshop-open-result-${app.key}`}
                  >
                    <ExternalLink size={12} strokeWidth={1.75} className="inline mr-0.5" />
                    {app.key === 'infographic' ? '查看图片' : '打开结果'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryAction}
                    onClick={() => openAppSurface(app.key)}
                    data-testid={`workshop-open-app-${app.key}`}
                  >
                    <ExternalLink size={12} strokeWidth={1.75} className="inline mr-0.5" />
                    进去看看
                  </button>
                )}

                {isRunning ? (
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    onClick={() => openAppSurface(app.key)}
                    data-testid={`workshop-open-surface-${app.key}`}
                  >
                    <ExternalLink size={12} strokeWidth={1.75} className="inline mr-0.5" />
                    进去看看
                  </button>
                ) : isFailed ? (
                  /* 失败时不再显示次级按钮——保持单一动作焦点 */
                  null
                ) : (
                  <button
                    type="button"
                    className={styles.secondaryAction}
                    data-testid={`workshop-bg-generate-${app.key}`}
                    onClick={() => void runInBackground(app)}
                    disabled={isRunning}
                  >
                    {generated ? (
                      <>
                        <RotateCw size={12} strokeWidth={1.75} className="inline mr-0.5" />
                        再做一版
                      </>
                    ) : (
                      <>
                        <Play size={12} strokeWidth={1.75} className="inline mr-0.5" />
                        先做一版
                      </>
                    )}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {(runningCount > 0 || failedCount > 0 || completedCount > 0) ? (
        <div className={styles.dock}>
          <button
            type="button"
            className={styles.dockToggle}
            onClick={() => setDockOpen((prev) => !prev)}
            data-testid="workshop-dock-toggle"
          >
            <span className="flex items-center gap-1">
              <ListTodo size={14} strokeWidth={1.75} />
              生成进度
            </span>
            {runningCount > 0 ? (
              <span className={`${styles.dockStat} ${styles.dockStatRunning}`}>
                <span className={styles.pulseIndicator} />
                进行中 {runningCount}
              </span>
            ) : null}
            <span className={styles.dockStat}>已完成 {completedCount}</span>
            {failedCount > 0 ? <span className={`${styles.dockStat} ${styles.dockStatFailed}`}>需要处理 {failedCount}</span> : null}
          </button>

          {dockOpen ? (
            <aside className={styles.dockPanel} data-testid="workshop-dock-panel">
              <div className={styles.dockPanelHeader}>
                <p className={styles.dockPanelTitle}>生成进度</p>
                <div className={styles.dockHeaderActions}>
                  {failedCount > 0 ? (
                    <button type="button" className={styles.dockActionSecondary} onClick={retryAllFailed} data-testid="workshop-dock-retry-all">
                      全部重试
                    </button>
                  ) : null}
                  {completedCount > 0 ? (
                    <button type="button" className={styles.dockActionSecondary} onClick={clearCompleted} data-testid="workshop-dock-clear-done">
                      清除已完成
                    </button>
                  ) : null}
                  <button type="button" className={styles.dockClose} onClick={() => setDockOpen(false)}>
                    收起
                  </button>
                </div>
              </div>

              {dockList.length === 0 ? (
                <p className={styles.dockEmpty}>暂无进度记录，点任意应用的“先做一版”即可开始。</p>
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
                          <p className={styles.dockTaskName}>
                            {task.status === 'running' ? <span className={styles.pulseIndicator} /> : null}
                            {task.appName}
                          </p>
                          <span className={`${styles.dockTaskStatus} ${styles[`dockStatus${task.status}`]}`}>
                            {task.status === 'running' ? <ElapsedTimer startMs={task.startedAt} /> : statusText(task.status)}
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
                              {task.appKey === 'infographic' ? '查看图片' : '打开结果'}
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
      ) : null}
    </section>
  );
}
