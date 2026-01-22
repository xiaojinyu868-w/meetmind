/**
 * Page UI Store - 管理 page.tsx 的 UI 状态
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - rerender-zustand-selector: 使用 selector 精确订阅，避免不必要重渲染
 * - rerender-memoize: 避免在渲染时创建新对象
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ==================== 类型定义 ====================

export type ViewMode = 'record' | 'review';
export type DataSource = 'live' | 'demo';
export type ReviewTab = 'timeline' | 'highlights' | 'summary' | 'notes' | 'anchor-detail';
export type MobileSubPage = 'highlights' | 'summary' | 'notes' | 'tasks' | 'ai-chat' | null;

interface UIState {
  // 视图模式
  viewMode: ViewMode;
  reviewTab: ReviewTab;
  mobileSubPage: MobileSubPage;
  
  // UI 开关
  isMenuOpen: boolean;
  isActionDrawerOpen: boolean;
  showConversationHistory: boolean;
  
  // 应用加载状态
  showSplash: boolean;
  appReady: boolean;
}

interface UIActions {
  // 视图模式 actions
  setViewMode: (mode: ViewMode) => void;
  setReviewTab: (tab: ReviewTab) => void;
  setMobileSubPage: (page: MobileSubPage) => void;
  
  // UI 开关 actions
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setActionDrawerOpen: (open: boolean) => void;
  setShowConversationHistory: (show: boolean) => void;
  
  // 应用状态 actions
  setShowSplash: (show: boolean) => void;
  setAppReady: (ready: boolean) => void;
  
  // 批量重置（切换会话时）
  resetUIState: () => void;
}

export type UIStore = UIState & { actions: UIActions };

// ==================== 初始状态 ====================

const initialState: UIState = {
  viewMode: 'record',
  reviewTab: 'timeline',
  mobileSubPage: null,
  isMenuOpen: false,
  isActionDrawerOpen: false,
  showConversationHistory: false,
  showSplash: true,
  appReady: false,
};

// ==================== Store 实现 ====================

export const useUIStore = create<UIStore>()(
  devtools(
    (set) => ({
      ...initialState,
      
      actions: {
        setViewMode: (mode) => set({ viewMode: mode }, false, 'setViewMode'),
        setReviewTab: (tab) => set({ reviewTab: tab }, false, 'setReviewTab'),
        setMobileSubPage: (page) => set({ mobileSubPage: page }, false, 'setMobileSubPage'),
        
        setMenuOpen: (open) => set({ isMenuOpen: open }, false, 'setMenuOpen'),
        toggleMenu: () => set((state) => ({ isMenuOpen: !state.isMenuOpen }), false, 'toggleMenu'),
        setActionDrawerOpen: (open) => set({ isActionDrawerOpen: open }, false, 'setActionDrawerOpen'),
        setShowConversationHistory: (show) => set({ showConversationHistory: show }, false, 'setShowConversationHistory'),
        
        setShowSplash: (show) => set({ showSplash: show }, false, 'setShowSplash'),
        setAppReady: (ready) => set({ appReady: ready }, false, 'setAppReady'),
        
        resetUIState: () => set({
          reviewTab: 'timeline',
          mobileSubPage: null,
          isMenuOpen: false,
          isActionDrawerOpen: false,
          showConversationHistory: false,
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
export const useMobileSubPage = () => useUIStore((state) => state.mobileSubPage);
export const useIsMenuOpen = () => useUIStore((state) => state.isMenuOpen);
export const useIsActionDrawerOpen = () => useUIStore((state) => state.isActionDrawerOpen);
export const useShowConversationHistory = () => useUIStore((state) => state.showConversationHistory);
export const useShowSplash = () => useUIStore((state) => state.showSplash);
export const useAppReady = () => useUIStore((state) => state.appReady);
export const useUIActions = () => useUIStore((state) => state.actions);

export default useUIStore;
