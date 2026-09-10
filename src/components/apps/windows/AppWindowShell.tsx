'use client';

import Link from 'next/link';
import { ArrowLeft, RotateCw } from 'lucide-react';
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
  backHref?: string;
  onBack?: () => void;
  backLabel?: string;
  headerActions?: ReactNode;
  /** 成品已在眼前（正在重做 / 刚没做好时头部才说状态；没有成品时正文的进入态自己会说） */
  hasResult?: boolean;
  children: ReactNode;
}

/**
 * StatusIndicator —— 极简状态指示：一枚小圆点 + 极淡文字。
 *
 *   - running : pine 小圆点 + pulse，"正在做"
 *   - error   : vermilion 圆点，"没做好"——朱批提醒，不是红色尖叫
 *   - idle    : 灰圆点，"还没开始"
 *   - success : 不出现——产物在眼前，一枚「做好了」的绿点只是噪音
 */
function StatusIndicator({ status }: { status: AppTaskState['status'] }) {
  const config: Record<AppTaskState['status'], { dot: string; label: string; pulse: boolean }> = {
    running: { dot: 'var(--mm-pine)', label: COPY.apps.matrix.running, pulse: true },
    success: { dot: 'var(--mm-pine)', label: COPY.apps.matrix.ready, pulse: false },
    error: { dot: 'var(--mm-vermilion)', label: COPY.apps.matrix.failed, pulse: false },
    idle: { dot: 'var(--mm-ink-muted)', label: COPY.apps.matrix.waiting, pulse: false },
  };
  const { dot, label, pulse } = config[status];
  if (status === 'success') return null;

  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted" aria-label={label}>
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
      <span className="hidden tabular-nums sm:inline">{label}</span>
    </span>
  );
}

export function AppWindowShell(props: AppWindowShellProps) {
  const {
    app,
    taskState,
    onRegenerate,
    showPrimaryAction = true,
    backHref = '/app?workspace=apps',
    onBack,
    backLabel = COPY.apps.matrix.backToMatrix,
    headerActions,
    hasResult = false,
    children,
  } = props;
  // 所有应用同一张纸（闪卡的深色 immersive 变体 2026-09-10 移除，理由见 app-window-shell-tone.ts）
  const tone = useMemo(() => getAppWindowShellTone(app.key), [app.key]);
  const isRunning = taskState.status === 'running';

  return (
    <div
      className={`${tone.root} print:!min-h-0 print:!bg-white`}
      data-testid="app-window-shell"
    >
      {/* 打印态：header 整条隐藏（返回 / 标题 / 状态 / 重做都不上打印纸）。
          头部一行：返回 · 应用名 · [状态] · 动作——此前第二行「检验理解 · 想做题测一测…」是说明句，删 */}
      <header className={`${tone.header} print:hidden`}>
        <div className={tone.headerInner}>
          {onBack ? (
            <button type="button" onClick={onBack} className={tone.backLink} aria-label={backLabel}>
              <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
              <span className="hidden sm:inline">{backLabel}</span>
            </button>
          ) : (
            <Link href={backHref} className={tone.backLink} aria-label={backLabel}>
              <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
              <span className="hidden sm:inline">{backLabel}</span>
            </Link>
          )}
          <p className={`${tone.title} min-w-0 flex-1`}>{app.name}</p>
          {hasResult ? <StatusIndicator status={taskState.status} /> : null}
          {headerActions}
          {/* loading 时整条主操作按钮隐藏：避免视觉重量 + 用户也点不动；
              做完之后再出现「再做一版」是更自然的节奏 */}
          {showPrimaryAction && !isRunning ? (
            <button
              type="button"
              data-testid="app-window-rerun"
              className={tone.actionButton}
              onClick={onRegenerate}
              aria-label={COPY.apps.matrix.remake}
            >
              <RotateCw size={14} strokeWidth={1.8} aria-hidden />
              <span className="hidden sm:inline">{COPY.apps.matrix.remake}</span>
            </button>
          ) : null}
        </div>
      </header>
      {/* 打印态：main 撑满页面、零边距，让 children 内部的 @media print 拿到全部空间 */}
      <main className={`${tone.main} print:!max-w-none print:!p-0 print:!mx-0`}>
        {children}
      </main>

      {/* 全局 print 兜底：去掉 body 边距、隐藏 sidebar / nav / toast 等全局元素 */}
      <style jsx global>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #FFFFFF !important; /* 打印必须强制白纸，与主题无关，保留字面值 */
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
