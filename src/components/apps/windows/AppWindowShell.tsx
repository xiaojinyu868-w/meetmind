'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { getAppWindowShellTone } from './app-window-shell-tone';
import type { WorkshopAppCatalogItem } from '@/lib/ai-native/app-catalog';
import type { AppTaskState } from '@/components/apps/hooks/useAppExecution';
import { COPY } from '@/lib/ui/copy';

interface AppWindowShellProps {
  app: WorkshopAppCatalogItem;
  taskState: AppTaskState;
  onRegenerate: () => void;
  showPrimaryAction?: boolean;
  children: ReactNode;
}

/**
 * StatusIndicator —— 极简状态指示
 *
 * 替代原来的 chip 边框徽章。loading 时只是一个 pulse 圆点 + 极淡文字，
 * 视觉重量极低，让 Octo Buddy 是主角。
 *
 * 状态对应：
 *   - running : 蓝绿小圆点 + pulse 光晕，"在做"
 *   - success : 浅绿圆点（不闪），"做好了"
 *   - error   : 沙色圆点，"没做好"——不要红色尖叫
 *   - idle    : 灰圆点，"待开始"
 */
function StatusIndicator({
  status,
  immersive,
}: {
  status: AppTaskState['status'];
  immersive: boolean;
}) {
  // v7：状态色对齐双签名色
  //  - running / success → pine（AI 沉淀）
  //  - error → vermilion（朱批提醒，不是红色尖叫）
  //  - idle → ink-muted
  const config: Record<AppTaskState['status'], { dot: string; label: string; pulse: boolean }> = {
    running: { dot: '#2D4F3E', label: COPY.apps.matrix.running, pulse: true },
    success: { dot: '#2D4F3E', label: COPY.apps.matrix.ready, pulse: false },
    error: { dot: '#B5483C', label: COPY.apps.matrix.failed, pulse: false },
    idle: { dot: '#8E8B82', label: COPY.apps.matrix.waiting, pulse: false },
  };
  const { dot, label, pulse } = config[status];
  const textColor = immersive ? 'text-white/55' : 'text-ink-muted';

  return (
    <span className={`inline-flex items-center gap-1.5 text-[11.5px] ${textColor}`}>
      <span
        aria-hidden
        className="relative inline-flex h-1.5 w-1.5 flex-shrink-0"
      >
        {pulse ? (
          <span
            className="absolute inset-0 animate-ping rounded-full opacity-65"
            style={{ background: dot }}
          />
        ) : null}
        <span
          className="relative inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: dot }}
        />
      </span>
      <span className="tabular-nums">{label}</span>
    </span>
  );
}

export function AppWindowShell(props: AppWindowShellProps) {
  const {
    app,
    taskState,
    onRegenerate,
    showPrimaryAction = true,
    children,
  } = props;
  const tone = useMemo(() => getAppWindowShellTone(app.key), [app.key]);
  const isRunning = taskState.status === 'running';
  // immersive 黑 hero（flashcards）只在产物真出来后启用——loading 态强制中性，
  // 否则会和白色 main 主体撞色，且 Octo Buddy 听课的温柔气质被切断
  const immersiveActive = app.key === 'flashcards' && taskState.status === 'success';
  const effectiveTone = immersiveActive
    ? tone
    : {
        ...tone,
        root: 'min-h-screen bg-paper',
        header:
          'sticky top-0 z-20 border-b border-divider/70 bg-card/92 backdrop-blur-md shadow-soft',
        backLink:
          'inline-flex items-center gap-1.5 rounded-full border border-divider bg-card px-3 py-1.5 text-[13px] text-ink-secondary transition hover:border-pine hover:text-pine',
        title: 'truncate text-[15.5px] font-semibold tracking-display text-ink',
        subtitle: 'truncate text-[12px] text-ink-muted',
        actionButton:
          'rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-medium text-white shadow-soft transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.98]',
      };

  return (
    <div
      className={`${effectiveTone.root} print:!min-h-0 print:!bg-white`}
      data-testid="app-window-shell"
    >
      {/* 打印态：header 整条隐藏（返回 / 标题 / 状态 / 重做都不上打印纸） */}
      <header className={`${effectiveTone.header} print:hidden`}>
        <div className={effectiveTone.headerInner}>
          <Link href="/app?workspace=apps" className={effectiveTone.backLink}>
            <span>←</span>
            <span>{COPY.apps.matrix.backToMatrix}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <p className={effectiveTone.title}>{app.name}</p>
            <p className={effectiveTone.subtitle}>{COPY.apps.matrix.workspaceSubtitle(app.learningAction, app.bestFor)}</p>
          </div>
          <StatusIndicator status={taskState.status} immersive={immersiveActive} />
          {/* loading 时整条主操作按钮隐藏：避免视觉重量 + 用户也点不动；
              做完之后再出现「再做一版」是更自然的节奏 */}
          {showPrimaryAction && !isRunning ? (
            <button
              type="button"
              data-testid="app-window-rerun"
              className={effectiveTone.actionButton}
              onClick={onRegenerate}
            >
              {COPY.apps.matrix.remake}
            </button>
          ) : null}
        </div>
      </header>
      {/* 打印态：main 撑满页面、零边距，让 children 内部的 @media print 拿到全部空间 */}
      <main className={`${effectiveTone.main} print:!max-w-none print:!p-0 print:!mx-0`}>
        {children}
      </main>

      {/* 全局 print 兜底：去掉 body 边距、隐藏 sidebar / nav / toast 等全局元素 */}
      <style jsx global>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #FFFFFF !important;
          }
          [data-app-sidebar],
          [data-app-nav],
          [data-floating-octo],
          [data-toast-region],
          .Toaster,
          .toaster,
          [role="alert"],
          [role="status"] {
            display: none !important;
          }
          /* 打印不要 sticky / fixed —— 否则在每页都重复 */
          .sticky, .fixed {
            position: static !important;
          }
        }
      `}</style>
    </div>
  );
}
