/**
 * Page UI Store - 管理 page.tsx 的 UI 状态
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - rerender-zustand-selector: 使用 selector 精确订阅，避免不必要重渲染
 * - rerender-memoize: 避免在渲染时创建新对象
 * 
 * 类型来源：@/types/page-types（single source of truth）
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  ViewMode,
  DataSource,
  ReviewTab,
  VideoWorkspaceTab,
  MobileCollectionSheet,
} from '@/types/page-types';

// Re-export types for convenience
export type { ViewMode, DataSource, ReviewTab, VideoWorkspaceTab, MobileCollectionSheet };

// page.tsx 中 mobileSubPage 实际使用的类型（包含 'apps' + 'transcript'）
export type MobileSubPage = 'highlights' | 'summary' | 'notes' | 'tasks' | 'apps' | 'ai-chat' | 'ai-call' | 'transcript' | null;

// ==================== 类型定义 ====================

interface UIState {
  // 视图模式
  viewMode: ViewMode;
  reviewTab: ReviewTab;
  videoWorkspaceTab: VideoWorkspaceTab;
  mobileSubPage: MobileSubPage;
  
  // UI 开关
  isMenuOpen: boolean;
  isActionDrawerOpen: boolean;
  showConversationHistory: boolean;
  showTranscriptBar: boolean;
  showAISearch: boolean;
  showMobileRecorder: boolean;
  
  // Mobile Collection
  mobileCollectionSheet: MobileCollectionSheet;
  
  // 应用加载状态
  showSplash: boolean;
  appReady: boolean;
  loadingProgress: number;
}

interface UIActions {
  // 视图模式 actions
  setViewMode: (mode: ViewMode) => void;
  setReviewTab: (tab: ReviewTab) => void;
  setVideoWorkspaceTab: (tab: VideoWorkspaceTab) => void;
  setMobileSubPage: (page: MobileSubPage) => void;
  
  // UI 开关 actions
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setActionDrawerOpen: (open: boolean) => void;
  setShowConversationHistory: (show: boolean) => void;
  setShowTranscriptBar: (show: boolean) => void;
  toggleTranscriptBar: () => void;
  setShowAISearch: (show: boolean) => void;
  setShowMobileRecorder: (show: boolean) => void;
  
  // Mobile Collection
  setMobileCollectionSheet: (sheet: MobileCollectionSheet) => void;
  
  // 应用状态 actions
  setShowSplash: (show: boolean) => void;
  setAppReady: (ready: boolean) => void;
  setLoadingProgress: (progress: number) => void;
  
  // 批量重置（切换会话时）
  resetUIState: () => void;
}

export type UIStore = UIState & { actions: UIActions };

// ==================== 初始状态 ====================

const initialState: UIState = {
  viewMode: 'record',
  reviewTab: 'timeline',
  videoWorkspaceTab: 'chat',
  mobileSubPage: null,
  isMenuOpen: false,
  isActionDrawerOpen: false,
  showConversationHistory: false,
  showTranscriptBar: false,
  showAISearch: false,
  showMobileRecorder: false,
  mobileCollectionSheet: null,
  showSplash: true,
  appReady: false,
  loadingProgress: 0,
};

// ==================== Store 实现 ====================

export const useUIStore = create<UIStore>()(
  devtools(
    (set) => ({
      ...initialState,
      
      actions: {
        setViewMode: (mode) => set({ viewMode: mode }, false, 'setViewMode'),
        setReviewTab: (tab) => set({ reviewTab: tab }, false, 'setReviewTab'),
        setVideoWorkspaceTab: (tab) => set({ videoWorkspaceTab: tab }, false, 'setVideoWorkspaceTab'),
        setMobileSubPage: (page) => set({ mobileSubPage: page }, false, 'setMobileSubPage'),
        
        setMenuOpen: (open) => set({ isMenuOpen: open }, false, 'setMenuOpen'),
        toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen }), false, 'toggleMenu'),
        setActionDrawerOpen: (open) => set({ isActionDrawerOpen: open }, false, 'setActionDrawerOpen'),
        setShowConversationHistory: (show) => set({ showConversationHistory: show }, false, 'setShowConversationHistory'),
        setShowTranscriptBar: (show) => set({ showTranscriptBar: show }, false, 'setShowTranscriptBar'),
        toggleTranscriptBar: () => set((state) => ({ showTranscriptBar: !state.showTranscriptBar }), false, 'toggleTranscriptBar'),
        setShowAISearch: (show) => set({ showAISearch: show }, false, 'setShowAISearch'),
        setShowMobileRecorder: (show) => set({ showMobileRecorder: show }, false, 'setShowMobileRecorder'),
        
        setMobileCollectionSheet: (sheet) => set({ mobileCollectionSheet: sheet }, false, 'setMobileCollectionSheet'),
        
        setShowSplash: (show) => set({ showSplash: show }, false, 'setShowSplash'),
        setAppReady: (ready) => set({ appReady: ready }, false, 'setAppReady'),
        setLoadingProgress: (progress) => set({ loadingProgress: progress }, false, 'setLoadingProgress'),
        
        resetUIState: () => set({
          reviewTab: 'timeline',
          videoWorkspaceTab: 'chat',
          mobileSubPage: null,
          isMenuOpen: false,
          isActionDrawerOpen: false,
          showConversationHistory: false,
          showTranscriptBar: false,
          showAISearch: false,
          showMobileRecorder: false,
          mobileCollectionSheet: null,
        }, false, 'resetUIState'),
      },
    }),
    { name: 'ui-store' }
  )
);

// ==================== Selector Hooks ====================
// 使用 selector 精确订阅，避免不必要的重渲染

export const useViewMode = () => useUIStore((state) => state.viewMode);
export const useReviewTab = () => useUIStore((state) => state.reviewTab);
export const useVideoWorkspaceTab = () => useUIStore((state) => state.videoWorkspaceTab);
export const useMobileSubPage = () => useUIStore((state) => state.mobileSubPage);
export const useIsMenuOpen = () => useUIStore((state) => state.isMenuOpen);
export const useIsActionDrawerOpen = () => useUIStore((state) => state.isActionDrawerOpen);
export const useShowConversationHistory = () => useUIStore((state) => state.showConversationHistory);
export const useShowTranscriptBar = () => useUIStore((state) => state.showTranscriptBar);
export const useShowAISearch = () => useUIStore((state) => state.showAISearch);
export const useShowMobileRecorder = () => useUIStore((state) => state.showMobileRecorder);
export const useMobileCollectionSheet = () => useUIStore((state) => state.mobileCollectionSheet);
export const useShowSplash = () => useUIStore((state) => state.showSplash);
export const useAppReady = () => useUIStore((state) => state.appReady);
export const useLoadingProgress = () => useUIStore((state) => state.loadingProgress);
export const useUIActions = () => useUIStore((state) => state.actions);

export default useUIStore;
