'use client';

import { useMemo, useState } from 'react';
import type { AppExecutionResult } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import { EvidenceChip } from '@/components/apps/evidence/EvidenceChip';

interface QuizWindowProps {
  result: AppExecutionResult | null;
  transcript: TranscriptSegment[];
  onSeek?: (startMs: number) => void;
}

interface QuizQuestion {
  id: string;
  title?: string;
  stem: string;
  options: string[];
  answer: string;
  explanation?: string;
}

function normalizeQuestions(result: AppExecutionResult | null): QuizQuestion[] {
  if (!result) return [];
  const payload = result.render?.payload as { questions?: Array<Record<string, unknown>> } | undefined;
  const payloadQuestions = Array.isArray(payload?.questions)
    ? payload.questions
        .map((item, index) => ({
          id: typeof item.id === 'string' ? item.id : `quiz-${index + 1}`,
          title: typeof item.title === 'string' ? item.title : `题目 ${index + 1}`,
          stem: typeof item.stem === 'string' ? item.stem : '',
          options: Array.isArray(item.options)
            ? item.options.map((option) => (typeof option === 'string' ? option : '')).filter(Boolean)
            : [],
          answer: typeof item.answer === 'string' ? item.answer : '',
          explanation: typeof item.explanation === 'string' ? item.explanation : '',
        }))
        .filter((question) => question.stem && question.options.length >= 2)
    : [];
  if (payloadQuestions.length > 0) return payloadQuestions;

  return result.cards
    .filter((card) => card.meta?.cardKind === 'quiz')
    .map((card, index) => ({
      id: card.id,
      title: card.title || `题目 ${index + 1}`,
      stem: typeof card.meta?.stem === 'string' ? card.meta.stem : card.body,
      options: Array.isArray(card.meta?.options)
        ? card.meta.options.map((option) => (typeof option === 'string' ? option : '')).filter(Boolean)
        : [],
      answer: typeof card.meta?.answer === 'string' ? card.meta.answer : '',
      explanation: typeof card.meta?.explanation === 'string' ? card.meta.explanation : '',
    }))
    .filter((question) => question.stem && question.options.length >= 2);
}

function normalizeAnswer(answer: string, options: string[]): string {
  const trimmed = answer.trim();
  if (!trimmed) return '';
  const letter = trimmed.slice(0, 1).toUpperCase();
  const letterIndex = letter.charCodeAt(0) - 65;
  if (letterIndex >= 0 && letterIndex < options.length) return options[letterIndex];
  const matched = options.find((option) => option.toLowerCase() === trimmed.toLowerCase());
  return matched || trimmed;
}

export function QuizWindow({ result, transcript, onSeek }: QuizWindowProps) {
  const questions = useMemo(() => normalizeQuestions(result), [result]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<Record<string, boolean>>({});

  if (!result) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">正在生成测验...</div>;
  }

  if (questions.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">未获得可作答题目，请重新生成。</div>;
  }

  const current = questions[Math.min(index, questions.length - 1)];
  const evidenceCard = result.cards.find((card) => card.id === current.id);
  const citation = evidenceCard?.citations?.[0];
  const selectedOption = selected[current.id];
  const isSubmitted = Boolean(submitted[current.id]);
  const normalizedAnswer = normalizeAnswer(current.answer, current.options);
  const isCorrect = selectedOption ? selectedOption === normalizedAnswer : false;

  const finishedCount = Object.values(submitted).filter(Boolean).length;
  const correctCount = questions.filter((question) => submitted[question.id] && selected[question.id] === normalizeAnswer(question.answer, question.options)).length;

  return (
    <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]" data-testid="quiz-window">
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">
            题目 {index + 1}/{questions.length}
          </p>
          <p className="text-xs text-slate-500">已提交 {finishedCount}</p>
        </div>
        <h2 className="text-lg font-semibold leading-8 text-slate-900">{current.stem}</h2>
        <div className="mt-4 space-y-2">
          {current.options.map((option) => {
            const active = selectedOption === option;
            const optionCorrect = isSubmitted && option === normalizedAnswer;
            const optionWrong = isSubmitted && active && !isCorrect;
            return (
              <button
                key={option}
                type="button"
                disabled={isSubmitted}
                onClick={() => setSelected((prev) => ({ ...prev, [current.id]: option }))}
                className={`w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
                  optionCorrect
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                    : optionWrong
                      ? 'border-rose-400 bg-rose-50 text-rose-700'
                      : active
                        ? 'border-blue-400 bg-blue-50 text-blue-800'
                        : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                {option}
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {citation ? <EvidenceChip citation={citation} transcript={transcript} onSeek={onSeek} /> : null}
          {!isSubmitted ? (
            <button
              type="button"
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!selectedOption}
              onClick={() => setSubmitted((prev) => ({ ...prev, [current.id]: true }))}
            >
              提交答案
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => setIndex((prev) => Math.min(prev + 1, questions.length - 1))}
            >
              下一题
            </button>
          )}
        </div>

        {isSubmitted ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className={`font-medium ${isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>{isCorrect ? '回答正确' : `正确答案：${normalizedAnswer}`}</p>
            {current.explanation ? <p className="mt-1 leading-6 text-slate-600">{current.explanation}</p> : null}
          </div>
        ) : null}
      </div>

      <aside className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium text-slate-700">作答概览</p>
        <p className="mt-1 text-xs text-slate-500">
          正确 {correctCount}/{questions.length}
        </p>
        <div className="mt-3 space-y-2">
          {questions.map((question, qIndex) => {
            const done = Boolean(submitted[question.id]);
            const chosen = selected[question.id];
            const answer = normalizeAnswer(question.answer, question.options);
            const ok = done && chosen === answer;
            return (
              <button
                key={question.id}
                type="button"
                onClick={() => setIndex(qIndex)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
                  done ? (ok ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50') : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span className="truncate pr-2 text-sm text-slate-700">{question.title || `题目 ${qIndex + 1}`}</span>
                <span className="text-xs text-slate-500">{done ? (ok ? '正确' : '错题') : '未作答'}</span>
              </button>
            );
          })}
        </div>
      </aside>
    </section>
  );
}
