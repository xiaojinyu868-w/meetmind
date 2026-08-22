'use client';

/**
 * /teach — v32 AI 家教 demo 页：左备课本画布 + 右 Agent 对话栏 + ChatGPT 式历史。
 *
 * 数据流：teach-client（mock 事件流，后端就绪切一行 flag）→ useTeachSession
 * → TeachBoard（BoardCanvas v32 备课本）/ TeachChatPanel（Chat 底座）。
 * 划线引用提问：画布选中文本 → QuoteAskPopover → 引用块进输入框 → quote 随消息发出。
 *
 * DEMO：?pace=12 加速 mock 流（截图/录屏用）；?mock=0 走真实后端路由。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, Volume2, VolumeX, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { flattenPage } from '@/components/apps/windows/blackboard/board-lecture';
import { teachDefaultTopic, isMockMode } from '@/components/teach/teach-client';
import { teachListThreads } from '@/components/teach/teach-client';
import { removeTeachThread } from '@/components/teach/teach-store';
import type { TeachThreadMeta } from '@/components/teach/teach-store';
import type { MockPace } from '@/components/teach/mockTeachStream';
import { useTeachSession } from '@/components/teach/useTeachSession';
import { TeachBoard } from '@/components/teach/TeachBoard';
import { TeachChatPanel } from '@/components/teach/TeachChatPanel';
import { TeachThreadList } from '@/components/teach/TeachThreadList';

export default function TeachPage() {
  const session = useTeachSession();
  const [threads, setThreads] = useState<TeachThreadMeta[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [quote, setQuote] = useState<string | null>(null);
  // 开课前置：先问学生想学什么（v33 修复——之前新开一课直接拿默认课题开课，
  // 学生想换课题只能中途打断，agent 还带着旧课题的上下文）
  const [topicPromptOpen, setTopicPromptOpen] = useState(false);
  const [topicDraft, setTopicDraft] = useState('');
  // live：本次挂载有过真实流（开课/发问）→ 之后的书写走动画；否则是历史恢复终态直出
  const [live, setLive] = useState(false);

  // ?pace=12：mock text-delta 间隔 ms（截图/录屏加速用）；?topic=：新开一课的课题
  const pace = useMemo<MockPace | undefined>(() => {
    if (typeof window === 'undefined') return undefined;
    const raw = new URLSearchParams(window.location.search).get('pace');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 200 ? { deltaMs: parsed } : undefined;
  }, []);
  const topic = useMemo(() => {
    if (typeof window === 'undefined') return teachDefaultTopic();
    const raw = new URLSearchParams(window.location.search).get('topic')?.trim();
    return raw ? raw.slice(0, 100) : teachDefaultTopic();
  }, []);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await teachListThreads());
    } catch {
      setThreads([]);
    }
  }, []);

  const startNewLesson = useCallback(async (chosenTopic?: string) => {
    session.unlockAudio(); // 点击手势内激活语音
    setQuote(null);
    setLive(true);
    setDrawerOpen(false);
    setTopicPromptOpen(false);
    await session.newLesson(chosenTopic?.trim() || topic, pace);
    void refreshThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pace, topic, refreshThreads]);

  const openThread = useCallback(
    async (meta: TeachThreadMeta) => {
      setQuote(null);
      setLive(false);
      setDrawerOpen(false);
      await session.openThread(meta, pace);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pace],
  );

  // 首屏：有历史开最近一课，没有直接开新课改（initRef：StrictMode 双跑只执行一次）
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    // 静音偏好恢复
    try {
      if (window.localStorage.getItem('teach:v1:muted') === '1') session.setMuted(true);
    } catch {
      /* 隐私模式忽略 */
    }
    void (async () => {
      let list: TeachThreadMeta[] = [];
      try {
        list = await teachListThreads();
      } catch {
        list = [];
      }
      setThreads(list);
      if (list.length > 0) {
        await session.openThread(list[0], pace);
      } else {
        // 首次进入：不擅自拿默认课题开课，先问学生想学什么
        setTopicPromptOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemove = useCallback(
    (id: string) => {
      if (isMockMode()) removeTeachThread(id);
      void (async () => {
        await refreshThreads();
        if (id === session.threadId) {
          const rest = await teachListThreads();
          if (rest.length > 0) await openThread(rest[0]);
          else {
            setTopicDraft('');
            setTopicPromptOpen(true);
          }
        }
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshThreads, session.threadId, openThread, startNewLesson],
  );

  const page = session.pages[Math.min(session.pageIndex, session.pages.length - 1)];
  const hasActions = flattenPage(page).length > 0;
  const preparing = session.streaming && !hasActions && session.messages.length === 0;

  const threadList = (
    <TeachThreadList
      threads={threads}
      activeId={session.threadId}
      onSelect={(meta) => void openThread(meta)}
      onNew={() => {
        setTopicDraft('');
        setTopicPromptOpen(true);
      }}
      onRemove={handleRemove}
    />
  );

  return (
    <div className="flex h-screen flex-col bg-paper-warm">
      {/* 顶部：课程标题 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-divider-light bg-paper px-4 py-2.5">
        <button
          type="button"
          className="rounded-lg p-1.5 text-ink-secondary hover:bg-paper-warm lg:hidden"
          onClick={() => setDrawerOpen(true)}
          aria-label={COPY.apps.teach.history}
        >
          <Menu size={16} strokeWidth={1.8} />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">
          {session.title || COPY.apps.teach.appName}
        </h1>
        {session.streaming ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pine" />
            讲课中
          </span>
        ) : null}
        {/* 讲课声音开关（静音偏好持久化 localStorage） */}
        <button
          type="button"
          onClick={() => {
            const next = !session.muted;
            session.setMuted(next);
            try {
              window.localStorage.setItem('teach:v1:muted', next ? '1' : '0');
            } catch {
              /* 隐私模式忽略 */
            }
          }}
          className="rounded-lg p-1.5 text-ink-secondary transition-colors hover:bg-paper-warm"
          aria-label={session.muted ? COPY.apps.teach.soundOff : COPY.apps.teach.soundOn}
          title={session.muted ? COPY.apps.teach.soundOff : COPY.apps.teach.soundOn}
        >
          {session.muted ? (
            <VolumeX size={16} strokeWidth={1.8} />
          ) : (
            <Volume2 size={16} strokeWidth={1.8} className={session.speaking ? 'text-pine' : undefined} />
          )}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 历史列表：桌面固定左栏，移动抽屉 */}
        <aside className="hidden w-56 shrink-0 border-r border-divider-light lg:block">{threadList}</aside>
        {drawerOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-64 shadow-card">
              <div className="flex items-center justify-end bg-paper px-2 py-1.5">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-ink-secondary hover:bg-paper-warm"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="关闭"
                >
                  <X size={14} strokeWidth={1.8} />
                </button>
              </div>
              <div className="h-[calc(100%-40px)]">{threadList}</div>
            </div>
          </div>
        ) : null}

        {/* 左：备课本画布 */}
        <main className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="mx-auto max-w-[980px]">
            <TeachBoard
              page={page}
              pageIndex={session.pageIndex}
              instant={!live}
              preparing={preparing}
              onQuote={(text) => setQuote(text)}
              writePaceScale={0.3}
            />
            {session.error ? (
              <p className="mt-2 text-[13px] text-vermilion">流中断：{session.error}</p>
            ) : null}
          </div>
        </main>

        {/* 右：Agent 对话栏 */}
        <section className="flex h-[46vh] shrink-0 flex-col border-t border-divider-light lg:h-auto lg:w-[380px] lg:border-l lg:border-t-0">
          <TeachChatPanel
            threadId={session.threadId}
            messages={session.messages}
            streaming={session.streaming}
            quote={quote}
            onQuoteChange={setQuote}
            onSend={(text, quoteText) => {
              session.unlockAudio(); // 发送手势内激活语音
              setLive(true);
              void session.send(text, quoteText);
            }}
          />
        </section>
      </div>

      {/* 开课前置：先问学生想学什么（点击手势内创建，音频激活随之完成） */}
      {topicPromptOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setTopicPromptOpen(false)}
            aria-hidden="true"
          />
          <form
            className="relative w-[min(420px,90vw)] rounded-2xl border border-divider-light bg-paper p-5 shadow-card"
            onSubmit={(event) => {
              event.preventDefault();
              void startNewLesson(topicDraft);
            }}
          >
            <h2 className="text-[15px] font-medium text-ink">{COPY.apps.teach.topicPromptTitle}</h2>
            <input
              autoFocus
              value={topicDraft}
              onChange={(event) => setTopicDraft(event.target.value)}
              placeholder={COPY.apps.teach.topicPromptPlaceholder}
              maxLength={100}
              className="mt-3 w-full rounded-lg border border-divider bg-paper-warm px-3 py-2 text-[14px] text-ink outline-none placeholder:text-ink-muted focus:border-pine/50"
            />
            <div className="mt-4 flex justify-end">
              <button
                type="submit"
                disabled={!topicDraft.trim()}
                className="rounded-lg bg-pine px-4 py-1.5 text-[13px] text-white transition-opacity disabled:opacity-40"
              >
                {COPY.apps.teach.topicPromptStart}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
