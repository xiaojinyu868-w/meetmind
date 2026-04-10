/**
 * Mobile AI Store - 管理移动端 AI 对话启动状态
 *
 * 从 page.tsx 迁移的状态覆盖：
 * - mobileAIQuestion / mobileAIDisplayQuestion — AI 提问文本
 * - mobileAILaunchImages — 启动时附带的图片
 * - mobileAILaunchSupportContextText — 启动时附带的上下文
 * - mobileAIQuestionNonce / mobileAIConsumedQuestionNonce — 消费机制
 * - mobileAIPreferSelectedContext — 是否偏好选中上下文
 * - mobileAILaunchTarget — 启动目标面板
 * - mobileAINewConversationNonce — 新会话信号
 * - mobileAIHasActiveConversation — 是否有活跃会话
 *
 * 类型来源：@/types/page-types（single source of truth）
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { TutorLaunchImageAsset } from '@/types/page-types';

// ==================== 类型定义 ====================

export type MobileAILaunchTarget = 'review-panel' | 'video-chat' | 'mobile-ai-chat' | null;

interface MobileAIState {
  mobileAIQuestion: string;
  mobileAIDisplayQuestion: string;
  mobileAILaunchImages: TutorLaunchImageAsset[];
  mobileAILaunchSupportContextText: string;
  mobileAIQuestionNonce: number;
  mobileAIConsumedQuestionNonce: number | null;
  mobileAIPreferSelectedContext: boolean;
  mobileAILaunchTarget: MobileAILaunchTarget;
  mobileAINewConversationNonce: number;
  mobileAIHasActiveConversation: boolean;
}

interface MobileAIActions {
  setMobileAIQuestion: (q: string) => void;
  setMobileAIDisplayQuestion: (q: string) => void;
  setMobileAILaunchImages: (images: TutorLaunchImageAsset[]) => void;
  setMobileAILaunchSupportContextText: (text: string) => void;
  setMobileAIQuestionNonce: (nonce: number | ((prev: number) => number)) => void;
  setMobileAIConsumedQuestionNonce: (nonce: number | null) => void;
  setMobileAIPreferSelectedContext: (prefer: boolean) => void;
  setMobileAILaunchTarget: (target: MobileAILaunchTarget) => void;
  setMobileAINewConversationNonce: (nonce: number | ((prev: number) => number)) => void;
  setMobileAIHasActiveConversation: (active: boolean) => void;

  /** 清除所有启动状态（问题已被消费后调用） */
  clearLaunchState: () => void;

  resetMobileAIState: () => void;
}

export type MobileAIStore = MobileAIState & { actions: MobileAIActions };

// ==================== 初始状态 ====================

const initialState: MobileAIState = {
  mobileAIQuestion: '',
  mobileAIDisplayQuestion: '',
  mobileAILaunchImages: [],
  mobileAILaunchSupportContextText: '',
  mobileAIQuestionNonce: 0,
  mobileAIConsumedQuestionNonce: null,
  mobileAIPreferSelectedContext: false,
  mobileAILaunchTarget: null,
  mobileAINewConversationNonce: 0,
  mobileAIHasActiveConversation: false,
};

// ==================== Store 实现 ====================

export const useMobileAIStore = create<MobileAIStore>()(
  devtools(
    (set) => ({
      ...initialState,

      actions: {
        setMobileAIQuestion: (q) => set({ mobileAIQuestion: q }, false, 'setMobileAIQuestion'),
        setMobileAIDisplayQuestion: (q) => set({ mobileAIDisplayQuestion: q }, false, 'setMobileAIDisplayQuestion'),
        setMobileAILaunchImages: (images) => set({ mobileAILaunchImages: images }, false, 'setMobileAILaunchImages'),
        setMobileAILaunchSupportContextText: (text) => set({ mobileAILaunchSupportContextText: text }, false, 'setMobileAILaunchSupportContextText'),
        setMobileAIQuestionNonce: (next) => set((s) => ({ mobileAIQuestionNonce: typeof next === 'function' ? next(s.mobileAIQuestionNonce) : next }), false, 'setMobileAIQuestionNonce'),
        setMobileAIConsumedQuestionNonce: (nonce) => set({ mobileAIConsumedQuestionNonce: nonce }, false, 'setMobileAIConsumedQuestionNonce'),
        setMobileAIPreferSelectedContext: (prefer) => set({ mobileAIPreferSelectedContext: prefer }, false, 'setMobileAIPreferSelectedContext'),
        setMobileAILaunchTarget: (target) => set({ mobileAILaunchTarget: target }, false, 'setMobileAILaunchTarget'),
        setMobileAINewConversationNonce: (next) => set((s) => ({ mobileAINewConversationNonce: typeof next === 'function' ? next(s.mobileAINewConversationNonce) : next }), false, 'setMobileAINewConversationNonce'),
        setMobileAIHasActiveConversation: (active) => set({ mobileAIHasActiveConversation: active }, false, 'setMobileAIHasActiveConversation'),

        clearLaunchState: () => set({
          mobileAIQuestion: '',
          mobileAIDisplayQuestion: '',
          mobileAILaunchImages: [],
          mobileAILaunchSupportContextText: '',
          mobileAIConsumedQuestionNonce: null,
          mobileAIPreferSelectedContext: false,
          mobileAILaunchTarget: null,
        }, false, 'clearLaunchState'),

        resetMobileAIState: () => set(initialState, false, 'resetMobileAIState'),
      },
    }),
    { name: 'mobile-ai-store' }
  )
);

// ==================== Selector Hooks ====================

export const useMobileAIQuestion = () => useMobileAIStore((s) => s.mobileAIQuestion);
export const useMobileAIDisplayQuestion = () => useMobileAIStore((s) => s.mobileAIDisplayQuestion);
export const useMobileAILaunchImages = () => useMobileAIStore((s) => s.mobileAILaunchImages);
export const useMobileAILaunchSupportContextText = () => useMobileAIStore((s) => s.mobileAILaunchSupportContextText);
export const useMobileAIQuestionNonce = () => useMobileAIStore((s) => s.mobileAIQuestionNonce);
export const useMobileAIConsumedQuestionNonce = () => useMobileAIStore((s) => s.mobileAIConsumedQuestionNonce);
export const useMobileAIPreferSelectedContext = () => useMobileAIStore((s) => s.mobileAIPreferSelectedContext);
export const useMobileAILaunchTarget = () => useMobileAIStore((s) => s.mobileAILaunchTarget);
export const useMobileAINewConversationNonce = () => useMobileAIStore((s) => s.mobileAINewConversationNonce);
export const useMobileAIHasActiveConversation = () => useMobileAIStore((s) => s.mobileAIHasActiveConversation);
export const useMobileAIActions = () => useMobileAIStore((s) => s.actions);

export default useMobileAIStore;
