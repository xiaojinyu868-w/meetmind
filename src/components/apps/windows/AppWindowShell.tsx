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

function statusText(task: AppTaskState): string {
  if (task.status === 'running') return '正在做';
  if (task.status === 'success') return '已做好';
  if (task.status === 'error') return '没做好';
  return '待开始';
}

interface AppWindowShellProps {
  app: WorkshopAppCatalogItem;
  sessionId: string;
  dataSource: DataSourceType;
  model: string;
  onModelChange: (modelId: string) => void;
  taskState: AppTaskState;
  onRegenerate: () => void;
  primaryActionLabel?: string;
  showPrimaryAction?: boolean;
  children: ReactNode;
}

export function AppWindowShell(props: AppWindowShellProps) {
  const {
    app,
    dataSource,
    model,
    onModelChange,
    taskState,
    onRegenerate,
    primaryActionLabel,
    showPrimaryAction = true,
    children,
  } = props;
  const statusColor = useMemo(() => {
    if (taskState.status === 'success') return 'bg-[#D1F4E0]/30 text-[#232322] border-[#D1F4E0]';
    if (taskState.status === 'running') return 'bg-[#FDF3C0]/50 text-[#232322] border-[#E9E9E7]';
    if (taskState.status === 'error') return 'bg-[#FBFAF5] text-ink-secondary border-divider';
    return 'bg-white text-ink-secondary border-divider';
  }, [taskState.status]);

  return (
    <div className="min-h-screen bg-canvas" data-testid="app-window-shell">
      <header className="sticky top-0 z-20 border-b border-divider bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/app?workspace=apps"
            className="inline-flex items-center gap-1 rounded-full border border-divider bg-white px-3 py-1.5 text-sm text-ink-secondary hover:text-ink"
          >
            <span>←</span>
            <span>返回应用</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-ink">{app.name}</p>
            <p className="truncate text-xs text-ink-muted">
              {formatDataSource(dataSource)}
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-medium ${statusColor}`}>{statusText(taskState)}</span>
          <ModelSelector
            value={model}
            onChange={onModelChange}
            compact
            allowedProviders={['deepseek', 'qwen', 'volcengine']}
          />
          {showPrimaryAction ? (
            <button
              type="button"
              data-testid="app-window-rerun"
              className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onRegenerate}
              disabled={taskState.status === 'running'}
            >
              {primaryActionLabel || '再做一版'}
            </button>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}
