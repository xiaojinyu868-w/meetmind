'use client';

/**
 * IntentStepBar —— 目标共建顶部步骤条：说说 → 捋一捋 → 记下了。
 *
 * 让对话有可见的终点：用户随时知道自己在哪一步、还差几步。
 * 纯展示组件，进度由父组件根据对话状态推导。
 */

import { Check } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

interface IntentStepBarProps {
  /** 当前步骤：0 说说 / 1 捋一捋 / 2 记下了；-1 不展示 */
  stepIndex: number;
}

export function IntentStepBar({ stepIndex }: IntentStepBarProps) {
  if (stepIndex < 0) return null;
  const steps = [COPY.intent.stepChat, COPY.intent.stepShape, COPY.intent.stepSaved];
  return (
    <div className="relative z-10 flex shrink-0 items-center justify-center gap-1.5 py-2.5" aria-hidden>
      {steps.map((label, idx) => {
        const reached = idx <= stepIndex;
        const current = idx === stepIndex;
        return (
          <span key={label} className="flex items-center gap-1.5">
            {idx > 0 ? (
              <span className={`h-px w-6 ${reached ? 'bg-pine/50' : 'bg-divider'}`} />
            ) : null}
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                current
                  ? 'bg-pine text-white'
                  : reached
                    ? 'bg-pine-mist/60 text-pine'
                    : 'bg-paper-warm text-ink-muted'
              }`}
            >
              {idx < stepIndex ? <Check size={11} strokeWidth={2.4} /> : null}
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default IntentStepBar;
