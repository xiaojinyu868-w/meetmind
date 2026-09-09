'use client';

/**
 * MasteryTrailSection — 「我的上下文」总览里的掌握轨迹。
 *
 * 与问同学右侧画像栏的「检验过的」同一套语言（2026-09-10）：一行一件——概念 · 事实序列（测验 ✕ → 闪卡 ✓）· 状态词，
 * 没有状态点、没有卡片。状态只有三个词，其余全是事实；"还没稳"排最前——最需要被看见的先看见。没有任何记录时整块不渲染。
 * 数据：useMasteryTrail（本机会话层结果 + 登录用户的服务端事件表切片合并）。
 */

import { Check, X } from 'lucide-react';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import { cn } from '@/lib/utils';
import { useMasteryTrail } from '@/hooks/useMasteryTrail';
import type { MasteryStatus } from './mastery-trail';

const STATUS_STYLE: Record<MasteryStatus, { text: string; label: string }> = {
  unstable: { text: 'text-vermilion', label: GLOBAL_ASK_COPY.masteryTrail.statusUnstable },
  improving: { text: 'text-pine', label: GLOBAL_ASK_COPY.masteryTrail.statusImproving },
  stable: { text: 'text-ink-muted', label: GLOBAL_ASK_COPY.masteryTrail.statusStable },
};

function stepLabel(appKey: string): string {
  return GLOBAL_ASK_COPY.masteryTrail.stepLabels[appKey] ?? appKey;
}

export function MasteryTrailSection({ className }: { className?: string }) {
  // 本机 + 服务端（登录用户）合并：换设备也看到同一个自己
  const { trail, fromAccount } = useMasteryTrail({ appId: 'my-context' });

  if (trail.length === 0) return null;

  return (
    <section className={cn('mt-8', className)} aria-labelledby="mastery-trail-title" data-testid="mastery-trail">
      <p id="mastery-trail-title" className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{GLOBAL_ASK_COPY.profile.sections.mastery}</p>
      <ul className="mt-1 px-1">
        {trail.map((entry) => {
          const style = STATUS_STYLE[entry.status];
          return (
            <li key={entry.concept} className="flex items-baseline gap-3 border-b border-divider/60 py-2.5 last:border-0">
              <span className="min-w-0 flex-1 truncate text-[13.5px] leading-6 text-ink">{entry.concept}</span>
              <span className="hidden shrink-0 items-center gap-1 font-mono text-[10.5px] text-ink-muted sm:inline-flex">
                {entry.steps.map((step, index) => (
                  <span key={`${step.appKey}-${step.at}-${index}`} className="inline-flex items-center gap-0.5">
                    {index > 0 ? <span className="mx-0.5 text-ink-muted/60">→</span> : null}
                    <span>{stepLabel(step.appKey)}</span>
                    {step.positive
                      ? <Check size={10} strokeWidth={2.4} className="text-pine" aria-label="对" />
                      : <X size={10} strokeWidth={2.4} className="text-vermilion" aria-label="错" />}
                  </span>
                ))}
              </span>
              <span className={cn('w-12 shrink-0 text-right text-[11.5px]', style.text)}>{style.label}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 px-1 text-[11px] leading-5 text-ink-muted/80">{GLOBAL_ASK_COPY.masteryTrail.body} {fromAccount ? GLOBAL_ASK_COPY.masteryTrail.accountScopeHint : GLOBAL_ASK_COPY.masteryTrail.deviceScopeHint}</p>
    </section>
  );
}
