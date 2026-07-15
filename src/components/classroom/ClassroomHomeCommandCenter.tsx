'use client';

import type { ReactNode } from 'react';
import { ArrowUpRight, AudioLines, FilePlus2, Network, Search, Shapes } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  const capabilities: Array<{ key: string; icon: LucideIcon; title: string }> = [
    {
      key: 'listen',
      icon: AudioLines,
      title: COPY.classroomHome.capabilityListenTitle,
    },
    {
      key: 'connect',
      icon: Network,
      title: COPY.classroomHome.capabilityConnectTitle,
    },
    {
      key: 'practice',
      icon: Shapes,
      title: COPY.classroomHome.capabilityPracticeTitle,
    },
  ];

  const actions = [
    onSearch ? {
      key: 'search',
      icon: Search,
      title: COPY.classroomHome.actionSearchTitle,
      body: COPY.classroomHome.actionSearchBody,
      onClick: onSearch,
    } : null,
    onAddMaterial ? {
      key: 'material',
      icon: FilePlus2,
      title: COPY.classroomHome.actionMaterialTitle,
      body: COPY.classroomHome.actionMaterialBody,
      onClick: onAddMaterial,
    } : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  return (
    <header className="flex-shrink-0 px-8 pb-4 pt-8 lg:px-12 lg:pt-10">
      <div className="mx-auto w-full max-w-4xl">
        <section className="relative overflow-hidden rounded-[26px] border border-pine/14 bg-card shadow-soft">
          <span className="absolute left-0 top-8 h-12 w-[3px] rounded-r-full bg-vermilion" aria-hidden />

          <div className="min-w-0 px-6 py-6 lg:px-8 lg:py-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-[10px] font-medium tracking-[0.08em] text-ink-muted">
                  {formatTodayLabel()}
                </p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pine/10 bg-pine-fog px-2.5 py-1 text-[10px] font-medium text-pine">
                  <span className="h-1.5 w-1.5 rounded-full bg-pine" aria-hidden />
                  {COPY.classroomHome.contextStatus}
                </span>
              </div>

              <h1 className="mt-5 max-w-[680px] text-[34px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink">
                {COPY.classroomHome.title}
              </h1>
              <p className="mt-2.5 max-w-[610px] text-[14px] leading-6 text-ink-secondary">
                {COPY.classroomHome.subtitle}
              </p>

              {recoverySlot ? <div className="mt-5">{recoverySlot}</div> : null}

              {actions.length > 0 ? (
                <div className={`mt-5 grid gap-2.5 ${actions.length > 1 ? 'sm:grid-cols-2' : ''}`}>
                  {actions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.key}
                        type="button"
                        onClick={action.onClick}
                        className="group flex min-w-0 items-center gap-3 rounded-[16px] border border-divider bg-paper px-4 py-3 text-left transition hover:border-pine/25 hover:bg-pine-fog"
                      >
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] bg-white text-pine ring-1 ring-divider">
                          <Icon size={15} strokeWidth={1.9} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-ink">{action.title}</span>
                          <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{action.body}</span>
                        </span>
                        <ArrowUpRight size={13} className="flex-shrink-0 text-ink-muted transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-pine" />
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-divider pt-4" aria-label={COPY.classroomHome.capabilityLabel}>
                {capabilities.map(({ key, icon: Icon, title }, index) => (
                  <div key={key} className="flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
                    <span className="font-mono text-[9px] text-vermilion">0{index + 1}</span>
                    <Icon size={14} strokeWidth={1.8} className="text-pine" />
                    <span>{title}</span>
                  </div>
                ))}
              </div>
          </div>
        </section>
      </div>
    </header>
  );
}

export default ClassroomHomeCommandCenter;
