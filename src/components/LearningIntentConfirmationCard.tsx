'use client';

import { useState } from 'react';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import type { LearningIntentAnswer, LearningIntentPlan } from '@/types/learning-intent';
import { COPY } from '@/lib/ui/copy';

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
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  const selectOption = (questionId: string, optionId: string, multiple: boolean) => {
    setAnswers((current) => {
      const selected = current[questionId] ?? [];
      if (!multiple) return { ...current, [questionId]: [optionId] };
      return {
        ...current,
        [questionId]: selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId],
      };
    });
  };

  const ready = questions.length > 0 && questions.every((question) => (answers[question.id]?.length ?? 0) > 0);
  const resolve = () => onResolve(questions.map((question) => {
    const optionIds = answers[question.id] ?? [];
    return {
      questionId: question.id,
      question: question.prompt,
      optionIds,
      optionLabels: question.options.filter((option) => optionIds.includes(option.id)).map((option) => option.label),
    };
  }));

  if (questions.length > 0) {
    return (
      <section className="rounded-[22px] border border-divider bg-card px-5 py-5" aria-label={COPY.globalAsk.intentEyebrow}>
        <div className="flex items-center gap-2 text-[12px] font-medium text-vermilion">
          <Sparkles size={14} />
          {COPY.globalAsk.intentQuestionTitle(questions.length)}
        </div>

        <div className="mt-5 space-y-6">
          {questions.map((question, questionIndex) => (
            <fieldset key={question.id} disabled={busy}>
              <legend className="text-[15px] font-semibold leading-6 text-ink">
                <span className="mr-2 text-vermilion">{questionIndex + 1}.</span>
                {question.prompt}
              </legend>
              <p className="mt-1 text-[12px] text-ink-muted">
                {question.kind === 'multiple' ? COPY.globalAsk.intentMultiple : COPY.globalAsk.intentSingle}
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {question.options.map((option) => {
                  const selected = answers[question.id]?.includes(option.id) ?? false;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectOption(question.id, option.id, question.kind === 'multiple')}
                      aria-pressed={selected}
                      className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 py-2 text-[13.5px] font-medium transition ${selected ? 'border-vermilion/35 bg-vermilion-fog text-vermilion' : 'border-divider bg-paper text-ink-secondary hover:border-pine/25 hover:text-ink'}`}
                    >
                      {selected ? <Check size={14} strokeWidth={2.2} /> : null}
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3 border-t border-divider pt-4">
          <button type="button" onClick={onCancel} disabled={busy} className="px-1 py-2 text-[13px] text-ink-muted hover:text-ink">
            {COPY.globalAsk.intentCancel}
          </button>
          <button
            type="button"
            onClick={resolve}
            disabled={busy || !ready}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-pine px-5 text-[13.5px] font-semibold text-white transition hover:bg-pine-deep disabled:opacity-35"
          >
            {COPY.globalAsk.intentResolve}
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
