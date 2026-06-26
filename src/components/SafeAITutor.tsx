'use client';

/**
 * SafeAITutor — M10 收口后的唯一 AI 对话入口（录音复习 + 视频复习共用）
 *
 * M10 之前：feature flag `NEXT_PUBLIC_TUTOR_AGENT_ENABLED` 在新 agent 路径
 * 和老 AITutor SSE 路径之间切换，两份 prompt/model。
 * M10 之后：flag 退役，所有对话统一走 `TutorAgentPanel → /api/tutor/agent`。
 *
 * M12：彻底退役 AITutor.tsx（97KB legacy）—— LEGACY_AITUTOR_ENABLED 分支删除，
 * 没有人再依赖它。如果将来真的需要回滚，回 git history 找。
 *
 * 复习态的两个可选能力（时间戳显示 / 思维引导）现在**不再**作为顶部 ReviewOptionsBar
 * 出现在主舞台——这违反"主页面只做一件事"的产品原则。它们：
 *   - 默认值由产品判断（时间戳 ON / 思维引导 OFF），写死在 `tutor-preferences.ts`
 *   - 高级用户想覆盖，去**设置页**（/settings）调整，IndexedDB 持久化
 * 主舞台不再插入产品配置面板。
 *
 * 课堂同桌不走这里——它直接用 useClassroomCompanion hook（更细粒度的消息管理 +
 * inline app 气泡 + 停止录音 ceremony 等 classroom-only 能力）。
 */

import * as React from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { TutorErrorBoundary } from './TutorErrorBoundary';
import { TutorAgentPanel } from './tutor/TutorAgentPanel';
import { buildTutorAgentReviewContext, formatLearnerProfileForTutorAgent } from './tutor/tutor-agent-adapter';
import { getPreference } from '@/lib/db';
import type { AITutorProps } from './tutor/tutor-types';
import {
  TUTOR_PREFERENCES_DEFAULT,
  TUTOR_SHOW_TIMESTAMPS_KEY,
  TUTOR_THINKING_GUIDE_KEY,
  parseTutorBooleanPreference,
  type TutorPreferences,
} from '@/lib/utils/tutor-preferences';

export function SafeAITutor(props: AITutorProps) {
  const resetKeys = [
    props.sessionId ?? 'default',
    props.breakpoint?.id ?? 'global',
    props.selectedConversationId ?? 'current',
    props.launchQuestionNonce ?? 0,
    props.isMobile ? 'mobile' : 'desktop',
  ];

  const { accessToken, user } = useAuth();

  // 从 IndexedDB 读偏好（只在 mount 时一次；用户改设置后下次进对话框时生效）。
  const [tutorPrefs, setTutorPrefs] = React.useState<TutorPreferences>(TUTOR_PREFERENCES_DEFAULT);
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [showTsRaw, thinkingRaw] = await Promise.all([
          getPreference<string | null>(TUTOR_SHOW_TIMESTAMPS_KEY, null),
          getPreference<string | null>(TUTOR_THINKING_GUIDE_KEY, null),
        ]);
        if (cancelled) return;
        setTutorPrefs({
          showTimestamps: parseTutorBooleanPreference(showTsRaw, TUTOR_PREFERENCES_DEFAULT.showTimestamps),
          thinkingGuide: parseTutorBooleanPreference(thinkingRaw, TUTOR_PREFERENCES_DEFAULT.thinkingGuide),
        });
      } catch {
        /* IndexedDB 不可用——保持产品默认值 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const learnerProfileContext = React.useMemo(
    () => formatLearnerProfileForTutorAgent(user?.learnerProfile),
    [user?.learnerProfile],
  );

  const reviewContext = React.useMemo(
    () => buildTutorAgentReviewContext({
      segments: props.segments,
      currentTimeSec: props.currentTimeSec,
      breakpoint: props.breakpoint,
      supportContextText: props.supportContextText,
      preferSupportContext: props.preferSupportContext,
      learnerProfile: [learnerProfileContext, props.learningActivityContext]
        .filter(Boolean)
        .join('\n\n') || undefined,
    }),
    [
      props.breakpoint,
      props.currentTimeSec,
      props.preferSupportContext,
      learnerProfileContext,
      props.segments,
      props.learningActivityContext,
      props.supportContextText,
    ],
  );

  return (
    <TutorErrorBoundary panelName="AI 同桌" resetKeys={resetKeys}>
      <div className="flex h-full flex-col">
        <div className="flex-1 min-h-0">
          <TutorAgentPanel
            sessionId={props.sessionId ?? 'anon'}
            transcript={props.segments.map((s) => ({
              id: s.id,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            }))}
            subject={props.supportContextText}
            authToken={accessToken ?? undefined}
            onSeek={props.onSeek}
            mode="review"
            selectedConversationId={props.selectedConversationId}
            selectedConversationTitle={props.selectedConversationTitle}
            onShowHistory={props.onShowHistory}
            onConversationActiveChange={props.onConversationActiveChange}
            newConversationNonce={props.newConversationNonce}
            onNewConversation={props.onAgentNewConversation}
            launchQuestion={props.launchQuestion}
            launchDisplayText={props.launchDisplayText}
            launchQuestionNonce={props.launchQuestionNonce}
            onLaunchQuestionConsumed={props.onLaunchQuestionConsumed}
            context={reviewContext}
            options={{
              returnTimestamps: tutorPrefs.showTimestamps,
              thinkingGuide: tutorPrefs.thinkingGuide,
            }}
            onOpenApp={props.onOpenAppInWorkspace}
          />
        </div>
      </div>
    </TutorErrorBoundary>
  );
}
