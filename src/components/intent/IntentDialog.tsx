'use client';

/**
 * IntentDialog —— 「聊聊你想要的」沉浸式对话面板（M11 重做）
 *
 * 设计哲学（v7 仪式时刻白名单第 6 项升级版）：
 *   这一页是 v3.0 信息流哲学的"灵魂入口"。视觉为智能让路，但**这一页**允许情绪化：
 *     - 全屏 Octo 大图 + 双签名色 radial gradient 虚化背景
 *     - Glass morphism 半透明气泡，让 Octo 在背后若隐若现（陪伴感）
 *     - Instrument Serif italic 装饰文字 + Inter 主字体
 *     - 进入动画 fade-up 16px / 240ms（让人感觉这是"打开了一扇门"）
 *
 * 架构：迁到底座 ChatBase（M11 重构）
 *   - 输入条：ChatComposer（glass variant）
 *   - 消息流：ChatMessageList + ChatBubble（glass variant）
 *   - 渲染：ChatRenderer + intent-summary marker
 *   - 等待态：ChatThinkingStripBubble
 *   - 文件上传：useChatFileUpload（拖拽 + 粘贴 + 点击三入口统一）
 *   - 草稿：useChatComposer（持久化 sessionId）
 *
 * 与「设置页」共享同一个 Container（IntentDialogContainer）。
 */

import * as React from 'react';
import Image from 'next/image';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { X, Phone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import {
  ChatBubble,
  ChatComposer,
  ChatMessageList,
  ChatRenderer,
  ChatThinkingStripBubble,
  collectMessageText,
  extractIntentSummary,
  extractIntentBio,
  useChatComposer,
  useChatFileUpload,
} from '@/components/chat';
import { IntentSummaryCard } from './IntentSummaryCard';
import { IntentBioCard } from './IntentBioCard';
import type { BioEntry, GoalEntry, LearnerProfile } from '@/types/user';

interface IntentDialogProps {
  open: boolean;
  authToken?: string;
  /** 当前 learnerProfile（已有目标 + bio 会作为上下文注入） */
  learnerProfile?: LearnerProfile | null;
  /** 进入这次对话时附带的 hint */
  sessionHint?: string;
  /** 切到通话模式 */
  onSwitchToCall?: () => void;
  /** 关闭对话 */
  onClose: () => void;
  /** 用户保存了一个目标 */
  onSaveGoal: (goal: GoalEntry) => Promise<void>;
  /** 用户保存了"我了解到的你"画像 */
  onSaveBio: (bio: BioEntry) => Promise<void>;
  /** 用户跳过 onboarding */
  onSkip?: () => void;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function getGreetingHint(profile: LearnerProfile | null | undefined): {
  headline: string;
  hint: string;
  options: string[];
} {
  const goals = profile?.goals ?? [];
  const bio = profile?.bio;
  // 路径 B：回访（已经认识了）
  if (bio?.headline) {
    if (goals.length > 0) {
      return {
        headline: '欢迎回来。',
        hint: `上次我们聊到 "${goals[0].title}"——这次想接着聊，还是有新的事？`,
        options: ['接着上次聊', '聊件新的', '更新一下我自己'],
      };
    }
    return {
      headline: '欢迎回来。',
      hint: `上次我大概了解了你——${bio.headline.slice(0, 40)}…  最近怎么样？`,
      options: ['有件事在心里', '想换个方向', '只是来记录一下'],
    };
  }
  // 路径 B'：有 goals 但没 bio（旧用户走过 goals 流程但没 bio）
  if (goals.length > 0) {
    return {
      headline: '欢迎回来。',
      hint: `你之前留下了 ${goals.length} 件想做的事——这次想聊新的，还是更新一件旧的？`,
      options: ['聊一件新的', '更新某件旧的', '把已有的几件再排一下'],
    };
  }
  // 路径 A：首次会面（建立个人上下文）
  return {
    headline: '我是 Octo。',
    hint: '你以后想清楚事情、记下事情都可以来找我。我们刚认识——你想先告诉我一点你自己吗？',
    options: ['我是学生', '我在工作', '我在过渡期'],
  };
}

export function IntentDialog({
  open,
  authToken,
  learnerProfile,
  sessionHint,
  onSwitchToCall,
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

  const greeting = React.useMemo(() => getGreetingHint(learnerProfile), [learnerProfile]);

  const existingGoalsContext = React.useMemo(() => {
    const goals = learnerProfile?.goals ?? [];
    if (goals.length === 0) return undefined;
    return goals.map((g) => ({
      title: g.title,
      summary: g.summary,
      updatedAt: g.updatedAt?.slice(0, 10),
    }));
  }, [learnerProfile]);

  const existingBioContext = React.useMemo(() => {
    const bio = learnerProfile?.bio;
    if (!bio?.headline) return undefined;
    return {
      headline: bio.headline,
      detail: bio.detail,
    };
  }, [learnerProfile]);

  // 文件上传（拖拽 / 粘贴 / 点击 三入口统一）
  const composerRef = React.useRef<HTMLFormElement>(null);
  const fileUpload = useChatFileUpload({
    authToken,
    targetRef: composerRef,
  });

  // supportMaterials = 用户上传的文件解析文本
  const supportMaterials = React.useMemo(() => {
    if (fileUpload.attachedFiles.length === 0) return undefined;
    return fileUpload.attachedFiles.map((f) => ({
      title: f.title,
      content: f.text,
    }));
  }, [fileUpload.attachedFiles]);

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        body: () => ({
          sessionId,
          mode: 'goal' as const,
          transcript: [],
          context: {
            goal: {
              existingGoals: existingGoalsContext,
              existingBio: existingBioContext,
              sessionHint,
            },
            supportMaterials,
          },
          options: {},
        }),
      }),
    [authToken, sessionId, existingGoalsContext, existingBioContext, sessionHint, supportMaterials],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';

  const composer = useChatComposer({
    draftKey: sessionId,
    onSubmit: (text) => {
      sendMessage({ text });
      // 已发送的文件信息已经透过 supportMaterials 注入了；保留 attached 让 AI 能在后续也引用
      // 如果用户希望发送后清空附件，把下面这行打开即可：
      // fileUpload.clear();
    },
    disabled: busy,
    // M12：粘大段（>500 字）→ 自动转附件 + toast 提示
    onLargePaste: (text) => {
      fileUpload.addTextAsFile(text);
      toast.success('内容较长，已作为附件附加', {
        description: 'Octo 会先把这段读完',
        duration: 2400,
      });
    },
  });

  const handleAcceptSummary = React.useCallback(
    async (messageId: string, params: { title: string; summary?: string; acceptedPoints?: string[]; rejectedPoints?: string[] }) => {
      const now = new Date().toISOString();
      const goal: GoalEntry = {
        id: genId(),
        title: params.title,
        summary: params.summary,
        createdAt: now,
        updatedAt: now,
        conversationId: sessionId,
        status: 'active',
      };
      await onSaveGoal(goal);
      setSavedSummaryIds((prev) => ({ ...prev, [messageId]: true }));

      // 如果有被拒绝的点，发送反馈让 AI 知道"这条不对"
      if (params.rejectedPoints && params.rejectedPoints.length > 0) {
        const feedback = `有几条我不太认同：\n${params.rejectedPoints.map(p => `· ${p}`).join('\n')}\n其他的没问题。`;
        // 通过 append 注入用户反馈
        sendMessage({ text: feedback });
      }
    },
    [onSaveGoal, sessionId, sendMessage],
  );

  const handleAcceptBio = React.useCallback(
    async (messageId: string, params: { headline: string; detail?: string; acceptedPoints?: string[]; rejectedPoints?: string[] }) => {
      const now = new Date().toISOString();
      const existing = learnerProfile?.bio;
      const bio: BioEntry = {
        headline: params.headline,
        detail: params.detail,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        conversationId: existing?.conversationId ?? sessionId,
      };
      await onSaveBio(bio);
      setSavedBioIds((prev) => ({ ...prev, [messageId]: true }));

      if (params.rejectedPoints && params.rejectedPoints.length > 0) {
        const feedback = `有几条不太对：\n${params.rejectedPoints.map(p => `· ${p}`).join('\n')}\n其他的没问题。`;
        sendMessage({ text: feedback });
      }
    },
    [onSaveBio, sessionId, learnerProfile?.bio, sendMessage],
  );

  // 监听最近一条 AI 消息的 mood —— 影响顶部 Octo 表情
  const assistantMood = React.useMemo<'thinking' | 'listening' | 'idle' | 'happy'>(() => {
    if (busy) {
      const lastMsg = messages[messages.length - 1];
      const lastIsUser = lastMsg && lastMsg.role === 'user';
      const lastIsEmpty =
        lastMsg && lastMsg.role === 'assistant' && !collectMessageText(lastMsg).trim();
      if (lastIsUser || lastIsEmpty) return 'thinking';
      return 'happy'; // 流中
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

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col"
      style={{
        // 底层：深色暗调（让虚化的 Octo 浮起）
        background:
          'radial-gradient(ellipse at 30% 40%, rgba(45,79,62,0.18) 0%, rgba(20,17,13,0.92) 55%), radial-gradient(ellipse at 75% 70%, rgba(181,72,60,0.10) 0%, transparent 60%), #14110D',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="聊聊你想要的"
    >
      {/* ─── 沉浸式 Octo 背景（绝对定位 + blur） ─────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {/* 大 Octo IP，右下偏置，模糊呼吸 */}
        <div
          className="absolute -bottom-[14%] -right-[6%] h-[78vh] w-[78vh] opacity-[0.36]"
          style={{
            filter: 'blur(28px)',
            animation: 'octoBreathe 9s ease-in-out infinite',
          }}
        >
          <Image
            src="/images/octo-buddy/original.png"
            alt=""
            fill
            sizes="78vh"
            priority
            style={{ objectFit: 'contain' }}
          />
        </div>
        {/* 顶部柔光（pine） */}
        <div
          className="absolute -left-[20%] -top-[15%] h-[60vh] w-[60vh] rounded-full opacity-50"
          style={{
            background:
              'radial-gradient(circle, rgba(45,79,62,0.40) 0%, rgba(45,79,62,0.10) 40%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
        {/* 右上柔光（vermilion） */}
        <div
          className="absolute -right-[10%] -top-[5%] h-[40vh] w-[40vh] rounded-full opacity-30"
          style={{
            background:
              'radial-gradient(circle, rgba(181,72,60,0.30) 0%, rgba(181,72,60,0.08) 50%, transparent 80%)',
            filter: 'blur(60px)',
          }}
        />
        {/* 纸感颗粒（极淡 noise，让 backdrop-blur 不太"塑料感"） */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.2' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.5'/></svg>\")",
          }}
        />
      </div>

      {/* ─── 顶部 Header（透明 + 极简） ──────────────────────────────── */}
      <header className="relative z-10 flex shrink-0 items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <OctoAvatar mood={assistantMood} size="sm" aura />
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.01em] text-white">聊聊你想要的</p>
            <p className="text-[11.5px] italic text-white/55" style={{ fontFamily: '"Instrument Serif", serif' }}>
              不用想好——说就行
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onSwitchToCall ? (
            <button
              type="button"
              onClick={onSwitchToCall}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 bg-white/12 px-3.5 text-[12px] font-medium text-white/90 backdrop-blur-md transition-colors hover:bg-white/22"
              aria-label="切换为通话"
            >
              <Phone size={14} strokeWidth={1.8} />
              打电话聊
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-white/12 text-white/90 backdrop-blur-md transition-colors hover:bg-white/22"
            aria-label="关闭"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
      </header>

      {/* ─── 已保存的画像/目标 顶部记忆卡 ─────────────────────── */}
      {(() => {
        const bio = learnerProfile?.bio;
        const goals = learnerProfile?.goals ?? [];
        if (!bio?.headline && goals.length === 0) return null;
        const showBio = Boolean(bio?.headline);
        return (
          <div className="relative z-10 px-4 sm:px-6">
            <div className="mx-auto w-full max-w-2xl">
              <div className="flex items-start gap-2 rounded-2xl border border-white/15 bg-black/35 px-4 py-3 backdrop-blur-md">
                <Sparkles size={14} strokeWidth={1.8} className="mt-0.5 text-pine/85" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-white/55">
                    {showBio ? '我了解到的你' : '我想要的'}
                  </p>
                  <p className="mt-0.5 truncate text-[14px] leading-6 text-white/95">
                    {showBio ? bio?.headline : goals[0]?.title}
                    {showBio && goals.length > 0 ? (
                      <span className="ml-2 text-[12px] text-white/45">
                        · 已记下 {goals.length} 件想做的事
                      </span>
                    ) : null}
                    {!showBio && goals.length > 1 ? (
                      <span className="ml-2 text-[12px] text-white/45">
                        还有 {goals.length - 1} 件
                      </span>
                    ) : null}
                  </p>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── 消息区（透明，让背景透出） ──────────────────────────────── */}
      <ChatMessageList
        watchKey={messages.length + (busy ? 1 : 0)}
        showEmpty={messages.length === 0}
        emptyState={
          <div
            className="flex flex-col items-center pt-12 text-center"
            style={{ animation: 'intentFadeUp 0.5s ease-out 0.1s both' }}
          >
            <OctoAvatar mood="listening" size="xl" aura />
            <p
              className="mt-6 px-6 text-[18px] leading-[1.7] text-white/95"
              style={{ fontFamily: '"Instrument Serif", "Inter", serif' }}
            >
              {greeting.headline}
            </p>
            <p className="mt-3 px-6 text-[14px] leading-6 text-white/70">{greeting.hint}</p>
            {/* 3 个开局选项 chips —— 点击直接发送，让用户不用从"什么都不会"开始 */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 px-6">
              {greeting.options.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => sendMessage({ text: opt })}
                  disabled={busy}
                  className="inline-flex h-9 items-center rounded-full border border-white/25 bg-white/10 px-4 text-[13.5px] text-white/90 backdrop-blur-md transition-all hover:bg-white/20 hover:border-white/35 hover:-translate-y-[1px] disabled:opacity-50"
                >
                  {opt}
                </button>
              ))}
            </div>
            <p className="mt-5 px-6 text-[12px] text-white/45">挑一个开口，也可以直接打字告诉我。</p>
          </div>
        }
        variant="glass"
        contentMaxWidth="max-w-2xl"
        className="relative z-10"
      >
        {messages.map((message: UIMessage, idx) => {
          const text = collectMessageText(message);
          const role = message.role;
          const isLast = idx === messages.length - 1;
          const isStreaming = busy && isLast && role === 'assistant';
          if (role === 'user') {
            return (
              <ChatBubble
                key={message.id}
                role="user"
                variant="glass"
                messageId={message.id}
                className="animate-in fade-in slide-in-from-bottom-1 duration-200"
              >
                {text}
              </ChatBubble>
            );
          }
          if (role === 'assistant') {
            // 同一条 AI 消息可能包含 bio 块、summary 块、或两者都有。
            // 先抽 bio，再在剩余文本上抽 summary（顺序无所谓，块互不相交）。
            const bio = extractIntentBio(text);
            const afterBio = bio ? bio.textWithoutBlock : text;
            const extracted = extractIntentSummary(afterBio);
            const visibleText = extracted ? extracted.textWithoutBlock : afterBio;

            const dismissed = dismissedSummaryIds[message.id];
            const saved = savedSummaryIds[message.id];
            const bioDismissed = dismissedBioIds[message.id];
            const bioSaved = savedBioIds[message.id];

            // 卡片堆叠：bio 在上、goal 在下（首次会面流程：先认识你 → 才记你想做的事）
            const footers: React.ReactNode[] = [];
            if (bio && !bioDismissed) {
              footers.push(
                <IntentBioCard
                  key="bio"
                  points={bio.points}
                  saved={bioSaved}
                  onDismiss={() =>
                    setDismissedBioIds((prev) => ({ ...prev, [message.id]: true }))
                  }
                  onAccept={(p) => handleAcceptBio(message.id, p)}
                />,
              );
            }
            if (extracted && !dismissed) {
              footers.push(
                <IntentSummaryCard
                  key="summary"
                  points={extracted.points}
                  saved={saved}
                  onDismiss={() =>
                    setDismissedSummaryIds((prev) => ({ ...prev, [message.id]: true }))
                  }
                  onAccept={(p) => handleAcceptSummary(message.id, p)}
                />,
              );
            }
            const summaryFooter =
              footers.length > 0 ? (
                <div className="flex flex-col gap-3">{footers}</div>
              ) : null;

            // 文本为空时直接吃掉气泡（流式刚启动 / 全部内容都被 marker 吃掉）
            if (!visibleText.trim() && !summaryFooter) {
              return null;
            }

            return (
              <ChatBubble
                key={message.id}
                role="assistant"
                variant="glass"
                messageId={message.id}
                avatar={
                  <OctoAvatar
                    mood={isStreaming ? 'happy' : 'idle'}
                    size="sm"
                    aura={isStreaming}
                  />
                }
                footer={summaryFooter}
                className="animate-in fade-in slide-in-from-bottom-1 duration-200"
              >
                {visibleText.trim() ? (
                  <ChatRenderer
                    content={visibleText}
                    isStreaming={isStreaming}
                    messageId={message.id}
                  />
                ) : null}
              </ChatBubble>
            );
          }
          return null;
        })}

        {showThinkingBubble ? (
          <ChatThinkingStripBubble
            variant="glass"
            avatar={<OctoAvatar mood="thinking" size="sm" aura />}
            label={
              <span style={{ fontFamily: '"Instrument Serif", serif' }}>同学在想…</span>
            }
          />
        ) : null}
      </ChatMessageList>

      {/* ─── 底部输入条（glass） ────────────────────────────────────── */}
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
        capabilities={{ file: true, call: Boolean(onSwitchToCall) }}
        onCallStart={onSwitchToCall}
        placeholder="说说你最近想做的事 · 也可以拖文件 / 粘截图进来"
        busyPlaceholder="同学在听…"
        variant="glass"
        className="relative z-10"
      />

      {/* 用户想主动沉淀时可以点 */}
      {messages.length >= 2 && !busy ? (
        <div className="relative z-10 flex justify-center -mt-1 pb-1.5">
          <button
            type="button"
            onClick={() => sendMessage({ text: '帮我记一下' })}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/8 px-4 py-2 text-[12px] font-medium text-white/70 backdrop-blur-md transition-all hover:bg-white/16 hover:text-white/90 active:scale-95"
          >
            <Sparkles size={12} strokeWidth={2} />
            帮我记一下
          </button>
        </div>
      ) : null}

      {/* ─── 跳过链接（首次注册场景） ──────────────────────────────── */}
      {onSkip ? (
        <div className="relative z-10 mb-2 flex justify-center pb-2">
          <button
            type="button"
            onClick={onSkip}
            className="text-[12px] text-white/55 transition-colors hover:text-white/80 hover:underline"
          >
            先不聊，下次再说
          </button>
        </div>
      ) : null}

      {/* keyframes */}
      <style jsx>{`
        @keyframes octoBreathe {
          0%, 100% { transform: scale(1) translateY(0); opacity: 0.36; }
          50% { transform: scale(1.04) translateY(-8px); opacity: 0.42; }
        }
        @keyframes intentFadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default IntentDialog;
