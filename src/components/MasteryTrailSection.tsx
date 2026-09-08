'use client';

/**
 * MasteryTrailSection — 「我的上下文」总览里的掌握轨迹。
 *
 * 每一行：状态点 + 概念原文 + 事实序列（测验 ✕ → 闪卡 ✓）。状态只有三个词，其余全是事实；
 * "还没稳"排最前——最需要被看见的先看见。没有任何记录时整块不渲染，页面保持安静。
 * 数据：useMasteryTrail（本机会话层结果 + 登录用户的服务端事件表切片合并）。
 */

import { Check, X } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';
import { cn } from '@/lib/utils';
import { useMasteryTrail } from '@/hooks/useMasteryTrail';
import type { MasteryStatus } from './mastery-trail';

const STATUS_STYLE: Record<MasteryStatus, { dot: string; text: string; label: string }> = {
  unstable: { dot: 'bg-vermilion', text: 'text-vermilion', label: COPY.globalAsk.masteryTrail.statusUnstable },
  improving: { dot: 'bg-pine ring-4 ring-pine/15', text: 'text-pine', label: COPY.globalAsk.masteryTrail.statusImproving },
  stable: { dot: 'bg-pine', text: 'text-pine', label: COPY.globalAsk.masteryTrail.statusStable },
};

function stepLabel(appKey: string): string {
  return COPY.globalAsk.masteryTrail.stepLabels[appKey] ?? appKey;
}

export function MasteryTrailSection({ className }: { className?: string }) {
  // 本机 + 服务端（登录用户）合并：换设备也看到同一个自己
  const { trail, fromAccount } = useMasteryTrail({ appId: 'my-context' });

  if (trail.length === 0) return null;

  return (
    <section className={cn('mt-9', className)} aria-labelledby="mastery-trail-title" data-testid="mastery-trail">
      <div className="mb-3 px-1">
        <p className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.12em] text-pine">{COPY.globalAsk.masteryTrail.eyebrow}</p>
        <h2 id="mastery-trail-title" className="mt-2 text-[17px] font-semibold tracking-[-0.02em] text-ink">{COPY.globalAsk.masteryTrail.title}</h2>
        <p className="mt-1 text-[11.5px] leading-5 text-ink-muted">{COPY.globalAsk.masteryTrail.body}</p>
      </div>
      <ul className="divide-y divide-divider border-y border-divider">
        {trail.map((entry) => {
          const style = STATUS_STYLE[entry.status];
          return (
            <li key={entry.concept} className="flex items-start gap-3 px-1 py-3.5">
              <span className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-6 text-ink">{entry.concept}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-muted">
                  {entry.steps.map((step, index) => (
                    <span key={`${step.appKey}-${step.at}-${index}`} className="inline-flex items-center gap-1">
                      {index > 0 ? <span className="text-ink-muted/60">→</span> : null}
                      <span>{stepLabel(step.appKey)}</span>
                      {step.positive
                        ? <Check size={11} strokeWidth={2.4} className="text-pine" aria-label="对" />
                        : <X size={11} strokeWidth={2.4} className="text-vermilion" aria-label="错" />}
                    </span>
                  ))}
                </div>
              </div>
              <span className={cn('shrink-0 font-mono text-[10px] font-semibold tracking-[0.04em]', style.text)}>{style.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 px-1 text-[10.5px] text-ink-muted">{fromAccount ? COPY.globalAsk.masteryTrail.accountScopeHint : COPY.globalAsk.masteryTrail.deviceScopeHint}</p>
    </section>
  );
}
