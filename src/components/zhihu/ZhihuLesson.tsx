'use client';

/**
 * /apps/zhihu/lesson/[threadId] —— 收藏夹开出来的那节课。
 *
 * 舞台原样复用 teach-live 的 LiveStage（板 + 声音 + 随时插话）。本页只做三件事：
 * 1. 进来先打开线程；事件日志还是空的（刚从收藏夹开出来）就替学生说一句「开始上课」，老师开讲
 * 2. 右侧一条可收起的材料栏：同学读了哪几篇、正文状态、原文链接（有根，随手可查）；「考一考」去课后页
 * 3. 老师讲完一轮那一刻，右下长出一张小卡：「讲完这一段了。考一考？」——机器 act，不让学生去找按钮；「继续听」收起
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import 'katex/dist/katex.min.css';
import '@/components/teach-live/teach-live.css';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import { LiveStage } from '@/components/teach-live/LiveStage';
import { useLiveLesson } from '@/components/teach-live/useLiveLesson';
import { liveFetchEvents, livePostMessage } from '@/components/teach-live/live-client';
import { useZhihuLesson } from './useZhihuLesson';
import { MaterialsList } from './ZhihuLessonPanels';

const START_MESSAGE = '开始上课';

export function ZhihuLesson({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, isCheckingAuth } = useAuth();
  const lesson = useLiveLesson();
  const zhihu = useZhihuLesson(threadId);
  const [live, setLive] = React.useState(true);
  const [bootError, setBootError] = React.useState<string | null>(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const [nextStep, setNextStep] = React.useState<'hidden' | 'shown' | 'dismissed'>('hidden');
  const bootRef = React.useRef(false);
  const wasGenerating = React.useRef(false);
  const rounds = React.useRef(0);
  const reviewHref = `/apps/zhihu/lesson/${encodeURIComponent(threadId)}/review`;

  // 打开这节课；日志为空就替学生说「开始上课」
  React.useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    (async () => {
      try {
        const { events } = await liveFetchEvents(threadId);
        const fresh = events.length === 0;
        setLive(fresh);
        await lesson.openLesson(threadId, 'resume');
        if (fresh) await livePostMessage(threadId, START_MESSAGE);
      } catch {
        setBootError(C.errors.unknown);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // 讲完一轮：generating 从 true 落到 false → 长出「考一考」小卡（每轮讲完再出现一次，除非学生已经去过课后页）
  React.useEffect(() => {
    const generating = Boolean(lesson.state.generating);
    if (generating) {
      setLive(true);
      wasGenerating.current = true;
      return;
    }
    if (wasGenerating.current) {
      wasGenerating.current = false;
      rounds.current += 1;
      setNextStep((s) => (s === 'dismissed' && rounds.current < 3 ? s : 'shown'));
    }
  }, [lesson.state.generating]);

  const leave = React.useCallback(() => {
    lesson.leaveLesson();
    router.push('/apps/zhihu');
  }, [lesson, router]);

  if (!isLoading && !isCheckingAuth && !isAuthenticated) {
    return (
      <main className="min-h-screen bg-paper px-6 py-16 text-ink">
        <p className="text-[15px]">{C.loginFirst}</p>
        <a className="mt-4 inline-block text-pine underline-offset-4 hover:underline" href={`/login?next=${encodeURIComponent(`/apps/zhihu/lesson/${threadId}`)}`}>{C.loginOther}</a>
      </main>
    );
  }

  return (
    <>
      {lesson.state.threadId ? (
        <LiveStage lesson={lesson} live={live} onLeave={leave} />
      ) : (
        <main className="fixed inset-0 grid place-items-center bg-paper text-[14px] text-ink-secondary">{bootError ?? zhihu.packError ?? C.loading}</main>
      )}

      {/* 材料栏开关：舞台顶栏之下、板面右上空白处 */}
      {!railOpen && lesson.state.threadId && (
        <button
          type="button"
          onClick={() => setRailOpen(true)}
          className="fixed right-6 top-20 z-[70] rounded-full border border-divider bg-card/90 px-4 py-2 text-[13px] text-ink shadow-sm backdrop-blur hover:bg-paper-warm"
        >
          {C.railToggle}
        </button>
      )}

      {/* 讲完一轮：下一步 */}
      {nextStep === 'shown' && lesson.state.threadId && (
        <div className="fixed bottom-28 right-6 z-[65] w-[300px] rounded-2xl border border-divider bg-card/95 p-4 text-ink shadow-lg backdrop-blur">
          <p className="text-[14px] font-medium">{C.nextStepTitle}</p>
          <p className="mt-1 text-[13px] leading-6 text-ink-secondary">{C.nextStepBody}</p>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className="rounded-full bg-pine px-4 py-1.5 text-[13px] text-white hover:bg-pine-deep" onClick={() => router.push(reviewHref)}>
              {C.nextStepQuiz}
            </button>
            <button type="button" className="text-[13px] text-ink-secondary hover:text-ink" onClick={() => setNextStep('dismissed')}>
              {C.nextStepListen}
            </button>
          </div>
        </div>
      )}

      {railOpen && (
        <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[420px] flex-col border-l border-divider bg-paper text-ink shadow-xl">
          <header className="flex items-center gap-3 border-b border-divider px-4 py-3">
            <span className="text-[14px] font-medium">{C.tabMaterials}</span>
            <span className="flex-1" />
            <button type="button" className="rounded-full bg-pine px-3.5 py-1 text-[13px] text-white hover:bg-pine-deep" onClick={() => router.push(reviewHref)}>
              {C.tabQuiz} →
            </button>
            <button type="button" onClick={() => setRailOpen(false)} className="rounded-full px-3 py-1 text-[13px] text-ink-secondary hover:bg-paper-warm">
              {C.railCollapse}
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {zhihu.pack ? <MaterialsList pack={zhihu.pack} compact /> : <p className="text-[13px] text-ink-muted">{zhihu.packError ?? C.loading}</p>}
          </div>
        </aside>
      )}
    </>
  );
}
