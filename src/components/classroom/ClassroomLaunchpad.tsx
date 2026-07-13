'use client';

import React from 'react';
import { ArrowUpRight, FilePlus2, Mic, Search } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

export interface ClassroomLaunchpadProps {
  onStartRecording: () => void;
  onAddMaterial?: () => void;
  onSearch?: () => void;
  showRecord?: boolean;
  compact?: boolean;
}

export function ClassroomLaunchpad({
  onStartRecording,
  onAddMaterial,
  onSearch,
  showRecord = true,
  compact = false,
}: ClassroomLaunchpadProps) {
  const actions = [
    ...(showRecord ? [{
      key: 'record',
      title: COPY.classroomHome.actionRecordTitle,
      body: COPY.classroomHome.actionRecordBody,
      label: COPY.classroomHome.actionRecordLabel,
      icon: Mic,
      onClick: onStartRecording,
    }] : []),
    ...(onAddMaterial ? [{
      key: 'material',
      title: COPY.classroomHome.actionMaterialTitle,
      body: COPY.classroomHome.actionMaterialBody,
      label: COPY.classroomHome.actionMaterialLabel,
      icon: FilePlus2,
      onClick: onAddMaterial,
    }] : []),
    ...(onSearch ? [{
      key: 'search',
      title: COPY.classroomHome.actionSearchTitle,
      body: COPY.classroomHome.actionSearchBody,
      label: COPY.classroomHome.actionSearchLabel,
      icon: Search,
      onClick: onSearch,
    }] : []),
  ];

  if (actions.length === 0) return null;

  return (
    <section aria-label={COPY.classroomHome.launchpadTitle}>
      {!compact ? (
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-[12px] font-semibold text-ink-secondary">{COPY.classroomHome.launchpadTitle}</h2>
          <span className="text-[11.5px] text-ink-muted">{COPY.classroomHome.launchpadHint}</span>
        </div>
      ) : null}
      <div className={`grid gap-2 ${actions.length === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.key}
              type="button"
              onClick={action.onClick}
              className={`group flex items-start gap-3 rounded-[18px] border border-divider bg-white text-left transition hover:border-pine/30 hover:bg-pine-mist/20 ${
                compact ? 'px-3.5 py-3.5' : 'px-4 py-4'
              }`}
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[12px] bg-paper-warm text-ink-secondary transition group-hover:bg-pine-mist group-hover:text-pine">
                <Icon size={16} strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-ink">{action.title}</span>
                <span className="mt-1 block text-[11.5px] leading-[1.55] text-ink-muted">{action.body}</span>
                <span className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-medium text-pine">
                  {action.label}
                  <ArrowUpRight size={11} />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
