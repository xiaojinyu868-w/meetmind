'use client';

import type { ReactNode } from 'react';
import { ArrowRight, Check, ChevronRight, Layers3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LearningThreadEntry } from '@/types/user';
import { COPY } from '@/lib/ui/copy';
import { OctoAvatar } from '@/components/ui/octo-avatar';

/**
 * GlobalAskWelcome — 问同学空态（v9 呼吸森林）
 *
 * 布局对齐大厂 AI 首页心智（豆包 / ChatGPT）：问候在上、输入框是唯一主角、
 * 建议入口垫在输入框下面。视觉用 v9 B 方向（globals.css 的 v9-* 基元）：
 * 签名色光场在背后缓慢漂移，Octo 带听课涟漪，表面是浮在光上的毛玻璃。
 *
 * 文案契约不变：全部来自 COPY.globalAsk；免费档的深度模式入口带 Pro 标识
 * （`deepLocked`，由 panel 按会员档位传入）。
 */

interface GlobalAskWelcomeProps {
  depth: 'quick' | 'deep';
  /** 免费档：深度模式（陪我学会）是 Pro/Max 专属，在入口上带 Pro 标识 */
  deepLocked?: boolean;
  activeThread?: LearningThreadEntry;
  composer: ReactNode;
  contextSummary: string;
  onDepthChange: (depth: 'quick' | 'deep') => void;
  onOpenContext: () => void;
  onChoosePrompt: (prompt: string) => void;
  onResumeThread: () => void;
}

export function GlobalAskWelcome({
  depth,
  deepLocked = false,
  activeThread,
  composer,
  contextSummary,
  onDepthChange,
  onOpenContext,
  onChoosePrompt,
  onResumeThread,
}: GlobalAskWelcomeProps) {
  const prompts = depth === 'deep'
    ? COPY.globalAsk.deepExamples
    : COPY.globalAsk.quickExamples;

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center overflow-hidden px-4 pb-10 pt-8 sm:px-6">
      {/* 呼吸森林光场 */}
      <div className="v9-aura" aria-hidden>
        <div className="v9-blob v9-blob-pine" />
        <div className="v9-blob v9-blob-sky" />
        <div className="v9-blob v9-blob-sand" />
      </div>

      {/* ── Hero：Octo + 问候 ── */}
      <div className="relative flex flex-col items-center text-center">
        <div className="v9-rise v9-d1 relative grid place-items-center p-4">
          <span className="v9-ring" />
          <span className="v9-ring v9-ring-delay" />
          <OctoAvatar mood="listening" size="lg" aura={false} />
        </div>
        <p className="v9-rise v9-d2 mt-3 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-pine">
          {COPY.globalAsk.welcomeEyebrow}
        </p>
        <h2 className="v9-rise v9-d3 mt-3 max-w-2xl font-serif text-[32px] italic leading-[1.2] tracking-[-0.02em] text-ink sm:text-[42px]">
          {depth === 'deep' ? COPY.globalAsk.deepEmptyTitle : COPY.globalAsk.emptyTitle}
        </h2>
        <p className="v9-rise v9-d4 mt-3 max-w-lg text-[13px] leading-6 text-ink-secondary sm:text-[13.5px] sm:leading-7">
          {depth === 'deep' ? COPY.globalAsk.deepEmptyBody : COPY.globalAsk.emptyBody}
        </p>
      </div>

      {/* ── 上次还在学：接回线程（玻璃条） ── */}
      {activeThread?.status === 'active' ? (
        <button
          type="button"
          onClick={onResumeThread}
          className="v9-rise v9-d4 v9-glass group relative mt-7 flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:shadow-float"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pine/10 text-pine transition group-hover:bg-pine/15"><ArrowRight size={14} /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-pine">{COPY.globalAsk.threadTitle}</span>
            <span className="mt-1 block truncate text-[13px] font-semibold text-ink">{activeThread.title}</span>
          </span>
          <span className="hidden text-[11px] font-medium text-ink-muted sm:block">{COPY.globalAsk.threadResume}</span>
          <ChevronRight size={14} className="shrink-0 text-ink-muted transition group-hover:translate-x-0.5 group-hover:text-pine" />
        </button>
      ) : null}

      {/* ── 主角：玻璃 composer ── */}
      <div className="v9-rise v9-d5 v9-glass relative mt-7 rounded-[28px] transition-shadow duration-500 focus-within:shadow-[0_0_0_4px_rgba(47,107,85,0.1),0_24px_56px_rgba(16,22,15,0.12)]">
        <div className="px-4 pt-4 sm:px-5">{composer}</div>
        <div className="flex flex-col gap-2 border-t border-ink/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-1" aria-label={COPY.globalAsk.modeSelectorLabel}>
            {(['quick', 'deep'] as const).map((option) => {
              const selected = depth === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onDepthChange(option)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[11.5px] transition',
                    selected ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:bg-pine/8 hover:text-ink',
                  )}
                >
                  {selected ? <Check size={11} /> : null}
                  {option === 'quick' ? COPY.globalAsk.quickMode : COPY.globalAsk.deepMode}
                  {option === 'deep' && deepLocked ? (
                    <span className={cn(
                      'rounded-full px-1.5 py-px text-[9px] font-semibold',
                      selected ? 'bg-white/20 text-white' : 'bg-pine/10 text-pine',
                    )}>
                      {COPY.membership.tierName.pro}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onOpenContext}
            className="inline-flex min-w-0 items-center gap-1.5 text-left text-[10.5px] text-ink-muted transition hover:text-pine"
          >
            <Layers3 size={12} className="shrink-0" />
            <span className="truncate">{contextSummary}</span>
            <ChevronRight size={11} className="shrink-0" />
          </button>
        </div>
      </div>

      {/* ── 建议入口：玻璃卡，垫在 composer 下面 ── */}
      <div className="v9-rise v9-d6 relative mt-6">
        <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-muted">{COPY.globalAsk.startersTitle}</p>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onChoosePrompt(prompt)}
              className="v9-glass group flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-left transition duration-300 hover:-translate-y-0.5 hover:bg-white/80 hover:shadow-float"
            >
              <span className="text-[12.5px] leading-5 text-ink-secondary transition group-hover:text-ink">{prompt}</span>
              <ArrowRight size={14} className="shrink-0 text-ink-muted transition group-hover:translate-x-1 group-hover:text-pine" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
