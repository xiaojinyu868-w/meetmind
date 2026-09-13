'use client';

/**
 * /apps/zhihu/lesson/[threadId]/review —— 课后：讲完了，考一考。
 *
 * 产品自己的课后原则：左边有根、中间练习、右边接着走。这里左栏是同学读过的材料（每篇一段预览 + 原文），
 * 中栏是测验 / 闪卡（应用矩阵原组件，「回到原话」改成「看这篇材料」），右栏是考完哪没稳、知乎上讲得最清楚的几条。
 * 零提问：进来就开始出题，不让学生先做选择；闪卡是第二个动作。手机上按 练习 → 继续看 → 材料 的顺序竖排。
 */

import * as React from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/hooks/useAuth';
import { ZHIHU_COPY as C } from '@/lib/ui/copy-zhihu';
import { QuizWindow } from '@/components/apps/windows/QuizWindow';
import { FlashcardsWindow } from '@/components/apps/windows/FlashcardsWindow';
import { useZhihuLesson } from './useZhihuLesson';
import { ContinueReadingPanel, MaterialsList } from './ZhihuLessonPanels';
import type { ZhihuLessonAppKey } from './zhihu-lesson-model';

export function ZhihuReview({ threadId }: { threadId: string }) {
  const { isAuthenticated, isLoading, isCheckingAuth } = useAuth();
  const lesson = useZhihuLesson(threadId);
  const [active, setActive] = React.useState<ZhihuLessonAppKey>('quiz');
  const autoRan = React.useRef(false);

  // 进来就出题（一次）
  React.useEffect(() => {
    if (autoRan.current || !lesson.pack || !lesson.materials) return;
    autoRan.current = true;
    void lesson.run('quiz');
  }, [lesson]);

  if (!isLoading && !isCheckingAuth && !isAuthenticated) {
    return (
      <main className="min-h-screen bg-paper px-6 py-16 text-ink">
        <p className="text-[15px]">{C.loginFirst}</p>
        <a className="mt-4 inline-block text-pine underline-offset-4 hover:underline" href={`/login?next=${encodeURIComponent(`/apps/zhihu/lesson/${threadId}/review`)}`}>{C.loginOther}</a>
      </main>
    );
  }

  const run = lesson.runs[active];
  const sessionId = `zhihu-lesson:${threadId}`;

  return (
    <main className="min-h-screen bg-paper px-4 py-6 text-ink sm:px-8">
      <div className="mx-auto max-w-[1280px]">
        <header className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/apps/zhihu/lesson/${encodeURIComponent(threadId)}`} className="text-[13px] text-pine">← {C.reviewBack}</Link>
            <h1 className="mt-2 truncate text-[22px] font-medium leading-tight">{lesson.thread?.title || lesson.pack?.title || C.loading}</h1>
            <p className="mt-1 text-[14px] text-ink-secondary">{C.reviewTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {(['quiz', 'flashcards'] as ZhihuLessonAppKey[]).map((key) => {
              const state = lesson.runs[key].status;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setActive(key);
                    if (lesson.runs[key].status === 'idle' || lesson.runs[key].status === 'error') void lesson.run(key);
                  }}
                  className={`rounded-full px-4 py-1.5 text-[13px] transition ${active === key ? 'bg-pine text-white' : 'border border-divider bg-card text-ink hover:bg-paper-warm'}`}
                >
                  {key === 'quiz' ? (state === 'running' ? C.making : C.makeQuiz) : state === 'running' ? C.makingCards : C.makeFlashcards}
                </button>
              );
            })}
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)_minmax(0,320px)]">
          {/* 左：有根 */}
          <aside className="order-3 lg:order-1 lg:sticky lg:top-6 lg:self-start">
            {lesson.pack ? <MaterialsList pack={lesson.pack} /> : <p className="text-[13px] text-ink-muted">{lesson.packError ?? C.loading}</p>}
          </aside>

          {/* 中：练习 */}
          <section className="order-1 min-w-0 lg:order-2">
            <div className="rounded-2xl border border-divider bg-card p-4 sm:p-6">
              {run.status === 'running' && (
                <p className="py-10 text-center text-[14px] text-ink-secondary">{active === 'quiz' ? C.making : C.makingCards}</p>
              )}
              {run.status === 'error' && (
                <div className="py-10 text-center">
                  <p className="text-[14px] text-cinnabar-deep">{run.error}</p>
                  <button type="button" className="mt-4 rounded-full border border-divider px-4 py-1.5 text-[13px] hover:bg-paper-warm" onClick={() => void lesson.run(active)}>
                    {C.retry}
                  </button>
                </div>
              )}
              {run.status === 'idle' && !lesson.pack && (
                <div className="py-10 text-center">
                  <p className={`text-[14px] ${lesson.packError ? 'text-cinnabar-deep' : 'text-ink-muted'}`}>{lesson.packError ?? C.loading}</p>
                  {lesson.packError && (
                    <button type="button" className="mt-4 rounded-full border border-divider px-4 py-1.5 text-[13px] hover:bg-paper-warm" onClick={lesson.retryPack}>
                      {C.retry}
                    </button>
                  )}
                </div>
              )}
              {run.status === 'done' && run.result && lesson.materials && active === 'quiz' && (
                <QuizWindow
                  result={run.result}
                  transcript={lesson.materials.transcript}
                  onSeek={lesson.openSource}
                  evidenceLabel={lesson.evidenceLabel}
                  onAssessment={(draft) => lesson.recordAssessment('quiz', draft)}
                />
              )}
              {run.status === 'done' && run.result && lesson.materials && active === 'flashcards' && (
                <FlashcardsWindow
                  result={run.result}
                  transcript={lesson.materials.transcript}
                  sessionId={sessionId}
                  onSeek={lesson.openSource}
                  evidenceLabel={lesson.evidenceLabel}
                  onAssessment={(draft) => lesson.recordAssessment('flashcards', draft)}
                />
              )}
            </div>
          </section>

          {/* 右：接着走 */}
          <aside className="order-2 lg:order-3 lg:sticky lg:top-6 lg:self-start">
            <h2 className="text-[15px] font-medium">{C.tabContinue}</h2>
            <div className="mt-3">
              <ContinueReadingPanel weak={lesson.weak} groups={lesson.groups} busy={lesson.continueBusy} exhausted={lesson.continueExhausted} />
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
