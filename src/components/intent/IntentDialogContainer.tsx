'use client';

/**
 * IntentDialogContainer — 「聊聊你想要的」文字对话入口。
 *
 * 父组件只需要给：
 *   - open / onClose
 *   - sessionHint（首次进入用 'first-time'，设置页用 undefined）
 *   - onSkip（首次进入"先不聊"）
 *
 * 内部负责：
 *   - 保存 GoalEntry → PATCH /api/auth/learner-profile（合并已有 goals）
 *
 * 不做的事：
 *   ✗ 不写 IndexedDB
 *   ✗ 不动 conversationService（globalChat 持久化）
 *
 * 2026-08 决策：实时语音通话（/api/tutor-call）下线，原「打电话聊」模式
 * （IntentVoiceCallScreen）入口已移除，意图录入只保留文字对话。
 * 语音组件文件标记 deprecated，保留一个周期后物理删除。
 */

import * as React from 'react';
import { IntentDialog } from './IntentDialog';
import { useAuth } from '@/lib/hooks/useAuth';
import type { BioEntry, GoalEntry, LearnerProfile } from '@/types/user';

interface IntentDialogContainerProps {
  open: boolean;
  /** 进入这次对话时附带的 hint —— 首次注册可传 'first-time' */
  sessionHint?: string;
  /** 关闭弹窗 */
  onClose: () => void;
  /** 首次进入"先不聊" —— 父组件标记 onboarding 跳过 */
  onSkip?: () => void;
}

export function IntentDialogContainer({
  open,
  sessionHint,
  onClose,
  onSkip,
}: IntentDialogContainerProps) {
  const { user, accessToken, saveLearnerProfile } = useAuth();

  const learnerProfile = user?.learnerProfile ?? null;

  const handleSaveGoal = React.useCallback(
    async (goal: GoalEntry) => {
      const existingGoals = learnerProfile?.goals ?? [];
      // 简单去重：title 完全相同则更新而不是新增
      const dedupedExisting = existingGoals.filter((g) => g.title.trim() !== goal.title.trim());
      const nextGoals = [...dedupedExisting, goal];

      // 只有自然语言沉淀时不猜结构化身份，等用户主动填写学习档案。
      const baseProfile: Partial<LearnerProfile> & { goals: GoalEntry[] } = learnerProfile
        ? { ...(learnerProfile as object), goals: nextGoals } as LearnerProfile & { goals: GoalEntry[] }
        : ({ stage: 'unknown', goals: nextGoals } as LearnerProfile & { goals: GoalEntry[] });

      await saveLearnerProfile(baseProfile as LearnerProfile);
    },
    [learnerProfile, saveLearnerProfile],
  );

  const handleSaveBio = React.useCallback(
    async (bio: BioEntry) => {
      // bio 已由用户逐条确认，但结构化身份仍保持未知，不能替用户补成“大一”。
      const baseProfile: Partial<LearnerProfile> & { bio: BioEntry } = learnerProfile
        ? ({ ...(learnerProfile as object), bio } as LearnerProfile & { bio: BioEntry })
        : ({ stage: 'unknown', bio } as LearnerProfile & { bio: BioEntry });

      await saveLearnerProfile(baseProfile as LearnerProfile);
    },
    [learnerProfile, saveLearnerProfile],
  );

  if (!open) return null;

  return (
    <IntentDialog
      open
      authToken={accessToken ?? undefined}
      learnerProfile={learnerProfile}
      sessionHint={sessionHint}
      onClose={onClose}
      onSaveGoal={handleSaveGoal}
      onSaveBio={handleSaveBio}
      onSkip={onSkip}
    />
  );
}

export default IntentDialogContainer;
