/**
 * Zustand Stores 统一导出
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - bundle-barrel-file: 使用命名导出支持 tree-shaking
 */

// UI Store
export { 
  useUIStore,
  useViewMode,
  useReviewTab,
  useMobileSubPage,
  useIsMenuOpen,
  useIsActionDrawerOpen,
  useShowConversationHistory,
  useShowSplash,
  useAppReady,
  useUIActions,
} from './ui-store';
export type { UIStore, ViewMode, DataSource, ReviewTab, MobileSubPage } from './ui-store';

// Player Store
export {
  usePlayerStore,
  useIsPlaying,
  useCurrentTime,
  useIsPlayingAll,
  usePlayAllIndex,
  usePlayerActions,
} from './player-store';
export type { PlayerStore } from './player-store';
