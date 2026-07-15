'use client';

import Image from 'next/image';
import { ArrowUp, Mic, Paperclip, Play, Sparkles } from 'lucide-react';
import { COPY } from '@/lib/ui/copy';

export interface MobileFirstLearningScreenProps {
  onStartRecording: () => void;
  onAddMaterial: () => void;
  onAsk?: () => void;
  onTryDemo?: () => void;
  onBrowse: () => void;
}

export function MobileFirstLearningScreen({
  onStartRecording,
  onAddMaterial,
  onAsk,
  onTryDemo,
  onBrowse,
}: MobileFirstLearningScreenProps) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-paper px-5 pb-8 pt-[max(env(safe-area-inset-top),24px)] m-page-in mm-mobile-scroll">
      <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 overflow-hidden rounded-[14px] bg-pine-mist m-octo-breath">
              <Image src="/images/octo-buddy/idle.png" alt="" width={40} height={40} className="h-full w-full object-cover" priority />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-ink">{COPY.identity.productName}</p>
            </div>
          </div>
          <span className="h-2 w-2 rounded-full bg-vermilion" aria-hidden />
        </div>

        <section className="relative mt-8 overflow-hidden rounded-[26px] border border-pine/14 bg-card px-5 pb-5 pt-7 shadow-soft">
          <span className="absolute left-0 top-7 h-11 w-[3px] rounded-r-full bg-vermilion" aria-hidden />
          <h1 className="text-[32px] font-semibold leading-[1.12] tracking-[-0.045em] text-ink">
            {COPY.mobileHome.emptyTitle}
          </h1>
          <p className="mt-3 text-[14px] leading-6 text-ink-secondary">
            {COPY.mobileHome.emptyBody}
          </p>

          <button
            type="button"
            onClick={onStartRecording}
            className="mt-6 flex min-h-[54px] w-full items-center justify-between rounded-[17px] bg-pine px-4 text-left text-white transition active:scale-[0.99]"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-white/10">
                <Mic size={17} strokeWidth={2} />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">{COPY.mobileHome.record}</span>
                <span className="mt-0.5 block text-[12px] text-white/75">{COPY.mobileHome.emptyRecordHint}</span>
              </span>
            </span>
            <ArrowUp size={16} className="rotate-90" />
          </button>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onAddMaterial}
              className="flex min-h-[70px] flex-col justify-between rounded-[17px] border border-divider bg-paper px-4 py-3.5 text-left transition active:scale-[0.99]"
            >
              <Paperclip size={17} className="text-pine" />
              <span className="text-[14px] font-semibold text-ink">{COPY.mobileHome.addMaterial}</span>
            </button>
            <button
              type="button"
              onClick={onAsk}
              disabled={!onAsk}
              className="flex min-h-[70px] flex-col justify-between rounded-[17px] border border-divider bg-paper px-4 py-3.5 text-left transition active:scale-[0.99] disabled:opacity-40"
            >
              <Sparkles size={17} className="text-vermilion" />
              <span className="text-[14px] font-semibold text-ink">{COPY.mobileHome.search}</span>
            </button>
          </div>

          {onTryDemo ? (
            <button
              type="button"
              onClick={onTryDemo}
              className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[15px] border border-pine/20 bg-pine-fog text-[14px] font-semibold text-pine transition active:scale-[0.99]"
            >
              <Play size={15} fill="currentColor" />
              {COPY.mobileHome.tryDemo}
            </button>
          ) : null}
        </section>

        <button
          type="button"
          onClick={onBrowse}
          className="mx-auto mt-auto pt-8 text-[13px] font-medium text-ink-muted"
        >
          {COPY.mobileHome.emptyBrowse}
        </button>
      </div>
    </div>
  );
}

export default MobileFirstLearningScreen;
