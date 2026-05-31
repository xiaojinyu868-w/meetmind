'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModelSelector } from '@/components/ModelSelector';
import { DEFAULT_WORKSHOP_MODEL_ID } from '@/lib/services/llm-service';
import type { Anchor, TranscriptSegment } from '@/types';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { useAppExecution, type AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { AppRenderSurface } from '@/components/apps/windows/AppRenderSurface';

import type { ClassCheckRound } from '@/hooks/useClassCheck';
import type { ClassCheckPlan } from '@/app/api/class-check/plan/route';

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
          <div className="rounded-full bg-[#FBFAF5] p-3">
            <svg className="h-6 w-6 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-ink-secondary">{this.props.appName} 渲染出错</p>
          <p className="max-w-xs text-xs text-ink-muted">{this.state.error?.message || '未知错误'}</p>
          <button
            type="button"
            className="rounded-lg border border-divider px-3 py-1.5 text-xs font-medium text-ink-secondary hover:bg-paper-warm hover:text-ink"
            onClick={() => {
              this.setState({ hasError: false, error: undefined });
              this.props.onRetry?.();
            }}
          >
            重试
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

const WORKSHOP_MODEL_PREFERENCE = 'ai_workshop_model';

/** 应用的默认展示模式 */
const DEFAULT_DISPLAY_MODES: Partial<Record<WorkshopAppKey, 'panel' | 'fullscreen'>> = {
  mindmap: 'fullscreen',
  infographic: 'fullscreen',
  'audio-overview': 'panel',
  flashcards: 'fullscreen',
  quiz: 'fullscreen',
  cheatsheet: 'fullscreen',
};

/** 需要沉浸式全屏体验的应用（深色背景、精简header） */
const IMMERSIVE_APPS: Set<WorkshopAppKey> = new Set(['flashcards', 'quiz']);

function getDefaultDisplayMode(appKey: WorkshopAppKey): 'panel' | 'fullscreen' {
  return DEFAULT_DISPLAY_MODES[appKey] || 'panel';
}

export type WorkshopDisplayMode = 'panel' | 'fullscreen';

export interface FloatingWorkshopWindowState {
  appKey: WorkshopAppKey;
  minimized: boolean;
  zIndex: number;
  displayMode: WorkshopDisplayMode;
}

interface WorkshopWindowManagerProps {
  windows: FloatingWorkshopWindowState[];
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  terminologyHint?: string;
  classCheckRounds?: ClassCheckRound[];
  classCheckPlan?: ClassCheckPlan | null;
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
  classCheckRounds?: ClassCheckRound[];
  classCheckPlan?: ClassCheckPlan | null;
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
  if (dataSource === 'demo') return '演示数据';
  return '课堂数据';
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
  if (taskState.status === 'running') return '生成中';
  if (taskState.status === 'success') return '已完成';
  if (taskState.status === 'error') return '失败';
  return '待生成';
}

function taskTone(taskState: AppTaskState): string {
  if (taskState.status === 'running') return 'border-divider bg-[#FDF3C0]/50 text-ink';
  if (taskState.status === 'success') return 'border-divider bg-white text-ink';
  if (taskState.status === 'error') return 'border-divider bg-[#FBFAF5] text-ink-secondary';
  return 'border-divider bg-white text-ink-secondary';
}

function taskDockBadge(taskState: AppTaskState): string {
  if (taskState.status === 'running') return 'bg-[#FADEC9]';
  if (taskState.status === 'success') return 'bg-ink';
  if (taskState.status === 'error') return 'bg-[#B5483C]';
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
    classCheckRounds,
    classCheckPlan,
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
    autoRun: resolvedApp.key !== 'infographic' && resolvedApp.key !== 'study-report',
  });


  const isImmersive = IMMERSIVE_APPS.has(windowState.appKey);
  // 沉浸式应用在移动端强制全屏
  const isFullscreen = windowState.displayMode === 'fullscreen' || (isMobile && isImmersive);

  const baseRight = 16 + stackOffset;
  const baseBottom = 20 + stackOffset;
  const drag = useDrag(baseRight, baseBottom);

  if (!app) return null;

  // 沉浸式全屏模式（闪卡等）— 深色背景、极简header
  if (isFullscreen && isImmersive) {
    return (
      <section
        className="pointer-events-auto fixed inset-0 z-[200] flex flex-col overflow-hidden bg-ink"
        data-testid={`workshop-window-${app.key}-fullscreen`}
        onMouseDown={() => onFocus(app.key)}
      >
        {/* 沉浸式 header — 极简，融入深色背景 */}
        <header className="flex items-center gap-3 px-4 py-2.5 select-none">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => onClose(app.key)}
            aria-label="关闭窗口"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="text-sm">返回</span>
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-sm font-medium text-white/80">{app.name}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {execution.taskState.status === 'running' && (
              <span className="text-xs text-[#5C5A55]/80">生成中…</span>
            )}
          </div>
        </header>

        {/* 沉浸式内容区 — 无内边距，组件自己控制 */}
        <div className="flex-1 overflow-auto">
          <WindowErrorBoundary appName={app.name} onRetry={() => void execution.rerun()}>
            <AppRenderSurface appKey={app.key} result={execution.result} transcript={transcript} onSeek={onSeek} />
          </WindowErrorBoundary>
        </div>
      </section>
    );
  }

  // 标准全屏模式（思维导图、信息图等）
  if (isFullscreen) {
    return (
      <section
        className="pointer-events-auto fixed inset-0 z-[200] flex flex-col overflow-hidden bg-white"
        data-testid={`workshop-window-${app.key}-fullscreen`}
        onMouseDown={() => onFocus(app.key)}
      >
        {/* 全屏 header */}
        <header className="flex items-center gap-2 border-b border-divider bg-white px-4 py-2.5 select-none">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{app.name}</p>
            <p className="truncate text-xs text-ink-muted">
              会话 {sessionId.slice(0, 6)}…{sessionId.slice(-4)} · {formatDataSource(dataSource)}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-xs font-medium ${taskTone(execution.taskState)}`}>
            {taskLabel(execution.taskState)}
          </span>
          <ModelSelector value={model} onChange={onModelChange} compact allowedProviders={['deepseek', 'qwen', 'volcengine']} />
          <button
            type="button"
            className="rounded-md px-2 py-1 text-ink-muted hover:bg-paper-warm hover:text-ink"
            onClick={() => onClose(app.key)}
            aria-label="关闭窗口"
          >
            ×
          </button>
        </header>

        {/* 全屏内容区 */}
        <div className="flex-1 overflow-auto bg-canvas p-4">
          <WindowErrorBoundary appName={app.name} onRetry={() => void execution.rerun()}>
            <AppRenderSurface
              appKey={app.key}
              result={execution.result}
              transcript={transcript}
              taskState={execution.taskState}
              sessionId={sessionId}
              contentContext={infographicContentContext}
              classCheckRounds={classCheckRounds}
              classCheckPlan={classCheckPlan}
              onSeek={onSeek}
              onRegenerate={() => void execution.rerun()}
              onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
              onResultUpdate={execution.updateResult}
            />
          </WindowErrorBoundary>
        </div>
      </section>
    );
  }

  // 面板模式（原浮动窗口）
  return (
    <section
      className="pointer-events-auto fixed flex h-[min(78vh,820px)] w-[min(860px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-divider bg-white max-md:left-2 max-md:right-2 max-md:top-14 max-md:h-[78vh] max-md:w-auto"
      data-testid={`floating-workshop-window-${app.key}`}
      style={{
        ...drag.style,
        zIndex: 70 + windowState.zIndex,
      }}
      onMouseDown={() => onFocus(app.key)}
    >
      <header
        className="flex cursor-grab items-center gap-1.5 border-b border-divider bg-white px-3 py-2 active:cursor-grabbing select-none md:gap-2"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
      >
        <button
          type="button"
          className="rounded-md px-2 py-1 text-ink-muted hover:bg-paper-warm hover:text-ink"
          onClick={() => onToggleMinimize(app.key)}
          data-testid={`workshop-window-minimize-${app.key}`}
          aria-label="最小化窗口"
        >
          —
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{app.name}</p>
          <p className="hidden truncate text-xs text-ink-muted md:block">
            会话 {sessionId.slice(0, 6)}…{sessionId.slice(-4)} · {formatDataSource(dataSource)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-xs font-medium ${taskTone(execution.taskState)}`}>
          {taskLabel(execution.taskState)}
        </span>
        <div className="hidden md:block">
          <ModelSelector value={model} onChange={onModelChange} compact allowedProviders={['deepseek', 'qwen', 'volcengine']} />
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-ink-muted hover:bg-paper-warm hover:text-ink"
          onClick={() => onClose(app.key)}
          data-testid={`workshop-window-close-${app.key}`}
          aria-label="关闭窗口"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-auto bg-canvas p-3">
        <WindowErrorBoundary appName={app.name} onRetry={() => void execution.rerun()}>
          <AppRenderSurface
            appKey={app.key}
            result={execution.result}
            transcript={transcript}
            taskState={execution.taskState}
            sessionId={sessionId}
            contentContext={infographicContentContext}
            classCheckRounds={classCheckRounds}
            classCheckPlan={classCheckPlan}
            onSeek={onSeek}
            onRegenerate={() => void execution.rerun()}
            onGenerateDraft={() => (execution.hasResult ? execution.rerun() : execution.execute())}
            onResultUpdate={execution.updateResult}
          />
        </WindowErrorBoundary>
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
    classCheckRounds,
    classCheckPlan,
    onSeek,
    onClose,
    onToggleMinimize,
    onFocus,
  } = props;

  const [model, setModel] = useState(DEFAULT_WORKSHOP_MODEL_ID);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(WORKSHOP_MODEL_PREFERENCE)?.trim();
    if (saved) setModel(saved);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSHOP_MODEL_PREFERENCE, model);
  }, [model]);

  const openedWindows = useMemo(
    () => [...windows].filter((windowState) => !windowState.minimized).sort((a, b) => a.zIndex - b.zIndex),
    [windows]
  );

  const minimizedWindows = useMemo(
    () => [...windows].filter((windowState) => windowState.minimized).sort((a, b) => b.zIndex - a.zIndex),
    [windows]
  );

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
          classCheckRounds={classCheckRounds}
          classCheckPlan={classCheckPlan}
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
                  aria-label="关闭最小化窗口"
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

export { getDefaultDisplayMode };
