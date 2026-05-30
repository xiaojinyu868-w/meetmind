'use client';

import type { ReactNode } from 'react';

/**
 * MobileSimpleSubPage — 手机端简单子页面通用容器
 *
 * 抽自 src/app/(main)/app/page.tsx 多个 mobileSubPage 分支共有的
 * "顶部 sticky 标题栏 + 全屏 children"模式。
 *
 * 阶段 A（docs/MOBILE_REFACTOR_PLAN.md）：纯 UI 容器，不持有 state。
 * page.tsx 仍负责状态机；这里只承担布局职责。
 *
 * 头部规范（手机端 P1）：
 *   - sticky top-0 + safe-area-inset-top 适配
 *   - 返回按钮 mm-touch-target (44×44)
 *   - hover → active（触屏更直观）
 */
interface MobileSimpleSubPageProps {
  /** 标题文字 */
  title: string;
  /** 返回按钮回调 */
  onBack: () => void;
  /** 内容区 */
  children: ReactNode;
}

export function MobileSimpleSubPage({ title, onBack, children }: MobileSimpleSubPageProps) {
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

/**
 * MobileAppsSubPage — 学习应用子页面
 *
 * 仅是 MobileSimpleSubPage 的命名包装，方便阅读 page.tsx 时一眼看出语义。
 */
export function MobileAppsSubPage(props: Omit<MobileSimpleSubPageProps, 'title'> & { title?: string }) {
  return <MobileSimpleSubPage title={props.title ?? '学习应用'} onBack={props.onBack}>{props.children}</MobileSimpleSubPage>;
}
