'use client';

/**
 * LessonEndRitual — 录课结束的收尾（PRODUCT_TASTE 仪式时刻 #4：屏幕中央极简收束，像合上一本笔记）。
 *
 * 点「结束这节课」的那一刻，一页纸在屏幕中央浮起：「这节课我听完了。共 47 句，标了 2 处你标的困惑。」
 * 停住让人读完，沿左边合上，消散——≈1.3s，pointer-events none，不挡下一屏（示例课直接进复习页、
 * 真实录课回到课堂列表的"正在理解"卡）。它不是 loading，不承担等待；只是给"下课"这个动作一个落点。
 *
 * 为什么走 window 事件而不是 props：触发方 ClassroomView 在示例课结束的同一帧就被复习布局替换掉，
 * 挂在它里面的仪式活不过第一帧。Host 挂在 page 根部，谁结束都能放。
 */

import { useEffect, useState } from 'react';
import { COPY } from '@/lib/ui/copy';

export interface LessonEndRitualInput {
  sentences: number;
  confusions: number;
}

const EVENT = 'meetmind:lesson-end';
const DURATION_MS = 1300;

/** 结课的一刻调用一次；Host 未挂载时静默无事 */
export function announceLessonEnd(detail: LessonEndRitualInput): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<LessonEndRitualInput>(EVENT, { detail }));
}

export function LessonEndRitualHost() {
  const [active, setActive] = useState<(LessonEndRitualInput & { key: number }) | null>(null);

  useEffect(() => {
    let timer = 0;
    const onEnd = (event: Event) => {
      const detail = (event as CustomEvent<LessonEndRitualInput>).detail;
      if (!detail) return;
      setActive({ ...detail, key: Date.now() });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setActive(null), DURATION_MS + 50);
    };
    window.addEventListener(EVENT, onEnd);
    return () => {
      window.removeEventListener(EVENT, onEnd);
      window.clearTimeout(timer);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      key={active.key}
      className="pointer-events-none fixed inset-0 z-[300] flex items-center justify-center"
      role="status"
      aria-live="polite"
      data-testid="lesson-end-ritual"
    >
      <div className="mm-notebook-veil absolute inset-0 bg-paper/70 backdrop-blur-[2px]" aria-hidden />
      <div className="mm-notebook-page relative w-[320px] rounded-[22px] border border-pine/15 bg-card px-7 py-7 shadow-[0_24px_70px_rgba(28,27,25,0.16)]">
        <span className="block h-1 w-10 rounded-full bg-pine" aria-hidden />
        <p className="mt-5 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-ink">{COPY.stop.heard}</p>
        <p className="mt-2 text-[13px] leading-6 text-ink-secondary">{COPY.stop.summary(active.sentences, active.confusions)}</p>
      </div>
    </div>
  );
}
