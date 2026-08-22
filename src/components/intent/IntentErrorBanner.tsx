'use client';

/**
 * IntentErrorBanner —— 对话请求失败 / 卡死看门狗掐断时的错误条。
 *
 * 原则：永远不让用户面对一个"没反应"的对话框——
 * 失败必须可见，并且一键重试。
 */

import { COPY } from '@/lib/ui/copy';

interface IntentErrorBannerProps {
  onRetry: () => void;
  onDismiss: () => void;
}

export function IntentErrorBanner({ onRetry, onDismiss }: IntentErrorBannerProps) {
  return (
    <div className="relative z-10 mx-auto -mt-1 mb-2 flex w-full max-w-2xl items-center justify-between gap-3 rounded-2xl border border-vermilion/20 bg-vermilion-mist/25 px-4 py-2.5">
      <p className="text-[13px] leading-5 text-vermilion">{COPY.intent.errorBanner}</p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center rounded-full bg-vermilion px-3.5 text-[12.5px] font-medium text-white transition-all hover:brightness-105 active:scale-95"
        >
          {COPY.intent.errorRetry}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[12px] text-ink-muted transition-colors hover:text-ink-secondary"
        >
          {COPY.intent.errorDismiss}
        </button>
      </div>
    </div>
  );
}

export default IntentErrorBanner;
