'use client';

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { BrainCircuit, ChevronRight, FileText, History, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import useAuth from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import { useLearningContext } from '@/hooks/useLearningContext';
import { useGlobalAskHistory } from '@/hooks/useGlobalAskHistory';
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
import { LearningContextStatus } from '@/components/LearningContextStatus';
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatThinkingStripBubble,
  collectMessageText,
  useChatComposer,
  useChatFileUpload,
} from '@/components/chat';

interface GlobalAskPanelProps {
  open: boolean;
  onClose: () => void;
  onNavigateToCapture?: (captureId: string) => void;
  isMobile?: boolean;
}

type AskDepth = 'quick' | 'deep';
export function GlobalAskPanel({
  open,
  onClose,
  onNavigateToCapture,
  isMobile = false,
}: GlobalAskPanelProps) {
  const { user, accessToken } = useAuth();
  const userId = user?.id || 'anonymous';
  const learning = useLearningContext();
  const recordLearningActivity = learning.recordActivity;
  const sessionId = useSessionStore((state) => state.sessionId);
  const segments = useCaptureEditorStore((state) => state.segments);
  const sourceItems = useCollectionStore((state) => state.sourceItems);
  const [depth, setDepth] = React.useState<AskDepth>('quick');
  const [view, setView] = React.useState<'ask' | 'memory'>('ask');
  const [intentPlan, setIntentPlan] = React.useState<LearningIntentPlan | null>(null);
  const [activeIntent, setActiveIntent] = React.useState<LearningIntentPlan | null>(null);
  const [pendingQuery, setPendingQuery] = React.useState('');
  const activeThreadRef = React.useRef(learning.activeThread);
  const composerRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => { activeThreadRef.current = learning.activeThread; }, [learning.activeThread]);

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
  });
  const busy = status === 'submitted' || status === 'streaming';
  const latestMessage = messages[messages.length - 1];
  const latestText = latestMessage ? collectMessageText(latestMessage) : '';
  const showThinking = busy && (latestMessage?.role === 'user' || !latestText.trim());

  React.useEffect(() => {
    if (!open) return;
    setActiveIntent(null);
    setIntentPlan(null);
    setPendingQuery('');
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
    if (effectiveDepth === 'deep' && !activeIntent) {
      void prepareDeepIntent(text);
      return;
    }
    sendMessage({ text });
    fileUpload.clear();
  }, [activeIntent, busy, effectiveDepth, fileUpload, intentBusy, prepareDeepIntent, sendMessage]);

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

  if (!open) return null;
  if (view === 'memory') {
    return (
      <div className={cn('fixed inset-0 z-[80]', !isMobile && 'left-[var(--sidebar-width,0px)]')}>
        <LearningMemoryPanel
          onBack={() => setView('ask')}
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
      <div className={cn('flex min-w-0 flex-1 flex-col bg-white', !isMobile && 'mx-auto my-3 max-w-[1120px] overflow-hidden rounded-[28px] border border-divider shadow-float')}>
        <header className="flex items-center gap-3 border-b border-divider bg-paper px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-pine/15 bg-pine-fog text-pine"><Sparkles size={16} /></span>
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold text-ink">{COPY.globalAsk.title}</h1>
              <p className="hidden truncate text-[11.5px] text-ink-muted sm:block">{history.hydrated ? (history.restoredTitle ? `${COPY.globalAsk.historyRestored} · ${history.restoredTitle}` : COPY.globalAsk.subtitle) : COPY.globalAsk.historyLoading}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setView('memory')} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine" aria-label={COPY.globalAsk.memoryAction} title={COPY.globalAsk.memoryAction}>
              <History size={13} /> <span className="hidden sm:inline">{COPY.globalAsk.memoryAction}</span>
            </button>
            {messages.length > 0 ? <button type="button" onClick={startNewConversation} className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-ink-muted hover:text-pine" aria-label={COPY.globalAsk.newConversation}><Plus size={14} /></button> : null}
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={COPY.globalAsk.close}><X size={16} /></button>
          </div>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-divider bg-white px-4 py-2 sm:px-6">
          <button
            type="button"
            aria-pressed={effectiveDepth === 'deep'}
            onClick={() => {
              if (effectiveDepth === 'deep') {
                setDepth('quick');
                setIntentPlan(null);
                setActiveIntent(null);
                return;
              }
              setDepth('deep');
            }}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[11.5px] transition',
              effectiveDepth === 'deep'
                ? 'bg-pine text-white'
                : 'border border-divider bg-paper text-ink-secondary hover:border-pine/25 hover:text-pine',
            )}
          >
            <BrainCircuit size={13} />
            {COPY.globalAsk.deepMode}
          </button>
          <LearningContextStatus
            currentCount={currentMaterials.length + fileUpload.attachedFiles.length}
            recentCount={learning.recentActivities.length}
            memoryCount={learning.memories.filter((memory) => memory.status === 'active').length}
          />
        </div>

        <ChatMessageList
          watchKey={`${messages.length}:${latestText.length}:${intentBusy ? 1 : 0}`}
          showEmpty={messages.length === 0 && !intentPlan && !intentBusy}
          variant="paper"
          contentMaxWidth="max-w-3xl"
          innerClassName="space-y-4"
          emptyState={
            <div className="mx-auto flex max-w-xl flex-col items-center pt-8 text-center sm:pt-14">
              <OctoAvatar mood="listening" size="lg" aura className="mb-5" />
              <h2 className="font-serif text-[25px] italic tracking-[-0.025em] text-ink">{COPY.globalAsk.emptyTitle}</h2>
              <p className="mt-2 max-w-lg text-[13px] leading-6 text-ink-secondary">{COPY.globalAsk.emptyBody}</p>
              {learning.activeThread?.status === 'active' ? (
                <button
                  type="button"
                  onClick={() => {
                    setDepth('deep');
                    if (learning.activeThread) setActiveIntent(learningThreadToIntent(learning.activeThread));
                    composer.setValue(learning.activeThread?.intent || '');
                    window.setTimeout(() => composer.textareaRef.current?.focus(), 0);
                  }}
                  className="mt-6 w-full rounded-[18px] border border-pine/15 bg-pine-fog px-4 py-4 text-left transition hover:bg-pine-mist"
                >
                  <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-pine">{COPY.globalAsk.threadTitle}</span>
                  <span className="mt-1.5 block text-[14px] font-semibold text-ink">{learning.activeThread.title}</span>
                  {learning.activeThread.lastSummary ? <span className="mt-1 block line-clamp-2 text-[11.5px] leading-5 text-ink-secondary">{learning.activeThread.lastSummary}</span> : null}
                  <span className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-medium text-pine">{COPY.globalAsk.threadResume}<ChevronRight size={13} /></span>
                </button>
              ) : null}
              {visibleSources.length > 0 ? (
                <div className="mt-7 w-full text-left">
                  <p className="mb-2 px-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-muted">{COPY.globalAsk.sourceContext}</p>
                  <div className="space-y-1.5">
                    {visibleSources.map((source) => (
                      <button key={source.id} type="button" onClick={() => onNavigateToCapture?.(source.id)} className="flex w-full items-center gap-3 rounded-xl border border-divider bg-paper px-3.5 py-3 text-left hover:border-pine/20 hover:bg-pine-fog">
                        <FileText size={13} className="text-pine" />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">{source.title}</span>
                        <ChevronRight size={13} className="text-ink-muted" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          }
        >
          {messages.map((message, index) => {
            const text = collectMessageText(message);
            const isStreaming = busy && index === messages.length - 1 && message.role === 'assistant';
            return (
              <ChatBubble
                key={message.id}
                role={message.role === 'user' ? 'user' : 'assistant'}
                avatar={message.role === 'assistant' ? <OctoAvatar mood={isStreaming ? 'thinking' : 'happy'} size="sm" /> : undefined}
                messageId={message.id}
              >
                {message.role === 'assistant' ? (
                  <ChatRenderer content={text} isStreaming={isStreaming} messageId={message.id} />
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
          {error ? <div className="rounded-xl border border-vermilion/15 bg-vermilion-fog px-4 py-3 text-[12.5px] text-vermilion">{COPY.globalAsk.responseError}</div> : null}
        </ChatMessageList>

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
        />
      </div>
    </div>
  );
}

export default GlobalAskPanel;
