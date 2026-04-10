/**
 * Echo Store - 管理回声（Echo）相关状态
 *
 * 从 page.tsx 迁移的状态覆盖：
 * - workspaceEchoes — 工作区回声消息列表
 * - selectedEchoChip — 回声筛选标签
 * - isManualEchoRefreshing — 手动刷新回声状态
 * - manualEchoDebugNote — 调试信息
 * - manualEchoFeedback — 手动回声反馈状态
 * - sharingEcho — 正在分享的回声
 * - workspaceCaptures — 工作区 capture 列表
 *
 * 类型来源：@/types/page-types（single source of truth）
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  WorkspaceEchoMessage,
  WorkspaceCaptureMessage,
  ManualEchoFeedbackState,
} from '@/types/page-types';
import type { EchoData } from '@/components/EchoCard';

// ==================== 类型定义 ====================

interface EchoState {
  workspaceEchoes: WorkspaceEchoMessage[];
  workspaceCaptures: WorkspaceCaptureMessage[];
  selectedEchoChip: string;
  isManualEchoRefreshing: boolean;
  manualEchoDebugNote: string;
  manualEchoFeedback: ManualEchoFeedbackState | null;
  sharingEcho: EchoData | null;
}

interface EchoActions {
  setWorkspaceEchoes: (echoes: WorkspaceEchoMessage[] | ((prev: WorkspaceEchoMessage[]) => WorkspaceEchoMessage[])) => void;
  setWorkspaceCaptures: (captures: WorkspaceCaptureMessage[] | ((prev: WorkspaceCaptureMessage[]) => WorkspaceCaptureMessage[])) => void;
  setSelectedEchoChip: (chip: string) => void;
  setIsManualEchoRefreshing: (refreshing: boolean) => void;
  setManualEchoDebugNote: (note: string) => void;
  setManualEchoFeedback: (feedback: ManualEchoFeedbackState | null) => void;
  setSharingEcho: (echo: EchoData | null) => void;

  resetEchoState: () => void;
}

export type EchoStore = EchoState & { actions: EchoActions };

// ==================== 初始状态 ====================

const initialState: EchoState = {
  workspaceEchoes: [],
  workspaceCaptures: [],
  selectedEchoChip: '全部',
  isManualEchoRefreshing: false,
  manualEchoDebugNote: '',
  manualEchoFeedback: null,
  sharingEcho: null,
};

// ==================== 辅助函数 ====================

function resolveUpdate<T>(next: T | ((prev: T) => T), prev: T): T {
  return typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
}

// ==================== Store 实现 ====================

export const useEchoStore = create<EchoStore>()(
  devtools(
    (set) => ({
      ...initialState,

      actions: {
        setWorkspaceEchoes: (next) => set((s) => ({ workspaceEchoes: resolveUpdate(next, s.workspaceEchoes) }), false, 'setWorkspaceEchoes'),
        setWorkspaceCaptures: (next) => set((s) => ({ workspaceCaptures: resolveUpdate(next, s.workspaceCaptures) }), false, 'setWorkspaceCaptures'),
        setSelectedEchoChip: (chip) => set({ selectedEchoChip: chip }, false, 'setSelectedEchoChip'),
        setIsManualEchoRefreshing: (refreshing) => set({ isManualEchoRefreshing: refreshing }, false, 'setIsManualEchoRefreshing'),
        setManualEchoDebugNote: (note) => set({ manualEchoDebugNote: note }, false, 'setManualEchoDebugNote'),
        setManualEchoFeedback: (feedback) => set({ manualEchoFeedback: feedback }, false, 'setManualEchoFeedback'),
        setSharingEcho: (echo) => set({ sharingEcho: echo }, false, 'setSharingEcho'),

        resetEchoState: () => set(initialState, false, 'resetEchoState'),
      },
    }),
    { name: 'echo-store' }
  )
);

// ==================== Selector Hooks ====================

export const useWorkspaceEchoes = () => useEchoStore((s) => s.workspaceEchoes);
export const useWorkspaceCaptures = () => useEchoStore((s) => s.workspaceCaptures);
export const useSelectedEchoChip = () => useEchoStore((s) => s.selectedEchoChip);
export const useIsManualEchoRefreshing = () => useEchoStore((s) => s.isManualEchoRefreshing);
export const useManualEchoDebugNote = () => useEchoStore((s) => s.manualEchoDebugNote);
export const useManualEchoFeedback = () => useEchoStore((s) => s.manualEchoFeedback);
export const useSharingEcho = () => useEchoStore((s) => s.sharingEcho);
export const useEchoActions = () => useEchoStore((s) => s.actions);

export default useEchoStore;
