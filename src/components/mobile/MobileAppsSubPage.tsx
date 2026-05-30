'use client';

import type { ReactNode } from 'react';

/**
 * MobileAppsSubPage — 手机端"学习应用"子页面
 *
 * 抽自 src/app/(main)/app/page.tsx mobileSubPage === 'apps' 分支。
 * 阶段 A（docs/MOBILE_REFACTOR_PLAN.md）：纯 UI 容器，不持有 state。
 * page.tsx 仍负责状态机；这里只承担"sticky 头部 + 内容区"布局职责。
 *
 * 头部规范（手机端 P1）：
 *   - sticky top-0
 *   - safe-area-inset-top 适配
 *   - 返回按钮 mm-touch-target (44×44)
 */
interface MobileAppsSubPageProps {
  /** 标题文字 */
  title: string;
  /** 返回按钮回调 */
  onBack: () => void;
  /** 内容区——通常是 SharedWorkspacePanel('apps') 的渲染结果 */
  children: ReactNode;
}

export function MobileAppsSubPage({ title, onBack, children }: MobileAppsSubPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-divider bg-white px-2 py-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)' }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="mm-touch-target flex items-center justify-center rounded-full text-ink-secondary transition-colors active:bg-divider-light active:text-ink"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-base font-semibold text-ink">{title}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
