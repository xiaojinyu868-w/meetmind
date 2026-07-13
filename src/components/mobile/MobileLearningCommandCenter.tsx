'use client';

import React from 'react';
import {
  AudioLines,
  Brain,
  Camera,
  FilePlus2,
  Layers3,
  MessageSquareText,
  Mic,
  Newspaper,
  Search,
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

const CAPABILITIES = [
  { key: 'flow', label: COPY.mobileHome.capabilityFlow, icon: AudioLines },
  { key: 'qa', label: COPY.mobileHome.capabilityQa, icon: MessageSquareText },
  { key: 'flashcards', label: COPY.mobileHome.capabilityFlashcards, icon: Layers3 },
  { key: 'quiz', label: COPY.mobileHome.capabilityQuiz, icon: Brain },
  { key: 'mindmap', label: COPY.mobileHome.capabilityMindmap, icon: Sparkles },
  { key: 'feed', label: COPY.mobileHome.capabilityFeed, icon: Newspaper },
] as const;

export function MobileLearningCommandCenter({
  contextCount,
  onStartRecording,
  onAddMaterial,
  onCapturePhoto,
  onSearch,
}: MobileLearningCommandCenterProps) {
  return (
    <section aria-label={COPY.mobileHome.commandCenterLabel}>
      <div className="overflow-hidden rounded-[24px] border border-pine/15 bg-pine-fog text-ink">
        <div className="px-5 pb-5 pt-4.5">
          <div className="flex items-center">
            <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-pine/10 bg-white px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-pine">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pine opacity-20" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pine" />
              </span>
              {COPY.mobileHome.contextStatus(contextCount)}
            </div>
          </div>

          <h1 className="mt-5 max-w-[20rem] text-[28px] font-semibold leading-[1.1] tracking-[-0.045em] text-ink">
            {COPY.mobileHome.title}
          </h1>
          <p className="mt-3 max-w-[31rem] text-[12.5px] leading-[1.75] text-ink-secondary">
            {COPY.mobileHome.body}
          </p>

          <button
            type="button"
            onClick={onStartRecording}
            className="mt-5 flex w-full items-center justify-between rounded-[15px] bg-pine px-4 py-3.5 text-left text-white transition hover:bg-pine-deep active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/14 text-white">
                <Mic size={16} strokeWidth={2} />
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold">{COPY.mobileHome.record}</span>
                <span className="mt-0.5 block text-[10.5px] text-white/70">{COPY.mobileHome.recordHint}</span>
              </span>
            </span>
          </button>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <CommandAction icon={FilePlus2} label={COPY.mobileHome.addMaterial} onClick={onAddMaterial} />
            <CommandAction icon={Camera} label={COPY.mobileHome.photo} onClick={onCapturePhoto} />
            <CommandAction icon={Search} label={COPY.mobileHome.search} onClick={onSearch} />
          </div>
        </div>

        <div className="border-t border-pine/10 bg-white/70 px-4 py-3.5">
          <p className="px-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.11em] text-pine/70">
            {COPY.mobileHome.capabilityLabel}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5">
            {CAPABILITIES.map(({ key, label, icon: Icon }) => (
              <span key={key} className="flex min-w-0 items-center gap-1.5 rounded-[9px] px-1.5 py-1.5 text-[10.5px] text-ink-secondary">
                <Icon size={11} strokeWidth={1.8} className="flex-shrink-0 text-pine/70" />
                <span className="truncate">{label}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CommandAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof FilePlus2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-col items-start gap-2 rounded-[13px] border border-divider bg-white px-3 py-3 text-left text-ink-secondary transition hover:border-pine/25 hover:text-pine active:scale-[0.98] active:bg-pine-mist/40"
    >
      <Icon size={14} strokeWidth={1.8} />
      <span className="truncate text-[10.5px] font-medium">{label}</span>
    </button>
  );
}

export default MobileLearningCommandCenter;
