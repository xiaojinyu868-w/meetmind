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
  onStartRecording: () => void;
  onAddMaterial: () => void;
  onCapturePhoto: () => void;
  onSearch: () => void;
}

export function MobileLearningCommandCenter({
  onStartRecording,
  onAddMaterial,
  onCapturePhoto,
  onSearch,
}: MobileLearningCommandCenterProps) {
  return (
    <section aria-label={COPY.mobileHome.commandCenterLabel}>
      <div className="rounded-[26px] border border-divider bg-card px-5 pb-5 pt-6 text-ink shadow-soft">
          <span className="block h-1 w-9 rounded-full bg-vermilion" aria-hidden />
          <h1 className="mt-5 max-w-[19rem] font-serif text-[32px] font-medium leading-[1.08] tracking-[-0.035em] text-ink">
            {COPY.mobileHome.title}
          </h1>

          <button
            type="button"
            onClick={onStartRecording}
            className="mt-5 flex min-h-[58px] w-full items-center rounded-[17px] bg-pine px-4 text-left text-white transition hover:bg-pine-deep active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-pine">
                <Mic size={17} strokeWidth={2} />
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-pine bg-vermilion" aria-hidden />
              </span>
              <span className="text-[15px] font-semibold">{COPY.mobileHome.record}</span>
            </span>
          </button>

          <div className="mt-2.5 grid grid-cols-3 gap-2.5">
            <CommandAction icon={Sparkles} label={COPY.mobileHome.search} onClick={onSearch} featured />
            <CommandAction icon={FilePlus2} label={COPY.mobileHome.addMaterial} onClick={onAddMaterial} />
            <CommandAction icon={Camera} label={COPY.mobileHome.photo} onClick={onCapturePhoto} />
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
      className={`flex min-h-[64px] min-w-0 flex-col items-center justify-center gap-1.5 rounded-[14px] border px-1.5 text-center text-[12.5px] font-medium transition active:scale-[0.98] ${featured ? 'border-vermilion/22 bg-vermilion-fog text-vermilion' : 'border-divider bg-white text-ink-secondary hover:border-pine/25 hover:text-pine'}`}
    >
      <Icon size={16} strokeWidth={1.9} />
      <span className="w-full whitespace-nowrap leading-4">{label}</span>
    </button>
  );
}

export default MobileLearningCommandCenter;
