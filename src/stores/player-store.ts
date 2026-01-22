/**
 * Player Store - 管理播放器状态
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - rerender-zustand-selector: 使用 selector 精确订阅
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// ==================== 类型定义 ====================

interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  isPlayingAll: boolean;
  playAllIndex: number;
}

interface PlayerActions {
  setIsPlaying: (playing: boolean) => void;
  setCurrentTime: (time: number) => void;
  setIsPlayingAll: (playing: boolean) => void;
  setPlayAllIndex: (index: number) => void;
  resetPlayerState: () => void;
}

export type PlayerStore = PlayerState & { actions: PlayerActions };

// ==================== 初始状态 ====================

const initialState: PlayerState = {
  isPlaying: false,
  currentTime: 0,
  isPlayingAll: false,
  playAllIndex: 0,
};

// ==================== Store 实现 ====================

export const usePlayerStore = create<PlayerStore>()(
  devtools(
    (set) => ({
      ...initialState,
      
      actions: {
        setIsPlaying: (playing) => set({ isPlaying: playing }, false, 'setIsPlaying'),
        setCurrentTime: (time) => set({ currentTime: time }, false, 'setCurrentTime'),
        setIsPlayingAll: (playing) => set({ isPlayingAll: playing }, false, 'setIsPlayingAll'),
        setPlayAllIndex: (index) => set({ playAllIndex: index }, false, 'setPlayAllIndex'),
        resetPlayerState: () => set(initialState, false, 'resetPlayerState'),
      },
    }),
    { name: 'player-store' }
  )
);

// ==================== Selector Hooks ====================

export const useIsPlaying = () => usePlayerStore((state) => state.isPlaying);
export const useCurrentTime = () => usePlayerStore((state) => state.currentTime);
export const useIsPlayingAll = () => usePlayerStore((state) => state.isPlayingAll);
export const usePlayAllIndex = () => usePlayerStore((state) => state.playAllIndex);
export const usePlayerActions = () => usePlayerStore((state) => state.actions);

export default usePlayerStore;
