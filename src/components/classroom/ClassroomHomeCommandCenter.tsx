'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, FilePlus2, Search } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

export interface ClassroomHomeCommandCenterProps {
  onAddMaterial?: () => void;
  onSearch?: () => void;
  recoverySlot?: ReactNode;
}

function formatTodayLabel(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric' }).format(now);
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(now);
  return `${date} · ${weekday}`;
}

export function ClassroomHomeCommandCenter({
  onAddMaterial,
  onSearch,
  recoverySlot,
}: ClassroomHomeCommandCenterProps) {
  return (
    <header className="flex-shrink-0 px-8 pb-3 pt-7 lg:px-12 lg:pt-9">
      <div className="mx-auto w-full max-w-4xl">
        <section className="relative overflow-hidden rounded-[22px] border border-pine/14 bg-card shadow-soft">
          <span className="absolute left-0 top-6 h-10 w-[3px] rounded-r-full bg-vermilion" aria-hidden />

          <div className="min-w-0 px-6 py-5 lg:px-7 lg:py-6">
            <p className="font-mono text-[10px] font-medium tracking-[0.08em] text-ink-muted">
              {formatTodayLabel()}
            </p>

            <h1 className="mt-3 max-w-[680px] text-[28px] font-semibold leading-[1.12] tracking-[-0.04em] text-ink lg:text-[30px]">
              {COPY.classroomHome.title}
            </h1>

            {recoverySlot ? <div className="mt-4">{recoverySlot}</div> : null}

            {(onSearch || onAddMaterial) ? (
              <div className="mt-4 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
                {onSearch ? (
                  <button
                    type="button"
                    onClick={onSearch}
                    className="group flex min-h-12 min-w-0 items-center gap-3 rounded-[15px] border border-pine/14 bg-pine-fog px-4 text-left transition hover:border-pine/25 hover:bg-pine-mist"
                  >
                    <Search size={16} strokeWidth={1.9} className="flex-shrink-0 text-pine" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">
                      {COPY.classroomHome.actionSearchTitle}
                    </span>
                    <ArrowUpRight size={14} className="flex-shrink-0 text-pine transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </button>
                ) : null}

                {onAddMaterial ? (
                  <button
                    type="button"
                    onClick={onAddMaterial}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-[15px] border border-divider bg-paper px-4 text-[13px] font-medium text-ink-secondary transition hover:border-pine/25 hover:text-pine"
                  >
                    <FilePlus2 size={15} strokeWidth={1.9} />
                    <span>{COPY.classroomHome.actionMaterialTitle}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </header>
  );
}

export default ClassroomHomeCommandCenter;
