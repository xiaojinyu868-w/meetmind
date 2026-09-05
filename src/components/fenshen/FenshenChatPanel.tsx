'use client';

/**
 * FenshenChatPanel — 分身对话面板。
 *
 * 渲染层用 copy-in 的 AI Elements（Conversation / Message / MessageResponse /
 * Loader），数据由 useFenshenSession（SSE 状态机）喂——Elements 是纯展示层，
 * 与传输协议无关。
 * 自有产品组件：
 * - 试听条：就绪且还没说过话时给一句试听建议（点击即作为用户消息发出）
 * - 「像 / 不像他」反馈条：POST feedback；unlike 带 note 触发重蒸馏，
 *   分身状态回 learning（契约：修订落盘后再发 ego-ready）
 * - 打断：streaming 中发送 = interrupt 附带消息；「打住」= 纯打断
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, SendHorizonal, Square } from 'lucide-react';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { Loader } from '@/components/ai-elements/loader';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/ui/copy';
import { DistillProgressView } from './DistillProgressView';
import type {
  FenshenEgoDto,
  FenshenEgoStatus,
  FenshenLessonSnapshot,
} from './fenshen-events';
import { useFenshenSession } from './useFenshenSession';

interface FenshenChatPanelProps {
  ego: FenshenEgoDto;
  onBack: () => void;
  /** 当前复习页课程会话：分身按这节课物化上下文（哪节课打开就听哪节课） */
  sessionId?: string;
  /** 这节课的标题：头部常驻 chip 明示分身正在读哪节课 */
  lessonTitle?: string;
  /** 这节课的前端快照（guest/demo 未持久化到服务端 DB 时的上下文兜底） */
  lessonSnapshot?: FenshenLessonSnapshot;
}

type FeedbackState = 'idle' | 'editing-unlike' | 'done';

export function FenshenChatPanel({ ego, onBack, sessionId, lessonTitle, lessonSnapshot }: FenshenChatPanelProps) {
  const session = useFenshenSession();
  const [draft, setDraft] = useState('');
  // unlike 反馈后契约上状态回 learning；等 ego-ready 再翻回（hook ready 为准）
  const [forcedLearning, setForcedLearning] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState>('idle');
  const [unlikeNote, setUnlikeNote] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void session.open(ego.id);
    return () => session.close();
    // 父层以 key={ego.id} 挂载，ego.id 变化即整体重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ego.id]);

  useEffect(() => {
    if (session.ready) setForcedLearning(false);
  }, [session.ready]);

  const status: FenshenEgoStatus = session.ready ? 'ready' : forcedLearning ? 'learning' : ego.status;
  const chatReady = status === 'ready';
  const hasUserMessage = session.messages.some((message) => message.role === 'user');
  const hasAssistantMessage = session.messages.some((message) => message.role === 'assistant');
  const last = session.messages[session.messages.length - 1];
  const waitingReply = session.streaming && last?.role === 'user';

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !chatReady) return;
      setDraft('');
      await session.send(trimmed, sessionId ? { sessionId, lessonSnapshot } : {});
    },
    [chatReady, session, sessionId, lessonSnapshot],
  );

  const handleFeedback = useCallback(
    async (verdict: 'like' | 'unlike', note?: string) => {
      if (feedbackSubmitting) return;
      setFeedbackSubmitting(true);
      const ok = await session.sendFeedback(verdict, note);
      setFeedbackSubmitting(false);
      if (!ok) return;
      if (verdict === 'like') {
        setFeedback('done');
      } else {
        setForcedLearning(true);
        setFeedback('done');
      }
    },
    [feedbackSubmitting, session],
  );

  const statusBadge =
    status === 'ready' ? (
      <Badge variant="pine" dot>{COPY.fenshen.statusReady}</Badge>
    ) : status === 'failed' ? (
      <Badge variant="vermilion">{COPY.fenshen.statusFailed}</Badge>
    ) : (
      <Badge variant="mute" dot>{COPY.fenshen.statusLearning}</Badge>
    );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* 头部：返回 + 名字 + 状态 */}
      <div className="flex items-center gap-2 border-b border-divider px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          <ChevronLeft size={14} aria-hidden />
          {COPY.fenshen.back}
        </button>
        <h3 className="flex-1 truncate text-center text-[14px] font-medium text-ink">{ego.name}</h3>
        {statusBadge}
      </div>

      {/* 常驻课名 chip：分身「正在读哪节课」从产品上显式在场（上下文本是隐式的） */}
      {lessonTitle ? (
        <div className="border-b border-divider bg-pine-fog/60 px-4 py-1.5 text-center text-[11px] text-ink-secondary">
          {COPY.fenshen.chatLessonChip(lessonTitle)}
        </div>
      ) : null}

      {/* 账本式进度（可折叠，默认收起） */}
      {session.progress.length > 0 ? (
        <div className="border-b border-divider px-4 pt-3">
          <DistillProgressView entries={session.progress} done={session.ready} />
        </div>
      ) : null}

      {session.error ? (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-lg bg-vermilion-mist px-3 py-2 text-[12px] text-vermilion">
          <span>{session.error}</span>
          <button type="button" onClick={session.clearError} className="shrink-0 underline">
            {COPY.fenshen.close}
          </button>
        </div>
      ) : null}

      {/* 对话区（AI Elements Conversation：贴底滚动） */}
      <Conversation className="bg-paper">
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {session.messages.length === 0 ? (
            <ConversationEmptyState
              title={chatReady ? COPY.fenshen.chatEmptyReady(ego.name) : COPY.fenshen.chatEmptyLearning(ego.name)}
            />
          ) : (
            session.messages.map((message) => (
              <Message key={message.id} from={message.role}>
                <MessageContent>
                  {message.role === 'assistant' ? (
                    <MessageResponse>{message.text}</MessageResponse>
                  ) : (
                    message.text
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {waitingReply ? (
            <div className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Loader size={14} />
              {COPY.fenshen.speaking}
            </div>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* 试听条：就绪且未开聊时一句安静建议 */}
      {chatReady && !hasUserMessage ? (
        <div className="border-t border-divider bg-card px-4 py-2">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-[12px] text-ink-muted">
            <span>{COPY.fenshen.listenHint}</span>
            <button
              type="button"
              onClick={() => void handleSend(COPY.fenshen.listenSuggestion)}
              className="shrink-0 rounded-full border border-pine/40 px-2.5 py-1 text-pine transition-colors hover:bg-pine-mist"
            >
              {COPY.fenshen.listenSuggestion}
            </button>
          </div>
        </div>
      ) : null}

      {/* 「像 / 不像他」反馈条：就绪且分身说过话后出现 */}
      {chatReady && hasAssistantMessage && feedback !== 'done' ? (
        <div className="border-t border-divider bg-card px-4 py-2">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2">
            <div className="flex items-center gap-2 text-[12px]">
              <span className="text-ink-muted">{COPY.fenshen.feedbackPrompt}</span>
              <button
                type="button"
                disabled={feedbackSubmitting}
                onClick={() => void handleFeedback('like')}
                className="rounded-full border border-pine/40 px-2.5 py-1 text-pine transition-colors hover:bg-pine-mist disabled:opacity-50"
              >
                {COPY.fenshen.feedbackLike}
              </button>
              {feedback === 'idle' ? (
                <button
                  type="button"
                  onClick={() => setFeedback('editing-unlike')}
                  className="rounded-full border border-vermilion/40 px-2.5 py-1 text-vermilion transition-colors hover:bg-vermilion-mist"
                >
                  {COPY.fenshen.feedbackUnlike}
                </button>
              ) : null}
            </div>
            {feedback === 'editing-unlike' ? (
              <div className="flex items-center gap-2">
                <input
                  value={unlikeNote}
                  onChange={(event) => setUnlikeNote(event.target.value)}
                  placeholder={COPY.fenshen.feedbackUnlikeNotePlaceholder}
                  maxLength={200}
                  className="flex-1 rounded-lg border border-divider bg-paper px-3 py-1.5 text-[12px] text-ink outline-none focus:border-vermilion/50"
                />
                <Button
                  size="sm"
                  variant="vermilion"
                  loading={feedbackSubmitting}
                  onClick={() => void handleFeedback('unlike', unlikeNote.trim() || undefined)}
                >
                  {COPY.fenshen.feedbackUnlikeSubmit}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {feedback === 'done' ? (
        <div className="border-t border-divider bg-card px-4 py-2">
          <p className="mx-auto w-full max-w-2xl text-[12px] text-ink-muted">
            {forcedLearning ? COPY.fenshen.feedbackRelearning : COPY.fenshen.feedbackThanks}
          </p>
        </div>
      ) : null}

      {/* 输入条：streaming 中发送 = 打断续讲；「打住」= 纯打断 */}
      <div className="border-t border-divider bg-card px-4 py-3">
        <form
          className="mx-auto flex w-full max-w-2xl items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSend(draft);
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={chatReady ? COPY.fenshen.chatPlaceholder(ego.name) : COPY.fenshen.chatPlaceholderLearning}
            disabled={!chatReady}
            maxLength={2000}
            className="flex-1 rounded-full border border-divider bg-paper px-4 py-2 text-[13px] text-ink outline-none transition-colors focus:border-pine/50 disabled:opacity-50"
          />
          {session.streaming ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={COPY.fenshen.interrupt}
              title={COPY.fenshen.interrupt}
              onClick={() => void session.interrupt()}
            >
              <Square size={14} />
            </Button>
          ) : null}
          <Button
            type="submit"
            size="icon"
            variant="pine"
            disabled={!chatReady || !draft.trim()}
            aria-label={COPY.fenshen.submit}
          >
            <SendHorizonal size={14} />
          </Button>
        </form>
      </div>
    </div>
  );
}
