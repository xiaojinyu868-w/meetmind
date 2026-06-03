'use client';

/**
 * TutorAgentPanel — 使用 Vercel AI SDK v6 useChat 的 Tutor 交互面板（M6.5）
 *
 * 和 AITutor.tsx 并存，通过 NEXT_PUBLIC_TUTOR_AGENT_ENABLED feature flag 切换。
 *
 * 为什么不直接改 AITutor.tsx？
 *   - 1700+ 行的 SSE 自定义协议（breakpoint / guidance / parsedResponse）
 *   - useChat 的 UIMessage 模型 ≠ 现有 TutorChatMessage 模型
 *   - 灰度策略：flag=false → 老路径；flag=true → 新路径
 *
 * 设计：
 *   - 最小完整面板：输入框 + 消息流 + 工具卡片（TutorToolCard）
 *   - 保留关键输入：sessionId / transcript / subject，透传给 /api/tutor/agent
 *   - 不处理 guidance/actionItems/citations——那些是老 endpoint 特有，新 agent
 *     通过 lookupTranscript 工具直接返回 `[t=MM:SS]` 嵌在文本里
 */

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import { TutorToolCard } from './TutorToolCard';
import { conversationMessageToUIMessage, resolveTutorAgentHistoryLabel } from './tutor-agent-history';
import { formatRecentLearningActivityForTutorAgent, resolveTutorAgentLaunchText } from './tutor-agent-adapter';
import { resolveTutorMessageRenderPlan } from './tutor-message-rendering';
import type { TutorToolPartLike } from './tutor-tool-card-utils';
import { SkillChipRow } from './SkillChipRow';
import { InlineAppCard } from '@/components/classroom/InlineAppCard';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPreference } from '@/lib/db';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import { cn } from '@/lib/utils';
// M11：迁到 ChatBase 底座（薄底座 + 厚适配）
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatThinkingStripBubble,
  ChatMessageFeedbackButtons,
  useChatComposer,
  useChatFileUpload,
  collectMessageText as collectChatMessageText,
  copyMessageSmart,
} from '@/components/chat';
import { Copy, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  AI_MODEL_AUTO_VALUE,
  AI_MODEL_PREFERENCE_KEY,
  resolveExplicitAiModelPreference,
} from '@/lib/utils/ai-model-preference';
import {
  extractOpenAppMarker,
  isInlineAppKey,
  type InlineAppKey,
} from '@/lib/utils/open-app-marker';
import { buildInlineAppFallbackResult } from '@/lib/utils/inline-app-fallback';
import {
  readCachedReviewInlineAppState,
  writeReviewInlineAppError,
  writeReviewInlineAppRunning,
  writeReviewInlineAppSuccess,
  type ReviewInlineAppState,
} from './tutor-inline-app-cache';

export interface TutorAgentPanelTranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export interface TutorAgentPanelProps {
  sessionId: string;
  transcript: TutorAgentPanelTranscriptSegment[];
  subject?: string;
  className?: string;
  /** 访客模式不带 JWT；登录模式传 token 用于热词/鉴权 */
  authToken?: string;
  /** 点击 [t=MM:SS] 时把播放器跳转到该毫秒；父组件接 player.seek */
  onSeek?: (timeMs: number) => void;
  /**
   * M10：对话模式。默认 'review'（录音 / 视频复习页都走这个）。
   * 'in-class' 是课堂同桌专用，目前由 useClassroomCompanion 直接拼 body，
   * 不走这个 Panel——但接口留着给未来课堂嵌 AITutor 时用。
   */
  mode?: 'in-class' | 'review';
  /**
   * M10：复习态可选能力（两个默认关）。
   * - returnTimestamps：回答里附 [MM:SS] chip（点击跳转）
   * - thinkingGuide：学霸思维引导，回答按"---思维演示--- / ---正式回答---"分段
   * - allowInlineApp：允许 LLM 吐 <open_app:KEY/> marker（两 mode 默认都开）
   */
  options?: {
    returnTimestamps?: boolean;
    thinkingGuide?: boolean;
    allowInlineApp?: boolean;
  };
  /**
   * M10：复习态的完整上下文——整节课转录 + 当前播放位置。
   * review mode 下会注入到 system prompt 里。
   */
  context?: {
    fullTranscript?: string;
    currentTimestampSec?: number;
    supportMaterials?: Array<{ title: string; content: string }>;
    learnerProfile?: string;
  };
  /** 从历史列表点进来时，明确恢复指定对话，而不是自动接最近一条。 */
  selectedConversationId?: string | null;
  selectedConversationTitle?: string | null;
  /** 打开当前课程的历史列表。 */
  onShowHistory?: () => void;
  /** 当前对话有无内容变化，供外层显示「开新对话」等入口。 */
  onConversationActiveChange?: (hasMessages: boolean) => void;
  /** 外层从时间线/资料/困惑点发起的一次问题。 */
  launchQuestion?: string;
  launchDisplayText?: string;
  launchQuestionNonce?: number;
  onLaunchQuestionConsumed?: () => void;
  /** 外层触发开新对话时递增。 */
  newConversationNonce?: number;
  onNewConversation?: () => void;
  /** 复习态结构化应用在中间学习工作区打开，不在聊天流里承载完整应用。 */
  onOpenAppInWorkspace?: (appKey: InlineAppKey) => void;
}

/**
 * SkillChipRow + SKILL_PROMPTS 已提取到 ./skill-prompts.tsx，
 * 供 TutorAgentPanel 和 ClassroomCompanionPanel 共用——保证产品任意位置
 * "速查表 / 闪卡 / 测验 / 思维导图 / 薄弱点 / 再讲一遍" 的语义一致。
 */
function TutorMessageText({
  role,
  text,
  onSeek,
  isStreaming = false,
  messageId,
}: {
  role: string;
  text: string;
  onSeek?: (ms: number) => void;
  isStreaming?: boolean;
  messageId?: string;
}) {
  // resolveTutorMessageRenderPlan 处理"思维演示 / 正式回答"分段以及空内容剔除
  const plan = React.useMemo(() => resolveTutorMessageRenderPlan({ role, text }), [role, text]);
  if (!plan.content) return null;
  if (plan.renderer === 'markdown') {
    return (
      <ChatRenderer
        content={plan.content}
        isStreaming={isStreaming}
        onTimestampClick={onSeek}
        messageId={messageId}
        className="text-[14.5px] leading-[1.75] text-ink"
      />
    );
  }
  return <span className="whitespace-pre-wrap">{plan.content}</span>;
}

// 复用底座 collectMessageText（保留同名 wrapper 给本文件其他地方调用）
function collectMessageText(message: { parts?: unknown; content?: string }): string {
  return collectChatMessageText(message as { parts?: unknown; content?: string });
}

export function TutorAgentPanel({
  sessionId,
  transcript,
  subject,
  className,
  authToken,
  onSeek,
  mode = 'review',
  options,
  context,
  selectedConversationId,
  selectedConversationTitle,
  onShowHistory,
  onConversationActiveChange,
  launchQuestion,
  launchDisplayText,
  launchQuestionNonce = 0,
  onLaunchQuestionConsumed,
  newConversationNonce = 0,
  onNewConversation,
  onOpenAppInWorkspace,
}: TutorAgentPanelProps) {
  const { user } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  const [preferredModel, setPreferredModel] = React.useState<string | undefined>();
  const [inlineAppsByMessageId, setInlineAppsByMessageId] = React.useState<Record<string, ReviewInlineAppState>>({});
  const [historyHydrated, setHistoryHydrated] = React.useState(false);
  const [recentLearningActivity, setRecentLearningActivity] = React.useState<string | undefined>();
  const [restoredConversationTitle, setRestoredConversationTitle] = React.useState<string | null>(null);
  const inlineAppStartedRef = React.useRef<Set<string>>(new Set());
  const inlineAppRunPromisesRef = React.useRef<Record<string, Promise<ReviewInlineAppState | null>>>({});
  const conversationIdRef = React.useRef<string | null>(null);
  const persistedMessageIdsRef = React.useRef<Set<string>>(new Set());
  const lastLaunchQuestionNonceRef = React.useRef<number | null>(null);
  const lastNewConversationNonceRef = React.useRef(newConversationNonce);

  React.useEffect(() => {
    let alive = true;
    getPreference<string>(AI_MODEL_PREFERENCE_KEY, AI_MODEL_AUTO_VALUE)
      .then((preference) => {
        if (alive) setPreferredModel(resolveExplicitAiModelPreference(preference));
      })
      .catch(() => {
        if (alive) setPreferredModel(undefined);
      });
    return () => { alive = false; };
  }, []);

  // M11：底座文件上传 hook —— 拖拽 / 粘贴 / 点击三入口统一
  // 提前到这里因为 agentContext 需要读 attachedFiles
  const composerRef = React.useRef<HTMLFormElement>(null);
  const fileUpload = useChatFileUpload({
    authToken,
    targetRef: composerRef,
  });

  const agentContext = React.useMemo(() => {
    const baseContext = context ?? {};
    // M14.5 BUG FIX: 把已上传附件作为 supportMaterials 拼进 context
    // 之前 fileUpload.attachedFiles 只显示 chip 但发送时没传给后端，导致"传了图也不影响 AI"
    const userAttached = fileUpload.attachedFiles.length > 0
      ? fileUpload.attachedFiles.map((f) => ({ title: f.title, content: f.text }))
      : undefined;
    const mergedSupport = [
      ...(baseContext.supportMaterials ?? []),
      ...(userAttached ?? []),
    ];
    return {
      ...baseContext,
      ...(mergedSupport.length > 0 ? { supportMaterials: mergedSupport } : {}),
      learnerProfile:
        [context?.learnerProfile, recentLearningActivity].filter(Boolean).join('\n\n') || undefined,
    };
  }, [context, recentLearningActivity, fileUpload.attachedFiles]);

  // DefaultChatTransport 允许把非标字段一起发到 body。
  // M10：这里把 mode + context + options 全部透传给 /api/tutor/agent，
  // 让服务端的 buildTutorSystemPrompt 根据请求参数组装正确的 prompt。
  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: () => ({
          sessionId,
          transcript,
          subject: subject ?? '',
          ...(preferredModel ? { model: preferredModel } : {}),
          mode,
          context: agentContext ?? {},
          options: options ?? {},
        }),
      }),
    [authToken, sessionId, transcript, subject, preferredModel, mode, agentContext, options],
  );

  const { messages, setMessages, sendMessage, status, error, stop } = useChat({ transport });

  const busy = status === 'submitted' || status === 'streaming';

  React.useEffect(() => {
    let alive = true;
    setHistoryHydrated(false);
    setRecentLearningActivity(undefined);
    setRestoredConversationTitle(null);
    conversationIdRef.current = null;
    persistedMessageIdsRef.current = new Set();
    inlineAppStartedRef.current = new Set();
    inlineAppRunPromisesRef.current = {};
    setInlineAppsByMessageId({});
    setMessages([]);

    if (mode !== 'review') {
      setHistoryHydrated(true);
      return () => { alive = false; };
    }

    const hydrateConversation = async () => {
      try {
        const targetConversation = selectedConversationId
          ? await conversationService.getConversation(selectedConversationId)
          : (await conversationService.listConversations(userId, {
              type: 'global-chat',
              sessionId,
              limit: 1,
            }))[0];
        if (!alive || !targetConversation) {
          const recentConversations = await conversationService.listConversations(userId, {
            type: 'global-chat',
            sessionId,
            limit: 5,
          });
          if (alive) setRecentLearningActivity(formatRecentLearningActivityForTutorAgent(recentConversations));
          return;
        }
        const historyMessages = await conversationService.getMessages(targetConversation.conversationId);
        const recentConversations = await conversationService.listConversations(userId, {
          type: 'global-chat',
          sessionId,
          limit: 5,
        });
        if (!alive) return;
        conversationIdRef.current = targetConversation.conversationId;
        persistedMessageIdsRef.current = new Set(historyMessages.map((message) => message.messageId));
        setRecentLearningActivity(formatRecentLearningActivityForTutorAgent(recentConversations, targetConversation.conversationId));
        setRestoredConversationTitle(selectedConversationTitle || targetConversation.title);
        setMessages(historyMessages.map(conversationMessageToUIMessage));
      } catch (err) {
        console.error('[TutorAgentPanel] failed to hydrate conversation history:', err);
      } finally {
        if (alive) setHistoryHydrated(true);
      }
    };

    void hydrateConversation();
    return () => { alive = false; };
  }, [mode, selectedConversationId, selectedConversationTitle, sessionId, setMessages, userId]);

  React.useEffect(() => {
    if (!historyHydrated || busy || mode !== 'review') return;
    const persistMessages = async () => {
      const unsaved = messages.filter((message) => {
        if (message.role !== 'user' && message.role !== 'assistant') return false;
        if (persistedMessageIdsRef.current.has(message.id)) return false;
        return collectMessageText(message).trim().length > 0;
      });
      if (unsaved.length === 0) return;

      try {
        if (!conversationIdRef.current) {
          const firstUserText = collectMessageText(unsaved.find((message) => message.role === 'user') ?? unsaved[0]).trim();
          const conversation = await conversationService.createConversation({
            userId,
            type: 'global-chat',
            title: conversationService.generateTitleFromMessage(firstUserText || '复习对话'),
            sessionId,
            model: 'tutor-agent',
          });
          conversationIdRef.current = conversation.conversationId;
          setRestoredConversationTitle(conversation.title);
        }

        const conversationId = conversationIdRef.current;
        await conversationService.addMessages(
          conversationId,
          unsaved.map((message) => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: collectMessageText(message),
          })),
        );
        unsaved.forEach((message) => persistedMessageIdsRef.current.add(message.id));
      } catch (err) {
        console.error('[TutorAgentPanel] failed to persist conversation history:', err);
      }
    };
    void persistMessages();
  }, [busy, historyHydrated, messages, mode, sessionId, userId]);

  React.useEffect(() => {
    onConversationActiveChange?.(messages.some((message) => message.role === 'user' || message.role === 'assistant'));
  }, [messages, onConversationActiveChange]);

  React.useEffect(() => {
    if (mode !== 'review' || !historyHydrated || busy) return;
    if (!launchQuestionNonce) return;
    if (lastLaunchQuestionNonceRef.current === launchQuestionNonce) return;

    lastLaunchQuestionNonceRef.current = launchQuestionNonce;
    const text = resolveTutorAgentLaunchText({ launchQuestion, launchDisplayText });
    if (!text) {
      onLaunchQuestionConsumed?.();
      return;
    }

    sendMessage({ text });
    onLaunchQuestionConsumed?.();
  }, [
    busy,
    historyHydrated,
    launchDisplayText,
    launchQuestion,
    launchQuestionNonce,
    mode,
    onLaunchQuestionConsumed,
    sendMessage,
  ]);

  const clearCurrentConversation = React.useCallback(() => {
    stop();
    conversationIdRef.current = null;
    persistedMessageIdsRef.current = new Set();
    inlineAppStartedRef.current = new Set();
    inlineAppRunPromisesRef.current = {};
    setInlineAppsByMessageId({});
    setRestoredConversationTitle(null);
    setMessages([]);
  }, [setMessages, stop]);

  React.useEffect(() => {
    if (lastNewConversationNonceRef.current === newConversationNonce) return;
    lastNewConversationNonceRef.current = newConversationNonce;
    clearCurrentConversation();
  }, [clearCurrentConversation, newConversationNonce]);

  const handleNewConversation = React.useCallback(() => {
    clearCurrentConversation();
    onNewConversation?.();
  }, [clearCurrentConversation, onNewConversation]);

  const runInlineApp = React.useCallback(
    async (messageId: string, appKey: InlineAppKey) => {
      const cachedState = readCachedReviewInlineAppState(sessionId, appKey);
      if (cachedState) {
        setInlineAppsByMessageId((prev) => ({
          ...prev,
          [messageId]: cachedState,
        }));
        return;
      }

      setInlineAppsByMessageId((prev) => ({
        ...prev,
        [messageId]: { appKey, status: 'loading' },
      }));

      const runKey = `${sessionId}:${appKey}`;
      let runPromise = inlineAppRunPromisesRef.current[runKey];
      if (!runPromise) {
        runPromise = (async (): Promise<ReviewInlineAppState | null> => {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (authToken) headers.Authorization = `Bearer ${authToken}`;
          const appTranscript = transcript
            .filter((segment) => segment.text?.trim())
            .slice(0, 180);

          writeReviewInlineAppRunning(sessionId, appKey);

          try {
            const appCatalogItem = getWorkshopAppByKey(appKey);
            const response = await fetch('/api/apps/execute', {
              method: 'POST',
              headers,
              body: JSON.stringify({
                appKey,
                ...(preferredModel ? { model: preferredModel } : {}),
                goal: {
                  intent: appCatalogItem?.intent || `生成${appKey}学习应用`,
                  expectedOutput: 'mixed',
                  appKey,
                },
                input: {
                  sessionId,
                  dataSource: 'video',
                  transcript: appTranscript,
                  anchors: [],
                },
                memory: {},
              }),
            });
            const data = (await response.json().catch(() => null)) as
              | { ok?: boolean; error?: string; result?: AppExecutionResult }
              | null;

            if (response.ok && data?.ok && data.result) {
              return writeReviewInlineAppSuccess(sessionId, appKey, data.result);
            }

            const fallbackResult = buildInlineAppFallbackResult(appKey, appTranscript);
            if (fallbackResult) {
              return writeReviewInlineAppSuccess(sessionId, appKey, fallbackResult);
            }

            const error = data?.error || `生成失败（${response.status}）`;
            writeReviewInlineAppError(sessionId, appKey, error);
            return { appKey, status: 'error', error };
          } catch (err) {
            const fallbackResult = buildInlineAppFallbackResult(appKey, appTranscript);
            if (fallbackResult) {
              return writeReviewInlineAppSuccess(sessionId, appKey, fallbackResult);
            }

            const error = err instanceof Error ? err.message : '网络有点问题';
            writeReviewInlineAppError(sessionId, appKey, error);
            return { appKey, status: 'error', error };
          }
        })();
        inlineAppRunPromisesRef.current[runKey] = runPromise;
        void runPromise.finally(() => {
          delete inlineAppRunPromisesRef.current[runKey];
        });
      }

      const nextState = await runPromise;
      if (!nextState) return;
      setInlineAppsByMessageId((prev) => ({
        ...prev,
        [messageId]: nextState,
      }));
    },
    [authToken, preferredModel, sessionId, transcript],
  );

  React.useEffect(() => {
    if (busy) return;
    for (const message of messages) {
      if (message.role !== 'assistant' || inlineAppStartedRef.current.has(message.id)) continue;
      const marker = extractOpenAppMarker(collectMessageText(message)).key;
      if (!isInlineAppKey(marker)) continue;
      inlineAppStartedRef.current.add(message.id);
      if (onOpenAppInWorkspace) {
        onOpenAppInWorkspace(marker);
        continue;
      }
      void runInlineApp(message.id, marker);
    }
  }, [busy, messages, onOpenAppInWorkspace, runInlineApp]);

  const onSubmitText = React.useCallback(
    (text: string) => {
      if (!text || busy) return;
      sendMessage({ text });
      // M14.5: 提交后清空附件——避免下一轮再次发送同一组附件
      // attachedFiles 已经通过 agentContext.supportMaterials 拼进本次请求
      if (fileUpload.attachedFiles.length > 0) {
        fileUpload.clear();
      }
    },
    [busy, sendMessage, fileUpload],
  );

  // M11：底座文件上传 hook 已在 agentContext 上面实例化（提前是为了 useMemo 能读 attachedFiles）

  // M12：粘大段（>500 字）→ 自动转附件 + sonner toast 提示
  const handleLargePaste = React.useCallback(
    (text: string) => {
      fileUpload.addTextAsFile(text);
      toast.success('内容较长，已作为附件附加', {
        description: '同学会读完整段后再回复',
        duration: 2400,
      });
    },
    [fileUpload],
  );

  // M11：底座 composer hook —— 统一处理 IME / 草稿持久化 / 自适应高度 / 快捷键 / 大段粘贴
  const composer = useChatComposer({
    draftKey: sessionId,
    onSubmit: onSubmitText,
    disabled: busy,
    onLargePaste: handleLargePaste,
  });

  const handleVoiceTranscript = React.useCallback(
    (text: string) => {
      if (!text.trim()) return;
      composer.setValue(composer.value ? `${composer.value} ${text}` : text);
    },
    [composer],
  );

  const onPickSkill = React.useCallback(
    (prompt: string) => {
      if (busy) return;
      // 直接发送——减少犹豫，也避免 input 预填后用户误编辑
      sendMessage({ text: prompt });
    },
    [busy, sendMessage],
  );

  // 监听最近 user 消息触发 composer 中"复制 / 重生成"等动作的可见性
  const lastMsg = messages[messages.length - 1];
  const lastIsUser = lastMsg && lastMsg.role === 'user';
  const lastAssistantText =
    lastMsg && lastMsg.role === 'assistant' ? collectMessageText(lastMsg) : '';
  const showThinking =
    busy && (lastIsUser || (lastMsg?.role === 'assistant' && !lastAssistantText.trim()));

  // 重生成上一条 —— 删除最后一条 assistant + 重发上一条 user
  const handleRegenerateLast = React.useCallback(() => {
    if (busy) return;
    const lastUserIdx = [...messages].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIdx < 0) return;
    const realIdx = messages.length - 1 - lastUserIdx;
    const lastUser = messages[realIdx];
    const text = collectMessageText(lastUser);
    if (!text.trim()) return;
    // 砍掉这条 user 之后的所有 assistant 消息
    setMessages(messages.slice(0, realIdx + 1));
    sendMessage({ text });
  }, [busy, messages, sendMessage, setMessages]);

  return (
    <div
      className={cn(
        'flex h-full flex-col bg-white text-ink',
        className,
      )}
      role="log"
      aria-live="polite"
      aria-label="AI 同桌对话"
    >
      <div className="flex items-center justify-between gap-3 border-b border-divider bg-paper-warm/60 px-5 py-3 text-[13px] text-ink-muted backdrop-blur-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {/* v7：Octo 永驻顶栏 · 状态点同步会话 busy */}
          <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-divider bg-card shadow-soft">
            <span
              aria-hidden
              className={cn(
                'absolute inset-0 rounded-full',
                busy && 'animate-pulse',
              )}
              style={{
                background: busy
                  ? 'radial-gradient(circle, rgba(45,79,62,0.18), transparent 70%)'
                  : 'transparent',
              }}
            />
            <span
              className={cn(
                'relative h-2 w-2 rounded-full',
                busy ? 'bg-pine animate-pulse' : 'bg-pine/70',
              )}
            />
          </span>
          <span className="min-w-0 flex-1 truncate leading-relaxed">
            {resolveTutorAgentHistoryLabel({
              hydrated: historyHydrated,
              title: restoredConversationTitle,
              selected: Boolean(selectedConversationId),
            })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onShowHistory ? (
            <button
              type="button"
              onClick={onShowHistory}
              className="rounded-full border border-divider bg-card px-3 py-1.5 text-[13px] text-ink-secondary transition hover:border-pine hover:text-pine"
            >
              历史
            </button>
          ) : null}
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={handleNewConversation}
              className="rounded-full border border-divider bg-card px-3 py-1.5 text-[13px] text-ink-secondary transition hover:border-pine hover:text-pine"
            >
              开新对话
            </button>
          ) : null}
        </div>
      </div>

      {/* M11：底座消息流（自动跟随 + jump-to-latest） */}
      <ChatMessageList
        watchKey={messages.length + (busy ? 1 : 0) + (lastAssistantText.length || 0)}
        showEmpty={messages.length === 0}
        emptyState={
          <div className="flex flex-col items-center pt-6 text-center">
            <OctoAvatar mood="listening" size="lg" aura className="mb-4" />
            <div className="mx-auto max-w-[20rem] text-[15px] leading-[1.75] text-ink-secondary">
              <span className="font-serif italic text-pine">同学</span>
              在这里。挑一个直接开始，也可以在下方直接问。
            </div>
            <SkillChipRow onPick={onPickSkill} onSay={onPickSkill} disabled={busy} />
          </div>
        }
        variant="paper"
        contentMaxWidth="max-w-3xl"
        innerClassName="space-y-4"
      >
        {messages.map((m, mIdx) => {
          const parts = (m.parts ?? []) as Array<Record<string, unknown>>;
          const inlineApp = inlineAppsByMessageId[m.id];
          const isUser = m.role === 'user';
          // R9 bug 修复：isStreaming 必须同时满足
          //   (1) busy = true（流式正在进行中）
          //   (2) 这是 messages 数组里最后一条
          //   (3) 这是 assistant（用户消息从来不流）
          const isLastMessage = mIdx === messages.length - 1;
          const messageIsStreaming = busy && isLastMessage && m.role === 'assistant';

          // assistant 渲染（多 part：text + tool）—— 把每个 part 渲染成 ChatBubble 内部 children
          const bodyChildren =
            parts.length > 0
              ? parts.map((part, idx) => {
                  const partType = typeof part.type === 'string' ? part.type : '';
                  if (partType === 'text') {
                    const txt = typeof part.text === 'string' ? part.text : '';
                    return (
                      <TutorMessageText
                        key={idx}
                        role={m.role}
                        text={txt}
                        onSeek={onSeek}
                        isStreaming={messageIsStreaming && idx === parts.length - 1}
                        messageId={m.id}
                      />
                    );
                  }
                  if (partType.startsWith('tool-')) {
                    return (
                      <TutorToolCard key={idx} part={part as unknown as TutorToolPartLike} />
                    );
                  }
                  return null;
                })
              : (() => {
                  const content = (m as unknown as { content?: string }).content ?? '';
                  return (
                    <TutorMessageText
                      role={m.role}
                      text={content}
                      onSeek={onSeek}
                      isStreaming={messageIsStreaming}
                      messageId={m.id}
                    />
                  );
                })();

          // 内联应用卡放在 ChatBubble 的 footer slot
          const footerSlot =
            !isUser && inlineApp ? (
              <InlineAppCard
                inlineApp={inlineApp}
                onRetry={() => runInlineApp(m.id, inlineApp.appKey)}
              />
            ) : null;

          // hover 行动按钮（复制 / 重生成 / 反馈）—— 只对 assistant 消息提供
          const actionsSlot =
            !isUser && !messageIsStreaming && collectMessageText(m).trim() ? (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyMessageSmart(collectMessageText(m), {
                      messageId: m.id,
                    });
                    if (ok) toast.success('已复制（含格式）', { duration: 1500 });
                  }}
                  title="复制（含格式）"
                  aria-label="复制"
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] text-ink-muted transition-colors hover:bg-paper-warm hover:text-ink-secondary"
                >
                  <Copy size={12} strokeWidth={1.8} />
                  <span className="hidden sm:inline">复制</span>
                </button>
                {isLastMessage ? (
                  <button
                    type="button"
                    onClick={handleRegenerateLast}
                    title="重生成"
                    aria-label="重生成"
                    className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] text-ink-muted transition-colors hover:bg-paper-warm hover:text-ink-secondary"
                  >
                    <RefreshCw size={12} strokeWidth={1.8} />
                    <span className="hidden sm:inline">重生成</span>
                  </button>
                ) : null}
                {/* M14.5: 消息级 👍👎 反馈 —— 数据闭环 + 大厂标志 */}
                <ChatMessageFeedbackButtons
                  messageId={m.id}
                  messageText={collectMessageText(m)}
                  mode={mode}
                  modelId={preferredModel}
                  userId={user?.id}
                  onFeedbackSent={(rating) => {
                    toast.success(rating === 'up' ? '已反馈' : '已记录，下次会更好', { duration: 1200 });
                  }}
                />
              </>
            ) : null;

          return (
            <ChatBubble
              key={m.id}
              role={m.role === 'user' ? 'user' : 'assistant'}
              variant="paper"
              fullWidth={Boolean(inlineApp)}
              footer={footerSlot}
              actions={actionsSlot}
              messageId={m.id}
            >
              {bodyChildren}
            </ChatBubble>
          );
        })}

        {/* M11：底座 thinking 气泡 —— 等待首 token 时缓解焦虑 */}
        {showThinking ? (
          <ChatThinkingStripBubble
            variant="paper"
            avatar={<OctoAvatar mood="thinking" size="sm" aura />}
          />
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-divider bg-canvas px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
            刚刚没接住：{error.message ?? '未知错误'}
            <button
              type="button"
              onClick={handleRegenerateLast}
              className="ml-3 underline decoration-pine/40 underline-offset-2 hover:decoration-pine hover:text-pine"
            >
              再试一次
            </button>
          </div>
        ) : null}
      </ChatMessageList>

      {/* M11：底座输入条（复用 IntentDialog 同款 ChatComposer，只是 paper variant） */}
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
        capabilities={{ mic: true, file: true }}
        onVoiceTranscript={handleVoiceTranscript}
        placeholder="问点什么…"
        busyPlaceholder="同学在想…"
        variant="paper"
      />
    </div>
  );
}
