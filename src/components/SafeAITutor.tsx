'use client';

/**
 * SafeAITutor — M10 收口后的唯一 AI 对话入口（录音复习 + 视频复习共用）
 *
 * M10 之前：feature flag `NEXT_PUBLIC_TUTOR_AGENT_ENABLED` 在新 agent 路径
 * 和老 AITutor SSE 路径之间切换，两份 prompt/model。
 * M10 之后：flag 退役，所有对话统一走 `TutorAgentPanel → /api/tutor/agent`。
 * 老 AITutor.tsx 保留为"历史 deprecated"，只在极端回滚场景下才会被用到。
 *
 * 复习态专属的两个可选能力（默认关，localStorage 持久化）由这个组件挂载：
 *   - 显示时间戳（回答里附 [MM:SS] chip）
 *   - 学霸思维引导（---思维演示--- / ---正式回答--- 分段）
 *
 * 课堂同桌不走这里——它直接用 useClassroomCompanion hook（更细粒度的消息管理 +
 * inline app 气泡 + 停止录音 ceremony 等 classroom-only 能力）。
 */

import type { ComponentProps } from 'react';
import * as React from 'react';
import { AITutor } from './AITutor';
import { useAuth } from '@/lib/hooks/useAuth';
import { TutorErrorBoundary } from './TutorErrorBoundary';
import { TutorAgentPanel } from './tutor/TutorAgentPanel';
import { buildTutorAgentReviewContext, formatLearnerProfileForTutorAgent } from './tutor/tutor-agent-adapter';

const REVIEW_OPTIONS_LS_KEY = 'meetmind_tutor_review_options_v1';

interface ReviewOptions {
  returnTimestamps: boolean;
  thinkingGuide: boolean;
}

function loadReviewOptions(): ReviewOptions {
  // SSR 安全
  if (typeof window === 'undefined') {
    return { returnTimestamps: false, thinkingGuide: false };
  }
  try {
    const raw = window.localStorage.getItem(REVIEW_OPTIONS_LS_KEY);
    if (!raw) return { returnTimestamps: false, thinkingGuide: false };
    const parsed = JSON.parse(raw) as Partial<ReviewOptions>;
    return {
      returnTimestamps: parsed.returnTimestamps === true,
      thinkingGuide: parsed.thinkingGuide === true,
    };
  } catch {
    return { returnTimestamps: false, thinkingGuide: false };
  }
}

function saveReviewOptions(opts: ReviewOptions) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REVIEW_OPTIONS_LS_KEY, JSON.stringify(opts));
  } catch {
    /* localStorage 满/被禁——静默忽略 */
  }
}

/**
 * 极端回滚开关。默认走 agent 路径；显式设 `false` 走老 AITutor SSE 路径。
 * 日常使用不应该碰——保留它只是为了 M10 切过去后线上若发现严重 bug 能翻回来。
 */
const LEGACY_AITUTOR_ENABLED =
  typeof process !== 'undefined' &&
  String(process.env.NEXT_PUBLIC_TUTOR_AGENT_ENABLED ?? 'true').toLowerCase() === 'false';

export function SafeAITutor(props: ComponentProps<typeof AITutor>) {
  const resetKeys = [
    props.sessionId ?? 'default',
    props.breakpoint?.id ?? 'global',
    props.selectedConversationId ?? 'current',
    props.launchQuestionNonce ?? 0,
    props.isMobile ? 'mobile' : 'desktop',
  ];

  const { accessToken, user } = useAuth();
  const [reviewOpts, setReviewOpts] = React.useState<ReviewOptions>(() => loadReviewOptions());
  const [optionsPanelOpen, setOptionsPanelOpen] = React.useState(false);

  const updateReviewOpts = React.useCallback((next: Partial<ReviewOptions>) => {
    setReviewOpts((prev) => {
      const merged = { ...prev, ...next };
      saveReviewOptions(merged);
      return merged;
    });
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

  // 回滚开关：极端情况下才会触发
  if (LEGACY_AITUTOR_ENABLED) {
    return (
      <TutorErrorBoundary panelName="AI 助教" resetKeys={resetKeys}>
        <AITutor {...props} />
      </TutorErrorBoundary>
    );
  }

  return (
    <TutorErrorBoundary panelName="AI 同桌" resetKeys={resetKeys}>
      <div className="flex h-full flex-col">
        <ReviewOptionsBar
          opts={reviewOpts}
          onChange={updateReviewOpts}
          open={optionsPanelOpen}
          onOpenChange={setOptionsPanelOpen}
        />
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
              returnTimestamps: reviewOpts.returnTimestamps,
              thinkingGuide: reviewOpts.thinkingGuide,
              allowInlineApp: true,
            }}
            onOpenAppInWorkspace={props.onOpenAppInWorkspace}
          />
        </div>
      </div>
    </TutorErrorBoundary>
  );
}

// ──────────────────────────────────────────────────────────────
// ReviewOptionsBar — 复习态 AI 设置的最小开关条
//
// 放在 AITutor 顶部一条细细的控件行。默认收起为一个 "⚙ 设置" 链接，
// 点开后展开两个切换开关。不要把它做成弹窗或者模态——这是复习场景，
// 用户可以随时开/关而不中断阅读。
// ──────────────────────────────────────────────────────────────

function ReviewOptionsBar({
  opts,
  onChange,
  open,
  onOpenChange,
}: {
  opts: ReviewOptions;
  onChange: (next: Partial<ReviewOptions>) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const activeCount = Number(opts.returnTimestamps) + Number(opts.thinkingGuide);

  return (
    <div className="border-b border-divider bg-white px-3 py-1.5 text-xs">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="inline-flex items-center gap-1.5 text-ink-muted transition hover:text-ink"
        aria-expanded={open}
        aria-controls="review-options-panel"
      >
        <span>回答设置</span>
        {activeCount > 0 ? (
          <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-medium text-white">
            {activeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div id="review-options-panel" className="mt-2 flex flex-wrap gap-4 pb-1">
          <OptionToggle
            label="显示时间戳"
            hint="回答里附 [MM:SS] chip，点击跳转"
            checked={opts.returnTimestamps}
            onChange={(v) => onChange({ returnTimestamps: v })}
          />
          <OptionToggle
            label="学霸思维引导"
            hint="回答分成'想的过程'和'最终答案'两段"
            checked={opts.thinkingGuide}
            onChange={(v) => onChange({ thinkingGuide: v })}
          />
        </div>
      ) : null}
    </div>
  );
}

function OptionToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-divider text-ink focus:ring-1 focus:ring-ink-muted"
      />
      <span className="text-ink-secondary">{label}</span>
      {hint ? <span className="text-ink-muted">· {hint}</span> : null}
    </label>
  );
}
