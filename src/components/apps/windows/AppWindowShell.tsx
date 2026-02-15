'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ModelSelector } from '@/components/ModelSelector';
import type { DataSourceType } from '@/lib/ai-native/types';
import type { WorkshopAppCatalogItem } from '@/lib/ai-native/app-catalog';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';

function formatDataSource(dataSource: DataSourceType): string {
  if (dataSource === 'live') return '实时录音';
  if (dataSource === 'video') return '视频导入';
  if (dataSource === 'demo') return '演示数据';
  return '课堂数据';
}

function shortSessionId(sessionId: string): string {
  if (!sessionId) return '-';
  return sessionId.length > 18 ? `${sessionId.slice(0, 8)}...${sessionId.slice(-6)}` : sessionId;
}

function statusText(task: AppTaskState): string {
  if (task.status === 'running') return '生成中';
  if (task.status === 'success') return '已生成';
  if (task.status === 'error') return '生成失败';
  return '未生成';
}

interface AppWindowShellProps {
  app: WorkshopAppCatalogItem;
  sessionId: string;
  dataSource: DataSourceType;
  model: string;
  onModelChange: (modelId: string) => void;
  taskState: AppTaskState;
  onRegenerate: () => void;
  children: ReactNode;
}

export function AppWindowShell(props: AppWindowShellProps) {
  const { app, sessionId, dataSource, model, onModelChange, taskState, onRegenerate, children } = props;
  const statusColor = useMemo(() => {
    if (taskState.status === 'success') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (taskState.status === 'running') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (taskState.status === 'error') return 'bg-rose-50 text-rose-700 border-rose-200';
    return 'bg-slate-50 text-slate-600 border-slate-200';
  }, [taskState.status]);

  return (
    <div className="min-h-screen bg-[radial-gradient(1200px_500px_at_20%_-5%,#dbeafe,transparent_60%),radial-gradient(1200px_500px_at_90%_-20%,#fde68a,transparent_60%),#f8fafc]" data-testid="app-window-shell">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/app?workspace=apps"
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <span>←</span>
            <span>返回 AI工坊</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-slate-900">{app.name}</p>
            <p className="truncate text-xs text-slate-500">
              会话 {shortSessionId(sessionId)} · {formatDataSource(dataSource)}
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusColor}`}>{statusText(taskState)}</span>
          <ModelSelector
            value={model}
            onChange={onModelChange}
            compact
            allowedProviders={['qwen', 'volcengine']}
          />
          <button
            type="button"
            data-testid="app-window-rerun"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onRegenerate}
            disabled={taskState.status === 'running'}
          >
            重新生成
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}
