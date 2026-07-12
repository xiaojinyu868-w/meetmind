'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { COPY } from '@/lib/ui/copy';

interface AppLoadingProps {
  /** 外部传入的真实进度 0-100；不传时显示安静的循环进度。 */
  progress?: number;
  /** 可选状态文字，只用于真实的用户过程，不展示工程阶段。 */
  message?: string;
  onComplete?: () => void;
}

/**
 * AppLoading — 产品进入时的品牌过渡。
 *
 * 加载页不是展示技术过程的仪表盘。用户只需要知道：学习现场正在接回来，
 * 产品没有卡住。视觉与课堂页共享米白纸感、墨绿状态和 Octo，不另造一套风格。
 */
export function AppLoading({ progress, message, onComplete }: AppLoadingProps) {
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);

  useEffect(() => {
    if (progress === undefined) return;
    const target = Math.max(0, Math.min(100, progress));
    let frameId = 0;

    const animate = () => {
      setDisplayProgress((current) => {
        const distance = target - current;
        if (Math.abs(distance) < 0.4) return target;
        frameId = requestAnimationFrame(animate);
        return current + distance * 0.16;
      });
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [progress]);

  useEffect(() => {
    if (progress !== 100 || !onComplete) return;
    const fadeTimer = window.setTimeout(() => setIsFadingOut(true), 80);
    const completeTimer = window.setTimeout(onComplete, 300);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(completeTimer);
    };
  }, [onComplete, progress]);

  const isIndeterminate = progress === undefined;
  const statusText = message || COPY.loading.restoring;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-paper px-6 transition-opacity duration-200 ${
        isFadingOut ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
      role="status"
      aria-live="polite"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[42%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-pine/[0.045] blur-3xl"
      />

      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative flex h-[72px] w-[72px] items-center justify-center rounded-[22px] border border-divider bg-white shadow-[0_12px_36px_rgba(28,27,25,0.07)]">
          <span className="absolute inset-2 rounded-2xl bg-pine/[0.055]" aria-hidden />
          <Image
            src="/images/octo-buddy/idle.png"
            alt=""
            aria-hidden
            width={48}
            height={48}
            priority
            unoptimized
            className="relative h-12 w-12 object-contain"
          />
        </div>

        <p className="mt-6 text-[18px] font-semibold tracking-[-0.025em] text-ink">MeetMind</p>
        <h1 className="mt-2 text-[14px] font-medium text-ink-secondary">
          {COPY.identity.tagline}
        </h1>

        <div className="mt-10 w-full max-w-[260px]">
          <div className="relative h-[2px] overflow-hidden rounded-full bg-divider">
            {isIndeterminate ? (
              <span className="absolute inset-y-0 w-1/3 rounded-full bg-pine animate-[loading-glide_1.4s_ease-in-out_infinite]" />
            ) : (
              <span
                className="absolute inset-y-0 left-0 rounded-full bg-pine transition-[width] duration-150"
                style={{ width: `${displayProgress}%` }}
              />
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 font-mono text-[10px] tracking-[0.03em] text-ink-muted">
            <span>{statusText}</span>
            {!isIndeterminate ? <span>{Math.round(displayProgress)}%</span> : null}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes loading-glide {
          0% { left: -34%; opacity: 0.35; }
          45% { opacity: 1; }
          100% { left: 100%; opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

export default AppLoading;
