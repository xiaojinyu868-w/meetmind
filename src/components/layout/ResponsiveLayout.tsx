'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ResponsiveLayoutProps {
  children: React.ReactNode;
  className?: string;
}

// 响应式布局容器 - 移动端优先
export function ResponsiveLayout({ children, className }: ResponsiveLayoutProps) {
  return (
    <div className={cn(
      "min-h-screen bg-paper",
      className
    )}>
      {children}
    </div>
  );
}

interface MainContentProps {
  children: React.ReactNode;
  hasHeader?: boolean;
  hasBottomNav?: boolean;
  className?: string;
}

// 主内容区域 - 自动处理顶部和底部导航的间距
export function MainContent({ 
  children, 
  hasHeader = true, 
  hasBottomNav = true,
  className 
}: MainContentProps) {
  return (
    <main className={cn(
      "flex-1",
      hasHeader && "pt-16 lg:pt-20",
      hasBottomNav && "pb-20 lg:pb-0",
      className
    )}>
      {children}
    </main>
  );
}

interface PanelLayoutProps {
  leftPanel?: React.ReactNode;
  centerPanel: React.ReactNode;
  rightPanel?: React.ReactNode;
  activePanel?: 'left' | 'center' | 'right';
  onPanelChange?: (panel: 'left' | 'center' | 'right') => void;
  className?: string;
}

// 三栏布局 - 桌面端三栏，移动端单栏切换
export function PanelLayout({
  leftPanel,
  centerPanel,
  rightPanel,
  activePanel = 'center',
  onPanelChange,
  className,
}: PanelLayoutProps) {
  return (
    <div className={cn("flex-1 flex overflow-hidden", className)}>
      {/* 桌面端：三栏布局 */}
      <div className="hidden lg:flex flex-1">
        {leftPanel && (
          <aside className="w-80 xl:w-96 border-r border-ink/10 flex flex-col bg-paper/50 backdrop-blur-sm">
            {leftPanel}
          </aside>
        )}
        <div className="flex-1 flex flex-col min-w-0 bg-paper">
          {centerPanel}
        </div>
        {rightPanel && (
          <aside className="w-72 xl:w-80 border-l border-ink/10 flex flex-col bg-paper/50 backdrop-blur-sm">
            {rightPanel}
          </aside>
        )}
      </div>

      {/* 移动端：单栏布局 + 底部切换 */}
      <div className="flex lg:hidden flex-1 flex-col">
        <div className="flex-1 overflow-hidden">
          {activePanel === 'left' && leftPanel}
          {activePanel === 'center' && centerPanel}
          {activePanel === 'right' && rightPanel}
        </div>
        
        {/* 移动端面板切换器 */}
        {(leftPanel || rightPanel) && (
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40">
            <div className="flex items-center gap-1 p-1 bg-ink/90 backdrop-blur-xl rounded-full shadow-xl shadow-ink/20">
              {leftPanel && (
                <button
                  onClick={() => onPanelChange?.('left')}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-full transition-all",
                    activePanel === 'left'
                      ? "bg-paper text-ink"
                      : "text-paper/70 hover:text-paper"
                  )}
                >
                  工具
                </button>
              )}
              <button
                onClick={() => onPanelChange?.('center')}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-full transition-all",
                  activePanel === 'center'
                    ? "bg-paper text-ink"
                    : "text-paper/70 hover:text-paper"
                )}
              >
                对话
              </button>
              {rightPanel && (
                <button
                  onClick={() => onPanelChange?.('right')}
                  className={cn(
                    "px-4 py-2 text-sm font-medium rounded-full transition-all",
                    activePanel === 'right'
                      ? "bg-paper text-ink"
                      : "text-paper/70 hover:text-paper"
                  )}
                >
                  任务
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TabSwitcherProps {
  tabs: {
    id: string;
    label: string;
    icon?: React.ReactNode;
    badge?: string | number;
  }[];
  activeTab: string;
  onTabChange: (id: string) => void;
  variant?: 'default' | 'pills' | 'underline';
  className?: string;
}

// 标签切换器 - 用于面板内的子标签
export function TabSwitcher({
  tabs,
  activeTab,
  onTabChange,
  variant = 'default',
  className,
}: TabSwitcherProps) {
  const variants = {
    default: {
      container: "flex items-center gap-1 p-1 bg-ink/5 rounded-xl overflow-x-auto scrollbar-hide",
      tab: (active: boolean) => cn(
        "flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-all",
        active
          ? "bg-paper text-ink shadow-sm"
          : "text-ink/50 hover:text-ink/70 hover:bg-paper/50"
      ),
    },
    pills: {
      container: "flex items-center gap-2 overflow-x-auto scrollbar-hide",
      tab: (active: boolean) => cn(
        "flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full whitespace-nowrap transition-all",
        active
          ? "bg-ink text-paper shadow-lg shadow-ink/20"
          : "bg-ink/5 text-ink/60 hover:bg-ink/10"
      ),
    },
    underline: {
      container: "flex items-center gap-4 border-b border-ink/10 overflow-x-auto scrollbar-hide",
      tab: (active: boolean) => cn(
        "flex items-center gap-1.5 px-1 py-3 text-sm font-medium whitespace-nowrap transition-all relative",
        active
          ? "text-ink after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-vermilion after:rounded-full"
          : "text-ink/50 hover:text-ink/70"
      ),
    },
  };

  const style = variants[variant];

  return (
    <div className={cn(style.container, className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={style.tab(activeTab === tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge !== undefined && (
            <span className={cn(
              "ml-1 text-xs",
              activeTab === tab.id ? "opacity-70" : "opacity-50"
            )}>
              ({tab.badge})
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface FloatingActionButtonProps {
  icon: React.ReactNode;
  label?: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'vermilion';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// 浮动操作按钮 - 移动端常用
export function FloatingActionButton({
  icon,
  label,
  onClick,
  variant = 'primary',
  size = 'md',
  className,
}: FloatingActionButtonProps) {
  const variants = {
    primary: "bg-ink text-paper shadow-xl shadow-ink/30 hover:shadow-2xl hover:shadow-ink/40",
    secondary: "bg-paper text-ink border border-ink/20 shadow-lg hover:shadow-xl",
    vermilion: "bg-vermilion text-paper shadow-xl shadow-vermilion/30 hover:shadow-2xl hover:shadow-vermilion/40",
  };

  const sizes = {
    sm: "w-12 h-12",
    md: "w-14 h-14",
    lg: "w-16 h-16",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "fixed bottom-24 right-4 lg:bottom-8 lg:right-8 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-105 active:scale-95 z-50",
        variants[variant],
        label ? "px-5 py-3 gap-2" : sizes[size],
        className
      )}
    >
      {icon}
      {label && <span className="font-medium">{label}</span>}
    </button>
  );
}

// 空状态组件
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center py-12 px-4 text-center",
      className
    )}>
      {icon && (
        <div className="w-16 h-16 rounded-full bg-ink/5 flex items-center justify-center mb-4 text-ink/30">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-ink/50 max-w-xs mb-4">{description}</p>
      )}
      {action}
    </div>
  );
}
