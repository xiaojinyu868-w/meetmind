'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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

export interface FloatingWorkshopWindowState {
  appKey: WorkshopAppKey;
  minimized: boolean;
  zIndex: number;
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
}

interface FloatingWindowCardProps {
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

function FloatingWindowCard(props: FloatingWindowCardProps) {
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

  if (!app) return null;

  return (
    <section
      className="pointer-events-auto fixed flex h-[min(78vh,820px)] w-[min(860px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.25)] max-md:left-2 max-md:right-2 max-md:top-14 max-md:h-[78vh] max-md:w-auto"
      data-testid={`floating-workshop-window-${app.key}`}
      style={{
        right: `${16 + stackOffset}px`,
        bottom: `${20 + stackOffset}px`,
        zIndex: 70 + windowState.zIndex,
      }}
      onMouseDown={() => onFocus(app.key)}
    >
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur">
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
          onClick={() => {
            void execution.rerun();
          }}
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
        <FloatingWindowCard
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
          stackOffset={Math.min(index, 3) * 22}
        />
      ))}

      {minimizedWindows.length > 0 ? (
        <div className="pointer-events-auto fixed bottom-3 left-1/2 z-[90] flex max-w-[calc(100vw-20px)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-full border border-slate-200 bg-white/95 px-2 py-2 shadow-xl backdrop-blur">
          {minimizedWindows.map((windowState) => {
            const app = getWorkshopAppByKey(windowState.appKey);
            if (!app) return null;
            return (
              <div key={windowState.appKey} className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
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
