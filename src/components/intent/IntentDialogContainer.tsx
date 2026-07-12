'use client';

/**
 * IntentDialogContainer — 把「聊聊你想要的」的文字+通话两态打包给入口处用。
 *
 * 父组件只需要给：
 *   - open / onClose
 *   - sessionHint（首次进入用 'first-time'，设置页用 undefined）
 *   - onSkip（首次进入"先不聊"）
 *
 * 内部负责：
 *   - 切换文字模式（IntentDialog） / 通话模式（IntentVoiceCallScreen）
 *   - 通话 instructions 拼装
 *   - 保存 GoalEntry → PATCH /api/auth/learner-profile（合并已有 goals）
 *
 * 不做的事：
 *   ✗ 不写 IndexedDB
 *   ✗ 不动 conversationService（globalChat 持久化）
 *
 * 设计决策：
 *   - 通话模式的 instructions 是简化版 system prompt（直接拼一段话），
 *     不复用 buildTutorSystemPrompt——那是给 /api/tutor/agent 的格式，
 *     /api/tutor-call 走的是 DashScope Realtime，prompt 形态完全不同。
 */

import * as React from 'react';
import { IntentDialog } from './IntentDialog';
import { IntentVoiceCallScreen } from '@/components/realtime/IntentVoiceCallScreen';
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

/** 通话模式 instructions —— 简短拼接，DashScope Realtime 用 */
function buildCallInstructions(profile: LearnerProfile | null | undefined): string {
  const bio = profile?.bio;
  const goals = profile?.goals ?? [];
  const bioLine = bio?.headline
    ? `你之前已经认识他：${bio.headline}${bio.detail ? '。' + bio.detail : ''}。这次别再问身份/阶段。`
    : '这是你和他的第一次见面——温和地引导他自我介绍（先聊身份、阶段、最近状态），不要一次问多个问题。';
  const goalList =
    goals.length > 0
      ? '他之前留下的事：' + goals.map((g) => g.title).join('；') + '。'
      : '';
  return [
    '你是 Octo——这位同学的人生顾问。他打来电话，想被你认真听一次。',
    bioLine,
    '不要追着问"为什么 / 多久 / 怎么做"——那会变成问卷。',
    '认真听他说，复述/反问让他听到自己说了什么。当他说出一句稳的句子，把它温柔点出来。',
    '用自然、口语化、温暖的中文回答，每次两三句话以内。',
    goalList,
  ]
    .filter(Boolean)
    .join(' ');
}

export function IntentDialogContainer({
  open,
  sessionHint,
  onClose,
  onSkip,
}: IntentDialogContainerProps) {
  const { user, accessToken, saveLearnerProfile } = useAuth();
  const [mode, setMode] = React.useState<'text' | 'call'>('text');

  React.useEffect(() => {
    if (!open) setMode('text');
  }, [open]);

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

  const callInstructions = React.useMemo(() => buildCallInstructions(learnerProfile), [learnerProfile]);

  if (!open) return null;

  if (mode === 'call') {
    return (
      <IntentVoiceCallScreen
        open
        instructions={callInstructions}
        onSwitchToText={() => setMode('text')}
        onExit={onClose}
      />
    );
  }

  return (
    <IntentDialog
      open
      authToken={accessToken ?? undefined}
      learnerProfile={learnerProfile}
      sessionHint={sessionHint}
      onSwitchToCall={() => setMode('call')}
      onClose={onClose}
      onSaveGoal={handleSaveGoal}
      onSaveBio={handleSaveBio}
      onSkip={onSkip}
    />
  );
}

export default IntentDialogContainer;
