'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModelSelector } from '@/components/ModelSelector';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { Anchor, TranscriptSegment } from '@/types';
import type { DataSourceType } from '@/lib/ai-native/types';
import { getWorkshopAppByKey, type WorkshopAppKey } from '@/lib/ai-native/app-catalog';
import { useAppExecution, type AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { PodcastWindow } from '@/components/apps/windows/PodcastWindow';
import { FlashcardsWindow } from '@/components/apps/windows/FlashcardsWindow';
import { QuizWindow } from '@/components/apps/windows/QuizWindow';
import { MindmapWindow } from '@/components/apps/windows/MindmapWindow';
import { InfographicWindow } from '@/components/apps/windows/InfographicWindow';

const WORKSHOP_MODEL_PREFERENCE = 'ai_workshop_model';

/** 应用的默认展示模式 */
const DEFAULT_DISPLAY_MODES: Partial<Record<WorkshopAppKey, 'panel' | 'fullscreen'>> = {
  mindmap: 'fullscreen',
  infographic: 'fullscreen',
  'audio-overview': 'panel',
  flashcards: 'panel',
  quiz: 'panel',
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
  onSeek?: (startMs: number) => void;
  onClose: (appKey: WorkshopAppKey) => void;
  onToggleMinimize: (appKey: WorkshopAppKey) => void;
  onFocus: (appKey: WorkshopAppKey) => void;
  onToggleDisplayMode: (appKey: WorkshopAppKey) => void;
}

interface WindowCardProps {
  windowState: FloatingWorkshopWindowState;
  sessionId: string;
  dataSource: DataSourceType;
  transcript: TranscriptSegment[];
  anchors: Anchor[];
  summaryOverview?: string;
  keyDifficulties?: string[];
  model: string;
  onModelChange: (modelId: string) => void;
  onSeek?: (startMs: number) => void;
  onClose: (appKey: WorkshopAppKey) => void;
  onToggleMinimize: (appKey: WorkshopAppKey) => void;
  onFocus: (appKey: WorkshopAppKey) => void;
  onToggleDisplayMode: (appKey: WorkshopAppKey) => void;
  stackOffset: number;
}

function formatDataSource(dataSource: DataSourceType): string {
  if (dataSource === 'live') return '实时录音';
  if (dataSource === 'video') return '视频导入';
  if (dataSource === 'demo') return '演示数据';
  return '课堂数据';
}

function taskLabel(taskState: AppTaskState): string {
  if (taskState.status === 'running') return '生成中';
  if (taskState.status === 'success') return '已完成';
  if (taskState.status === 'error') return '失败';
  return '待生成';
}

function taskTone(taskState: AppTaskState): string {
  if (taskState.status === 'running') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (taskState.status === 'success') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (taskState.status === 'error') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function taskDockBadge(taskState: AppTaskState): string {
  if (taskState.status === 'running') return 'bg-amber-400';
  if (taskState.status === 'success') return 'bg-emerald-400';
  if (taskState.status === 'error') return 'bg-rose-400';
  return 'bg-slate-300';
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
/*  全屏/面板切换按钮                                                 */
/* ================================================================ */

function DisplayModeToggle({
  mode,
  onToggle,
}: {
  mode: WorkshopDisplayMode;
  onToggle: () => void;
}) {
  const isFullscreen = mode === 'fullscreen';
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-all duration-200 hover:brightness-110"
      style={{
        border: '1px solid ' + (isFullscreen ? '#6366f1' : '#cbd5e1'),
        background: isFullscreen ? '#6366f120' : 'transparent',
        color: isFullscreen ? '#6366f1' : '#64748b',
      }}
      title={isFullscreen ? '切换到面板模式' : '切换到全屏模式'}
    >
      {isFullscreen ? (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
          </svg>
          面板
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
          全屏
        </>
      )}
    </button>
  );
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
    model,
    onModelChange,
    onSeek,
    onClose,
    onToggleMinimize,
    onFocus,
    onToggleDisplayMode,
    stackOffset,
  } = props;
  const app = getWorkshopAppByKey(windowState.appKey);
  const resolvedApp = app ?? getWorkshopAppByKey('audio-overview')!;

  const execution = useAppExecution({
    app: resolvedApp,
    sessionId,
    dataSource,
    transcript,
    anchors,
    summaryOverview,
    keyDifficulties,
    model,
    autoRun: true,
  });

  const standaloneHref = `/app/matrix/${resolvedApp.key}?sessionId=${encodeURIComponent(sessionId)}&dataSource=${encodeURIComponent(
    dataSource
  )}`;

  const isFullscreen = windowState.displayMode === 'fullscreen';
  const isImmersive = IMMERSIVE_APPS.has(windowState.appKey);

  const baseRight = 16 + stackOffset;
  const baseBottom = 20 + stackOffset;
  const drag = useDrag(baseRight, baseBottom);

  if (!app) return null;

  // 沉浸式全屏模式（闪卡等）— 深色背景、极简header
  if (isFullscreen && isImmersive) {
    return (
      <section
        className="pointer-events-auto fixed inset-0 z-[200] flex flex-col overflow-hidden bg-[#0f1419]"
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
              <span className="text-xs text-amber-400/80">生成中…</span>
            )}
            <button
              type="button"
              className="rounded-lg p-1.5 text-white/40 hover:text-white hover:bg-white/10 transition-colors"
              onClick={() => onToggleDisplayMode(app.key)}
              title="切换到面板模式"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            </button>
          </div>
        </header>

        {/* 沉浸式内容区 — 无内边距，组件自己控制 */}
        <div className="flex-1 overflow-auto">
          {app.key === 'flashcards' ? (
            <FlashcardsWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
          ) : null}
          {app.key === 'quiz' ? (
            <QuizWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
          ) : null}
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
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur select-none">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{app.name}</p>
            <p className="truncate text-xs text-slate-500">
              会话 {sessionId.slice(0, 6)}…{sessionId.slice(-4)} · {formatDataSource(dataSource)}
            </p>
          </div>
          <span className={`rounded-full border px-2 py-1 text-xs font-medium ${taskTone(execution.taskState)}`}>
            {taskLabel(execution.taskState)}
          </span>
          <ModelSelector value={model} onChange={onModelChange} compact allowedProviders={['qwen', 'volcengine']} />
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void execution.rerun()}
            disabled={execution.taskState.status === 'running'}
          >
            重新生成
          </button>
          <Link
            href={standaloneHref}
            className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
            target="_blank"
            rel="noreferrer"
          >
            独立页
          </Link>
          <DisplayModeToggle mode="fullscreen" onToggle={() => onToggleDisplayMode(app.key)} />
          <button
            type="button"
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
            onClick={() => onClose(app.key)}
            aria-label="关闭窗口"
          >
            ×
          </button>
        </header>

        {/* 全屏内容区 */}
        <div className="flex-1 overflow-auto bg-[radial-gradient(900px_360px_at_15%_-10%,#dbeafe,transparent_60%),radial-gradient(900px_360px_at_100%_-35%,#fde68a,transparent_60%),#f8fafc] p-4">
          {app.key === 'audio-overview' ? (
            <PodcastWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
          ) : null}
          {app.key === 'flashcards' ? (
            <FlashcardsWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
          ) : null}
          {app.key === 'quiz' ? <QuizWindow result={execution.result} transcript={transcript} onSeek={onSeek} /> : null}
          {app.key === 'mindmap' ? (
            <MindmapWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
          ) : null}
          {app.key === 'infographic' ? (
            <InfographicWindow sessionId={sessionId} result={execution.result} onResultUpdate={execution.updateResult} />
          ) : null}
        </div>
      </section>
    );
  }

  // 面板模式（原浮动窗口）
  return (
    <section
      className="pointer-events-auto fixed flex h-[min(78vh,820px)] w-[min(860px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.25)] max-md:left-2 max-md:right-2 max-md:top-14 max-md:h-[78vh] max-md:w-auto"
      data-testid={`floating-workshop-window-${app.key}`}
      style={{
        ...drag.style,
        zIndex: 70 + windowState.zIndex,
      }}
      onMouseDown={() => onFocus(app.key)}
    >
      <header
        className="flex cursor-grab items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur active:cursor-grabbing select-none"
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
      >
        <button
          type="button"
          className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
          onClick={() => onToggleMinimize(app.key)}
          data-testid={`workshop-window-minimize-${app.key}`}
          aria-label="最小化窗口"
        >
          —
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{app.name}</p>
          <p className="truncate text-xs text-slate-500">
            会话 {sessionId.slice(0, 6)}…{sessionId.slice(-4)} · {formatDataSource(dataSource)}
          </p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-xs font-medium ${taskTone(execution.taskState)}`}>
          {taskLabel(execution.taskState)}
        </span>
        <ModelSelector value={model} onChange={onModelChange} compact allowedProviders={['qwen', 'volcengine']} />
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          onClick={() => void execution.rerun()}
          disabled={execution.taskState.status === 'running'}
          data-testid={`workshop-window-rerun-${app.key}`}
        >
          重新生成
        </button>
        <Link
          href={standaloneHref}
          className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
          target="_blank"
          rel="noreferrer"
        >
          独立页
        </Link>
        <DisplayModeToggle mode="panel" onToggle={() => onToggleDisplayMode(app.key)} />
        <button
          type="button"
          className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
          onClick={() => onClose(app.key)}
          data-testid={`workshop-window-close-${app.key}`}
          aria-label="关闭窗口"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-auto bg-[radial-gradient(900px_360px_at_15%_-10%,#dbeafe,transparent_60%),radial-gradient(900px_360px_at_100%_-35%,#fde68a,transparent_60%),#f8fafc] p-3">
        {app.key === 'audio-overview' ? (
          <PodcastWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
        ) : null}
        {app.key === 'flashcards' ? (
          <FlashcardsWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
        ) : null}
        {app.key === 'quiz' ? <QuizWindow result={execution.result} transcript={transcript} onSeek={onSeek} /> : null}
        {app.key === 'mindmap' ? (
          <MindmapWindow result={execution.result} transcript={transcript} onSeek={onSeek} />
        ) : null}
        {app.key === 'infographic' ? (
          <InfographicWindow sessionId={sessionId} result={execution.result} onResultUpdate={execution.updateResult} />
        ) : null}
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
    onSeek,
    onClose,
    onToggleMinimize,
    onFocus,
    onToggleDisplayMode,
  } = props;

  const [model, setModel] = useState(DEFAULT_MODEL_ID);

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
          model={model}
          onModelChange={setModel}
          onSeek={onSeek}
          onClose={onClose}
          onToggleMinimize={onToggleMinimize}
          onFocus={onFocus}
          onToggleDisplayMode={onToggleDisplayMode}
          stackOffset={Math.min(index, 3) * 22}
        />
      ))}

      {minimizedWindows.length > 0 ? (
        <div className="pointer-events-auto fixed bottom-3 left-1/2 z-[90] flex max-w-[calc(100vw-20px)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-full border border-slate-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur">
          {minimizedWindows.map((windowState) => {
            const app = getWorkshopAppByKey(windowState.appKey);
            if (!app) return null;
            return (
              <div key={windowState.appKey} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 transition hover:border-blue-300 hover:bg-blue-50">
                <span className={`inline-block h-2 w-2 rounded-full ${taskDockBadge({ status: 'success', updatedAt: 0 })}`} />
                <button
                  type="button"
                  className="truncate text-xs font-medium text-slate-700 hover:text-blue-700"
                  onClick={() => onToggleMinimize(windowState.appKey)}
                  data-testid={`workshop-window-restore-${windowState.appKey}`}
                >
                  {app.name}
                </button>
                <button
                  type="button"
                  className="rounded-full px-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
