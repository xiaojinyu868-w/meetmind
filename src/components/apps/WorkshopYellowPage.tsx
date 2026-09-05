'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  BookMarked,
  ChevronRight,
  ListTodo,
  Download,
} from 'lucide-react';
import { resolveWorkshopModelId } from '@/lib/utils/workshop-model-preference';
import type { Anchor, TranscriptSegment } from '@/types';
import type { AppExecutionResult, ContextTier, DataSourceType, WorkshopReadinessReason } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem, WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { WORKSHOP_APP_CATALOG } from '@/lib/ai-native/app-catalog';
import { isAppSupportedAtTier } from '@/lib/ai-native/context-pack';
import {
  buildResultCacheKey,
  buildTaskCacheKey,
  readCachedAppResult,
  readCachedTaskState,
  writeCachedAppResult,
  writeCachedTaskState,
  type AppTaskState,
} from '@/components/apps/hooks/useAppExecution';
import styles from './WorkshopYellowPage.module.css';
import { useAuth } from '@/lib/hooks/useAuth';
import { ShareArtifactAction } from '@/components/share/ShareArtifactAction';
import { FenshenEntryChip } from '@/components/fenshen/FenshenEntryChip';
import { isShareableArtifactAppKey } from '@/components/share/share-artifact-model';
import { WorkshopAppCard, type WorkshopCardStatus } from './WorkshopAppCard';
import { COPY } from '@/lib/ui/copy';
import { parsePointsBlock, describePointsBlock } from '@/hooks/points-guard';
import { openPaywallGlobal } from '@/hooks/usePaywall';
import { notifyPointsChanged } from '@/hooks/usePointsSummary';
import { createLogger } from '@/lib/logger';
import { recommendWorkshopApp } from './workshop-recommendation';
import { useWorkshopReadiness } from './hooks/useWorkshopReadiness';
import { AdminAiInspectorLink } from '@/components/admin/AdminAiInspectorLink';
import { ClassroomFlowMatrixEntry } from './ClassroomFlowArtifact';
import type { ClassroomFlowState } from '@/types/classroom-flow';
import { buildPromptAnchorContext, buildPromptTranscriptContext } from '@/lib/ai-native/prompt-context';
import {
  buildAudioOverviewChapterEvidence,
  buildAudioOverviewNarrationCorpus,
} from '@/lib/ai-native/app-prompts';

const DOCK_STORAGE_PREFIX = 'app_workspace_dock:';
const log = createLogger('workshop-matrix');

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
// 信息图：execute 现在内含服务端内联生图（见 studio-workshop 插件），
// 与服务端 APP_EXEC_INFOGRAPHIC_TIMEOUT_MS 对齐放宽到 5 分钟。
const WORKSHOP_EXEC_TIMEOUT_INFOGRAPHIC_MS = parseClientTimeoutMs(
  process.env.NEXT_PUBLIC_APP_EXEC_INFOGRAPHIC_TIMEOUT_MS,
  300 * 1000,
  60 * 1000,
  15 * 60 * 1000
);

function resolveWorkshopTimeoutMs(appKey: string): number {
  if (appKey === 'audio-overview') return WORKSHOP_EXEC_TIMEOUT_PODCAST_MS;
  if (appKey === 'infographic') return WORKSHOP_EXEC_TIMEOUT_INFOGRAPHIC_MS;
  return WORKSHOP_EXEC_TIMEOUT_DEFAULT_MS;
}

interface WorkshopYellowPageProps {
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  contextTitle?: string;
  onOpenAppWindow?: (appKey: WorkshopAppKey) => void;
  onOpenClassroomFlow?: (flow: ClassroomFlowState) => void;
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

function sameBooleanRecord(
  current: Record<string, boolean>,
  next: Record<string, boolean>,
): boolean {
  const keys = Object.keys(next);
  if (Object.keys(current).length !== keys.length) return false;
  return keys.every((key) => current[key] === next[key]);
}

function sameTaskRecord(
  current: Record<string, AppTaskState>,
  next: Record<string, AppTaskState>,
): boolean {
  const keys = Object.keys(next);
  if (Object.keys(current).length !== keys.length) return false;
  return keys.every((key) => {
    const left = current[key];
    const right = next[key];
    return left?.status === right?.status
      && left?.updatedAt === right?.updatedAt
      && left?.error === right?.error;
  });
}

function statusText(status: DockTaskStatus): string {
  if (status === 'running') return COPY.apps.matrix.running;
  if (status === 'success') return COPY.apps.matrix.ready;
  if (status === 'cancelled') return COPY.apps.matrix.cancel;
  return COPY.apps.matrix.failed;
}

function readinessMessage(reason: WorkshopReadinessReason): { title: string; body: string } {
  if (reason === 'not_learning') {
    return {
      title: COPY.apps.matrix.notLearningTitle,
      body: COPY.apps.matrix.notLearningBody,
    };
  }
  if (reason === 'unreliable_transcript') {
    return {
      title: COPY.apps.matrix.unreliableTitle,
      body: COPY.apps.matrix.unreliableBody,
    };
  }
  return {
    title: COPY.apps.matrix.insufficientTitle,
    body: COPY.apps.matrix.insufficientBody,
  };
}

function formatElapsed(startMs: number, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  if (m > 0) return `${m}分${s}秒`;
  return `${s}秒`;
}

function readCachedInfographicImageUrl(sessionId: string): { url: string; title: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(buildResultCacheKey(sessionId, 'infographic'));
    const parsed = raw ? (JSON.parse(raw) as AppExecutionResult) : null;
    const payload = (parsed?.render?.payload || {}) as { image?: { imageUrl?: string } };
    // imageUrl 是 base64 data URL，会被 localStorage 的 stripLargeInlineData 剥空；
    // 退而读 sessionStorage 里生成时单独存的完整 base64。
    let url = payload.image?.imageUrl || (parsed?.raw?.infographicImageUrl as string | undefined) || '';
    if (!url) {
      try {
        url = sessionStorage.getItem(`mm_infographic_img:${sessionId}`) || '';
      } catch { /* sessionStorage 不可用 */ }
    }
    if (!url) return null;
    const title = parsed?.render?.title || parsed?.cards?.[0]?.title || '课堂信息图';
    return { url, title };
  } catch {
    return null;
  }
}

// 播客与信息图同一交互契约：execute 已内联生成音频，缓存里能直接读出 audioUrl，
// 做好即弹播放器；缓存无音频（生成降级为纯脚本）才退回 toast「查看」进完整页。
function readCachedPodcastAudio(sessionId: string): { url: string; title: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(buildResultCacheKey(sessionId, 'audio-overview'));
    const parsed = raw ? (JSON.parse(raw) as AppExecutionResult) : null;
    const payload = (parsed?.render?.payload || {}) as { audioUrl?: string };
    const url =
      payload.audioUrl || ((parsed?.raw as { podcast?: { audioUrl?: string } } | undefined)?.podcast?.audioUrl ?? '');
    if (!url) return null;
    const title = parsed?.render?.title || '课堂播客';
    return { url, title };
  } catch {
    return null;
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
    // 按当前 tier 过滤直接生成能力。考试速查表不在 class 结果集中退化生成，
    // 但会由下方显性跨课入口承接到课程 / 多节课范围选择。
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

  const activeAnchorCount = useMemo(
    () => anchors.filter((anchor) => !anchor.cancelled && !anchor.resolved).length,
    [anchors],
  );
  const governedAppContexts = useMemo(() => {
    const anchorContext = buildPromptAnchorContext(anchors, 12);
    return {
      flashcards: {
        transcriptContext: buildPromptTranscriptContext(transcript, {
          maxChars: 8_000,
          includeIndex: true,
          includeTimestamp: true,
          minCharsPerSegment: 48,
        }).text,
        anchorContext,
      },
      quiz: {
        transcriptContext: buildPromptTranscriptContext(transcript, {
          maxChars: 8_000,
          includeIndex: true,
          includeTimestamp: false,
          minCharsPerSegment: 52,
        }).text,
        anchorContext,
      },
      mindmap: {
        transcriptContext: buildPromptTranscriptContext(transcript, {
          maxChars: 8_000,
          includeIndex: false,
          includeTimestamp: false,
          minCharsPerSegment: 52,
        }).text,
        anchorContext,
      },
      infographic: {
        transcriptContext: buildPromptTranscriptContext(transcript, {
          maxChars: 8_000,
          includeIndex: true,
          includeTimestamp: false,
          minCharsPerSegment: 56,
        }).text,
        anchorContext,
      },
      'audio-overview': {
        narrationCorpus: buildAudioOverviewNarrationCorpus(transcript, 12_000),
        chapterEvidenceContext: buildAudioOverviewChapterEvidence(transcript),
        anchorContext: buildPromptAnchorContext(anchors, 10),
      },
    };
  }, [anchors, transcript]);

  const { assessment, isAssessing, failed: readinessFailed } = useWorkshopReadiness({
    transcript,
    contextTitle: props.contextTitle,
    contextType: dataSource,
    activeAnchorCount,
    keyDifficulties,
    summary: summaryOverview,
    contextTier: tier,
  });

  // 不再替用户决定「能不能用」：所有应用始终可用，材料撑不住时由插件执行后诚实空态。
  // readiness 只负责「现在最适合」的推荐和材料不足的提示横幅。

  const fallbackRecommendation = useMemo(() => recommendWorkshopApp({
    activeAnchorCount,
    difficultyCount: keyDifficulties?.length ?? 0,
    segmentCount: transcript.length,
  }), [activeAnchorCount, keyDifficulties?.length, transcript.length]);

  // 模型明确返回 null 也是判断结果：说明当前没有一项值得被强推。
  // 旧逻辑会在 ready 时用前端规则补一个“现在最适合”，把模型的克制覆盖掉。
  const recommendationKey = assessment
    ? assessment.recommendedAppKey
    : fallbackRecommendation.key;
  const recommendationReason = fallbackRecommendation.key === recommendationKey
    ? fallbackRecommendation.reason
    : '';
  const recommendedApp = recommendationKey
    ? visibleApps.find((app) => app.key === recommendationKey)
    : undefined;
  const otherApps = visibleApps.filter((app) => app.key !== recommendedApp?.key);
  const blockedCopy = assessment?.status === 'not_ready'
    ? readinessMessage(assessment.reason)
    : null;

  useEffect(() => {
    if (assessment?.status !== 'not_ready' || typeof window === 'undefined') return;

    // 产物是课堂原文的派生缓存。材料被判断为不可加工时，继续保留旧产物会在
    // 后续转录增长后把早期幻觉重新带回来，因此这里清掉派生结果，不碰原录音。
    for (const app of visibleApps) {
      window.localStorage.removeItem(buildResultCacheKey(sessionId, app.key));
      window.localStorage.removeItem(buildTaskCacheKey(sessionId, app.key));
    }
    window.localStorage.removeItem(dockStorageKey(sessionId));
    setGeneratedMap({});
    setTaskMap({});
    setRunningMap({});
    setDockTasks({});
  }, [assessment?.status, sessionId, visibleApps]);

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
  const courseCheatsheetHref = useMemo(
    () => `/app?workspace=context&intent=cheatsheet${isGuest ? '&guest=1' : ''}`,
    [isGuest],
  );

  // 信息图"查看图片"不跳独立页——独立页重新挂载 InfographicWindow 时，
  // 若缓存 result 没有 imageUrl 会 auto-start 重新触发 5 步生成 loading，
  // 导致"做好了点查看却又在生成"。改为直接从缓存读出已生成图片在当前页弹出。
  const [infographicPreview, setInfographicPreview] = useState<{ url: string; title: string } | null>(null);
  // 播客同一契约：做好即弹播放器，音频 URL 从缓存直读，不进完整页干等。
  const [podcastPreview, setPodcastPreview] = useState<{ url: string; title: string } | null>(null);

  const downloadInfographicImage = useCallback(async () => {
    if (!infographicPreview?.url) return;
    try {
      const response = await fetch(infographicPreview.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${infographicPreview.title || '课堂信息图'}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      toast.success(COPY.apps.matrix.imageDownloaded);
    } catch {
      toast.error(COPY.apps.matrix.imageDownloadFailed);
    }
  }, [infographicPreview?.title, infographicPreview?.url]);

  const refreshState = useCallback(() => {
    if (!sessionId || typeof window === 'undefined') return;

    const nextGenerated: Record<string, boolean> = {};
    const nextTasks: Record<string, AppTaskState> = {};

    for (const app of visibleApps) {
      nextGenerated[app.key] = Boolean(window.localStorage.getItem(buildResultCacheKey(sessionId, app.key)));
      const cachedTask = readCachedTaskState(sessionId, app.key);
      if (cachedTask) nextTasks[app.key] = cachedTask;
    }

    // 定时同步只在缓存真的变化时更新 React state。此前每 1.5 秒无条件塞入
    // 新对象，会让整个三栏学习区持续重渲染，按钮点击和大画布交互都会发黏。
    setGeneratedMap((prev) => sameBooleanRecord(prev, nextGenerated) ? prev : nextGenerated);
    setTaskMap((prev) => sameTaskRecord(prev, nextTasks) ? prev : nextTasks);
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
        const errorMessage = COPY.apps.matrix.noContent;
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
          contextTier: tier,
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
            metadata: {
              title: props.contextTitle,
              contextType: dataSource,
            },
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

        // 诊断信息进日志，用户只看到稳定、可行动的产品文案。
        // HTTP 状态、网关 HTML、模型名都不是用户该承担的认知负担。
        const rawBody = await response.text();
        let data: ExecuteApiResponse = {};
        try {
          data = JSON.parse(rawBody) as ExecuteApiResponse;
        } catch {
          data = {};
        }

        if (!response.ok || !data.ok || !data.result) {
          const backendError = data.error?.trim();
          // 402 积分拦截：余额不足 / 本月成本到顶。与材料不足同级的安静空态：
          // 卡片回可开始状态，toast 一句说明（含余额与下月发放），不记错误。
          const pointsBlock = parsePointsBlock(response.status, data);
          if (pointsBlock) {
            log.info('app.execute.points_blocked', { appKey: app.key, kind: pointsBlock.kind });
            const idleState: AppTaskState = { status: 'idle', updatedAt: Date.now() };
            writeCachedTaskState(sessionId, app.key, idleState);
            setTaskMap((prev) => ({ ...prev, [app.key]: idleState }));
            upsertDockTask(app, { status: 'cancelled', updatedAt: Date.now(), message: undefined });
            toast.message(describePointsBlock(pointsBlock));
            notifyPointsChanged();
            // 高意向截断：余额不足（登录用户）同步唤起付费页；会员闸门弹会员 Tab；guest 限额/月熔断不弹
            if (pointsBlock.kind === 'insufficient_points') {
              openPaywallGlobal({ reason: 'insufficient_points', balance: pointsBlock.balance, required: pointsBlock.required });
            } else if (pointsBlock.kind === 'membership_required') {
              openPaywallGlobal({ reason: 'membership_required', requiredTier: pointsBlock.requiredTier });
            }
            return;
          }
          // 材料不足是预期内的诚实空态，不是失败：不记错误、不进红色失败态，
          // 卡片回到可开始状态，用户看到一句安静的说明。
          if (backendError === 'CONTENT_NOT_READY' || backendError === 'APP_NOT_SUITABLE') {
            log.info('app.execute.not_ready', { appKey: app.key, status: response.status, backendError });
            const idleState: AppTaskState = { status: 'idle', updatedAt: Date.now() };
            writeCachedTaskState(sessionId, app.key, idleState);
            setTaskMap((prev) => ({ ...prev, [app.key]: idleState }));
            upsertDockTask(app, { status: 'cancelled', updatedAt: Date.now(), message: undefined });
            toast.message(
              backendError === 'CONTENT_NOT_READY'
                ? COPY.apps.matrix.executeNotReady
                : COPY.apps.matrix.executeNotSuitable,
            );
            return;
          }
          log.error('app.execute.failed', {
            appKey: app.key,
            status: response.status,
            backendError,
            responsePreview: rawBody.slice(0, 240).replace(/\s+/g, ' ').trim(),
          });
          throw new Error(COPY.apps.matrix.generateFailed);
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
        // 信息图做好即弹成品图（execute 已内联生图，缓存里能直接读出 imageUrl），
        // 不再让用户点「查看」或进独立页干等；缓存无图（生图降级失败）才退回
        // toast「查看」→ 独立页补生成。播客同一契约：做好即弹播放器直播。
        const infographicReady =
          app.key === 'infographic' ? readCachedInfographicImageUrl(sessionId) : null;
        if (infographicReady) {
          setInfographicPreview(infographicReady);
        }
        const podcastReady =
          app.key === 'audio-overview' ? readCachedPodcastAudio(sessionId) : null;
        if (podcastReady) {
          setPodcastPreview(podcastReady);
        }
        const poppedDirectly = Boolean(infographicReady || podcastReady);
        toast.success(COPY.apps.matrix.generated(app.name), {
          action:
            !poppedDirectly && (onOpenAppWindow || app.key === 'infographic' || app.key === 'audio-overview')
              ? {
                  label: COPY.apps.matrix.openResult,
                  onClick: () => {
                    if (app.key === 'infographic') {
                      const cached = readCachedInfographicImageUrl(sessionId);
                      if (cached) {
                        setInfographicPreview(cached);
                        return;
                      }
                      router.push(buildAppHref(app.key));
                      return;
                    }
                    if (app.key === 'audio-overview') {
                      const cached = readCachedPodcastAudio(sessionId);
                      if (cached) {
                        setPodcastPreview(cached);
                        return;
                      }
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
          const timeoutMessage = COPY.apps.matrix.timeout;
          const cancelled = {
            status: 'error' as const,
            updatedAt: Date.now(),
            error: timeoutTriggered ? timeoutMessage : COPY.apps.matrix.cancelled,
          };
          writeCachedTaskState(sessionId, app.key, cancelled);
          setTaskMap((prev) => ({ ...prev, [app.key]: cancelled }));
          upsertDockTask(app, {
            status: timeoutTriggered ? 'error' : 'cancelled',
            updatedAt: Date.now(),
            message: timeoutTriggered ? timeoutMessage : COPY.apps.matrix.cancelled,
          });
          if (timeoutTriggered) {
            toast.error(COPY.apps.matrix.timeoutFor(app.name));
          } else {
            toast.message(COPY.apps.matrix.cancelledFor(app.name));
          }
        } else {
          const message = error instanceof Error ? error.message : COPY.apps.matrix.generateFailed;
          log.error('app.execute.client-failed', {
            appKey: app.key,
            message,
          });
          const failedState: AppTaskState = { status: 'error', updatedAt: Date.now(), error: message };
          writeCachedTaskState(sessionId, app.key, failedState);
          setTaskMap((prev) => ({ ...prev, [app.key]: failedState }));
          upsertDockTask(app, {
            status: 'error',
            updatedAt: Date.now(),
            message,
          });
          toast.error(COPY.apps.matrix.failedFor(app.name));
        }
      } finally {
        delete abortControllersRef.current[app.key];
        setRunningMap((prev) => ({ ...prev, [app.key]: false }));
      }
    },
    [
      anchors,
      accessToken,
      buildAppHref,
      dataSource,
      dockTasks,
      generatedMap,
      keyDifficulties,
      onOpenAppWindow,
      props.contextTitle,
      runningMap,
      router,
      sessionId,
      summaryOverview,
      transcript,
      tier,
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
        // 优先直接弹图片预览（从缓存读已生成的 imageUrl），不跳独立页；
        // 缓存里没图才回退到独立页走生成流程。
        const cached = readCachedInfographicImageUrl(sessionId);
        if (cached) {
          setInfographicPreview(cached);
          return;
        }
        router.push(buildAppHref(app.key));
        return;
      }
      if (app.key === 'audio-overview') {
        // 播客同理：缓存里有音频就直接弹播放器，没有才进完整页。
        const cached = readCachedPodcastAudio(sessionId);
        if (cached) {
          setPodcastPreview(cached);
          return;
        }
      }
      openAppSurface(app.key);
    },
    [appMap, buildAppHref, openAppSurface, router, sessionId]
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

  const generatedCount = useMemo(
    () => visibleApps.filter((app) => generatedMap[app.key]).length,
    [generatedMap, visibleApps]
  );

  const failedCount = useMemo(
    () => dockList.filter((task) => task.status === 'error' || task.status === 'cancelled').length,
    [dockList]
  );

  const completedCount = useMemo(() => dockList.filter((task) => task.status === 'success').length, [dockList]);
  const renderAppCard = (app: WorkshopAppCatalogItem, isRecommended = false) => {
    const generated = Boolean(generatedMap[app.key]);
    const taskState = taskMap[app.key];
    const isRunning = Boolean(runningMap[app.key]) || taskState?.status === 'running';
    const status: WorkshopCardStatus = isRunning
      ? 'running'
      : taskState?.status === 'error'
        ? 'error'
        : generated
          ? 'success'
          : 'idle';
    const dockTask = dockTasks[app.key];
    const cachedResult = generated ? readCachedAppResult(sessionId, app.key) : null;
    return (
      <WorkshopAppCard
        key={app.key}
        app={app}
        status={status}
        recommended={isRecommended}
        recommendationReason={isRecommended ? recommendationReason : undefined}
        progressLabel={dockTask ? <ElapsedTimer startMs={dockTask.startedAt} /> : undefined}
        onStart={() => void runInBackground(app)}
        onOpen={() => openTaskResult(app.key)}
        onRetry={() => retryTask(app.key)}
        onRemake={() => void runInBackground(app)}
        onProgress={() => setDockOpen(true)}
        compact={!isRecommended}
        shareAction={cachedResult && isShareableArtifactAppKey(app.key) ? (
          <ShareArtifactAction
            appKey={app.key}
            result={cachedResult}
            sessionId={sessionId}
            transcript={transcript}
            courseTitle={props.contextTitle}
            summary={summaryOverview}
            className={styles.secondaryAction}
          />
        ) : undefined}
        adminAction={app.key === 'flashcards' || app.key === 'quiz' || app.key === 'mindmap' || app.key === 'infographic' || app.key === 'audio-overview' ? (
          <AdminAiInspectorLink
            controlKey={`app:${app.key}`}
            context={{ goalIntent: app.intent, ...governedAppContexts[app.key] }}
            query={app.intent}
            compact
          />
        ) : undefined}
      />
    );
  };
  return (
    <section
      className={styles.page}
      data-testid="workshop-yellow-page"
      data-readiness-state={readinessFailed ? 'fallback' : isAssessing ? 'assessing' : assessment ? 'remote' : 'none'}
    >
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <p className={styles.eyebrow}>{COPY.apps.matrix.eyebrow}</p>
            <h2 className={styles.title}>{blockedCopy?.title ?? COPY.apps.matrix.title}</h2>
          </div>
          <p className={styles.contextBasis}>{COPY.apps.matrix.contextBasis(transcript.length, activeAnchorCount, keyDifficulties?.length ?? 0)}</p>
        </div>
        {blockedCopy?.body ? <p className={styles.subTitle}>{blockedCopy.body}</p> : null}
        {assessment?.status !== 'not_ready' && (runningCount > 0 || failedCount > 0) ? (
          <p className={styles.subStatus} data-testid="workshop-task-summary">
            {COPY.apps.matrix.summary(visibleApps.length, generatedCount, runningCount, failedCount)}
          </p>
        ) : null}
      </header>

      {isAssessing && !assessment ? (
        <div className={styles.readinessPending} role="status">
          <span className={styles.readinessPulse} aria-hidden />
          {COPY.apps.matrix.assessing}
        </div>
      ) : null}

      {tier === 'class' && props.onOpenClassroomFlow ? (
        <ClassroomFlowMatrixEntry sessionId={sessionId} onOpen={props.onOpenClassroomFlow} />
      ) : null}

      {/* 「请一个分身」固定入口（非产物型应用，不进 catalog；架层在 chip 内部） */}
      <section className={styles.matrixSection} aria-labelledby="fenshen-entry-title">
        <div className={styles.sectionHeading}>
          <h3 id="fenshen-entry-title" className={styles.sectionTitle}>
            {COPY.fenshen.entrySectionTitle}
          </h3>
        </div>
        <FenshenEntryChip variant="card" />
      </section>

      {recommendedApp ? (
        <section className={styles.matrixSection} aria-labelledby="workshop-recommended-title">
          <div className={styles.sectionHeading}>
            <h3 id="workshop-recommended-title" className={styles.sectionTitle}>{COPY.apps.matrix.recommendedTitle}</h3>
          </div>
          <div className={`${styles.grid} ${styles.recommendedGrid}`}>{renderAppCard(recommendedApp, true)}</div>
        </section>
      ) : null}

      {otherApps.length > 0 ? (
        <section className={styles.matrixSection} aria-labelledby="workshop-all-title">
          <div className={styles.sectionHeading}>
            <h3 id="workshop-all-title" className={styles.sectionTitle}>
              {assessment?.status === 'not_ready'
                ? COPY.apps.matrix.previewTitle
                : recommendedApp
                  ? COPY.apps.matrix.allTitle
                  : COPY.apps.matrix.availableTitle}
            </h3>
          </div>
          <div className={styles.grid}>{otherApps.map((app) => renderAppCard(app))}</div>
        </section>
      ) : null}

      {tier === 'class' ? (
        <section className={styles.matrixSection} aria-labelledby="course-cheatsheet-entry-title">
          <div className={styles.sectionHeading}>
            <h3 id="course-cheatsheet-entry-title" className={styles.sectionTitle}>{COPY.apps.matrix.courseCheatsheetSection}</h3>
          </div>
          <button
            type="button"
            className={styles.contextAppCard}
            onClick={() => router.push(courseCheatsheetHref)}
            data-testid="workshop-course-cheatsheet-entry"
          >
            <span className={styles.contextAppIcon} aria-hidden><BookMarked size={22} strokeWidth={1.6} /></span>
            <span className={styles.contextAppBody}>
              <strong>{COPY.apps.matrix.courseCheatsheetTitle}</strong>
              <span>{COPY.apps.matrix.courseCheatsheetBody}</span>
            </span>
            <span className={styles.contextAppAction}>
              {COPY.apps.matrix.courseCheatsheetAction}
              <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
            </span>
          </button>
        </section>
      ) : null}

      {assessment?.status !== 'not_ready' && (runningCount > 0 || failedCount > 0) ? (
        <div className={styles.dock}>
          <button
            type="button"
            className={styles.dockToggle}
            onClick={() => setDockOpen((prev) => !prev)}
            data-testid="workshop-dock-toggle"
          >
            <span className="flex items-center gap-1">
              <ListTodo size={14} strokeWidth={1.75} />
              {COPY.apps.matrix.taskTray}
            </span>
            {runningCount > 0 ? (
              <span className={`${styles.dockStat} ${styles.dockStatRunning}`}>
                <span className={styles.pulseIndicator} />
                {COPY.apps.matrix.taskRunning(runningCount)}
              </span>
            ) : null}
            <span className={styles.dockStat}>{COPY.apps.matrix.taskDone(completedCount)}</span>
            {failedCount > 0 ? <span className={`${styles.dockStat} ${styles.dockStatFailed}`}>{COPY.apps.matrix.taskNeedsAttention(failedCount)}</span> : null}
          </button>

          {dockOpen ? (
            <aside className={styles.dockPanel} data-testid="workshop-dock-panel">
              <div className={styles.dockPanelHeader}>
                <p className={styles.dockPanelTitle}>{COPY.apps.matrix.taskPanelTitle}</p>
                <div className={styles.dockHeaderActions}>
                  <button type="button" className={styles.dockClose} onClick={() => setDockOpen(false)}>
                    {COPY.apps.matrix.collapse}
                  </button>
                </div>
              </div>

              {dockList.length === 0 ? (
                <p className={styles.dockEmpty}>{COPY.apps.matrix.noTasks}</p>
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
                        {task.message ? <p className={styles.dockTaskMessage}>{task.message}</p> : null}
                        <div className={styles.dockTaskActions}>
                          {task.status === 'running' ? (
                            <button
                              type="button"
                              className={styles.dockActionSecondary}
                              onClick={() => cancelTask(task.appKey)}
                              data-testid={`workshop-dock-cancel-${task.appKey}`}
                            >
                              {COPY.apps.matrix.cancel}
                            </button>
                          ) : null}
                          {task.status === 'error' || task.status === 'cancelled' ? (
                            <button
                              type="button"
                              className={styles.dockActionSecondary}
                              onClick={() => retryTask(task.appKey)}
                              data-testid={`workshop-dock-retry-${task.appKey}`}
                            >
                              {COPY.apps.matrix.retry}
                            </button>
                          ) : null}
                          {canOpen ? (
                            <button
                              type="button"
                              className={styles.dockActionPrimary}
                              onClick={() => openTaskResult(task.appKey)}
                              data-testid={`workshop-dock-open-${task.appKey}`}
                            >
                              {task.appKey === 'infographic' ? COPY.apps.matrix.openImage : COPY.apps.matrix.open}
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
      {infographicPreview ? (
        <div
          className={styles.previewOverlay}
          onClick={() => setInfographicPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={COPY.apps.matrix.infographicPreview}
        >
          <div
            className={styles.previewStage}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={infographicPreview.url}
              alt={infographicPreview.title}
              className={styles.previewImage}
            />
            <div className={styles.previewActions}>
              <button
                type="button"
                onClick={downloadInfographicImage}
                className={styles.previewPrimaryAction}
              >
                <Download size={14} strokeWidth={2} />
                {COPY.apps.matrix.downloadImage}
              </button>
              <button
                type="button"
                onClick={() => setInfographicPreview(null)}
                className={styles.previewSecondaryAction}
              >
                {COPY.apps.matrix.closePreview}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {podcastPreview ? (
        <div
          className={styles.previewOverlay}
          onClick={() => setPodcastPreview(null)}
          role="dialog"
          aria-modal="true"
          aria-label={COPY.apps.matrix.podcastPreview}
        >
          <div
            className={styles.previewStage}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.podcastCard}>
              <p className={styles.podcastTitle}>{podcastPreview.title}</p>
              {/* autoPlay 是尽力而为：异步完成后浏览器多半已收回用户手势，
                  被拦时用户点一下播放键即可，不会再被带去别的页面等 */}
              <audio
                className={styles.podcastAudio}
                src={podcastPreview.url}
                controls
                autoPlay
                preload="auto"
              />
            </div>
            <div className={styles.previewActions}>
              <button
                type="button"
                onClick={() => setPodcastPreview(null)}
                className={styles.previewSecondaryAction}
              >
                {COPY.apps.matrix.closePreview}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
