'use client';

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { BrainCircuit, ChevronRight, FileText, History, Plus, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import useAuth from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';
import { useLearningContext } from '@/hooks/useLearningContext';
import { formatLearningContextForTutor, summarizeLearningContext } from '@/lib/utils/learning-context';
import { conversationService, getEffectiveUserId } from '@/lib/services/conversation-service';
import { useSessionStore } from '@/stores/session-store';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { useCollectionStore } from '@/stores/collection-store';
import type { LearningIntentPlan } from '@/types/learning-intent';
import type { LearningThreadEntry } from '@/types/user';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { LearningIntentConfirmationCard } from '@/components/LearningIntentConfirmationCard';
import { LearningProgressMemoryCard } from '@/components/LearningProgressMemoryCard';
import { LearningMemoryPanel } from '@/components/LearningMemoryPanel';
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatThinkingStripBubble,
  collectMessageText,
  useChatComposer,
  useChatFileUpload,
  type ChatMarkerHit,
} from '@/components/chat';

interface GlobalAskPanelProps {
  open: boolean;
  onClose: () => void;
  onNavigateToCapture?: (captureId: string) => void;
  isMobile?: boolean;
}

type AskDepth = 'quick' | 'deep';
type ProgressState = { points: string[]; status: 'pending' | 'saved' | 'dismissed' };

function historyMessageToUIMessage(message: { messageId: string; role: string; content: string }): UIMessage {
  return {
    id: message.messageId,
    role: message.role === 'user' ? 'user' : 'assistant',
    parts: [{ type: 'text', text: message.content }],
  } as UIMessage;
}

function createThread(plan: LearningIntentPlan, query: string): LearningThreadEntry {
  const now = new Date().toISOString();
  return {
    id: `thread-${crypto.randomUUID()}`,
    title: plan.title,
    intent: query,
    outcome: plan.outcome,
    depth: 'deep',
    status: 'active',
    nextStep: plan.checkpoints[0],
    createdAt: now,
    updatedAt: now,
  };
}

export function GlobalAskPanel({
  open,
  onClose,
  onNavigateToCapture,
  isMobile = false,
}: GlobalAskPanelProps) {
  const { user, accessToken } = useAuth();
  const userId = getEffectiveUserId(user?.id);
  const learning = useLearningContext();
  const sessionId = useSessionStore((state) => state.sessionId);
  const segments = useCaptureEditorStore((state) => state.segments);
  const sourceItems = useCollectionStore((state) => state.sourceItems);
  const [depth, setDepth] = React.useState<AskDepth>('quick');
  const [view, setView] = React.useState<'ask' | 'memory'>('ask');
  const [intentPlan, setIntentPlan] = React.useState<LearningIntentPlan | null>(null);
  const [activeIntent, setActiveIntent] = React.useState<LearningIntentPlan | null>(null);
  const [pendingQuery, setPendingQuery] = React.useState('');
  const [intentBusy, setIntentBusy] = React.useState(false);
  const [historyHydrated, setHistoryHydrated] = React.useState(false);
  const [restoredTitle, setRestoredTitle] = React.useState<string | null>(null);
  const [progressByMessage, setProgressByMessage] = React.useState<Record<string, ProgressState>>({});
  const conversationIdRef = React.useRef<string | null>(null);
  const persistedIdsRef = React.useRef<Set<string>>(new Set());
  const composerRef = React.useRef<HTMLFormElement>(null);

  const fileUpload = useChatFileUpload({ authToken: accessToken ?? undefined, targetRef: composerRef });

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

  const agentContext = React.useMemo(() => {
    const attached = fileUpload.attachedFiles.map((file) => ({ title: file.title, content: file.text }));
    const supportMaterials = [...(useCurrentContext ? currentMaterials : []), ...attached];
    return {
      ...(supportMaterials.length > 0 ? { supportMaterials } : {}),
      global: {
        depth,
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
  }, [activeIntent, currentMaterials, depth, fileUpload.attachedFiles, formattedLearningContext, useCurrentContext, usePersonalContext]);

  const transport = React.useMemo(() => new DefaultChatTransport({
    api: '/api/tutor/agent',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: () => ({
      mode: 'global',
      sessionId: sessionId || 'global-ask',
      context: agentContext,
      options: {},
    }),
  }), [accessToken, agentContext, sessionId]);

  const { messages, setMessages, sendMessage, status, stop, error } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';
  const latestMessage = messages[messages.length - 1];
  const latestText = latestMessage ? collectMessageText(latestMessage) : '';
  const showThinking = busy && (latestMessage?.role === 'user' || !latestText.trim());

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setHistoryHydrated(false);
    const hydrate = async () => {
      try {
        const conversations = await conversationService.listConversations(userId, { type: 'global-chat', limit: 20 });
        const target = conversations.find((item) => item.metadata?.scope === 'global-ask');
        if (!target || !alive) return;
        const history = await conversationService.getMessages(target.conversationId);
        if (!alive) return;
        conversationIdRef.current = target.conversationId;
        persistedIdsRef.current = new Set(history.map((message) => message.messageId));
        setRestoredTitle(target.title);
        setDepth(target.metadata?.depth === 'deep' ? 'deep' : 'quick');
        setMessages(history.map(historyMessageToUIMessage));
      } catch (hydrateError) {
        console.error('[GlobalAskPanel] failed to restore history', hydrateError);
      } finally {
        if (alive) setHistoryHydrated(true);
      }
    };
    void hydrate();
    return () => { alive = false; };
  }, [open, setMessages, userId]);

  React.useEffect(() => {
    if (!open || !historyHydrated || busy) return;
    const persist = async () => {
      const unsaved = messages.filter((message) => (
        (message.role === 'user' || message.role === 'assistant')
        && !persistedIdsRef.current.has(message.id)
        && collectMessageText(message).trim()
      ));
      if (unsaved.length === 0) return;
      try {
        if (!conversationIdRef.current) {
          const firstUser = unsaved.find((message) => message.role === 'user');
          const title = conversationService.generateTitleFromMessage(
            firstUser ? collectMessageText(firstUser) : COPY.globalAsk.recentConversation,
          );
          const created = await conversationService.createConversation({
            userId,
            type: 'global-chat',
            title,
            sessionId: 'global-ask',
            model: 'tutor-agent',
            metadata: { scope: 'global-ask', depth },
          });
          conversationIdRef.current = created.conversationId;
          setRestoredTitle(created.title);
        }
        const conversationId = conversationIdRef.current;
        await conversationService.addMessages(conversationId, unsaved.map((message) => ({
          role: message.role === 'user' ? 'user' : 'assistant',
          content: collectMessageText(message),
        })));
        unsaved.forEach((message) => persistedIdsRef.current.add(message.id));
        const latestAssistant = [...unsaved].reverse().find((message) => message.role === 'assistant');
        if (latestAssistant) {
          await learning.recordActivity({
            kind: 'conversation',
            title: depth === 'deep' ? COPY.globalAsk.recentDeepSession : COPY.globalAsk.recentConversation,
            detail: collectMessageText(latestAssistant).slice(0, 220),
            sourceId: `global-ask:${conversationId}:${latestAssistant.id}`,
          });
        }
      } catch (persistError) {
        console.error('[GlobalAskPanel] failed to persist history', persistError);
      }
    };
    void persist();
  }, [busy, depth, historyHydrated, learning, messages, open, userId]);

  const startNewConversation = React.useCallback(() => {
    stop();
    setMessages([]);
    setIntentPlan(null);
    setActiveIntent(null);
    setPendingQuery('');
    setProgressByMessage({});
    setRestoredTitle(null);
    conversationIdRef.current = null;
    persistedIdsRef.current = new Set();
    fileUpload.clear();
  }, [fileUpload, setMessages, stop]);

  const sendQuick = React.useCallback((text: string) => {
    setActiveIntent(null);
    sendMessage({ text });
    fileUpload.clear();
  }, [fileUpload, sendMessage]);

  const prepareDeepIntent = React.useCallback(async (query: string) => {
    setPendingQuery(query);
    setIntentBusy(true);
    try {
      const summary = summarizeLearningContext(learning);
      const response = await fetch('/api/tutor/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          learnerContext: summary,
          recentContext: learning.recentActivities.slice(-6).map((item) => `${item.title}${item.detail ? `：${item.detail}` : ''}`).join('\n'),
          activeContext: currentMaterials.map((item) => `${item.title}\n${item.content.slice(0, 500)}`).join('\n\n').slice(0, 4_000),
        }),
      });
      const payload = await response.json() as { ok?: boolean; plan?: LearningIntentPlan };
      if (!response.ok || !payload.plan) throw new Error('intent unavailable');
      setIntentPlan(payload.plan);
    } catch {
      toast.message(COPY.globalAsk.preparingError);
      setDepth('quick');
      sendQuick(query);
      setPendingQuery('');
    } finally {
      setIntentBusy(false);
    }
  }, [currentMaterials, learning, sendQuick]);

  const submitText = React.useCallback((text: string) => {
    if (busy || intentBusy) return;
    if (depth === 'deep' && !activeIntent) {
      void prepareDeepIntent(text);
      return;
    }
    sendMessage({ text });
    fileUpload.clear();
  }, [activeIntent, busy, depth, fileUpload, intentBusy, prepareDeepIntent, sendMessage]);

  const composer = useChatComposer({
    draftKey: 'global-ask',
    onSubmit: submitText,
    disabled: busy || intentBusy,
    onLargePaste: (text) => fileUpload.addTextAsFile(text),
  });

  const confirmIntent = React.useCallback(async (plan: LearningIntentPlan) => {
    const query = pendingQuery;
    if (!query) return;
    setActiveIntent(plan);
    setIntentPlan(null);
    setPendingQuery('');
    await learning.setActiveThread(createThread(plan, query));
    sendMessage({ text: query });
    fileUpload.clear();
  }, [fileUpload, learning, pendingQuery, sendMessage]);

  const cancelIntent = React.useCallback(() => {
    const query = pendingQuery;
    setIntentPlan(null);
    setPendingQuery('');
    setDepth('quick');
    if (query) sendQuick(query);
  }, [pendingQuery, sendQuick]);

  const handleMarkerHit = React.useCallback((hit: ChatMarkerHit) => {
    if (hit.kind !== 'learning-progress' || !hit.learningProgress?.points.length || !hit.messageId) return;
    setProgressByMessage((current) => current[hit.messageId] ? current : {
      ...current,
      [hit.messageId]: { points: hit.learningProgress!.points, status: 'pending' },
    });
  }, []);

  const saveProgress = React.useCallback(async (messageId: string, points: string[]) => {
    for (let index = 0; index < points.length; index += 1) {
      await learning.addMemory({
        kind: 'progress',
        title: points[index],
        source: 'confirmed-ai',
        sourceId: `global-progress:${messageId}:${index}`,
      });
    }
    if (learning.activeThread) {
      await learning.setActiveThread({
        ...learning.activeThread,
        lastSummary: points.join('；'),
        nextStep: activeIntent?.checkpoints[1] || activeIntent?.checkpoints[0],
        conversationId: conversationIdRef.current || undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    setProgressByMessage((current) => ({
      ...current,
      [messageId]: { ...current[messageId], status: 'saved' },
    }));
  }, [activeIntent, learning]);

  const visibleSources = sourceItems.filter((item) => item.status !== 'failed').slice(-3).reverse();

  if (!open) return null;
  if (view === 'memory') {
    return (
      <div className={cn('fixed inset-0 z-[80]', !isMobile && 'left-[var(--sidebar-width,0px)]')}>
        <LearningMemoryPanel
          onBack={() => setView('ask')}
          onResumeThread={() => {
            setView('ask');
            setDepth('deep');
            if (learning.activeThread?.intent) composer.setValue(learning.activeThread.intent);
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
              <p className="truncate text-[11.5px] text-ink-muted">{historyHydrated ? (restoredTitle ? `${COPY.globalAsk.historyRestored} · ${restoredTitle}` : COPY.globalAsk.subtitle) : COPY.globalAsk.historyLoading}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setView('memory')} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine">
              <History size={13} /> <span className="hidden sm:inline">{COPY.globalAsk.memoryAction}</span>
            </button>
            {messages.length > 0 ? <button type="button" onClick={startNewConversation} className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-ink-muted hover:text-pine" aria-label={COPY.globalAsk.newConversation}><Plus size={14} /></button> : null}
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={COPY.globalAsk.close}><X size={16} /></button>
          </div>
        </header>

        <div className="flex items-center justify-center gap-1 border-b border-divider bg-white px-4 py-2">
          {(['quick', 'deep'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => { setDepth(mode); if (mode === 'quick') { setIntentPlan(null); setActiveIntent(null); } }}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11.5px] transition', depth === mode ? 'bg-ink text-white' : 'text-ink-muted hover:bg-paper-warm hover:text-ink')}
            >
              {mode === 'deep' ? <BrainCircuit size={13} /> : <Sparkles size={12} />}
              {mode === 'deep' ? COPY.globalAsk.deepMode : COPY.globalAsk.quickMode}
            </button>
          ))}
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
              <p className="mt-3 max-w-lg text-[13px] leading-6 text-ink-secondary">{COPY.globalAsk.emptyBody}</p>
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
            const progress = progressByMessage[message.id];
            return (
              <ChatBubble
                key={message.id}
                role={message.role === 'user' ? 'user' : 'assistant'}
                avatar={message.role === 'assistant' ? <OctoAvatar mood={isStreaming ? 'thinking' : 'happy'} size="sm" /> : undefined}
                messageId={message.id}
                footer={progress && progress.status !== 'dismissed' ? (
                  <LearningProgressMemoryCard
                    points={progress.points}
                    saved={progress.status === 'saved'}
                    onSave={(points) => saveProgress(message.id, points)}
                    onDismiss={() => setProgressByMessage((current) => ({ ...current, [message.id]: { ...progress, status: 'dismissed' } }))}
                  />
                ) : undefined}
              >
                {message.role === 'assistant' ? (
                  <ChatRenderer content={text} isStreaming={isStreaming} markers={depth === 'deep' ? ['learning-progress'] : undefined} onMarkerHit={handleMarkerHit} messageId={message.id} />
                ) : <span className="whitespace-pre-wrap">{text}</span>}
              </ChatBubble>
            );
          })}
          {intentBusy ? <ChatThinkingStripBubble label={COPY.globalAsk.preparingIntent} avatar={<OctoAvatar mood="thinking" size="sm" aura />} /> : null}
          {intentPlan ? <LearningIntentConfirmationCard plan={intentPlan} busy={busy} onConfirm={(plan) => void confirmIntent(plan)} onCancel={cancelIntent} /> : null}
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
          placeholder={depth === 'deep' ? COPY.globalAsk.composerDeep : COPY.globalAsk.composerQuick}
          statusLabel={intentBusy ? COPY.globalAsk.preparingIntent : undefined}
        />
      </div>
    </div>
  );
}

export default GlobalAskPanel;
