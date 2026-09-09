'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { GLOBAL_ASK_COPY } from '@/lib/ui/copy-global-ask';
import type { LearningMemoryKind } from '@/types/user';
import type { LearnerProfileView } from '@/components/learner-profile-model';
import { AddMemoryRow, MemoryRow } from '@/components/learner-profile-rows';

/**
 * LearnerProfileRail — 「同学眼里的你」（问同学右侧常驻一栏）
 *
 * 产品要养成的心智：你在 MeetMind 有一个会长大的、可以自己改的学习画像。所以它不藏在设置里，
 * 而是坐在你提问的旁边——问出去的每个问题都被它接住，答得准不准一眼能对上。
 *
 * 版式：顶部是同学写的小传（事实说成话），下面三段可以逐条维护的事实（正在学 / 检验过的 / 记住的），
 * 最下一行台账（认识你 N 天 · 听过 N 节课 · 记住 N 件事）让"在长大"被看见。
 * 全部是文字与一条条分隔线，没有卡片、没有图标网格；动作是悬停才出现的两个字。
 */

export interface LearnerProfileRailProps {
  view: LearnerProfileView;
  isGuest: boolean;
  saving: boolean;
  /** 访客的掌握记录只在这台设备；登录用户来自账号 */
  fromAccount: boolean;
  onAsk: (prompt: string) => void;
  onConfirmMemory: (id: string) => void;
  onEditMemory: (id: string, title: string) => void;
  onForgetMemory: (id: string) => void;
  onResumeMemory: (id: string) => void;
  onAddMemory: (kind: LearningMemoryKind, title: string) => void;
  onCompleteThread: () => void;
  onOpenAll: () => void;
  onStartDemo?: () => void;
  className?: string;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-muted first:mt-0">{children}</p>;
}

const STATUS_TONE: Record<LearnerProfileView['mastery'][number]['status'], string> = {
  unstable: 'text-vermilion',
  improving: 'text-pine',
  stable: 'text-ink-muted',
};

export function LearnerProfileRail({
  view, isGuest, saving, fromAccount,
  onAsk, onConfirmMemory, onEditMemory, onForgetMemory, onResumeMemory, onAddMemory, onCompleteThread, onOpenAll, onStartDemo,
  className,
}: LearnerProfileRailProps) {
  const copy = GLOBAL_ASK_COPY.profile;
  const ledger = [
    view.ledger.days ? copy.ledger.days(view.ledger.days) : '',
    copy.ledger.lessons(view.ledger.lessons),
    copy.ledger.memories(view.ledger.memories),
  ].filter(Boolean).join(copy.ledger.separator);

  return (
    <aside className={cn('flex h-full min-h-0 flex-col bg-paper', className)} aria-label={copy.eyebrow}>
      <div className="px-6 pb-2 pt-6">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-pine">{copy.eyebrow}</p>
        {view.empty ? (
          <div className="mt-3">
            <p className="text-[14px] leading-7 text-ink-secondary">{isGuest ? copy.emptyGuest : copy.emptyUser}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] font-medium text-pine">
              {isGuest && onStartDemo ? (
                <button type="button" onClick={onStartDemo} className="inline-flex items-center gap-1 underline-offset-4 hover:underline">{copy.emptyDemo}<ArrowRight size={12} /></button>
              ) : null}
              {isGuest ? (
                <Link href="/login" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">{copy.emptyLogin}<ArrowRight size={12} /></Link>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[15px] leading-[1.85] text-ink">
            {view.bio.map((sentence, index) => <span key={index}>{sentence}</span>)}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5 pt-3">
        {view.thread ? (
          <>
            <SectionTitle>{copy.sections.thread}</SectionTitle>
            <div className="group flex items-baseline gap-2.5 border-b border-divider/60 py-2.5">
              <button type="button" onClick={() => onAsk(view.thread!.intent || view.thread!.title)} className="min-w-0 flex-1 text-left text-[13.5px] leading-6 text-ink hover:text-pine">
                {view.thread.title}
              </button>
              <button type="button" onClick={onCompleteThread} disabled={saving} className="shrink-0 text-[11.5px] text-ink-muted transition hover:text-ink md:opacity-0 md:group-hover:opacity-100 disabled:opacity-40">{copy.threadDone}</button>
            </div>
          </>
        ) : null}

        {view.mastery.length > 0 ? (
          <>
            <SectionTitle>{copy.sections.mastery}</SectionTitle>
            <ul>
              {view.mastery.map((row) => (
                <li key={row.concept} className="group flex items-baseline gap-2.5 border-b border-divider/60 py-2.5 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] leading-6 text-ink">{row.concept}</span>
                  <span className={cn('shrink-0 text-[11.5px]', STATUS_TONE[row.status])}>{row.statusLabel}</span>
                  <button type="button" onClick={() => onAsk(row.prompt)} className="shrink-0 text-[11.5px] text-pine transition hover:underline md:opacity-0 md:group-hover:opacity-100">{copy.masteryAsk}</button>
                </li>
              ))}
            </ul>
            {isGuest && !fromAccount ? <p className="mt-1.5 text-[11px] leading-5 text-ink-muted/80">{copy.guestScopeHint}</p> : null}
          </>
        ) : null}

        <SectionTitle>{copy.sections.memories}</SectionTitle>
        <ul>
          {view.memories.map((row) => (
            <MemoryRow
              key={row.id}
              row={row}
              saving={saving}
              onConfirm={onConfirmMemory}
              onEdit={onEditMemory}
              onForget={onForgetMemory}
              onResume={onResumeMemory}
            />
          ))}
          <AddMemoryRow saving={saving} onAdd={onAddMemory} />
        </ul>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-divider px-6 py-3.5">
        <span className="truncate font-mono text-[10.5px] tabular-nums text-ink-muted">{ledger}</span>
        <button type="button" onClick={onOpenAll} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] text-ink-muted transition hover:text-pine">
          {copy.openAll}<ArrowRight size={11} />
        </button>
      </footer>
    </aside>
  );
}
