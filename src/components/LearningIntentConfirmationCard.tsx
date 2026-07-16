'use client';

import { useState } from 'react';
import { ArrowRight, Check, ChevronLeft, Sparkles } from 'lucide-react';
import type { LearningIntentAnswer, LearningIntentPlan } from '@/types/learning-intent';
import { COPY } from '@/lib/ui/copy';
import {
  buildLearningIntentAnswers,
  hasLearningIntentAnswer,
  updateLearningIntentSelection,
  type LearningIntentAnswerMap,
} from './learning-intent-confirmation-model';

interface LearningIntentConfirmationCardProps {
  plan: LearningIntentPlan;
  busy?: boolean;
  onConfirm: (plan: LearningIntentPlan) => void;
  onResolve: (answers: LearningIntentAnswer[]) => void;
  onCancel: () => void;
}

export function LearningIntentConfirmationCard({
  plan,
  busy = false,
  onConfirm,
  onResolve,
  onCancel,
}: LearningIntentConfirmationCardProps) {
  const questions = plan.questions ?? [];
  const [answers, setAnswers] = useState<LearningIntentAnswerMap>({});
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const selectOption = (optionId: string) => {
    const question = questions[activeQuestionIndex];
    if (!question) return;

    setAnswers((current) => updateLearningIntentSelection(current, question, optionId));
    if (question.kind === 'single' && activeQuestionIndex < questions.length - 1) {
      setActiveQuestionIndex((current) => current + 1);
    }
  };

  const activeQuestion = questions[activeQuestionIndex];
  const ready = activeQuestion ? hasLearningIntentAnswer(answers, activeQuestion) : false;
  const isLastQuestion = activeQuestionIndex === questions.length - 1;
  const resolve = () => onResolve(buildLearningIntentAnswers(questions, answers));

  if (questions.length > 0) {
    return (
      <section className="rounded-[22px] border border-divider bg-card px-5 py-5" aria-label={COPY.globalAsk.intentEyebrow}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] font-medium text-vermilion">
            <Sparkles size={14} />
            {COPY.globalAsk.intentEyebrow}
          </div>
          <span className="font-mono text-[10px] tabular-nums text-ink-muted">
            {COPY.globalAsk.intentProgress(activeQuestionIndex + 1, questions.length)}
          </span>
        </div>

        {activeQuestionIndex > 0 ? (
          <div className="mt-4 space-y-2">
            {questions.slice(0, activeQuestionIndex).map((question, questionIndex) => (
              <button
                key={question.id}
                type="button"
                onClick={() => setActiveQuestionIndex(questionIndex)}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-[13px] bg-paper px-3.5 py-2.5 text-left transition hover:bg-pine-fog"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-pine text-white">
                  <Check size={11} strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-secondary">
                  {questions[questionIndex]?.options
                    .filter((option) => answers[question.id]?.includes(option.id))
                    .map((option) => option.label)
                    .join(' · ')}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div key={activeQuestion?.id} className="mt-5 animate-in fade-in slide-in-from-bottom-1 duration-200">
          <fieldset disabled={busy}>
            <legend className="text-[16px] font-semibold leading-7 text-ink">
              {activeQuestion?.prompt}
            </legend>
            <p className="mt-1 text-[12px] text-ink-muted">
              {activeQuestion?.kind === 'multiple' ? COPY.globalAsk.intentMultiple : COPY.globalAsk.intentSingle}
            </p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {activeQuestion?.options.map((option) => {
                const selected = answers[activeQuestion.id]?.includes(option.id) ?? false;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectOption(option.id)}
                    aria-pressed={selected}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-medium transition ${selected ? 'border-vermilion/35 bg-vermilion-fog text-vermilion' : 'border-divider bg-paper text-ink-secondary hover:border-pine/25 hover:text-ink'}`}
                  >
                    {selected ? <Check size={14} strokeWidth={2.2} /> : null}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-divider pt-4">
          <button
            type="button"
            onClick={activeQuestionIndex > 0 ? () => setActiveQuestionIndex((current) => current - 1) : onCancel}
            disabled={busy}
            className="inline-flex items-center gap-1 px-1 py-2 text-[13px] text-ink-muted hover:text-ink"
          >
            {activeQuestionIndex > 0 ? <ChevronLeft size={14} /> : null}
            {activeQuestionIndex > 0 ? COPY.globalAsk.intentBack : COPY.globalAsk.intentCancel}
          </button>
          <button
            type="button"
            onClick={isLastQuestion ? resolve : () => setActiveQuestionIndex((current) => current + 1)}
            disabled={busy || !ready}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-pine px-5 text-[13.5px] font-semibold text-white transition hover:bg-pine-deep disabled:opacity-35"
          >
            {isLastQuestion ? COPY.globalAsk.intentResolve : COPY.globalAsk.intentContinue}
            <ArrowRight size={15} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-[22px] border border-pine/16 bg-pine-fog px-5 py-5" aria-label={COPY.globalAsk.intentEyebrow}>
      <span className="absolute inset-y-0 left-0 w-1 bg-vermilion" aria-hidden />
      <div className="flex items-center gap-2 text-[12px] font-medium text-pine">
        <Sparkles size={14} />
        {COPY.globalAsk.intentEyebrow}
      </div>

      <h3 className="mt-3 text-[20px] font-semibold leading-7 tracking-[-0.025em] text-ink">{plan.title}</h3>
      <p className="mt-2 text-[14px] leading-6 text-ink-secondary">{plan.outcome}</p>

      {plan.checkpoints.length > 0 ? (
        <div className="mt-4 rounded-[14px] border border-pine/12 bg-white/75 px-4 py-3">
          <p className="text-[12px] font-medium text-vermilion">{COPY.globalAsk.intentFirstStep}</p>
          <p className="mt-1 text-[13.5px] leading-6 text-ink-secondary">{plan.checkpoints[0]}</p>
        </div>
      ) : null}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button type="button" onClick={onCancel} disabled={busy} className="px-1 py-2 text-[13px] text-ink-muted hover:text-ink">
          {COPY.globalAsk.intentCancel}
        </button>
        <button
          type="button"
          onClick={() => onConfirm(plan)}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-full bg-pine px-5 text-[13.5px] font-semibold text-white transition hover:bg-pine-deep disabled:opacity-40"
        >
          {COPY.globalAsk.intentStart}
          <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}
