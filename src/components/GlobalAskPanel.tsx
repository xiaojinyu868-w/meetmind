'use client';

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Layers3, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import useAuth from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import { useLearningContext } from '@/hooks/useLearningContext';
import { useGlobalAskHistory } from '@/hooks/useGlobalAskHistory';
import { usePointsSummary } from '@/hooks/usePointsSummary';
import { openPaywallForChatError, openPaywallGlobal, parseChatErrorPointsBlock } from '@/hooks/usePaywall';
import { describePointsBlock } from '@/hooks/points-guard';
import { useLearningMemoryDistillation } from '@/hooks/useLearningMemoryDistillation';
import {
  createLearningThread,
  learningThreadToIntent,
  shouldAutoStartLearningIntent,
  useLearningIntentFlow,
  withConfirmedLearningIntent,
} from '@/hooks/useLearningIntentFlow';
import {
  formatLearningContextForTutor,
  summarizeLearningContext,
  toLearningActivityPreview,
} from '@/lib/utils/learning-context';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useCollectionStore } from '@/stores/collection-store';
import type { LearningIntentAnswer, LearningIntentPlan } from '@/types/learning-intent';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { LearningIntentConfirmationCard } from '@/components/LearningIntentConfirmationCard';
import { LearningMemoryPanel } from '@/components/LearningMemoryPanel';
import { GlobalAskContextDrawer } from '@/components/GlobalAskContextDrawer';
import { GlobalAskWelcome } from '@/components/GlobalAskWelcome';
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatReasoningBlock,
  ChatThinkingStripBubble,
  collectMessageReasoning,
  collectMessageText,
  useChatComposer,
  useChatFileUpload,
} from '@/components/chat';
import { AdminAiInspectorLink } from '@/components/admin/AdminAiInspectorLink';

interface GlobalAskPanelProps {
  open: boolean;
  onClose: () => void;
  onNavigateToCapture?: (captureId: string) => void;
  isMobile?: boolean;
  initialView?: 'ask' | 'memory';
  memoryFocus?: 'cheatsheet';
}

type AskDepth = 'quick' | 'deep';
export function GlobalAskPanel({
  open,
  onClose,
  onNavigateToCapture,
  isMobile = false,
  initialView,
  memoryFocus,
}: GlobalAskPanelProps) {
  const { user, accessToken, isCheckingAuth } = useAuth();
  const userId = user?.id || 'anonymous';
  const learning = useLearningContext();
  const recordLearningActivity = learning.recordActivity;
  // 免费档的深度模式（陪我学会）是 Pro/Max 专属：入口带 Pro 标识，提交时直接唤起会员页
  const { summary: pointsSummary } = usePointsSummary();
  const deepLocked = pointsSummary?.membership.tier === 'free';
  const sessionId = useSessionStore((state) => state.sessionId);
  const segments = useCaptureEditorStore((state) => state.segments);
  const sourceItems = useCollectionStore((state) => state.sourceItems);
  const [depth, setDepth] = React.useState<AskDepth>('quick');
  const [view, setView] = React.useState<'ask' | 'memory'>('ask');
  const [contextOpen, setContextOpen] = React.useState(false);
  const [intentPlan, setIntentPlan] = React.useState<LearningIntentPlan | null>(null);
  const [activeIntent, setActiveIntent] = React.useState<LearningIntentPlan | null>(null);
  const [pendingQuery, setPendingQuery] = React.useState('');
  const activeThreadRef = React.useRef(learning.activeThread);
  const previouslyOpenRef = React.useRef(false);
  const composerRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => { activeThreadRef.current = learning.activeThread; }, [learning.activeThread]);
  React.useEffect(() => {
    if (open && (!previouslyOpenRef.current || initialView)) {
      setView(initialView ?? 'ask');
    }
    previouslyOpenRef.current = open;
  }, [initialView, open]);

  const fileUpload = useChatFileUpload({ authToken: accessToken ?? undefined, targetRef: composerRef });
  const { busy: intentBusy, requestIntent } = useLearningIntentFlow();
  const distillAndApplyLearningMemory = useLearningMemoryDistillation({
    accessToken: accessToken ?? undefined,
    memories: learning.memories,
    activeThread: learning.activeThread,
    activeIntent,
    addMemory: learning.addMemory,
    updateMemory: learning.updateMemory,
    setActiveThread: learning.setActiveThread,
  });

  const currentTranscript = React.useMemo(
    () => segments.map((segment) => segment.text.trim()).filter(Boolean).join('\n').slice(-10_000),
    [segments],
  );

  const currentMaterials = React.useMemo(() => {
    const materials = sourceItems
      .filter((item) => item.status !== 'failed')
      .slice(-6)
      .reverse()
      .map((item) => ({
        title: item.title,
        content: (item.fullText || item.preview || '').slice(0, 8_000),
      }))
      .filter((item) => item.content.trim());
    if (currentTranscript) {
      materials.unshift({ title: COPY.globalAsk.sourceCurrentLesson, content: currentTranscript });
    }
    return materials.slice(0, 6);
  }, [currentTranscript, sourceItems]);

  const formattedLearningContext = React.useMemo(
    () => formatLearningContextForTutor(learning, user?.learnerProfile),
    [learning, user?.learnerProfile],
  );
  const contextFocus = activeIntent?.contextFocus ?? 'mixed';
  const usePersonalContext = contextFocus !== 'current';
  const useCurrentContext = contextFocus !== 'personal';
  const effectiveDepth: AskDepth = activeIntent ? 'deep' : depth;

  const agentContext = React.useMemo(() => {
    const attached = fileUpload.attachedFiles.map((file) => ({ title: file.title, content: file.text }));
    const supportMaterials = [...(useCurrentContext ? currentMaterials : []), ...attached];
    return {
      ...(supportMaterials.length > 0 ? { supportMaterials } : {}),
      global: {
        depth: effectiveDepth,
        ...(activeIntent ? {
          intent: {
            title: activeIntent.title,
            outcome: activeIntent.outcome,
            approach: activeIntent.approach,
            checkpoints: activeIntent.checkpoints,
          },
        } : {}),
        ...(usePersonalContext ? formattedLearningContext : {}),
      },
    };
  }, [activeIntent, currentMaterials, effectiveDepth, fileUpload.attachedFiles, formattedLearningContext, useCurrentContext, usePersonalContext]);
  const agentContextRef = React.useRef(agentContext);
  React.useEffect(() => { agentContextRef.current = agentContext; }, [agentContext]);

  const transport = React.useMemo(() => new DefaultChatTransport({
    api: '/api/tutor/agent',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: () => ({
      mode: 'global',
      sessionId: sessionId || 'global-ask',
      context: agentContextRef.current,
      options: {},
    }),
  }), [accessToken, sessionId]);

  const { messages, setMessages, sendMessage, status, stop, error } = useChat({
    transport,
    // 402 积分/会员拦截（兜底：免费档深度模式在提交前已拦，这里防 quick 撞月熔断等）
    onError: (chatError) => openPaywallForChatError(chatError),
  });
  const pointsBlock = React.useMemo(() => parseChatErrorPointsBlock(error), [error]);
  const busy = status === 'submitted' || status === 'streaming';
  const latestMessage = messages[messages.length - 1];
  const latestText = latestMessage ? collectMessageText(latestMessage) : '';
  const inspectorQuery = React.useMemo(() => {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    return latestUserMessage ? collectMessageText(latestUserMessage) : pendingQuery;
  }, [messages, pendingQuery]);
  const showThinking = busy && (latestMessage?.role === 'user' || !latestText.trim());

  React.useEffect(() => {
    if (!open) return;
    setActiveIntent(null);
    setIntentPlan(null);
    setPendingQuery('');
    setContextOpen(false);
  }, [open]);

  const handleDepthRestored = React.useCallback((restoredDepth: AskDepth) => {
    const restoredThread = activeThreadRef.current;
    if (restoredThread?.status === 'active') {
      setDepth('deep');
      setActiveIntent(learningThreadToIntent(restoredThread));
      return;
    }
    setDepth(restoredDepth);
  }, []);

  const handleAssistantPersisted = React.useCallback(async ({
    text,
    userText,
    sourceId,
    depth: persistedDepth,
  }: { text: string; userText: string; sourceId: string; depth: AskDepth }) => {
    const learningMemoryUpdate = userText.trim()
      ? distillAndApplyLearningMemory({
          userText,
          assistantText: text,
          sourceId,
        })
      : Promise.resolve();
    await recordLearningActivity({
      kind: 'conversation',
      title: persistedDepth === 'deep' ? COPY.globalAsk.recentDeepSession : COPY.globalAsk.recentConversation,
      detail: toLearningActivityPreview(text),
      sourceId,
    });
    await learningMemoryUpdate;
  }, [distillAndApplyLearningMemory, recordLearningActivity]);

  const history = useGlobalAskHistory({
    open,
    // auth 初始化完成前不恢复/不持久化：避免先以 anonymous 落库、auth 解析后 userId 变化触发重跑把对话清空
    authReady: !isCheckingAuth,
    userId,
    depth: effectiveDepth,
    busy,
    messages,
    setMessages,
    getMessageText: collectMessageText,
    fallbackTitle: COPY.globalAsk.recentConversation,
    onDepthRestored: handleDepthRestored,
    onAssistantPersisted: handleAssistantPersisted,
  });

  const startNewConversation = React.useCallback(() => {
    stop();
    setDepth('quick');
    setIntentPlan(null);
    setActiveIntent(null);
    setPendingQuery('');
    history.reset();
    fileUpload.clear();
  }, [fileUpload, history, stop]);

  const sendQuick = React.useCallback((text: string) => {
    setActiveIntent(null);
    sendMessage({ text });
    fileUpload.clear();
  }, [fileUpload, sendMessage]);

  const beginDeepSession = React.useCallback(async (plan: LearningIntentPlan, query: string) => {
    const finalPlan = { ...plan, questions: undefined };
    const confirmedContext = withConfirmedLearningIntent(agentContext, finalPlan);
    setActiveIntent(finalPlan);
    setIntentPlan(null);
    setPendingQuery('');
    await learning.setActiveThread(createLearningThread(finalPlan, query));
    sendMessage({ text: query }, {
      body: { mode: 'global', sessionId: sessionId || 'global-ask', context: confirmedContext, options: {} },
    });
    fileUpload.clear();
  }, [agentContext, fileUpload, learning, sendMessage, sessionId]);

  const prepareDeepIntent = React.useCallback(async (
    query: string,
    answers?: LearningIntentAnswer[],
    fallbackPlan?: LearningIntentPlan,
  ) => {
    setPendingQuery(query);
    try {
      const summary = summarizeLearningContext(learning);
      const plan = await requestIntent({
        query,
        learnerContext: summary,
        recentContext: learning.recentActivities.slice(-6).map((item) => `${item.title}${item.detail ? `：${item.detail}` : ''}`).join('\n'),
        activeContext: currentMaterials.map((item) => `${item.title}\n${item.content.slice(0, 500)}`).join('\n\n').slice(0, 4_000),
        ...(answers?.length ? { answers } : {}),
      });
      if (shouldAutoStartLearningIntent(plan)) {
        await beginDeepSession(plan, query);
      } else {
        setIntentPlan(plan);
      }
    } catch {
      if (fallbackPlan) {
        toast.message(COPY.globalAsk.refiningError);
        await beginDeepSession(fallbackPlan, query);
      } else {
        toast.message(COPY.globalAsk.preparingError);
        setDepth('quick');
        sendQuick(query);
        setPendingQuery('');
      }
    }
  }, [beginDeepSession, currentMaterials, learning, requestIntent, sendQuick]);

  const submitText = React.useCallback((text: string) => {
    if (busy || intentBusy) return;
    if (effectiveDepth === 'deep' && deepLocked) {
      // 免费档点深度模式：不打请求（服务端 402 membership_required 兜底），直接唤起会员页
      openPaywallGlobal({ reason: 'membership_required', requiredTier: 'pro' });
      return;
    }
    if (effectiveDepth === 'deep' && !activeIntent) {
      void prepareDeepIntent(text);
      return;
    }
    sendMessage({ text });
    fileUpload.clear();
  }, [activeIntent, busy, deepLocked, effectiveDepth, fileUpload, intentBusy, prepareDeepIntent, sendMessage]);

  const composer = useChatComposer({
    draftKey: 'global-ask',
    onSubmit: submitText,
    disabled: busy || intentBusy,
    onLargePaste: (text) => fileUpload.addTextAsFile(text),
  });

  const confirmIntent = React.useCallback(async (plan: LearningIntentPlan) => {
    const query = pendingQuery;
    if (!query) return;
    await beginDeepSession(plan, query);
  }, [beginDeepSession, pendingQuery]);

  const cancelIntent = React.useCallback(() => {
    const query = pendingQuery;
    setIntentPlan(null);
    setPendingQuery('');
    setDepth('quick');
    if (query) sendQuick(query);
  }, [pendingQuery, sendQuick]);

  const visibleSources = sourceItems.filter((item) => item.status !== 'failed').slice(-3).reverse();
  const currentContextCount = currentMaterials.length + fileUpload.attachedFiles.length;
  const recentContextCount = learning.recentActivities.length;
  const memoryContextCount = learning.memories.filter((memory) => memory.status === 'active').length;
  const contextSummary = COPY.globalAsk.contextSummary(currentContextCount, recentContextCount, memoryContextCount);
  const showWelcome = messages.length === 0 && !intentPlan && !intentBusy && !pendingQuery;

  const handleDepthChange = React.useCallback((nextDepth: AskDepth) => {
    setDepth(nextDepth);
    if (nextDepth === 'quick') {
      setIntentPlan(null);
      setActiveIntent(null);
    }
  }, []);

  const renderComposer = (embedded: boolean) => (
    <ChatComposer
      containerRef={composerRef}
      textareaProps={composer.textareaProps}
      onSubmit={composer.submit}
      busy={busy || intentBusy}
      onStop={stop}
      attachedFiles={fileUpload.attachedFiles}
      onAddFiles={fileUpload.addFiles}
      onRemoveFile={fileUpload.removeFile}
      uploadBusy={fileUpload.busy}
      uploadError={fileUpload.error}
      onRetryUpload={fileUpload.retryLast}
      isDragging={fileUpload.isDragging}
      capabilities={{ file: true, mic: true }}
      onVoiceTranscript={(text) => composer.setValue([composer.value, text].filter(Boolean).join(' '))}
      placeholder={effectiveDepth === 'deep' ? COPY.globalAsk.composerDeep : COPY.globalAsk.composerQuick}
      statusLabel={intentBusy ? COPY.globalAsk.preparingIntent : undefined}
      className={embedded ? '!border-0 !bg-transparent !px-0 !pb-3 !pt-0' : undefined}
    />
  );

  if (!open) return null;
  if (view === 'memory') {
    return (
      <div className={cn('fixed inset-0 z-[80]', !isMobile && 'left-[var(--sidebar-width,0px)]')}>
        <LearningMemoryPanel
          onBack={initialView === 'memory' ? onClose : () => setView('ask')}
          initialFocus={memoryFocus}
          onTalkToMeetMind={() => {
            setView('ask');
            composer.setValue(COPY.globalAsk.memoryTalkPrompt);
            window.setTimeout(() => composer.textareaRef.current?.focus(), 0);
          }}
          onResumeThread={() => {
            setView('ask');
            setDepth('deep');
            if (learning.activeThread) {
              setActiveIntent(learningThreadToIntent(learning.activeThread));
              composer.setValue(learning.activeThread.intent);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex bg-canvas/95 backdrop-blur-xl">
      <div className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white', !isMobile && 'mx-auto my-3 max-w-[1060px] rounded-[28px] border border-divider shadow-float')}>
        <header className="flex items-center gap-3 border-b border-divider bg-paper px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <OctoAvatar mood="listening" size="sm" />
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold text-ink">{COPY.globalAsk.title}</h1>
              <p className="hidden truncate text-[11.5px] text-ink-muted sm:block">{history.hydrated ? (history.restoredTitle ? `${COPY.globalAsk.historyRestored} · ${history.restoredTitle}` : COPY.globalAsk.subtitle) : COPY.globalAsk.historyLoading}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <AdminAiInspectorLink controlKey="tutor:global" context={agentContext} query={inspectorQuery} compact={isMobile} />
            <button type="button" onClick={() => setContextOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine" aria-label={COPY.globalAsk.contextRailTitle} title={COPY.globalAsk.contextRailTitle}>
              <Layers3 size={13} /> <span className="hidden sm:inline">{COPY.globalAsk.contextAction}</span>
            </button>
            {messages.length > 0 ? <button type="button" onClick={startNewConversation} className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-ink-muted hover:text-pine" aria-label={COPY.globalAsk.newConversation}><Plus size={14} /></button> : null}
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={COPY.globalAsk.close}><X size={16} /></button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <ChatMessageList
              watchKey={`${messages.length}:${latestText.length}:${intentBusy ? 1 : 0}`}
              showEmpty={showWelcome}
              variant="paper"
              contentMaxWidth="max-w-3xl"
              innerClassName="space-y-4"
              emptyState={
                <GlobalAskWelcome
                  depth={effectiveDepth}
                  deepLocked={deepLocked}
                  activeThread={learning.activeThread}
                  composer={renderComposer(true)}
                  contextSummary={contextSummary}
                  onDepthChange={handleDepthChange}
                  onOpenContext={() => setContextOpen(true)}
                  onChoosePrompt={(prompt) => {
                    composer.setValue(prompt);
                    window.setTimeout(() => composer.textareaRef.current?.focus(), 0);
                  }}
                  onResumeThread={() => {
                    setDepth('deep');
                    if (learning.activeThread) setActiveIntent(learningThreadToIntent(learning.activeThread));
                    composer.setValue(learning.activeThread?.intent || '');
                    window.setTimeout(() => composer.textareaRef.current?.focus(), 0);
                  }}
                />
              }
            >
          {messages.map((message, index) => {
            const text = collectMessageText(message);
            const reasoning = collectMessageReasoning(message);
            const isStreaming = busy && index === messages.length - 1 && message.role === 'assistant';
            return (
              <ChatBubble
                key={message.id}
                role={message.role === 'user' ? 'user' : 'assistant'}
                avatar={message.role === 'assistant' ? <OctoAvatar mood={isStreaming ? 'thinking' : 'happy'} size="sm" /> : undefined}
                messageId={message.id}
              >
                {message.role === 'assistant' ? (
                  <>
                    {reasoning ? <ChatReasoningBlock reasoning={reasoning} isStreaming={isStreaming} /> : null}
                    <ChatRenderer content={text} isStreaming={isStreaming} messageId={message.id} />
                  </>
                ) : <span className="whitespace-pre-wrap">{text}</span>}
              </ChatBubble>
            );
          })}
          {pendingQuery && !activeIntent ? <ChatBubble role="user"><span className="whitespace-pre-wrap">{pendingQuery}</span></ChatBubble> : null}
          {intentBusy ? <ChatThinkingStripBubble label={COPY.globalAsk.preparingIntent} avatar={<OctoAvatar mood="thinking" size="sm" aura />} /> : null}
          {intentPlan ? (
            <LearningIntentConfirmationCard
              plan={intentPlan}
              busy={busy || intentBusy}
              onConfirm={(plan) => void confirmIntent(plan)}
              onResolve={(answers) => void prepareDeepIntent(pendingQuery, answers, intentPlan)}
              onCancel={cancelIntent}
            />
          ) : null}
          {showThinking ? <ChatThinkingStripBubble label={COPY.globalAsk.thinking} avatar={<OctoAvatar mood="thinking" size="sm" aura />} /> : null}
          {error ? <div className="rounded-xl border border-vermilion/15 bg-vermilion-fog px-4 py-3 text-[12.5px] text-vermilion">{pointsBlock ? describePointsBlock(pointsBlock) : COPY.globalAsk.responseError}</div> : null}
            </ChatMessageList>

            {!showWelcome ? renderComposer(false) : null}
          </main>
        </div>

        {contextOpen ? (
          <GlobalAskContextDrawer
            currentCount={currentContextCount}
            recentCount={recentContextCount}
            memoryCount={memoryContextCount}
            sources={visibleSources}
            activeThread={learning.activeThread}
            onClose={() => setContextOpen(false)}
            onOpenMemory={() => {
              setContextOpen(false);
              setView('memory');
            }}
            onOpenSource={(sourceId) => {
              setContextOpen(false);
              onNavigateToCapture?.(sourceId);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

export default GlobalAskPanel;
