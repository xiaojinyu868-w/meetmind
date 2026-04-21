'use client';

/**
 * SoftHint — 极简轻提示
 *
 * 设计理念：
 * - 一行字、一次到达、自动消失，不打断用户
 * - 无按钮、无遮罩、无模态（轻提示不该让用户付代价）
 * - 遵循 MeetMind 设计系统：零渐变、零阴影、纯平涂
 *
 * 用法：
 *   {hint ? <SoftHint text={hint} onDismiss={() => setHint(null)} /> : null}
 */

import { useEffect, useState } from 'react';

const AUTO_DISMISS_MS = 2600;

interface SoftHintProps {
  text: string;
  onDismiss: () => void;
  /** 可选：自定义持续时间 */
  durationMs?: number;
}

export function SoftHint({ text, onDismiss, durationMs = AUTO_DISMISS_MS }: SoftHintProps) {
  const [visible, setVisible] = useState(false);

  // 入场动画
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // 自动消失
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(), 260);
    }, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  return (
    <div
      className="fixed bottom-10 left-1/2 z-[260] -translate-x-1/2 pointer-events-none"
      style={{
        opacity: visible ? 1 : 0,
        transform: `translateX(-50%) translateY(${visible ? '0' : '8px'})`,
        transition: 'opacity 0.26s ease, transform 0.26s ease',
      }}
    >
      <div className="rounded-full border border-[#E9E9E7] bg-white px-4 py-2">
        <p className="text-[13px] leading-none text-[#232322]">{text}</p>
      </div>
    </div>
  );
}

export default SoftHint;
