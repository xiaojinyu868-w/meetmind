'use client';

import { Check, Compass, Eye, Lightbulb, Route, Sigma, type LucideIcon } from 'lucide-react';
import type { GuidanceOption, GuidanceQuestion as GuidanceQuestionType } from '@/types/dify';

interface GuidanceQuestionProps {
  question: GuidanceQuestionType;
  onSelect: (optionId: string, option: GuidanceOption) => void;
  isLoading?: boolean;
  disabled?: boolean;
  selectedOptionId?: string;
}

function getCategoryMeta(category: GuidanceOption['category']): {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  cardClassName: string;
} {
  switch (category) {
    case 'concept':
      return {
        label: '核心概念',
        icon: Lightbulb,
        iconClassName: 'border-vermilion/30 bg-vermilion-fog text-vermilion',
        cardClassName: 'hover:border-vermilion/40 hover:bg-vermilion-fog/60',
      };
    case 'procedure':
      return {
        label: '步骤拆解',
        icon: Route,
        iconClassName: 'border-pine/30 bg-pine-fog text-pine',
        cardClassName: 'hover:border-pine/40 hover:bg-pine-fog/60',
      };
    case 'calculation':
      return {
        label: '计算推导',
        icon: Sigma,
        iconClassName: 'border-pine/30 bg-pine-fog text-pine',
        cardClassName: 'hover:border-pine/40 hover:bg-pine-fog/60',
      };
    case 'comprehension':
      return {
        label: '理解卡点',
        icon: Eye,
        iconClassName: 'border-pine/25 bg-pine-fog text-pine',
        cardClassName: 'hover:border-pine/40 hover:bg-pine-fog/70',
      };
    case 'application':
      return {
        label: '应用迁移',
        icon: Compass,
        iconClassName: 'border-vermilion/30 bg-vermilion-fog text-vermilion-deep',
        cardClassName: 'hover:border-vermilion/45 hover:bg-vermilion-fog/60',
      };
    default:
      return {
        label: '继续细化',
        icon: Compass,
        iconClassName: 'border-divider bg-paper-warm text-ink-secondary',
        cardClassName: 'hover:border-divider hover:bg-paper-warm/70',
      };
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
    <div className="rounded-[28px] border border-[#E8E2D5] bg-white/96 px-4 py-4 shadow-[0_18px_40px_rgba(148,163,184,0.10)]">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-pine/15 bg-pine-fog text-pine">
          <Compass size={18} strokeWidth={1.9} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="inline-flex items-center rounded-full bg-vermilion-fog px-2.5 py-1 text-[11px] font-semibold text-vermilion-deep">
            继续缩小问题范围
          </div>
          <p className="mt-2 text-[16px] font-semibold leading-6 tracking-[-0.02em] text-ink">{question.question}</p>
          {question.hint ? (
            <p className="mt-1 text-[12px] leading-5 text-ink-muted">{question.hint}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {question.options.map((option) => {
          const isSelected = selectedOptionId === option.id;
          const meta = getCategoryMeta(option.category);
          const Icon = meta.icon;

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
                'group flex min-h-[108px] flex-col rounded-[22px] border px-3.5 py-3 text-left transition-all duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-divider focus-visible:ring-offset-2',
                isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer active:scale-[0.98]',
                isSelected
                  ? 'border-ink bg-ink text-white shadow-[0_16px_30px_rgba(15,23,42,0.16)]'
                  : `border-divider bg-paper-warm ${meta.cardClassName}`,
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${isSelected ? 'border-white/15 bg-white/10 text-white' : meta.iconClassName}`}>
                  <Icon size={17} strokeWidth={1.9} />
                </div>
                {isSelected ? (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-ink">
                    <Check size={14} strokeWidth={2.4} />
                  </div>
                ) : null}
              </div>
              <div className={`mt-3 text-[13px] font-semibold leading-5 ${isSelected ? 'text-white' : 'text-ink'}`}>
                {option.text}
              </div>
              <div className={`mt-auto pt-3 text-[11px] font-medium ${isSelected ? 'text-white/72' : 'text-ink-muted'}`}>
                {meta.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-divider-light pt-3">
        <p className="text-xs text-ink-muted">
          {selectedOptionId
            ? '已锁定这个方向，我会顺着它继续把问题压缩得更清楚。'
            : '先点最接近的一项，不需要一次就选得完全准确。'}
        </p>

        {isLoading ? (
          <div className="inline-flex items-center gap-2 rounded-full border border-divider bg-paper-warm px-3 py-1 text-xs text-ink-secondary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-paper-warm0" />
            正在继续细化
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function GuidanceQuestionSkeleton() {
  return (
    <div className="animate-pulse rounded-[28px] border border-[#E8E2D5] bg-white/96 px-4 py-4 shadow-[0_18px_40px_rgba(148,163,184,0.10)]">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-2xl bg-paper-deep" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-28 rounded-full bg-paper-deep" />
          <div className="h-4 w-3/4 rounded-full bg-paper-deep" />
          <div className="h-3 w-1/2 rounded-full bg-paper-deep" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-[108px] rounded-[22px] bg-paper-deep" />
        ))}
      </div>

      <div className="mt-4 h-3 w-2/3 rounded-full bg-paper-deep" />
    </div>
  );
}
