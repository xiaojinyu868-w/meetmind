/**
 * Session Store - 管理课堂会话核心数据
 * 
 * 管理「当前会话」的核心状态，在「开始录音」「恢复课堂」「切换会话」时需要整体重置。
 * 
 * 注意：segments, anchors, timeline 等数组数据因为与 ref 紧密配套（segmentsRef 等），
 * 暂时保留在 page.tsx 的 useState 中，后续视需要再迁移。
 * 
 * 类型来源：@/types/page-types（single source of truth）
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  DataSource,
} from '@/types/page-types';
import type { Anchor } from '@/lib/services/anchor-service';
import type { ServiceStatus as ServiceStatusType } from '@/lib/services/health-check';
import type { ConfusionMarker } from '@/components/mobile/PodcastPlayer';
import type { ConversationHistory } from '@/types/conversation';

// ==================== 类型定义 ====================

interface SessionState {
  // 会话基础
  sessionId: string;
  isRecording: boolean;
  dataSource: DataSource;
  serviceStatus: ServiceStatusType | null;

  // 媒体源
  sessionMediaDurationMs: number;
  videoSeekNonce: number;
  videoPlayNonce: number;
  videoPauseNonce: number;

  // 选中状态
  selectedAnchor: Anchor | null;
  selectedConfusion: ConfusionMarker | null;
  selectedHistoryConversation: ConversationHistory | null;
}

interface SessionActions {
  setSessionId: (id: string) => void;
  setIsRecording: (recording: boolean) => void;
  setDataSource: (source: DataSource) => void;
  setServiceStatus: (status: ServiceStatusType | null) => void;
  
  setSessionMediaDurationMs: (ms: number) => void;
  setVideoSeekNonce: (nonce: number) => void;
  setVideoPlayNonce: (nonce: number) => void;
  incrementVideoSeekNonce: () => void;
  incrementVideoPlayNonce: () => void;
  incrementVideoPauseNonce: () => void;

  setSelectedAnchor: (anchor: Anchor | null) => void;
  setSelectedConfusion: (confusion: ConfusionMarker | null) => void;
  setSelectedHistoryConversation: (conversation: ConversationHistory | null) => void;

  // 批量重置（开始新会话时）
  resetSessionState: () => void;
}

export type SessionStore = SessionState & { actions: SessionActions };

// ==================== 初始状态 ====================

const initialState: SessionState = {
  sessionId: 'demo-session',
  isRecording: false,
  dataSource: 'live',
  serviceStatus: null,
  sessionMediaDurationMs: 0,
  videoSeekNonce: 0,
  videoPlayNonce: 0,
  videoPauseNonce: 0,
  selectedAnchor: null,
  selectedConfusion: null,
  selectedHistoryConversation: null,
};

// ==================== Store 实现 ====================

export const useSessionStore = create<SessionStore>()(
  devtools(
    (set) => ({
      ...initialState,
      
      actions: {
        setSessionId: (id) => set({ sessionId: id }, false, 'setSessionId'),
        setIsRecording: (recording) => set({ isRecording: recording }, false, 'setIsRecording'),
        setDataSource: (source) => set({ dataSource: source }, false, 'setDataSource'),
        setServiceStatus: (status) => set({ serviceStatus: status }, false, 'setServiceStatus'),
        
        setSessionMediaDurationMs: (ms) => set({ sessionMediaDurationMs: ms }, false, 'setSessionMediaDurationMs'),
        setVideoSeekNonce: (nonce) => set({ videoSeekNonce: nonce }, false, 'setVideoSeekNonce'),
        setVideoPlayNonce: (nonce) => set({ videoPlayNonce: nonce }, false, 'setVideoPlayNonce'),
        incrementVideoSeekNonce: () => set((s) => ({ videoSeekNonce: s.videoSeekNonce + 1 }), false, 'incrementVideoSeekNonce'),
        incrementVideoPlayNonce: () => set((s) => ({ videoPlayNonce: s.videoPlayNonce + 1 }), false, 'incrementVideoPlayNonce'),
        incrementVideoPauseNonce: () => set((s) => ({ videoPauseNonce: s.videoPauseNonce + 1 }), false, 'incrementVideoPauseNonce'),

        setSelectedAnchor: (anchor) => set({ selectedAnchor: anchor }, false, 'setSelectedAnchor'),
        setSelectedConfusion: (confusion) => set({ selectedConfusion: confusion }, false, 'setSelectedConfusion'),
        setSelectedHistoryConversation: (conversation) => set({ selectedHistoryConversation: conversation }, false, 'setSelectedHistoryConversation'),

        resetSessionState: () => set({
          isRecording: false,
          selectedAnchor: null,
          selectedConfusion: null,
          selectedHistoryConversation: null,
          videoSeekNonce: 0,
          videoPlayNonce: 0,
          videoPauseNonce: 0,
        }, false, 'resetSessionState'),
      },
    }),
    { name: 'session-store' }
  )
);

// ==================== Selector Hooks ====================

export const useSessionId = () => useSessionStore((s) => s.sessionId);
export const useIsRecording = () => useSessionStore((s) => s.isRecording);
export const useDataSource = () => useSessionStore((s) => s.dataSource);
export const useServiceStatus = () => useSessionStore((s) => s.serviceStatus);
export const useSessionMediaDurationMs = () => useSessionStore((s) => s.sessionMediaDurationMs);
export const useVideoSeekNonce = () => useSessionStore((s) => s.videoSeekNonce);
export const useVideoPlayNonce = () => useSessionStore((s) => s.videoPlayNonce);
export const useSelectedAnchor = () => useSessionStore((s) => s.selectedAnchor);
export const useSelectedConfusion = () => useSessionStore((s) => s.selectedConfusion);
export const useSelectedHistoryConversation = () => useSessionStore((s) => s.selectedHistoryConversation);
export const useSessionActions = () => useSessionStore((s) => s.actions);

export default useSessionStore;
