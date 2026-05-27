'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ModelSelector } from '@/components/ModelSelector';
import { getAppWindowShellTone } from './app-window-shell-tone';
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
  const tone = useMemo(() => getAppWindowShellTone(app.key), [app.key]);
  const isImmersive = app.key === 'flashcards';
  const statusColor = useMemo(() => {
    if (isImmersive) {
      if (taskState.status === 'success') return 'bg-[#D1F4E0]/15 text-[#D1F4E0] border-[#D1F4E0]/25';
      if (taskState.status === 'running') return 'bg-white/[0.06] text-white/72 border-white/[0.10]';
      if (taskState.status === 'error') return 'bg-rose-500/10 text-rose-200 border-rose-300/20';
      return 'bg-white/[0.04] text-white/45 border-white/[0.10]';
    }
    if (taskState.status === 'success') return 'bg-[#D1F4E0]/30 text-[#232322] border-[#D1F4E0]';
    if (taskState.status === 'running') return 'bg-[#FDF3C0]/50 text-[#232322] border-[#E9E9E7]';
    if (taskState.status === 'error') return 'bg-[#FBFAF5] text-ink-secondary border-divider';
    return 'bg-white text-ink-secondary border-divider';
  }, [isImmersive, taskState.status]);

  return (
    <div className={tone.root} data-testid="app-window-shell">
      <header className={tone.header}>
        <div className={tone.headerInner}>
          <Link
            href="/app?workspace=apps"
            className={tone.backLink}
          >
            <span>←</span>
            <span>返回应用</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className={tone.title}>{app.name}</p>
            <p className={tone.subtitle}>
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
              className={tone.actionButton}
              onClick={onRegenerate}
              disabled={taskState.status === 'running'}
            >
              {primaryActionLabel || '再做一版'}
            </button>
          ) : null}
        </div>
      </header>
      <main className={tone.main}>{children}</main>
    </div>
  );
}
