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
      <div className="overflow-hidden rounded-[24px] border border-ink bg-ink text-white">
        <div className="px-5 pb-5 pt-4.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.13em] text-white/58">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-25" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/85" />
              </span>
              {COPY.mobileHome.contextStatus(contextCount)}
            </div>
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/38">
              {COPY.mobileHome.systemStatus}
            </span>
          </div>

          <h1 className="mt-5 max-w-[19rem] text-[29px] font-semibold leading-[1.08] tracking-[-0.045em] text-white">
            {COPY.mobileHome.title}
          </h1>
          <p className="mt-3 max-w-[31rem] text-[12.5px] leading-[1.75] text-white/62">
            {COPY.mobileHome.body}
          </p>

          <button
            type="button"
            onClick={onStartRecording}
            className="mt-5 flex w-full items-center justify-between rounded-[15px] bg-white px-4 py-3.5 text-left text-ink transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-vermilion-mist text-vermilion">
                <Mic size={16} strokeWidth={2} />
              </span>
              <span>
                <span className="block text-[13.5px] font-semibold">{COPY.mobileHome.record}</span>
                <span className="mt-0.5 block text-[10.5px] text-ink-muted">{COPY.mobileHome.recordHint}</span>
              </span>
            </span>
          </button>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <CommandAction icon={FilePlus2} label={COPY.mobileHome.addMaterial} onClick={onAddMaterial} />
            <CommandAction icon={Camera} label={COPY.mobileHome.photo} onClick={onCapturePhoto} />
            <CommandAction icon={Search} label={COPY.mobileHome.search} onClick={onSearch} />
          </div>
        </div>

        <div className="border-t border-white/10 bg-white/[0.035] px-4 py-3.5">
          <p className="px-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.13em] text-white/42">
            {COPY.mobileHome.capabilityLabel}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5">
            {CAPABILITIES.map(({ key, label, icon: Icon }) => (
              <span key={key} className="flex min-w-0 items-center gap-1.5 rounded-[9px] px-1.5 py-1.5 text-[10.5px] text-white/68">
                <Icon size={11} strokeWidth={1.8} className="flex-shrink-0 text-white/42" />
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
      className="flex min-w-0 flex-col items-start gap-2 rounded-[13px] border border-white/12 bg-white/[0.045] px-3 py-3 text-left text-white/72 transition active:scale-[0.98] active:bg-white/[0.08]"
    >
      <Icon size={14} strokeWidth={1.8} />
      <span className="truncate text-[10.5px] font-medium">{label}</span>
    </button>
  );
}

export default MobileLearningCommandCenter;
