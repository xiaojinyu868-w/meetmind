'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModelSelector } from '@/components/ModelSelector';
import { resolveWorkshopModelId, WORKSHOP_MODEL_PREFERENCE_KEY } from '@/lib/utils/workshop-model-preference';
import type { Anchor, TranscriptSegment } from '@/types';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { COPY } from '@/lib/ui/copy';
import { APPS_COPY } from '@/lib/ui/copy-apps';
import type { FloatingWorkshopWindowState } from './workshop-window-state';
import { useAppExecution, type AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';

/* ================================================================ */
/*  窗口级 ErrorBoundary — 单窗口崩溃不影响其他窗口和主页面            */
/* ================================================================ */

interface WindowErrorBoundaryProps {
  appName: string;
  onRetry?: () => void;
  children: React.ReactNode;
}
interface WindowErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class WindowErrorBoundary extends React.Component<WindowErrorBoundaryProps, WindowErrorBoundaryState> {
  constructor(props: WindowErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): WindowErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[WindowErrorBoundary] ${this.props.appName} crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="rounded-full bg-paper-warm p-3">
            <svg className="h-6 w-6 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-ink-secondary">{APPS_COPY.shell.crashed(this.props.appName)}</p>
          <button
            type="button"
            className="text-xs font-medium text-pine underline decoration-pine/30 underline-offset-[3px] hover:decoration-pine"
            onClick={() => {
              this.setState({ hasError: false, error: undefined });
              this.props.onRetry?.();
            }}
          >
            {APPS_COPY.shell.crashedRetry}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

/** 全屏时不要内边距、自己铺满整面的应用（闪卡 / 测验的纸就是窗口）；手机上强制全屏 */
const IMMERSIVE_APPS: Set<WorkshopAppKey> = new Set(['flashcards', 'quiz']);

// 状态类型与默认展示模式在 workshop-window-state.ts（纯模块）——首屏 hook 从那里取，不必静态加载整棵窗口树
export type { WorkshopDisplayMode, FloatingWorkshopWindowState } from './workshop-window-state';

interface WorkshopWindowManagerProps {
  windows: FloatingWorkshopWindowState[];
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  onSeek?: (startMs: number) => void;
  onClose: (appKey: WorkshopAppKey) => void;
  onToggleMinimize: (appKey: WorkshopAppKey) => void;
  onFocus: (appKey: WorkshopAppKey) => void;
}

interface WindowCardProps {
  windowState: FloatingWorkshopWindowState;
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  model: string;
  onModelChange: (modelId: string) => void;
  onSeek?: (startMs: number) => void;
  onClose: (appKey: WorkshopAppKey) => void;
  onToggleMinimize: (appKey: WorkshopAppKey) => void;
  onFocus: (appKey: WorkshopAppKey) => void;
  stackOffset: number;
}

function formatDataSource(dataSource: DataSourceType): string {
  if (dataSource === 'live') return '实时录音';
  if (dataSource === 'video') return '视频导入';
  if (dataSource === 'demo') return '示例课';
  return '这节课';
}

function buildInfographicContentContext(summaryOverview: string | undefined, transcript: TranscriptSegment[]): string {
  const normalizedSummary = (summaryOverview || '').trim();
  if (normalizedSummary) return normalizedSummary;
  return transcript
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 1400);
}

function taskLabel(taskState: AppTaskState): string {
  // 与 AppWindowShell 的状态点同一套词（做好了 / 正在做 / 没做好 / 还没开始），不再一边「已完成」一边「做好了」
  if (taskState.status === 'running') return COPY.apps.matrix.running;
  if (taskState.status === 'success') return COPY.apps.matrix.ready;
  if (taskState.status === 'error') return COPY.apps.matrix.failed;
  return COPY.apps.matrix.waiting;
}

/** 状态词跟在课名后面；做好了就不说（产物在眼前） */
function StatusWord({ taskState }: { taskState: AppTaskState }) {
  if (taskState.status === 'success') return null;
  const tone = taskState.status === 'error' ? 'text-vermilion' : 'text-ink-muted';
  return <span className={`ml-2 text-[12px] font-normal ${tone}`}>{taskLabel(taskState)}</span>;
}

function taskDockBadge(taskState: AppTaskState): string {
  if (taskState.status === 'running') return 'bg-pine';
  if (taskState.status === 'success') return 'bg-ink';
  if (taskState.status === 'error') return 'bg-vermilion';
  return 'bg-ink-muted';
}

function useDrag(baseRight: number, baseBottom: number) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; startOx: number; startOy: number } | null>(null);
  const rafRef = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('button, a, select, input')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        startOx: offset.x,
        startOy: offset.y,
      };
    },
    [offset.x, offset.y]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ds = dragState.current;
    if (!ds) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setOffset({ x: ds.startOx + dx, y: ds.startOy + dy });
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  const style = {
    right: `${baseRight - offset.x}px`,
    bottom: `${baseBottom - offset.y}px`,
  };

  return { style, onPointerDown, onPointerMove, onPointerUp };
}

/* ================================================================ */
/*  窗口卡片                                                         */
/* ================================================================ */

function WindowCard(props: WindowCardProps) {
  const {
    windowState,
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    model,
    onModelChange,
    onSeek,
    onClose,
    onToggleMinimize,
    onFocus,
    stackOffset,
  } = props;
  const app = getWorkshopAppByKey(windowState.appKey);
  const resolvedApp = app ?? getWorkshopAppByKey('audio-overview')!;
  const isMobile = useIsMobile();

  const infographicContentContext = useMemo(
    () => buildInfographicContentContext(summaryOverview, transcript),
    [summaryOverview, transcript]
  );

  const execution = useAppExecution({
    app: resolvedApp,
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    model,
    autoRun: resolvedApp.key !== 'infographic',
  });


  const isImmersive = IMMERSIVE_APPS.has(windowState.appKey);
  // 沉浸式应用在移动端强制全屏
  const isFullscreen = windowState.displayMode === 'fullscreen' || (isMobile && isImmersive);

  const baseRight = 16 + stackOffset;
  const baseBottom = 20 + stackOffset;
  const drag = useDrag(baseRight, baseBottom);

  if (!app) return null;

  const textAction = 'mm-focus rounded-md text-[12px] text-ink-muted transition hover:text-ink';
  const surface = (
    <WindowErrorBoundary appName={app.name} onRetry={() => void execution.rerun()}>
      <AppRenderSurface
        appKey={app.key}
        result={execution.result}
        transcript={transcript}
        taskState={execution.taskState}
        sessionId={sessionId}
        contentContext={infographicContentContext}
        onSeek={onSeek}
        onRegenerate={() => void execution.rerun()}
        onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
        onResultUpdate={execution.updateResult}
        hostFullscreen={isFullscreen}
      />
    </WindowErrorBoundary>
  );

  // 全屏：四个宿主同一张纸。此前闪卡 / 测验走"沉浸式"深绿 header（bg-ink）盖在米白正文上——
  // 头是夜里、身子是白天，与复习页舞台 / 独立页都不一致；现在只剩一个全屏壳，闪卡 / 测验只是去掉内边距
  if (isFullscreen) {
    return (
      <section
        className="mm-app-enter pointer-events-auto fixed inset-0 z-[200] flex flex-col overflow-hidden bg-white"
        data-testid={`workshop-window-${app.key}-fullscreen`}
        onMouseDown={() => onFocus(app.key)}
      >
        {/* 头部一行字：返回 / 课名 + 状态（只在正在做 / 没做好时说）/ 模型 / 关闭；不再有状态 pill */}
        <header className="flex items-center gap-3 border-b border-divider bg-white px-4 py-2.5 select-none">
          <button type="button" className={`${textAction} inline-flex items-center gap-1`} onClick={() => onClose(app.key)} aria-label={APPS_COPY.shell.back}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="hidden sm:inline">{APPS_COPY.shell.back}</span>
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
              {app.name}
              <StatusWord taskState={execution.taskState} />
            </p>
            <p className="hidden truncate text-xs text-ink-muted sm:block">{formatDataSource(dataSource)}</p>
          </div>
          <div className="hidden md:block">
            <ModelSelector value={model} onChange={onModelChange} compact allowedProviders={['deepseek', 'qwen', 'volcengine']} />
          </div>
          <button type="button" className={textAction} onClick={() => onClose(app.key)} aria-label={APPS_COPY.shell.close}>
            {APPS_COPY.shell.close}
          </button>
        </header>
        <div className={`min-h-0 flex-1 overflow-auto ${isImmersive ? 'bg-paper p-0' : 'bg-canvas p-4'}`}>
          {surface}
        </div>
      </section>
    );
  }

  // 面板模式（浮窗）：进场 180ms 弹出；浮在课堂上要有一层真实的投影（此前只有 1px 描边，像贴在页面上的一块）
  return (
    <section
      className="mm-pop-in pointer-events-auto fixed flex h-[min(78vh,820px)] w-[min(860px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-divider bg-white shadow-float max-md:left-2 max-md:right-2 max-md:top-14 max-md:h-[78vh] max-md:w-auto"
      data-testid={`floating-workshop-window-${app.key}`}
      style={{
        ...drag.style,
        zIndex: 70 + windowState.zIndex,
      }}
      onMouseDown={() => onFocus(app.key)}
    >
      <header
        className="flex cursor-grab touch-none items-center gap-1.5 border-b border-divider bg-white px-3 py-2 active:cursor-grabbing select-none md:gap-2"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
      >
        {/* 浮窗头：收起 / 课名 + 状态词 / 模型 / 关闭，全是文字。此前副标题写「会话 7eeeed…4598」——会话 id 是内部黑话 */}
        <button
          type="button"
          className={textAction}
          onClick={() => onToggleMinimize(app.key)}
          data-testid={`workshop-window-minimize-${app.key}`}
          aria-label={APPS_COPY.shell.minimize}
        >
          {APPS_COPY.shell.minimize}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">
            {app.name}
            <StatusWord taskState={execution.taskState} />
          </p>
          <p className="hidden truncate text-xs text-ink-muted md:block">{formatDataSource(dataSource)}</p>
        </div>
        <div className="hidden md:block">
          <ModelSelector value={model} onChange={onModelChange} compact allowedProviders={['deepseek', 'qwen', 'volcengine']} />
        </div>
        <button
          type="button"
          className={textAction}
          onClick={() => onClose(app.key)}
          data-testid={`workshop-window-close-${app.key}`}
          aria-label={APPS_COPY.shell.close}
        >
          {APPS_COPY.shell.close}
        </button>
      </header>

      <div className="flex-1 overflow-auto bg-canvas p-3">
        {surface}
      </div>
    </section>
  );
}

export function WorkshopWindowManager(props: WorkshopWindowManagerProps) {
  const {
    windows,
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    terminologyHint,
    onSeek,
    onClose,
    onToggleMinimize,
    onFocus,
  } = props;

  const [model, setModel] = useState('');

  useEffect(() => {
    let cancelled = false;
    void resolveWorkshopModelId().then((resolved) => {
      if (!cancelled && resolved) setModel(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !model) return;
    window.localStorage.setItem(WORKSHOP_MODEL_PREFERENCE_KEY, model);
  }, [model]);

  const openedWindows = useMemo(
    () => [...windows].filter((windowState) => !windowState.minimized).sort((a, b) => a.zIndex - b.zIndex),
    [windows]
  );

  const minimizedWindows = useMemo(
    () => [...windows].filter((windowState) => windowState.minimized).sort((a, b) => b.zIndex - a.zIndex),
    [windows]
  );

  // Esc 关掉最上面那个浮窗 / 全屏窗（正在输入时不抢；窗口内部自己处理 Esc 的——导图退自己的全屏——先收到，
  // 这里只在事件没被它们 preventDefault 时才动）
  const topWindow = openedWindows[openedWindows.length - 1];
  useEffect(() => {
    if (!topWindow) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return;
      onClose(topWindow.appKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, topWindow]);

  if (windows.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[65]" data-testid="workshop-window-layer">
      {openedWindows.map((windowState, index) => (
        <WindowCard
          key={windowState.appKey}
          windowState={windowState}
          sessionId={sessionId}
          dataSource={dataSource}
          transcript={transcript}
          anchors={anchors}
          summaryOverview={summaryOverview}
          keyDifficulties={keyDifficulties}
          terminologyHint={terminologyHint}
          model={model}
          onModelChange={setModel}
          onSeek={onSeek}
          onClose={onClose}
          onToggleMinimize={onToggleMinimize}
          onFocus={onFocus}
          stackOffset={Math.min(index, 3) * 22}
        />
      ))}

      {minimizedWindows.length > 0 ? (
        <div className="pointer-events-auto fixed bottom-3 left-1/2 z-[90] flex max-w-[calc(100vw-20px)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-full border border-divider bg-white px-3 py-2">
          {minimizedWindows.map((windowState) => {
            const app = getWorkshopAppByKey(windowState.appKey);
            if (!app) return null;
            return (
              <div key={windowState.appKey} className="flex items-center gap-1.5 rounded-full border border-divider bg-white px-2.5 py-1.5 transition hover:border-ink-muted">
                <span className={`inline-block h-2 w-2 rounded-full ${taskDockBadge({ status: 'success', updatedAt: 0 })}`} />
                <button
                  type="button"
                  className="truncate text-xs font-medium text-ink-secondary hover:text-ink"
                  onClick={() => onToggleMinimize(windowState.appKey)}
                  data-testid={`workshop-window-restore-${windowState.appKey}`}
                >
                  {app.name}
                </button>
                <button
                  type="button"
                  className="rounded-full px-1 text-xs text-ink-muted hover:bg-paper-warm hover:text-ink"
                  onClick={() => onClose(windowState.appKey)}
                  aria-label={APPS_COPY.shell.close}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export { getDefaultDisplayMode } from './workshop-window-state';
