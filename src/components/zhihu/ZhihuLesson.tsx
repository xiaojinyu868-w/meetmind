'use client';

/**
 * /apps/zhihu/lesson/[threadId] —— 收藏夹开出来的那节课。
 *
 * 舞台原样复用 teach-live 的 LiveStage（板 + 声音 + 随时插话），本页只做三件事：
 * 1. 进来先打开线程；事件日志还是空的（刚从收藏夹开出来）就替学生说一句「开始上课」，老师开讲
 * 2. 右侧一条可收起的栏：材料（同学读了哪几篇、正文状态、原文链接）/ 考一考（测验 / 闪卡，
 *    材料包变伪转录喂既有应用矩阵；「回到原话」= 打开知乎原文）/ 继续看（考完哪没稳 → 知乎上讲得最清楚的几条）
 * 3. 交卷 / 打完分 → assessment 进学习记忆（与应用矛阵同一条 /api/memory/events）
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
import { QuizWindow } from '@/components/apps/windows/QuizWindow';
import { FlashcardsWindow } from '@/components/apps/windows/FlashcardsWindow';
import { buildLocalLearnerContext } from '@/components/learner-context-local';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { LiveMaterialPack } from '@/lib/services/teach-live/live-materials';
import type { ContinueReadingGroup } from '@/lib/services/zhihu/zhihu-discovery-service';
import type { LearningAssessmentDraft, LearningEventInput } from '@/types/learning-event';
import { executeApp, fetchContinueReading, fetchLessonPack, ZhihuClientError } from './zhihu-api-client';
import { buildExecutePayload, materialsToTranscript, sourceForTime, weakConceptsFromAssessment, type ZhihuLessonAppKey } from './zhihu-lesson-model';

const START_MESSAGE = '开始上课';
type Tab = 'materials' | 'quiz' | 'continue';

interface AppRun {
  status: 'idle' | 'running' | 'done' | 'error';
  result: AppExecutionResult | null;
  updatedAt: number;
  error?: string;
}

const idleRun: AppRun = { status: 'idle', result: null, updatedAt: 0 };

export function ZhihuLesson({ threadId }: { threadId: string }) {
  const router = useRouter();
  const { accessToken, isAuthenticated, isLoading } = useAuth();
  const lesson = useLiveLesson();
  const [live, setLive] = React.useState(true);
  const [pack, setPack] = React.useState<LiveMaterialPack | null>(null);
  const [packError, setPackError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>('materials');
  const [runs, setRuns] = React.useState<Record<ZhihuLessonAppKey, AppRun>>({ quiz: idleRun, flashcards: idleRun });
  const [weak, setWeak] = React.useState<string[] | null>(null);
  const [groups, setGroups] = React.useState<ContinueReadingGroup[] | null>(null);
  const [continueBusy, setContinueBusy] = React.useState(false);
  const bootRef = React.useRef(false);

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
        setPackError(C.errors.unknown);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  React.useEffect(() => {
    if (lesson.state.generating) setLive(true);
  }, [lesson.state.generating]);

  // 材料包
  React.useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    fetchLessonPack(accessToken, threadId)
      .then((data) => {
        if (!cancelled) setPack(data.pack);
      })
      .catch((error: unknown) => {
        if (!cancelled) setPackError(error instanceof ZhihuClientError ? error.message : C.errors.unknown);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, threadId]);

  const materials = React.useMemo(() => (pack ? materialsToTranscript(pack) : null), [pack]);

  const onSeek = React.useCallback(
    (startMs: number) => {
      const span = materials ? sourceForTime(materials.spans, startMs) : null;
      if (span?.url) window.open(span.url, '_blank', 'noopener');
    },
    [materials],
  );

  const run = React.useCallback(
    async (appKey: ZhihuLessonAppKey) => {
      if (!pack || !materials) return;
      setRuns((r) => ({ ...r, [appKey]: { status: 'running', result: null, updatedAt: Date.now() } }));
      const sessionId = `zhihu-lesson:${threadId}`;
      let learner: unknown;
      try {
        learner = buildLocalLearnerContext({ appId: appKey, sessionId });
      } catch {
        learner = undefined;
      }
      const payload = buildExecutePayload({ appKey, threadId, pack, transcript: materials.transcript, learner });
      const outcome = await executeApp(accessToken, payload);
      setRuns((r) => ({
        ...r,
        [appKey]: outcome.ok
          ? { status: 'done', result: outcome.result, updatedAt: Date.now() }
          : { status: 'error', result: null, updatedAt: Date.now(), error: outcome.error === 'CONTENT_NOT_READY' ? C.notReady : C.quizFailed },
      }));
    },
    [accessToken, materials, pack, threadId],
  );

  const recordAssessment = React.useCallback(
    (appKey: ZhihuLessonAppKey, draft: LearningAssessmentDraft) => {
      const sessionId = `zhihu-lesson:${threadId}`;
      if (accessToken && draft.items.length) {
        const body: LearningEventInput = {
          appId: 'apps',
          type: 'assessment',
          payload: { v: 1, appKey: draft.appKey, sessionId, ...(pack ? { lessonTitle: pack.title.slice(0, 120) } : {}), items: draft.items },
          sourceId: `app-result:${sessionId}:${appKey}:${runs[appKey].updatedAt}`,
          idempotencyKey: `app-assessment:${sessionId}:${runs[appKey].updatedAt}:${draft.items.map((i) => `${i.concept}=${i.outcome}`).join('|').slice(0, 400)}`,
        };
        void fetch('/api/memory/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(body),
        }).catch(() => undefined);
      }
      // 哪没稳 → 继续看
      const concepts = weakConceptsFromAssessment(draft);
      setWeak(concepts);
      setTab('continue');
      setOpen(true);
      if (!accessToken || concepts.length === 0) {
        setGroups([]);
        return;
      }
      setContinueBusy(true);
      fetchContinueReading(accessToken, { concepts, threadId })
        .then(setGroups)
        .catch(() => setGroups([]))
        .finally(() => setContinueBusy(false));
    },
    [accessToken, pack, runs, threadId],
  );

  const leave = React.useCallback(() => {
    lesson.leaveLesson();
    router.push('/apps/zhihu');
  }, [lesson, router]);

  if (!isLoading && !isAuthenticated) {
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
        <main className="fixed inset-0 grid place-items-center bg-paper text-[14px] text-ink-secondary">{packError ?? C.loading}</main>
      )}

      {/* 右侧栏开关 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 top-4 z-[70] rounded-full border border-divider bg-card/90 px-4 py-2 text-[13px] text-ink shadow-sm backdrop-blur hover:bg-paper-warm"
      >
        {open ? '收起' : C.railToggle}
      </button>

      {open && (
        <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[440px] flex-col border-l border-divider bg-paper text-ink shadow-xl">
          <header className="flex items-center gap-2 border-b border-divider px-4 pt-14 pb-3">
            {(['materials', 'quiz', 'continue'] as Tab[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-1 text-[13px] ${tab === key ? 'bg-pine text-white' : 'text-ink-secondary hover:bg-paper-warm'}`}
              >
                {key === 'materials' ? C.tabMaterials : key === 'quiz' ? C.tabQuiz : C.tabContinue}
              </button>
            ))}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {tab === 'materials' && (
              <section>
                {!pack && <p className="text-[13px] text-ink-muted">{packError ?? C.loading}</p>}
                {pack && (
                  <>
                    <h2 className="text-[15px] font-medium">{C.materialsTitle(pack.items.length)}</h2>
                    <ol className="mt-3 space-y-3">
                      {pack.items.map((item) => (
                        <li key={item.ref} className="rounded-xl border border-divider bg-card px-4 py-3">
                          <div className="flex items-baseline gap-2 text-[12px] text-ink-muted">
                            <span className="font-mono text-pine">{item.ref}</span>
                            <span>{item.meta}</span>
                            <span>· {item.body === 'full' ? C.materialsFull : C.materialsSummary}</span>
                          </div>
                          <p className="mt-1 text-[14px] font-medium leading-6">{item.title}</p>
                          {item.author && <p className="text-[12px] text-ink-secondary">{item.author}</p>}
                          <a className="mt-2 inline-block text-[12px] text-pine underline-offset-4 hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">
                            {C.openOriginal}
                          </a>
                        </li>
                      ))}
                    </ol>
                    {pack.skipped && pack.skipped.length > 0 && (
                      <p className="mt-4 text-[12px] leading-6 text-ink-muted">
                        {C.materialsSkipped(pack.skipped.length)}：{pack.skipped.map((s) => `${s.title}（${s.reason}）`).join('；')}
                      </p>
                    )}
                  </>
                )}
              </section>
            )}

            {tab === 'quiz' && (
              <section className="space-y-4">
                <p className="text-[13px] leading-6 text-ink-secondary">{C.quizIntro}</p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className="rounded-full bg-pine px-4 py-2 text-[13px] text-white disabled:opacity-50" disabled={!pack || runs.quiz.status === 'running'} onClick={() => run('quiz')}>
                    {runs.quiz.status === 'running' ? C.making : C.makeQuiz}
                  </button>
                  <button type="button" className="rounded-full border border-pine px-4 py-2 text-[13px] text-pine disabled:opacity-50" disabled={!pack || runs.flashcards.status === 'running'} onClick={() => run('flashcards')}>
                    {runs.flashcards.status === 'running' ? C.makingCards : C.makeFlashcards}
                  </button>
                </div>
                {runs.quiz.status === 'error' && <p className="text-[13px] text-cinnabar-deep">{runs.quiz.error}</p>}
                {runs.flashcards.status === 'error' && <p className="text-[13px] text-cinnabar-deep">{runs.flashcards.error}</p>}
                {runs.quiz.result && materials && (
                  <div className="rounded-2xl border border-divider bg-card p-3">
                    <QuizWindow result={runs.quiz.result} transcript={materials.transcript} onSeek={onSeek} onAssessment={(draft) => recordAssessment('quiz', draft)} />
                  </div>
                )}
                {runs.flashcards.result && materials && (
                  <div className="rounded-2xl border border-divider bg-card p-3">
                    <FlashcardsWindow result={runs.flashcards.result} transcript={materials.transcript} sessionId={`zhihu-lesson:${threadId}`} onSeek={onSeek} onAssessment={(draft) => recordAssessment('flashcards', draft)} />
                  </div>
                )}
              </section>
            )}

            {tab === 'continue' && (
              <section className="space-y-4">
                {weak === null && <p className="text-[13px] leading-6 text-ink-secondary">{C.continueIntro}</p>}
                {weak && weak.length === 0 && <p className="text-[13px] leading-6 text-pine-deep">{C.continueAllGood}</p>}
                {weak && weak.length > 0 && <p className="text-[13px] leading-6 text-ink">{C.continueWeak(weak)}</p>}
                {continueBusy && <p className="text-[13px] text-ink-muted">{C.continueLoading}</p>}
                {!continueBusy && weak && weak.length > 0 && groups && groups.length === 0 && <p className="text-[13px] text-ink-muted">{C.continueEmpty}</p>}
                {groups?.map((group) => (
                  <div key={group.concept}>
                    <h3 className="text-[13px] font-medium text-ink-secondary">{group.concept}</h3>
                    <ul className="mt-2 space-y-2">
                      {group.candidates.map((candidate) => (
                        <li key={candidate.url} className="rounded-xl border border-divider bg-card px-4 py-3">
                          <a className="text-[14px] font-medium leading-6 text-ink hover:text-pine" href={candidate.url} target="_blank" rel="noopener noreferrer">
                            {candidate.title}
                          </a>
                          <p className="mt-1 text-[12px] text-ink-muted">{candidate.author}{candidate.author ? ' · ' : ''}{candidate.reason}</p>
                          {candidate.snippet && <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-ink-secondary">{candidate.snippet}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
