'use client';

/**
 * IntentCompletionOverlay —— 目标保存成功后的完成态定格。
 *
 * 给对话一个干脆的句号：用户明确知道"这件事成了，可以离开了"。
 * 主按钮离开去主页，次按钮留下来再记一件。
 */

import { Sparkles } from 'lucide-react';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { COPY } from '@/lib/ui/copy';

interface IntentCompletionOverlayProps {
  /** 刚保存的目标标题 */
  title: string;
  /** 主按钮：去主页 */
  onDone: () => void;
  /** 次按钮：再记一件（关闭浮层继续聊） */
  onContinue: () => void;
}

export function IntentCompletionOverlay({ title, onDone, onContinue }: IntentCompletionOverlayProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-paper/85 px-6 backdrop-blur-sm">
      <div
        className="flex w-full max-w-sm flex-col items-center rounded-3xl border border-divider bg-white px-8 py-10 text-center shadow-card"
        style={{ animation: 'intentFadeUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}
      >
        <OctoAvatar mood="happy" size="lg" aura />
        <p
          className="mt-5 text-[22px] text-ink"
          style={{ fontFamily: '"Instrument Serif", "Inter", serif' }}
        >
          {COPY.intent.doneTitle}
        </p>
        <p className="mt-3 rounded-2xl bg-pine-mist/40 px-4 py-2.5 text-[14.5px] leading-6 text-pine">
          {title}
        </p>
        <p className="mt-4 text-[12.5px] leading-5 text-ink-muted">{COPY.intent.doneHint}</p>
        <div className="mt-7 flex w-full flex-col gap-2.5">
          <button
            type="button"
            onClick={onDone}
            className="inline-flex h-11 w-full items-center justify-center rounded-full bg-pine text-[14px] font-medium text-white transition-all hover:brightness-105 active:scale-[0.97]"
          >
            {COPY.intent.donePrimary}
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-divider bg-white text-[14px] font-medium text-ink-secondary transition-colors hover:bg-paper-warm"
          >
            <Sparkles size={14} strokeWidth={1.8} />
            {COPY.intent.doneSecondary}
          </button>
        </div>
      </div>
    </div>
  );
}

export default IntentCompletionOverlay;
