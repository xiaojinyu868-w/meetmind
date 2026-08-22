'use client';

/**
 * IntentDialog —— 「聊聊你想要的」选择题式目标共建（M15 重做，Elys 式输入体验）
 *
 * 设计决策：
 *   1. 开场问题流在对话流里推进（Elys 式）：Octo 的问句是一条 AI 气泡，用户的回答
 *      是一条用户气泡，三个固定问题像聊天一样一来一回——不是一张表单
 *   2. 固定开场题（身份 → 分支阶段 → 时间尺度）零 LLM 往返；答完合成第一人称消息，
 *      稳定属性由 AI 沉淀进「我了解到的你」，目标卡带 horizon 时间尺度
 *   3. AI 每轮回复必带 ---选项--- 块 → 果冻软行（IntentOptionChips），输入框始终保留
 *   4. 收敛义务：3 轮内产出确认卡；保存后完成态定格，给对话一个句号
 *   5. 永远不沉默：请求失败/卡死有错误条 + 一键重试；模型漏给选项有兜底快答
 *
 * 架构：ChatBase 底座；单条消息渲染在 IntentMessageItem；视觉 v7 米白纸感。
 */

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { AdminAiInspectorLink } from '@/components/admin/AdminAiInspectorLink';
import {
  ChatComposer,
  ChatMessageList,
  ChatThinkingStripBubble,
  collectMessageText,
  extractIntentSummary,
  useChatComposer,
  useChatFileUpload,
} from '@/components/chat';
import { COPY } from '@/lib/ui/copy';
import { IntentMessageItem } from './IntentMessageItem';
import { IntentOpeningFlow } from './IntentOpeningFlow';
import { IntentStepBar } from './IntentStepBar';
import { IntentCompletionOverlay } from './IntentCompletionOverlay';
import { IntentErrorBanner } from './IntentErrorBanner';
import type { BioEntry, GoalEntry, LearnerProfile } from '@/types/user';

interface IntentDialogProps {
  open: boolean;
  authToken?: string;
  learnerProfile?: LearnerProfile | null;
  sessionHint?: string;
  onClose: () => void;
  onSaveGoal: (goal: GoalEntry) => Promise<void>;
  onSaveBio: (bio: BioEntry) => Promise<void>;
  onSkip?: () => void;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** 回访用户（已有 bio 或 goals）的开场 */
function getReturningGreeting(profile: LearnerProfile | null | undefined): {
  hint: string;
  options: string[];
} {
  const goals = profile?.goals ?? [];
  const bio = profile?.bio;
  if (bio?.headline && goals.length > 0) {
    return {
      hint: `上次我们聊到"${goals[0].title}"——这次想接着聊，还是有新的事？`,
      options: ['接着上次聊', '聊件新的', '更新一下我自己'],
    };
  }
  if (bio?.headline) {
    return {
      hint: `上次我大概了解了你——${bio.headline.slice(0, 40)}… 最近怎么样？`,
      options: ['有件事在心里', '想换个方向', '只是来记录一下'],
    };
  }
  return {
    hint: `你之前留下了 ${goals.length} 件想做的事——这次想聊新的，还是更新一件旧的？`,
    options: ['聊一件新的', '更新某件旧的', '把已有的几件再排一下'],
  };
}

export function IntentDialog({
  open,
  authToken,
  learnerProfile,
  sessionHint,
  onClose,
  onSaveGoal,
  onSaveBio,
  onSkip,
}: IntentDialogProps) {
  const [sessionId] = React.useState(() => `intent-${Date.now()}-${genId()}`);
  const [savedSummaryIds, setSavedSummaryIds] = React.useState<Record<string, boolean>>({});
  const [dismissedSummaryIds, setDismissedSummaryIds] = React.useState<Record<string, boolean>>({});
  const [savedBioIds, setSavedBioIds] = React.useState<Record<string, boolean>>({});
  const [dismissedBioIds, setDismissedBioIds] = React.useState<Record<string, boolean>>({});
  const [completion, setCompletion] = React.useState<{ title: string } | null>(null);

  const isFirstMeeting = !learnerProfile?.bio?.headline && (learnerProfile?.goals ?? []).length === 0;
  const returningGreeting = React.useMemo(
    () => (isFirstMeeting ? null : getReturningGreeting(learnerProfile)),
    [isFirstMeeting, learnerProfile],
  );

  // ─── 固定开场选择题（Elys 式问题流，仅首次会面）─────────────────
  const [quizStep, setQuizStep] = React.useState(0); // 0=身份 1=阶段 2=时间尺度
  const [quizIdentity, setQuizIdentity] = React.useState('');
  const [quizStage, setQuizStage] = React.useState('');
  const [quizDone, setQuizDone] = React.useState(false);
  const quizActive = isFirstMeeting && !quizDone;

  const existingGoalsContext = React.useMemo(() => {
    const goals = learnerProfile?.goals ?? [];
    if (goals.length === 0) return undefined;
    return goals.map((g) => ({
      title: g.title,
      summary: g.summary,
      updatedAt: g.updatedAt?.slice(0, 10),
      horizon: g.horizon,
    }));
  }, [learnerProfile]);

  const existingBioContext = React.useMemo(() => {
    const bio = learnerProfile?.bio;
    if (!bio?.headline) return undefined;
    return { headline: bio.headline, detail: bio.detail };
  }, [learnerProfile]);

  const composerRef = React.useRef<HTMLFormElement>(null);
  const fileUpload = useChatFileUpload({ authToken, targetRef: composerRef });

  const supportMaterials = React.useMemo(() => {
    if (fileUpload.attachedFiles.length === 0) return undefined;
    return fileUpload.attachedFiles.map((f) => ({ title: f.title, content: f.text }));
  }, [fileUpload.attachedFiles]);

  const agentContext = React.useMemo(() => ({
    goal: {
      existingGoals: existingGoalsContext,
      existingBio: existingBioContext,
      sessionHint,
    },
    supportMaterials,
  }), [existingBioContext, existingGoalsContext, sessionHint, supportMaterials]);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: () => ({
          sessionId,
          mode: 'goal' as const,
          transcript: [],
          context: agentContext,
          options: {},
        }),
      }),
    [agentContext, authToken, sessionId],
  );

  const { messages, sendMessage, status, stop, error, regenerate } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';

  // 卡死看门狗：请求挂在 submitted/streaming 超过 45s（网络断流、provider 挂起）
  // 主动掐断并亮错误条——永远不让用户面对一个"没反应"的对话框
  const [stalled, setStalled] = React.useState(false);
  React.useEffect(() => {
    if (!busy) return undefined;
    const timer = setTimeout(() => {
      stop();
      setStalled(true);
    }, 45_000);
    return () => clearTimeout(timer);
  }, [busy, stop, messages.length]);
  const [errorDismissed, setErrorDismissed] = React.useState(false);
  React.useEffect(() => {
    if (busy) {
      setStalled(false);
      setErrorDismissed(false);
    }
  }, [busy]);

  // 自动静默重试一次：瞬时失败（网络抖动 / 连接层 400）不该让用户看见，
  // 800ms 后自动 regenerate；只有第二次也失败才亮错误条
  const autoRetriedForRef = React.useRef<number | null>(null);
  const [autoRetryPending, setAutoRetryPending] = React.useState(false);
  React.useEffect(() => {
    if (!error || busy) return undefined;
    if (autoRetriedForRef.current === messages.length) return undefined;
    autoRetriedForRef.current = messages.length;
    setAutoRetryPending(true);
    const t = setTimeout(() => {
      setAutoRetryPending(false);
      void regenerate();
    }, 800);
    return () => clearTimeout(t);
  }, [error, busy, messages.length, regenerate]);

  const showErrorBanner =
    (stalled || (Boolean(error) && !autoRetryPending)) && !errorDismissed && !busy;

  const inspectorQuery = React.useMemo(() => {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    return latestUserMessage ? collectMessageText(latestUserMessage) : (sessionHint || '');
  }, [messages, sessionHint]);

  /** 答题进行中自由打字：把已答的稳定属性拼在前面，直接发给 AI */
  const sendFreeText = React.useCallback(
    (text: string) => {
      if (quizActive) {
        const who = quizStage ? `${quizIdentity}，${quizStage}` : quizIdentity;
        setQuizDone(true);
        sendMessage({ text: who ? `我是${who}。${text}` : text });
        return;
      }
      sendMessage({ text });
    },
    [quizActive, quizIdentity, quizStage, sendMessage],
  );

  const composer = useChatComposer({
    draftKey: sessionId,
    onSubmit: sendFreeText,
    disabled: busy,
    onLargePaste: (text) => {
      fileUpload.addTextAsFile(text);
      toast.success('内容较长，已作为附件附加', {
        description: 'Octo 会先把这段读完',
        duration: 2400,
      });
    },
  });

  /** 固定开场题点选：推进问题流，最后一题合成第一人称开场消息 */
  const handleQuizPick = React.useCallback(
    (option: string) => {
      if (quizStep === 0) {
        setQuizIdentity(option);
        setQuizStep(option === '在校学生' || option === '工作中' ? 1 : 2);
        return;
      }
      if (quizStep === 1) {
        setQuizStage(option);
        setQuizStep(2);
        return;
      }
      const who = quizStage ? `${quizIdentity}，${quizStage}` : quizIdentity;
      setQuizDone(true);
      sendMessage({ text: `我是${who}。最想你帮我盯住：${option}。` });
    },
    [quizStep, quizIdentity, quizStage, sendMessage],
  );

  const handleAcceptSummary = React.useCallback(
    async (messageId: string, params: { title: string; summary?: string; horizon?: GoalEntry['horizon']; acceptedPoints?: string[]; rejectedPoints?: string[] }) => {
      const now = new Date().toISOString();
      await onSaveGoal({
        id: genId(),
        title: params.title,
        summary: params.summary,
        horizon: params.horizon,
        createdAt: now,
        updatedAt: now,
        conversationId: sessionId,
        status: 'active',
      });
      setSavedSummaryIds((prev) => ({ ...prev, [messageId]: true }));
      setCompletion({ title: params.title });
      if (params.rejectedPoints && params.rejectedPoints.length > 0) {
        sendMessage({ text: `有几条我不太认同：\n${params.rejectedPoints.map((p) => `· ${p}`).join('\n')}\n其他的没问题。` });
      }
    },
    [onSaveGoal, sessionId, sendMessage],
  );

  const handleAcceptBio = React.useCallback(
    async (messageId: string, params: { headline: string; detail?: string; acceptedPoints?: string[]; rejectedPoints?: string[] }) => {
      const now = new Date().toISOString();
      const existing = learnerProfile?.bio;
      await onSaveBio({
        headline: params.headline,
        detail: params.detail,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        conversationId: existing?.conversationId ?? sessionId,
      });
      setSavedBioIds((prev) => ({ ...prev, [messageId]: true }));
      if (params.rejectedPoints && params.rejectedPoints.length > 0) {
        sendMessage({ text: `有几条不太对：\n${params.rejectedPoints.map((p) => `· ${p}`).join('\n')}\n其他的没问题。` });
      }
    },
    [onSaveBio, sessionId, learnerProfile?.bio, sendMessage],
  );

  // 步骤条进度：说说(0) → 捋一捋(1) → 记下了(2)
  const stepIndex = React.useMemo(() => {
    if (Object.keys(savedSummaryIds).length > 0) return 2;
    const hasCard = messages.some(
      (m) => m.role === 'assistant' && extractIntentSummary(collectMessageText(m)),
    );
    if (hasCard) return 1;
    return messages.length > 0 ? 0 : -1;
  }, [messages, savedSummaryIds]);

  const assistantMood = React.useMemo<'thinking' | 'listening' | 'idle' | 'happy'>(() => {
    if (busy) {
      const lastMsg = messages[messages.length - 1];
      const lastIsUser = lastMsg && lastMsg.role === 'user';
      const lastIsEmpty = lastMsg && lastMsg.role === 'assistant' && !collectMessageText(lastMsg).trim();
      if (lastIsUser || lastIsEmpty) return 'thinking';
      return 'happy';
    }
    if (messages.length === 0) return 'listening';
    return 'idle';
  }, [busy, messages]);

  if (!open) return null;

  const lastMsg = messages[messages.length - 1];
  const showThinkingBubble =
    busy &&
    (lastMsg?.role === 'user' ||
      (lastMsg?.role === 'assistant' && !collectMessageText(lastMsg).trim()));

  // ─── 合成问题流（首次三步 / 回访一问）──────────────────────────
  const quizQuestions: Array<{ question: string; options: string[]; answer: string | null }> = [];
  if (quizActive) {
    quizQuestions.push({
      question: COPY.intent.openingStep1Question,
      options: COPY.intent.openingStep1Options,
      answer: quizIdentity || null,
    });
    if (quizIdentity === '在校学生' || quizIdentity === '工作中') {
      quizQuestions.push({
        question: quizIdentity === '在校学生'
          ? COPY.intent.openingStep2StudentQuestion
          : COPY.intent.openingStep2WorkQuestion,
        options: quizIdentity === '在校学生'
          ? COPY.intent.openingStep2StudentOptions
          : COPY.intent.openingStep2WorkOptions,
        answer: quizStage || null,
      });
    }
    if (quizStep >= 2 || quizQuestions[quizQuestions.length - 1].answer) {
      quizQuestions.push({
        question: COPY.intent.openingStep3Question,
        options: COPY.intent.openingStep3Options,
        answer: null,
      });
    }
  }

  const serifStyle = { fontFamily: '"Instrument Serif", "Inter", serif' } as const;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-paper"
      role="dialog"
      aria-modal="true"
      aria-label={COPY.intent.title}
    >
      {/* 极淡的双签名色柔光（纸感不死板） */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div
          className="absolute -left-[18%] -top-[12%] h-[55vh] w-[55vh] rounded-full opacity-[0.35]"
          style={{ background: 'radial-gradient(circle, rgba(45,79,62,0.10) 0%, transparent 70%)', filter: 'blur(40px)' }}
        />
        <div
          className="absolute -right-[12%] -top-[6%] h-[38vh] w-[38vh] rounded-full opacity-[0.3]"
          style={{ background: 'radial-gradient(circle, rgba(181,72,60,0.08) 0%, transparent 75%)', filter: 'blur(50px)' }}
        />
      </div>

      {/* 顶部 Header */}
      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-divider/60 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <OctoAvatar mood={assistantMood} size="sm" aura />
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{COPY.intent.title}</p>
            <p className="text-[11.5px] italic text-ink-muted" style={serifStyle}>{COPY.intent.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AdminAiInspectorLink controlKey="tutor:goal" context={agentContext} query={inspectorQuery} compact />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-ink-secondary transition-colors hover:bg-paper-warm"
            aria-label="关闭"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {!completion ? <IntentStepBar stepIndex={stepIndex} /> : null}

      {/* 消息区 */}
      <ChatMessageList
        watchKey={messages.length + quizStep + (busy ? 1 : 0)}
        showEmpty={false}
        variant="paper"
        contentMaxWidth="max-w-2xl"
        className="relative z-10"
      >
        {/* 首次会面：Elys 式三步问题流（问句是 AI 气泡，回答是用户气泡） */}
        {quizActive ? (
          <IntentOpeningFlow mode="quiz" quizQuestions={quizQuestions} busy={busy} onPick={handleQuizPick} />
        ) : null}

        {/* 回访：一句欢迎 + 快捷入口 */}
        {!isFirstMeeting && messages.length === 0 && returningGreeting ? (
          <IntentOpeningFlow
            mode="returning"
            returningHint={returningGreeting.hint}
            returningOptions={returningGreeting.options}
            busy={busy}
            onPick={(option) => sendMessage({ text: option })}
          />
        ) : null}

        {messages.map((message, idx) => (
          <IntentMessageItem
            key={message.id}
            message={message}
            isLast={idx === messages.length - 1}
            busy={busy}
            summarySaved={Boolean(savedSummaryIds[message.id])}
            summaryDismissed={Boolean(dismissedSummaryIds[message.id])}
            bioSaved={Boolean(savedBioIds[message.id])}
            bioDismissed={Boolean(dismissedBioIds[message.id])}
            onDismissSummary={() => setDismissedSummaryIds((prev) => ({ ...prev, [message.id]: true }))}
            onAcceptSummary={(p) => handleAcceptSummary(message.id, p)}
            onDismissBio={() => setDismissedBioIds((prev) => ({ ...prev, [message.id]: true }))}
            onAcceptBio={(p) => handleAcceptBio(message.id, p)}
            onPickOption={(option) => sendMessage({ text: option })}
          />
        ))}

        {showThinkingBubble ? (
          <ChatThinkingStripBubble
            variant="paper"
            avatar={<OctoAvatar mood="thinking" size="sm" aura />}
            label={<span style={serifStyle}>同学在想…</span>}
          />
        ) : null}
      </ChatMessageList>

      {/* 错误条：请求失败 / 看门狗掐断时给出明确反馈和重试 */}
      {showErrorBanner ? (
        <IntentErrorBanner
          onRetry={() => {
            setErrorDismissed(true);
            setStalled(false);
            void regenerate();
          }}
          onDismiss={() => {
            setErrorDismissed(true);
            setStalled(false);
          }}
        />
      ) : null}

      {/* 底部输入条 */}
      <ChatComposer
        containerRef={composerRef}
        textareaProps={composer.textareaProps}
        onSubmit={composer.submit}
        busy={busy}
        onStop={stop}
        attachedFiles={fileUpload.attachedFiles}
        onAddFiles={fileUpload.addFiles}
        onRemoveFile={fileUpload.removeFile}
        uploadBusy={fileUpload.busy}
        uploadError={fileUpload.error}
        onRetryUpload={fileUpload.retryLast}
        isDragging={fileUpload.isDragging}
        capabilities={{ file: true }}
        placeholder="点上面的选项就好，也可以自己说"
        busyPlaceholder={COPY.intent.inputPlaceholderBusy}
        variant="paper"
        className="relative z-10"
      />

      {onSkip ? (
        <div className="relative z-10 mb-2 flex justify-center pb-2">
          <button
            type="button"
            onClick={onSkip}
            className="text-[12px] text-ink-muted transition-colors hover:text-ink-secondary hover:underline"
          >
            {COPY.intent.firstTimeSkip}
          </button>
        </div>
      ) : null}

      {/* 完成态：记下了一个目标 */}
      {completion ? (
        <IntentCompletionOverlay
          title={completion.title}
          onDone={onClose}
          onContinue={() => setCompletion(null)}
        />
      ) : null}

      <style jsx>{`
        @keyframes intentFadeUp {
          from { opacity: 0; transform: translateY(16px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

export default IntentDialog;
