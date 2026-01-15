'use client';

import { useState, useCallback } from 'react';
import { BottomPanel, BottomPanelHeader, PanelState } from './BottomPanel';
import { MenuDrawer, DrawerMenuItem, DrawerDivider } from './MenuDrawer';
import { cn } from '@/lib/utils';

export interface MobileLayoutProps {
  /** AI 对话主体内容 */
  mainContent: React.ReactNode;
  /** 底部面板内容（时间轴、困惑点等） */
  panelContent: React.ReactNode;
  /** 抽屉内容（今晚任务等） */
  drawerContent?: React.ReactNode;
  /** 波形播放器（可选，显示在主内容上方） */
  waveformPlayer?: React.ReactNode;
  /** 面板标题 */
  panelTitle?: string;
  /** 面板副标题/信息 */
  panelSubtitle?: string;
  /** 待解决数量徽章 */
  unresolvedCount?: number;
  /** 是否显示抽屉 */
  isDrawerOpen?: boolean;
  /** 抽屉开关回调 */
  onDrawerToggle?: (isOpen: boolean) => void;
  /** 面板状态变化回调 */
  onPanelStateChange?: (state: PanelState) => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * 移动端布局容器
 * 整合可拖拽底部面板和菜单抽屉
 */
export function MobileLayout({
  mainContent,
  panelContent,
  drawerContent,
  waveformPlayer,
  panelTitle = '课堂时间轴',
  panelSubtitle,
  unresolvedCount = 0,
  isDrawerOpen = false,
  onDrawerToggle,
  onPanelStateChange,
  className,
}: MobileLayoutProps) {
  const [panelState, setPanelState] = useState<PanelState>('collapsed');
  
  const handlePanelStateChange = useCallback((state: PanelState) => {
    setPanelState(state);
    onPanelStateChange?.(state);
  }, [onPanelStateChange]);

  const handleCloseDrawer = useCallback(() => {
    onDrawerToggle?.(false);
  }, [onDrawerToggle]);

  // 面板标题区域
  const panelHeader = (
    <BottomPanelHeader
      title={panelTitle}
      badge={unresolvedCount > 0 ? (
        <span className="px-2 py-0.5 text-xs font-semibold bg-rose-100 text-rose-600 rounded-full">
          {unresolvedCount} 待解决
        </span>
      ) : undefined}
      subtitle={panelSubtitle}
    />
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* 波形播放器（如果有） */}
      {waveformPlayer && (
        <div className="flex-shrink-0 px-3 py-2 border-b border-gray-100 bg-white">
          {waveformPlayer}
        </div>
      )}
      
      {/* AI 对话主体区域 */}
      <div 
        className={cn(
          "flex-1 min-h-0 overflow-hidden transition-all duration-300",
          // 根据面板状态调整主内容区域的底部内边距
          panelState === 'collapsed' && 'pb-[15vh]',
          panelState === 'partial' && 'pb-[45vh]',
          panelState === 'expanded' && 'pb-[85vh]',
        )}
      >
        {mainContent}
      </div>
      
      {/* 可拖拽底部面板 */}
      <BottomPanel
        header={panelHeader}
        defaultState="collapsed"
        onStateChange={handlePanelStateChange}
        showOverlay={panelState !== 'collapsed'}
        onOverlayClick={() => handlePanelStateChange('collapsed')}
      >
        {panelContent}
      </BottomPanel>
      
      {/* 菜单抽屉 */}
      {drawerContent && (
        <MenuDrawer
          isOpen={isDrawerOpen}
          onClose={handleCloseDrawer}
          title="今晚任务"
          position="right"
        >
          {drawerContent}
        </MenuDrawer>
      )}
    </div>
  );
}

/**
 * 移动端面板标签切换器
 */
export interface MobilePanelTabsProps {
  tabs: {
    id: string;
    label: string;
    icon?: React.ReactNode;
    badge?: number;
  }[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function MobilePanelTabs({
  tabs,
  activeTab,
  onTabChange,
}: MobilePanelTabsProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto scrollbar-hide border-b border-gray-100">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all",
            activeTab === tab.id
              ? "bg-gray-900 text-white"
              : "text-gray-500 hover:bg-gray-100"
          )}
        >
          {tab.icon}
          <span>{tab.label}</span>
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className={cn(
              "ml-1 px-1.5 py-0.5 text-xs rounded-full",
              activeTab === tab.id
                ? "bg-white/20 text-white"
                : "bg-rose-100 text-rose-600"
            )}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
