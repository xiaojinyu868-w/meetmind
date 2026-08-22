'use client';

/**
 * IntentOptionChips —— 目标共建的果冻选项（Elys 式精致软行）。
 *
 * 交互：点一下即作答。视觉对标成熟产品的 quick-reply：
 * 整行软卡（不是小药丸）——更好点、读起来更安静；
 * 依次浮入（stagger + spring 回弹），按下果冻压缩，松手弹回；
 * 行尾一枚极淡的箭头，暗示"点了就走"。
 */

import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';

interface IntentOptionChipsProps {
  options: string[];
  /** 点选某个选项（通常直接作为用户消息发出） */
  onPick: (option: string) => void;
  /** 对话进行中禁用 */
  disabled?: boolean;
}

const JELLY_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function IntentOptionChips({ options, onPick, disabled }: IntentOptionChipsProps) {
  // stagger 入场：挂载后依次点亮
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(t);
  }, []);

  if (options.length === 0) return null;

  return (
    <div className="flex w-full flex-col gap-2" role="group" aria-label="快速回答">
      {options.map((option, idx) => (
        <button
          key={`${idx}-${option}`}
          type="button"
          disabled={disabled}
          onClick={() => onPick(option)}
          className="group inline-flex w-full items-center justify-between gap-3 rounded-2xl border border-divider/70 bg-white/85 px-4 py-3 text-left text-[14px] leading-6 text-ink shadow-[0_1px_3px_rgba(20,17,13,0.04)] backdrop-blur-sm transition-colors hover:border-pine/40 hover:bg-pine-mist/30 active:bg-pine-mist/50 disabled:opacity-45"
          style={{
            opacity: entered ? 1 : 0,
            transform: entered ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
            transition: `opacity 0.3s ease ${idx * 80}ms, transform 0.45s ${JELLY_EASE} ${idx * 80}ms, background-color 0.15s ease, border-color 0.15s ease`,
          }}
          onPointerDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.965)';
            e.currentTarget.style.transition = 'transform 0.1s ease-out';
          }}
          onPointerUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.transition = `transform 0.5s ${JELLY_EASE}`;
          }}
          onPointerLeave={(e) => {
            if (!entered) return;
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.transition = `transform 0.5s ${JELLY_EASE}, background-color 0.15s ease, border-color 0.15s ease`;
          }}
        >
          <span className="min-w-0 flex-1">{option}</span>
          <ArrowRight
            size={14}
            strokeWidth={1.8}
            className="shrink-0 text-ink-muted/50 transition-all group-hover:translate-x-0.5 group-hover:text-pine"
          />
        </button>
      ))}
    </div>
  );
}

export default IntentOptionChips;
