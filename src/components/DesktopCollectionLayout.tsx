'use client';

/**
 * DesktopCollectionLayout — 桌面端收集页面三栏布局
 *
 * 对标 flomo / Get 笔记：
 * - 中间内容区：顶部 Composer + 卡片 Feed 流
 * - 右侧面板：回声 / 更多 / 历史 sheet
 * - 响应式：lg 以上三栏，小屏退化为全宽
 *
 * 设计系统：v7 设计宪法：95% 克制 + 5% 仪式时刻情绪化（shadow-soft / shadow-card / shadow-ai-glow）、Notion 暖白
 */

import React, { type ReactNode } from 'react';

// ==================== 类型定义 ====================

export interface DesktopCollectionLayoutProps {
  /** 中心区域：ComposerBar + CardFeed */
  children: ReactNode;
  /** 右侧面板内容（回声/更多/历史） */
  rightPanel?: ReactNode;
  /** 右侧面板是否展开 */
  rightPanelOpen?: boolean;
}

// ==================== 组件实现 ====================

export function DesktopCollectionLayout({
  children,
  rightPanel,
  rightPanelOpen = false,
}: DesktopCollectionLayoutProps) {
  return (
    <div
      className="flex h-full min-h-0 flex-1"
      style={{ background: 'var(--edu-bg-primary)' }}
    >
      {/* ── 中心内容区 ── */}
      <div className="flex flex-1 flex-col min-w-0 min-h-0">
        {children}
      </div>

      {/* ── 右侧面板：回声 / 更多 / 历史 ── */}
      {rightPanelOpen && rightPanel ? (
        <aside
          className="hidden lg:flex w-[340px] xl:w-[380px] flex-shrink-0 flex-col border-l border-[#E8E2D5]"
          style={{ background: 'var(--edu-bg-primary)' }}
        >
          {rightPanel}
        </aside>
      ) : null}
    </div>
  );
}

export default DesktopCollectionLayout;
