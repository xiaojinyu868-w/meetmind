'use client';

import type { GuidanceOption, GuidanceQuestion as GuidanceQuestionType } from '@/types/dify';

interface GuidanceQuestionProps {
  question: GuidanceQuestionType;
  onSelect: (optionId: string, option: GuidanceOption) => void;
  isLoading?: boolean;
  disabled?: boolean;
  selectedOptionId?: string;
}

function getOptionTone(category: GuidanceOption['category'], selected: boolean) {
  if (selected) {
    return 'border-slate-900 bg-slate-900 text-white shadow-sm shadow-slate-900/10';
  }

  switch (category) {
    case 'concept':
      return 'border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100';
    case 'procedure':
      return 'border-[#D1F4E0] bg-[#D1F4E0]/30 text-[#232322] hover:border-[#D1F4E0] hover:bg-[#D1F4E0]';
    case 'calculation':
      return 'border-[#E9E9E7] bg-[#FDF3C0]/50 text-[#232322] hover:border-[#232322] hover:bg-[#FDF3C0]';
    case 'comprehension':
      return 'border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100';
    case 'application':
      return 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100';
  }
}

export function GuidanceQuestion({
  question,
  onSelect,
  isLoading = false,
  disabled = false,
  selectedOptionId,
}: GuidanceQuestionProps) {
  const isLocked = disabled || isLoading;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)]">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xs font-semibold tracking-[0.18em] text-slate-500">
          AI
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
              方向
            </span>
            <span className="text-[11px] text-slate-400">选一个最接近你现在目标的方向</span>
          </div>

          <p className="mt-2 text-sm font-medium leading-6 text-slate-900">{question.question}</p>

          {question.hint ? (
            <p className="mt-1 text-xs leading-5 text-slate-500">{question.hint}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {question.options.map((option) => {
          const isSelected = selectedOptionId === option.id;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                if (!isLocked) {
                  onSelect(option.id, option);
                }
              }}
              disabled={isLocked}
              aria-pressed={isSelected}
              className={[
                'min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2',
                isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                getOptionTone(option.category, isSelected),
              ].join(' ')}
            >
              {option.text}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-500">
          {selectedOptionId
            ? '已锁定这个方向，正在继续细化你的问题。'
            : '如果都不完全贴合，先点最接近的一项，后面还能继续修正。'}
        </p>

        {isLoading ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-slate-500" />
            正在顺着这个方向继续分析
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function GuidanceQuestionSkeleton() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.35)] animate-pulse">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-2xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 rounded-full bg-slate-100" />
          <div className="h-4 w-3/4 rounded-full bg-slate-100" />
          <div className="h-3 w-1/2 rounded-full bg-slate-100" />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="h-11 w-32 rounded-full bg-slate-100" />
        ))}
      </div>

      <div className="mt-4 h-3 w-2/3 rounded-full bg-slate-100" />
    </div>
  );
}
