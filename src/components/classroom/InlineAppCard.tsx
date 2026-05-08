'use client';

/**
 * InlineAppCard — 把 app 产物（闪卡 / 测验 / 速查表 / 思维导图 / 学习报告）
 * 以紧凑形态嵌进同学对话流里，不再打开 WorkshopWindow。
 *
 * 设计原则（为什么是这样，不是直接 iframe 原 WorkshopWindow）：
 *   1. 空间有限——companion panel 即使 480px 也容不下完整全屏窗口；
 *      这里做专门的"窄版"渲染
 *   2. 节奏感——产物以消息形态冒出来，用户把它当成"同学的下一条话"，
 *      不是"要操作的工具"
 *   3. 闪卡 / 测验本质是对话的延续——答完立刻在对话里给反馈
 *
 * Loading 态：三阶段骨架（复用 AppWindowPlaceholder 的视觉语言，但紧凑）
 * Error 态：一行 error + "再试一次"按钮
 * Ready 态：按 appKey 分派到对应紧凑渲染器
 */

import * as React from 'react';
import { COPY } from '@/lib/ui/copy';

export interface InlineAppCardProps {
  inlineApp: NonNullable<import('./types').CompanionMessage['inlineApp']>;
  /** 用户在内联卡片里操作后的回调。不同 kind 传不同 payload。 */
  onInteraction?: (event: InlineAppInteraction) => void;
  onRetry?: () => void;
}

export type InlineAppInteraction =
  | {
      kind: 'quiz_submit';
      questionId: string;
      /** 题干，用来让同学在对话里引用 */
      stem: string;
      /** 用户选了哪个（字母或文本） */
      picked: string;
      /** 正解（字母或文本，和 payload 保持一致） */
      correctAnswer: string;
      /** 正解完整文本（option 原文） */
      correctText?: string;
      /** 正解解析，用来把同学的"为什么"一次讲透 */
      explanation?: string;
      correct: boolean;
    }
  | { kind: 'quiz_all_done'; correct: number; total: number }
  | {
      kind: 'flashcard_rate';
      cardId: string;
      rating: 'again' | 'hard' | 'good' | 'easy';
      /** 卡片正面——同学拿来复述"这张没记住" */
      front: string;
      /** 卡片背面——作为答案展开 */
      back: string;
    }
  | { kind: 'flashcard_all_done'; reviewed: number };

/* ------------------------------------------------------------------ */
/*  顶层分派                                                            */
/* ------------------------------------------------------------------ */

export function InlineAppCard({ inlineApp, onInteraction, onRetry }: InlineAppCardProps) {
  if (inlineApp.status === 'loading') {
    return <InlineLoading appKey={inlineApp.appKey} />;
  }
  if (inlineApp.status === 'error') {
    return <InlineError error={inlineApp.error} onRetry={onRetry} />;
  }
  switch (inlineApp.appKey) {
    case 'quiz':
      return <InlineQuiz payload={inlineApp.payload} onInteraction={onInteraction} />;
    case 'flashcards':
      return <InlineFlashcards payload={inlineApp.payload} onInteraction={onInteraction} />;
    case 'cheatsheet':
      return <InlineCheatsheet payload={inlineApp.payload} />;
    case 'mindmap':
      return <InlineMindmap payload={inlineApp.payload} />;
    case 'study-report':
      return <InlineStudyReport payload={inlineApp.payload} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Loading：紧凑版三阶段                                               */
/* ------------------------------------------------------------------ */

const STAGE_DURATIONS_MS = [6000, 14000, 20000];
const STAGES = [
  { icon: '📖', label: COPY.stages.reading },
  { icon: '🎯', label: COPY.stages.selecting },
  { icon: '✨', label: COPY.stages.composing },
] as const;

function useStageProgression() {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 600);
    return () => window.clearInterval(timer);
  }, []);
  let acc = 0;
  for (let i = 0; i < STAGE_DURATIONS_MS.length; i++) {
    acc += STAGE_DURATIONS_MS[i];
    if (elapsed < acc) return { stage: i, slow: false };
  }
  const totalExpected = STAGE_DURATIONS_MS.reduce((a, b) => a + b, 0);
  return { stage: 2, slow: elapsed > totalExpected };
}

function InlineLoading({ appKey: _appKey }: { appKey: string }) {
  const { stage, slow } = useStageProgression();
  return (
    <div className="mt-2 rounded-2xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.08]">
      <ul className="flex flex-col gap-1.5">
        {STAGES.map((item, idx) => {
          const done = idx < stage;
          const active = idx === stage;
          return (
            <li
              key={item.label}
              className={`flex items-center gap-2 text-[12px] ${
                done ? 'text-ink-muted/70' : active ? 'text-ink' : 'text-ink-muted/40'
              } ${active ? 'stage-shimmer rounded-md px-1 py-0.5 -mx-1' : ''}`}
            >
              <span aria-hidden className="w-4 text-center">
                {done ? '✓' : item.icon}
              </span>
              <span>
                {item.label}
                {active && '…'}
              </span>
            </li>
          );
        })}
      </ul>
      {slow ? <p className="mt-2 text-[11px] text-ink-muted/70">{COPY.stages.slow}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Error                                                                */
/* ------------------------------------------------------------------ */

function InlineError({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <div className="mt-2 rounded-2xl bg-[#FDEEEE] px-3.5 py-3 ring-[0.5px] ring-[#D96B6B]/30">
      <p className="text-[12.5px] text-ink">这次没做出来{error ? `：${error.slice(0, 60)}` : ''}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-white transition hover:opacity-85"
        >
          再试一次
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quiz（核心交互）                                                    */
/* ------------------------------------------------------------------ */

interface QuizPayload {
  questions?: Array<{
    id: string;
    title?: string;
    stem: string;
    options: string[];
    answer: string;
    explanation: string;
  }>;
}

function InlineQuiz({
  payload,
  onInteraction,
}: {
  payload: unknown;
  onInteraction?: (event: InlineAppInteraction) => void;
}) {
  const data = payload as QuizPayload;
  const questions = data?.questions ?? [];
  const [picks, setPicks] = React.useState<Record<string, string>>({});
  const [revealed, setRevealed] = React.useState<Record<string, boolean>>({});

  const summaryEmittedRef = React.useRef(false);
  // 全部答完时抛出 "quiz_all_done" 一次
  React.useEffect(() => {
    if (questions.length === 0 || summaryEmittedRef.current) return;
    const doneCount = Object.keys(revealed).length;
    if (doneCount < questions.length) return;
    summaryEmittedRef.current = true;
    const correct = questions.filter((q) => {
      const picked = picks[q.id];
      return picked && normalizeAnswer(picked) === normalizeAnswer(q.answer);
    }).length;
    onInteraction?.({ kind: 'quiz_all_done', correct, total: questions.length });
  }, [revealed, picks, questions, onInteraction]);

  if (questions.length === 0) {
    return <div className="mt-2 text-[12px] text-ink-muted">（没生成出题目）</div>;
  }

  return (
    <div className="mt-2 flex flex-col gap-3">
      {questions.map((q, qi) => {
        const picked = picks[q.id];
        const isRevealed = revealed[q.id];
        const isCorrect = picked && normalizeAnswer(picked) === normalizeAnswer(q.answer);
        return (
          <div
            key={q.id}
            className="rounded-2xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.08]"
          >
            <p className="text-[12.5px] font-medium text-ink-muted">第 {qi + 1} 题</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink">{q.stem}</p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {q.options.map((opt, oi) => {
                const letter = String.fromCharCode(65 + oi);
                const isPicked = picked === letter || picked === opt;
                const isAnswer = normalizeAnswer(q.answer) === normalizeAnswer(letter) ||
                  normalizeAnswer(q.answer) === normalizeAnswer(opt);
                let cls = 'border-[#E9E9E7] bg-white text-ink hover:border-[#CECEC8]';
                if (isRevealed) {
                  if (isAnswer) cls = 'border-[#2E7D52] bg-[#E8F4EE] text-[#1F5838]';
                  else if (isPicked && !isCorrect) cls = 'border-[#D96B6B] bg-[#FDEEEE] text-[#8A3333]';
                  else cls = 'border-[#E9E9E7] bg-white text-ink-muted/70';
                } else if (isPicked) {
                  cls = 'border-ink bg-[#F7F7F5] text-ink';
                }
                return (
                  <li key={oi}>
                    <button
                      type="button"
                      disabled={isRevealed}
                      onClick={() => {
                        setPicks((p) => ({ ...p, [q.id]: letter }));
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-[12.5px] transition ${cls} ${
                        isRevealed ? 'cursor-default' : 'cursor-pointer'
                      }`}
                    >
                      <span className="mr-1.5 font-mono text-[11px] text-ink-muted">{letter}.</span>
                      <span>{opt.replace(/^[A-D][.。、:：]\s*/, '')}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2.5 flex items-center gap-2">
              {!isRevealed ? (
                <button
                  type="button"
                  disabled={!picked}
                  onClick={() => {
                    if (!picked) return;
                    setRevealed((r) => ({ ...r, [q.id]: true }));
                    const correct = normalizeAnswer(picked) === normalizeAnswer(q.answer);
                    // 找到正解对应的 option 原文（方便同学把"B. 选项内容"完整复述）
                    const correctIdx = q.options.findIndex(
                      (opt) => normalizeAnswer(opt) === normalizeAnswer(q.answer) ||
                        String.fromCharCode(65 + q.options.indexOf(opt)) ===
                          normalizeAnswer(q.answer),
                    );
                    const correctText =
                      correctIdx >= 0
                        ? q.options[correctIdx].replace(/^[A-D][.。、:：]\s*/, '')
                        : undefined;
                    onInteraction?.({
                      kind: 'quiz_submit',
                      questionId: q.id,
                      stem: q.stem,
                      picked,
                      correctAnswer: q.answer,
                      correctText,
                      explanation: q.explanation,
                      correct,
                    });
                  }}
                  className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium transition ${
                    picked
                      ? 'bg-ink text-white hover:opacity-85'
                      : 'bg-[#F0F0ED] text-ink-muted/60 cursor-not-allowed'
                  }`}
                >
                  对答案
                </button>
              ) : (
                <span className={`text-[12px] ${isCorrect ? 'text-[#2E7D52]' : 'text-[#8A3333]'}`}>
                  {isCorrect ? '✓ 答对了' : '× 再看一下'}
                </span>
              )}
            </div>
            {isRevealed && q.explanation ? (
              <p className="mt-2 rounded-lg bg-[#F7F7F5] px-2.5 py-2 text-[12px] leading-relaxed text-ink-secondary">
                {q.explanation}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function normalizeAnswer(v: string): string {
  return (v || '').trim().replace(/^[A-D][.。、:：]\s*/, '').toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Flashcards                                                           */
/* ------------------------------------------------------------------ */

interface FlashcardsPayload {
  cards?: Array<{
    id: string;
    title?: string;
    front: string;
    back: string;
    hint?: string;
  }>;
}

function InlineFlashcards({
  payload,
  onInteraction,
}: {
  payload: unknown;
  onInteraction?: (event: InlineAppInteraction) => void;
}) {
  const data = payload as FlashcardsPayload;
  const cards = data?.cards ?? [];
  const [index, setIndex] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);

  const allDoneEmittedRef = React.useRef(false);

  if (cards.length === 0) {
    return <div className="mt-2 text-[12px] text-ink-muted">（没生成出闪卡）</div>;
  }

  const card = cards[index];
  const isLast = index === cards.length - 1;

  return (
    <div className="mt-2 rounded-2xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.08]">
      <div className="flex items-baseline justify-between">
        <p className="text-[11.5px] text-ink-muted">闪卡 {index + 1} / {cards.length}</p>
        <p className="text-[11.5px] text-ink-muted/70">{flipped ? '背面' : '正面'}</p>
      </div>

      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="mt-2 block w-full rounded-xl bg-[#F7F7F5] px-3.5 py-4 text-left text-[13px] leading-relaxed text-ink transition hover:bg-[#F0F0ED] active:scale-[0.995]"
      >
        {flipped ? card.back : card.front}
        {!flipped && card.hint ? (
          <span className="mt-2 block text-[11px] text-ink-muted">提示：{card.hint}</span>
        ) : null}
      </button>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(['again', 'hard', 'good', 'easy'] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => {
              onInteraction?.({
                kind: 'flashcard_rate',
                cardId: card.id,
                rating: r,
                front: card.front,
                back: card.back,
              });
              setFlipped(false);
              if (isLast) {
                if (!allDoneEmittedRef.current) {
                  allDoneEmittedRef.current = true;
                  onInteraction?.({ kind: 'flashcard_all_done', reviewed: cards.length });
                }
              } else {
                setIndex((i) => i + 1);
              }
            }}
            className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-[11.5px] text-ink ring-[0.5px] ring-[#232322]/[0.12] transition hover:ring-[#232322]/[0.28] active:scale-[0.97]"
          >
            {r === 'again' ? '再来' : r === 'hard' ? '有点难' : r === 'good' ? '记住了' : '很简单'}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cheatsheet（紧凑版——可展开/收起）                                  */
/* ------------------------------------------------------------------ */

interface CheatsheetPayload {
  title?: string;
  overview?: string;
  sections?: Array<{
    key?: string;
    label?: string;
    items?: Array<{ term: string; body: string; latex?: string }>;
  }>;
}

function InlineCheatsheet({ payload }: { payload: unknown }) {
  const data = payload as CheatsheetPayload;
  const sections = data?.sections ?? [];
  const [expanded, setExpanded] = React.useState(false);
  const totalItems = sections.reduce((sum, s) => sum + (s.items?.length ?? 0), 0);

  return (
    <div className="mt-2 rounded-2xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.08]">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold tracking-[-0.005em] text-ink">
            {data?.title || '一页速查表'}
          </p>
          {data?.overview ? (
            <p className="mt-0.5 text-[11.5px] text-ink-muted">{data.overview}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-shrink-0 text-[11.5px] text-ink-muted underline decoration-ink-muted/40 underline-offset-2 hover:text-ink"
        >
          {expanded ? '收起' : `展开 ${totalItems} 条`}
        </button>
      </div>
      {expanded ? (
        <div className="mt-3 flex flex-col gap-2.5">
          {sections.map((s, si) => (
            <div key={`${s.key}-${si}`}>
              <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-muted">
                {s.label || s.key}
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {(s.items ?? []).map((item, ii) => (
                  <li key={`${si}-${ii}`} className="flex gap-2 text-[12.5px] leading-relaxed">
                    <span className="min-w-[3rem] flex-shrink-0 font-medium text-ink">
                      {item.term}
                    </span>
                    <span className="text-ink-secondary">{item.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mindmap（紧凑版——显示前 6 分支 + markdown 折叠）                    */
/* ------------------------------------------------------------------ */

interface MindmapPayload {
  root?: string;
  markdown?: string;
  children?: Array<{ title: string; children?: Array<{ title: string }> }>;
}

function InlineMindmap({ payload }: { payload: unknown }) {
  const data = payload as MindmapPayload;
  const branches = (data?.children ?? []).slice(0, 6);

  return (
    <div className="mt-2 rounded-2xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.08]">
      <p className="text-[13px] font-semibold tracking-[-0.005em] text-ink">
        {data?.root || '课堂知识结构'}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {branches.map((b, bi) => (
          <li key={bi} className="text-[12.5px] leading-relaxed">
            <p className="font-medium text-ink">{b.title}</p>
            {b.children && b.children.length > 0 ? (
              <ul className="mt-0.5 flex flex-col gap-0.5 pl-4">
                {b.children.slice(0, 3).map((c, ci) => (
                  <li key={ci} className="text-ink-secondary">
                    · {c.title}
                  </li>
                ))}
                {b.children.length > 3 ? (
                  <li className="text-ink-muted/60">… 还有 {b.children.length - 3} 条</li>
                ) : null}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Study Report                                                        */
/* ------------------------------------------------------------------ */

interface StudyReportPayload {
  title?: string;
  letterToParent?: string;
  topics?: Array<{ name: string; difficulty: string; gist: string }>;
  chatTopics?: string[];
  nextSteps?: string[];
}

function InlineStudyReport({ payload }: { payload: unknown }) {
  const data = payload as StudyReportPayload;
  return (
    <div className="mt-2 rounded-2xl bg-white px-3.5 py-3 ring-[0.5px] ring-[#232322]/[0.08]">
      {data?.title ? (
        <p className="text-[13px] font-semibold tracking-[-0.005em] text-ink">{data.title}</p>
      ) : null}
      {data?.letterToParent ? (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">{data.letterToParent}</p>
      ) : null}
      {data?.topics && data.topics.length > 0 ? (
        <div className="mt-2.5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-muted">课堂知识点</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {data.topics.map((t, i) => (
              <li key={i} className="text-[12px] leading-relaxed">
                <span className="font-medium text-ink">{t.name}</span>
                <span className="mx-1 text-ink-muted/70">· {t.difficulty}</span>
                <span className="text-ink-secondary">{t.gist}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data?.chatTopics && data.chatTopics.length > 0 ? (
        <div className="mt-2.5">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.18em] text-ink-muted">可以和孩子聊</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {data.chatTopics.map((t, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-ink-secondary">· {t}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default InlineAppCard;
