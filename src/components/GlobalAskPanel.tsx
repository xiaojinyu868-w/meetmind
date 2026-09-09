'use client';

import * as React from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Layers3, Plus, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import useAuth from '@/lib/hooks/useAuth';
import { cn } from '@/lib/utils';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
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
import { buildGlobalAskStarters } from '@/components/global-ask-starters';
import { buildAskDesk, isMaterialTitle } from '@/components/global-ask-desk';
import { composeAskOpening } from '@/components/global-ask-opening';
import { buildLearnerProfile } from '@/components/learner-profile-model';
import { LearnerProfileRail } from '@/components/LearnerProfileRail';
import { buildLocalLearnerContext } from '@/components/learner-context-local';
import { GUEST_DEMO_LESSON_TITLE, resetDemoEntryConsumed } from '@/components/classroom/guest-demo-entry';
import { isDemoLessonLoaded } from '@/components/classroom/DemoLessonLoader';
import { useMasteryTrail } from '@/hooks/useMasteryTrail';
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
  const anchors = useCaptureEditorStore((state) => state.anchors);
  const sourceItems = useCollectionStore((state) => state.sourceItems);
  const [depth, setDepth] = React.useState<AskDepth>('quick');
  const [view, setView] = React.useState<'ask' | 'memory'>('ask');
  const [contextOpen, setContextOpen] = React.useState(false);
  // 画像栏：宽屏常驻在右侧；窄屏 / 移动端收成顶栏一个「画像」按钮，点开是右侧抽屉
  const [profileOpen, setProfileOpen] = React.useState(false);
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
    userId: user?.id,
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
      materials.unshift({ title: GLOBAL_ASK_COPY.sourceCurrentLesson, content: currentTranscript });
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
  const learnerRef = React.useRef({ usePersonalContext, activities: learning.recentActivities, memories: learning.memories });
  React.useEffect(() => {
    learnerRef.current = { usePersonalContext, activities: learning.recentActivities, memories: learning.memories };
  }, [usePersonalContext, learning.recentActivities, learning.memories]);

  const transport = React.useMemo(() => new DefaultChatTransport({
    api: '/api/tutor/agent',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    body: () => ({
      mode: 'global',
      sessionId: sessionId || 'global-ask',
      // 「这个学习者」读槽：发送时现算本机切片（掌握状态 + 最近现场 + 长期理解——和书桌同一份事实）；个人上下文关掉时不带
      context: {
        ...agentContextRef.current,
        ...(learnerRef.current.usePersonalContext
          ? { learner: buildLocalLearnerContext({ appId: 'tutor:global', sessionId: sessionId || undefined, activities: learnerRef.current.activities, memories: learnerRef.current.memories }) }
          : {}),
      },
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
      title: persistedDepth === 'deep' ? GLOBAL_ASK_COPY.recentDeepSession : GLOBAL_ASK_COPY.recentConversation,
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
    fallbackTitle: GLOBAL_ASK_COPY.recentConversation,
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
        toast.message(GLOBAL_ASK_COPY.refiningError);
        await beginDeepSession(fallbackPlan, query);
      } else {
        toast.message(GLOBAL_ASK_COPY.preparingError);
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

  // 抽屉里列的就是真正会带进对话的那几份（与 currentMaterials 同一口径：最近 6 份）
  const visibleSources = sourceItems.filter((item) => item.status !== 'failed').slice(-6).reverse();
  const showWelcome = messages.length === 0 && !intentPlan && !intentBusy && !pendingQuery;
  // 能在第一屏点名的材料：用户自己收的（不是系统写的）、不是图、标题是标题而不是一句话
  const namedMaterialTitles = React.useMemo(() => [
    ...sourceItems.filter((item) => item.status !== 'failed' && item.origin !== 'system' && item.type !== 'image').slice(-6).reverse().map((item) => item.title),
    ...fileUpload.attachedFiles.map((file) => file.title),
  ].filter(isMaterialTitle), [fileUpload.attachedFiles, sourceItems]);
  const welcomeStarters = React.useMemo(() => buildGlobalAskStarters({
    depth: effectiveDepth,
    currentMaterialTitles: [...(currentTranscript ? [GLOBAL_ASK_COPY.sourceCurrentLesson] : []), ...namedMaterialTitles],
    recentActivities: learning.recentActivities,
    memories: learning.memories,
  }), [currentTranscript, effectiveDepth, learning.memories, learning.recentActivities, namedMaterialTitles]);

  // 书桌：同桌此刻在读什么、记得你什么。掌握轨迹 = 本机会话层结果 + 登录用户的服务端切片（换设备也在），面板打开时读
  const { trail: masteryTrail, fromAccount: masteryFromAccount } = useMasteryTrail({ enabled: open, appId: 'global-ask' });
  // 「同学眼里的你」：小传 + 可维护的事实 + 台账——画像坐在提问旁边，而不是藏在设置里
  const profileView = React.useMemo(() => buildLearnerProfile({
    memories: learning.memories,
    recentActivities: learning.recentActivities,
    activeThread: learning.activeThread,
    trail: masteryTrail,
    knownSince: user?.createdAt,
  }), [learning.activeThread, learning.memories, learning.recentActivities, masteryTrail, user?.createdAt]);
  const currentLesson = React.useMemo(() => {
    if (isDemoLessonLoaded(segments)) return { title: GUEST_DEMO_LESSON_TITLE, at: undefined };
    if (!sessionId) return { title: undefined, at: undefined };
    const match = [...learning.recentActivities].reverse().find((item) => item.kind === 'lesson' && item.sessionId === sessionId);
    return { title: match?.title, at: match?.occurredAt };
  }, [learning.recentActivities, segments, sessionId]);
  const deskGroups = React.useMemo(() => buildAskDesk({
    hasCurrentTranscript: currentTranscript.length > 0,
    segments,
    currentLessonTitle: currentLesson.title,
    currentLessonAt: currentLesson.at,
    materialTitles: namedMaterialTitles,
    anchors,
    recentActivities: learning.recentActivities,
    trail: masteryTrail,
    memories: learning.memories,
  }), [anchors, currentLesson, currentTranscript.length, learning.memories, learning.recentActivities, masteryTrail, namedMaterialTitles, segments]);
  // 同学开口的话 + 「可以从这里开始」：从书桌事实说成一两句，不再陈列 chip
  const opening = React.useMemo(() => composeAskOpening({
    desk: deskGroups,
    activeThread: learning.activeThread,
    fallbackStarters: welcomeStarters,
    depth: effectiveDepth,
    canStartDemo: !user,
  }), [deskGroups, effectiveDepth, learning.activeThread, user, welcomeStarters]);
  // 空桌面的试听入口：只给访客（entry=demo 只在 guest=1 下自动灌课；登录用户从课堂 tab 进）
  const startDemoLesson = React.useCallback(() => {
    resetDemoEntryConsumed();
    onClose();
    window.location.assign('/app?guest=1&entry=demo');
  }, [onClose]);

  const askFromProfile = React.useCallback((prompt: string) => {
    setProfileOpen(false);
    composer.setValue(prompt);
    window.setTimeout(() => composer.textareaRef.current?.focus(), 0);
  }, [composer]);

  const renderProfileRail = (className?: string) => (
    <LearnerProfileRail
      className={className}
      view={profileView}
      isGuest={!user}
      saving={learning.saving}
      fromAccount={masteryFromAccount}
      onAsk={askFromProfile}
      onConfirmMemory={(id) => void learning.confirmMemory(id)}
      onEditMemory={(id, title) => void learning.updateMemory(id, { title, status: 'active' })}
      onForgetMemory={(id) => void learning.removeMemory(id)}
      onResumeMemory={(id) => void learning.updateMemory(id, { status: 'active' })}
      onAddMemory={(kind, title) => void learning.addMemory({ kind, title, source: 'user' })}
      onCompleteThread={() => {
        if (!learning.activeThread) return;
        void learning.setActiveThread({ ...learning.activeThread, status: 'completed', updatedAt: new Date().toISOString() });
        setActiveIntent(null);
      }}
      onOpenAll={() => { setProfileOpen(false); setView('memory'); }}
      onStartDemo={user ? undefined : startDemoLesson}
    />
  );

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
      placeholder={showWelcome
        ? (effectiveDepth === 'deep' ? GLOBAL_ASK_COPY.opening.placeholderDeep : GLOBAL_ASK_COPY.opening.placeholderQuick)
        : (effectiveDepth === 'deep' ? GLOBAL_ASK_COPY.composerDeep : GLOBAL_ASK_COPY.composerQuick)}
      statusLabel={intentBusy ? GLOBAL_ASK_COPY.preparingIntent : undefined}
      // 第一屏与对话态都用 bare（宿主画外框）；embedded=false 的 paper 变体保留给别的宿主
      variant={embedded ? 'bare' : 'paper'}
      className={embedded ? '!px-0 !pb-1 !pt-0' : undefined}
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
            composer.setValue(GLOBAL_ASK_COPY.memoryTalkPrompt);
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
    // 全屏布局（2026-09-09）：此前是 bg-canvas/95 毛玻璃罩 + 居中 1060px 圆角卡片，四周留着大片空白，像 demo。
    // 现在侧栏右侧整块就是问同学：左边对话，右边常驻画像栏（≥1180px），窄屏收成顶栏按钮。
    <div className={cn('fixed inset-0 z-[80] flex bg-white', !isMobile && 'left-[var(--sidebar-width,0px)]')}>
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="flex items-center gap-3 border-b border-divider bg-paper px-4 py-3 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <OctoAvatar mood="listening" size="sm" />
            <div className="min-w-0">
              <h1 className="truncate text-[15px] font-semibold text-ink">{GLOBAL_ASK_COPY.title}</h1>
              {history.hydrated && history.restoredTitle ? (
                <p className="hidden truncate text-[11.5px] text-ink-muted sm:block">{`${GLOBAL_ASK_COPY.historyRestored} · ${history.restoredTitle}`}</p>
              ) : !history.hydrated ? (
                <p className="hidden truncate text-[11.5px] text-ink-muted sm:block">{GLOBAL_ASK_COPY.historyLoading}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <AdminAiInspectorLink controlKey="tutor:global" context={agentContext} query={inspectorQuery} compact={isMobile} />
            <button type="button" onClick={() => setProfileOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine min-[1180px]:hidden" aria-label={GLOBAL_ASK_COPY.profile.eyebrow} title={GLOBAL_ASK_COPY.profile.eyebrow}>
              <UserRound size={13} /> <span className="hidden sm:inline">{GLOBAL_ASK_COPY.profile.toggle}</span>
            </button>
            <button type="button" onClick={() => setContextOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider bg-white px-3 text-[11.5px] text-ink-secondary hover:border-pine/25 hover:text-pine" aria-label={GLOBAL_ASK_COPY.contextRailTitle} title={GLOBAL_ASK_COPY.contextRailTitle}>
              <Layers3 size={13} /> <span className="hidden sm:inline">{GLOBAL_ASK_COPY.contextAction}</span>
            </button>
            {messages.length > 0 ? <button type="button" onClick={startNewConversation} className="flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-ink-muted hover:text-pine" aria-label={GLOBAL_ASK_COPY.newConversation}><Plus size={14} /></button> : null}
            <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={GLOBAL_ASK_COPY.close}><X size={16} /></button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="relative flex min-w-0 flex-1 flex-col">
            <ChatMessageList
              watchKey={`${messages.length}:${latestText.length}:${intentBusy ? 1 : 0}`}
              showEmpty={showWelcome}
              variant="paper"
              contentMaxWidth="max-w-3xl"
              innerClassName={showWelcome ? 'min-h-full' : 'space-y-4'}
              emptyState={
                <GlobalAskWelcome
                  depth={effectiveDepth}
                  opening={opening}
                  onStartDemo={user ? undefined : startDemoLesson}
                  deepLocked={deepLocked}
                  composer={renderComposer(true)}
                  onDepthChange={handleDepthChange}
                  onChoosePrompt={(prompt) => {
                    // 「接着上次的…」：接回学习线索走深度模式，其余只是把问题落进输入框
                    if (learning.activeThread?.status === 'active' && prompt === (learning.activeThread.intent || learning.activeThread.title)) {
                      setDepth('deep');
                      setActiveIntent(learningThreadToIntent(learning.activeThread));
                    }
                    composer.setValue(prompt);
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
                // 同学的回答不套卡片（minimal）：像第一屏那句话一样，是人在说话，不是系统在出卡；用户消息仍是墨色气泡
                variant={message.role === 'assistant' ? 'minimal' : 'paper'}
                fullWidth={message.role === 'assistant'}
                avatar={message.role === 'assistant' ? <OctoAvatar mood={isStreaming ? 'thinking' : 'happy'} size="sm" /> : undefined}
                messageId={message.id}
              >
                {message.role === 'assistant' ? (
                  // minimal 气泡是 pre-wrap（给纯文本用）；markdown 渲染出的块之间有换行文本节点，pre-wrap 会把它们撑成空行，这里收回 normal
                  <div className="whitespace-normal">
                    {reasoning ? <ChatReasoningBlock reasoning={reasoning} isStreaming={isStreaming} /> : null}
                    <ChatRenderer content={text} isStreaming={isStreaming} messageId={message.id} />
                  </div>
                ) : <span className="whitespace-pre-wrap">{text}</span>}
              </ChatBubble>
            );
          })}
          {pendingQuery && !activeIntent ? <ChatBubble role="user"><span className="whitespace-pre-wrap">{pendingQuery}</span></ChatBubble> : null}
          {intentBusy ? <ChatThinkingStripBubble label={GLOBAL_ASK_COPY.preparingIntent} avatar={<OctoAvatar mood="thinking" size="sm" aura />} /> : null}
          {intentPlan ? (
            <LearningIntentConfirmationCard
              plan={intentPlan}
              busy={busy || intentBusy}
              onConfirm={(plan) => void confirmIntent(plan)}
              onResolve={(answers) => void prepareDeepIntent(pendingQuery, answers, intentPlan)}
              onCancel={cancelIntent}
            />
          ) : null}
          {showThinking ? <ChatThinkingStripBubble label={GLOBAL_ASK_COPY.thinking} avatar={<OctoAvatar mood="thinking" size="sm" aura />} /> : null}
          {error ? <div className="rounded-xl border border-vermilion/15 bg-vermilion-fog px-4 py-3 text-[12.5px] text-vermilion">{pointsBlock ? describePointsBlock(pointsBlock) : GLOBAL_ASK_COPY.responseError}</div> : null}
            </ChatMessageList>

            {!showWelcome ? (
              // 对话态的输入框与第一屏同一张卡（bare 变体 + 宿主画外框），不再是通用底座那条带内层边框的输入条
              <div className="shrink-0 bg-white px-4 pb-4 pt-2 sm:px-6">
                <div className="mx-auto w-full max-w-3xl rounded-[22px] border border-divider bg-card shadow-card transition-[box-shadow,border-color] duration-300 focus-within:border-pine/40 focus-within:shadow-[0_0_0_4px_rgba(47,107,85,0.08),0_16px_48px_rgba(32,49,42,0.10)]">
                  <div className="px-4 pt-2.5 sm:px-5">{renderComposer(true)}</div>
                </div>
              </div>
            ) : null}
          </main>
          {!isMobile ? renderProfileRail('hidden w-[340px] shrink-0 border-l border-divider min-[1180px]:flex') : null}
        </div>

        {profileOpen ? (
          <div className="absolute inset-0 z-20 flex justify-end min-[1180px]:hidden">
            <button type="button" aria-label={GLOBAL_ASK_COPY.close} onClick={() => setProfileOpen(false)} className="flex-1 bg-ink/20 backdrop-blur-[2px]" />
            <div className="relative flex h-full w-full max-w-[400px] flex-col border-l border-divider bg-paper shadow-float">
              <button type="button" onClick={() => setProfileOpen(false)} className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-paper-warm hover:text-ink" aria-label={GLOBAL_ASK_COPY.close}><X size={15} /></button>
              {renderProfileRail('flex-1')}
            </div>
          </div>
        ) : null}

        {contextOpen ? (
          <GlobalAskContextDrawer
            currentLessonTitle={currentTranscript ? (currentLesson.title || GLOBAL_ASK_COPY.desk.currentLesson) : undefined}
            sources={visibleSources}
            attachedTitles={fileUpload.attachedFiles.map((file) => file.title)}
            recentActivities={learning.recentActivities}
            memories={learning.memories}
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
