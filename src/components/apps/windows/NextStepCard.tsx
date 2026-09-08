'use client';

/**
 * NextStepCard — 一步做完，同桌接着说下一步（课后学习页 v2 的延伸）。
 *
 * 此前每个应用的完成态是终点（"这一轮完成了"），下一步藏在「所有学习方式」后面。
 * 这里把 lesson-path-model.recommendNextStep 的同一份判断放到完成态里：理由 + 一个动作，
 * 理由必须是学生能核对的（"还有 1 张没记住"）。签名色只给这一个按钮。
 */

import { ArrowRight } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

export interface NextStepCardProps {
  /** 动作词（记住核心 / 讲给同桌听 / 做成一张图…） */
  action: string;
  appName: string;
  reason: string;
  onOpen: () => void;
}

export function NextStepCard({ action, appName, reason, onOpen }: NextStepCardProps) {
  return (
    <div
      className="mx-auto mt-6 flex w-full max-w-[440px] items-center gap-4 rounded-[18px] border border-pine/20 bg-pine-fog/60 px-4 py-3.5 text-left"
      data-testid="next-step-card"
    >
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-pine">{COPY.apps.path.nextInWindowTitle}</p>
        <p className="mt-1 text-[13px] leading-[1.6] text-ink">{reason}</p>
        <p className="mt-0.5 text-[11px] text-ink-muted">{appName}</p>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-pine px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-pine-deep active:scale-[0.98]"
      >
        {COPY.apps.path.nextInWindowAction(action)}
        <ArrowRight size={13} strokeWidth={2} />
      </button>
    </div>
  );
}
