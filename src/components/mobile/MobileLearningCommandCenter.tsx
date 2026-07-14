'use client';

import React from 'react';
import {
  Camera,
  FilePlus2,
  Mic,
  Sparkles,
} from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

export interface MobileLearningCommandCenterProps {
  contextCount: number;
  onStartRecording: () => void;
  onAddMaterial: () => void;
  onCapturePhoto: () => void;
  onSearch: () => void;
}

export function MobileLearningCommandCenter({
  contextCount,
  onStartRecording,
  onAddMaterial,
  onCapturePhoto,
  onSearch,
}: MobileLearningCommandCenterProps) {
  return (
    <section aria-label={COPY.mobileHome.commandCenterLabel}>
      <div className="overflow-hidden rounded-[26px] border border-divider bg-card text-ink">
        <div className="px-5 pb-5 pt-5">
          <div className="flex items-center justify-between gap-3 text-[12px] font-medium">
            <span className="inline-flex items-center gap-2 text-vermilion">
              <span className="h-2 w-2 rounded-full bg-vermilion" aria-hidden />
              {COPY.mobileHome.eyebrow}
            </span>
            {contextCount > 0 ? (
              <span className="text-ink-muted">{COPY.mobileHome.contextStatus(contextCount)}</span>
            ) : null}
          </div>

          <h1 className="mt-4 max-w-[19rem] font-serif text-[31px] font-medium leading-[1.08] tracking-[-0.035em] text-ink">
            {COPY.mobileHome.title}
          </h1>
          <p className="mt-3 max-w-[20rem] text-[14px] leading-6 text-ink-secondary">
            {COPY.mobileHome.body}
          </p>

          <button
            type="button"
            onClick={onStartRecording}
            className="mt-5 flex min-h-[60px] w-full items-center justify-between rounded-[17px] bg-pine px-4 text-left text-white transition hover:bg-pine-deep active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-pine">
                <Mic size={17} strokeWidth={2} />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-pine bg-vermilion" aria-hidden />
              </span>
              <span className="text-[15px] font-semibold">{COPY.mobileHome.record}</span>
            </span>
            <span className="text-[13px] text-white/75">{COPY.mobileHome.recordHint}</span>
          </button>

          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
            <CommandAction icon={Sparkles} label={COPY.mobileHome.search} onClick={onSearch} featured />
            <CommandAction icon={FilePlus2} label={COPY.mobileHome.addMaterial} onClick={onAddMaterial} />
            <CommandAction icon={Camera} label={COPY.mobileHome.photo} onClick={onCapturePhoto} />
          </div>
        </div>

        <div className="grid grid-cols-2 border-t border-divider bg-paper/70 text-[12.5px] text-ink-secondary">
          <span className="border-r border-divider px-5 py-3.5">{COPY.mobileHome.livePromise}</span>
          <span className="px-5 py-3.5">{COPY.mobileHome.afterClassPromise}</span>
        </div>
      </div>
    </section>
  );
}

function CommandAction({
  icon: Icon,
  label,
  onClick,
  featured = false,
}: {
  icon: typeof FilePlus2;
  label: string;
  onClick: () => void;
  featured?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[58px] min-w-0 items-center justify-center gap-2 rounded-[14px] border px-2 text-center text-[13px] font-medium transition active:scale-[0.98] ${featured ? 'border-vermilion/22 bg-vermilion-fog text-vermilion' : 'border-divider bg-white text-ink-secondary hover:border-pine/25 hover:text-pine'}`}
    >
      <Icon size={16} strokeWidth={1.9} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export default MobileLearningCommandCenter;
