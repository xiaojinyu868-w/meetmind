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
import { StreamingMarkdown } from '@/components/StreamingMarkdown';
import { conversationMessageToUIMessage, resolveTutorAgentHistoryLabel } from './tutor-agent-history';
import { formatRecentLearningActivityForTutorAgent, resolveTutorAgentLaunchText } from './tutor-agent-adapter';
import { resolveTutorMessageRenderPlan } from './tutor-message-rendering';
import type { TutorToolPartLike } from './tutor-tool-card-utils';
import { SkillChipRow } from './SkillChipRow';
import { InlineAppCard } from '@/components/classroom/InlineAppCard';
import { getWorkshopAppByKey } from '@/lib/ai-native/app-catalog';
import { useAuth } from '@/lib/hooks/useAuth';
import { getPreference } from '@/lib/db';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import { cn } from '@/lib/utils';
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

export interface TutorAgentPanelTranscriptSegment {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

type ReviewInlineAppState = {
  appKey: InlineAppKey;
  status: 'loading' | 'ready' | 'error';
  result?: AppExecutionResult;
  payload?: unknown;
  error?: string;
};

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
}: {
  role: string;
  text: string;
  onSeek?: (ms: number) => void;
  isStreaming?: boolean;
}) {
  const plan = React.useMemo(() => resolveTutorMessageRenderPlan({ role, text }), [role, text]);
  if (!plan.content) return null;
  if (plan.renderer === 'markdown') {
    return (
      <StreamingMarkdown
        content={plan.content}
        isStreaming={isStreaming}
        onTimestampClick={onSeek}
        className="text-[14.5px] leading-[1.75] text-ink"
      />
    );
  }
  return <span className="whitespace-pre-wrap">{plan.content}</span>;
}

function collectMessageText(message: { parts?: unknown; content?: string }): string {
  const parts = Array.isArray(message.parts) ? message.parts as Array<Record<string, unknown>> : [];
  const fromParts = parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
  if (fromParts.trim()) return fromParts;
  return typeof message.content === 'string' ? message.content : '';
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
}: TutorAgentPanelProps) {
  const { user } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  const [input, setInput] = React.useState('');
  const [preferredModel, setPreferredModel] = React.useState<string | undefined>();
  const [inlineAppsByMessageId, setInlineAppsByMessageId] = React.useState<Record<string, ReviewInlineAppState>>({});
  const [historyHydrated, setHistoryHydrated] = React.useState(false);
  const [recentLearningActivity, setRecentLearningActivity] = React.useState<string | undefined>();
  const [restoredConversationTitle, setRestoredConversationTitle] = React.useState<string | null>(null);
  const inlineAppStartedRef = React.useRef<Set<string>>(new Set());
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

  const agentContext = React.useMemo(() => {
    if (!recentLearningActivity) return context;
    return {
      ...(context ?? {}),
      learnerProfile: [context?.learnerProfile, recentLearningActivity].filter(Boolean).join('\n\n') || undefined,
    };
  }, [context, recentLearningActivity]);

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
      setInlineAppsByMessageId((prev) => ({
        ...prev,
        [messageId]: { appKey, status: 'loading' },
      }));

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const appTranscript = transcript
        .filter((segment) => segment.text?.trim())
        .slice(0, 180);

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
          const result = data.result;
          setInlineAppsByMessageId((prev) => ({
            ...prev,
            [messageId]: {
              appKey,
              status: 'ready',
              result,
              payload: result.render?.payload,
            },
          }));
          return;
        }

        const fallbackResult = buildInlineAppFallbackResult(appKey, appTranscript);
        setInlineAppsByMessageId((prev) => ({
          ...prev,
          [messageId]: fallbackResult
            ? { appKey, status: 'ready', result: fallbackResult, payload: fallbackResult.render?.payload }
            : {
                appKey,
                status: 'error',
                error: data?.error || `生成失败（${response.status}）`,
              },
        }));
      } catch (err) {
        const fallbackResult = buildInlineAppFallbackResult(appKey, appTranscript);
        setInlineAppsByMessageId((prev) => ({
          ...prev,
          [messageId]: fallbackResult
            ? { appKey, status: 'ready', result: fallbackResult, payload: fallbackResult.render?.payload }
            : {
                appKey,
                status: 'error',
                error: err instanceof Error ? err.message : '网络有点问题',
              },
        }));
      }
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
      void runInlineApp(message.id, marker);
    }
  }, [busy, messages, runInlineApp]);

  const onSubmit = React.useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const text = input.trim();
      if (!text || busy) return;
      sendMessage({ text });
      setInput('');
    },
    [input, busy, sendMessage],
  );

  const onPickSkill = React.useCallback(
    (prompt: string) => {
      if (busy) return;
      // 直接发送——减少犹豫，也避免 input 预填后用户误编辑
      sendMessage({ text: prompt });
    },
    [busy, sendMessage],
  );

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
      <div className="flex items-center justify-between gap-3 border-b border-divider bg-canvas px-5 py-3 text-[13px] text-ink-muted">
        <span className="min-w-0 flex-1 truncate leading-relaxed">
          {resolveTutorAgentHistoryLabel({
            hydrated: historyHydrated,
            title: restoredConversationTitle,
            selected: Boolean(selectedConversationId),
          })}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {onShowHistory ? (
            <button
              type="button"
              onClick={onShowHistory}
              className="rounded-full border border-divider bg-white px-3 py-1.5 text-[13px] text-ink-secondary transition hover:border-ink-muted hover:text-ink"
            >
              历史
            </button>
          ) : null}
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={handleNewConversation}
              className="rounded-full border border-divider bg-white px-3 py-1.5 text-[13px] text-ink-secondary transition hover:border-ink-muted hover:text-ink"
            >
              开新对话
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-white px-6 py-5">
        {messages.length === 0 ? (
          <div className="pt-10 text-center">
            <div className="mx-auto max-w-[20rem] text-[15px] leading-[1.75] text-ink-secondary">
              同学在这里。挑一个直接开始，也可以在下方直接问。
            </div>
            <SkillChipRow onPick={onPickSkill} onSay={onPickSkill} disabled={busy} />
          </div>
        ) : null}

        {messages.map((m) => {
          const parts = (m.parts ?? []) as Array<Record<string, unknown>>;
          const inlineApp = inlineAppsByMessageId[m.id];
          const isUser = m.role === 'user';
          return (
            <div
              key={m.id}
              className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
            >
              <div className={cn('flex flex-col', inlineApp ? 'w-full max-w-full' : 'max-w-[88%]', isUser ? 'items-end' : 'items-start')}>
                <div
                  className={cn(
                    'rounded-2xl px-4 py-2.5 text-[14.5px] leading-[1.75] break-words',
                    isUser
                      ? 'rounded-br-md bg-ink text-white whitespace-pre-wrap'
                      : 'rounded-bl-md border border-divider bg-canvas text-ink',
                  )}
                >
                  {parts.length > 0
                    ? parts.map((part, idx) => {
                        const partType = typeof part.type === 'string' ? part.type : '';
                        if (partType === 'text') {
                          const txt = typeof part.text === 'string' ? part.text : '';
                          return <TutorMessageText key={idx} role={m.role} text={txt} onSeek={onSeek} isStreaming={busy && idx === parts.length - 1} />;
                        }
                        if (partType.startsWith('tool-')) {
                          return (
                            <TutorToolCard
                              key={idx}
                              part={part as unknown as TutorToolPartLike}
                            />
                          );
                        }
                        // reasoning / 其他 part：静默忽略，不干扰对话
                        return null;
                      })
                    : // 老版本兼容（content 字段）
                      (() => {
                        const content = (m as unknown as { content?: string }).content ?? '';
                        return <TutorMessageText role={m.role} text={content} onSeek={onSeek} isStreaming={busy} />;
                      })()}
                </div>
                {!isUser && inlineApp ? (
                  <div className="w-full min-w-[280px]">
                    <InlineAppCard
                      inlineApp={inlineApp}
                      onRetry={() => runInlineApp(m.id, inlineApp.appKey)}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {error ? (
          <div className="rounded-2xl border border-divider bg-canvas px-4 py-3 text-[13px] leading-relaxed text-ink-secondary">
            刚刚没接住：{error.message ?? '未知错误'}
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="flex gap-3 border-t border-divider bg-canvas p-4">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder={busy ? '同学在想…' : '问点什么…'}
          className="flex-1 rounded-2xl border border-divider bg-white px-4 py-2.5 text-[14px] text-ink outline-none transition focus:border-ink disabled:bg-divider-light disabled:text-ink-muted"
          aria-label="向 AI 同桌提问"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-2xl border border-divider bg-white px-4 py-2.5 text-[14px] text-ink-secondary transition hover:text-ink"
          >
            停
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-2xl bg-ink px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-85 disabled:cursor-not-allowed disabled:bg-divider"
          >
            发送
          </button>
        )}
      </form>
    </div>
  );
}
