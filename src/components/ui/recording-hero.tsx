'use client';

/**
 * MeetMind v7 · RecordingHero
 *
 * 录课中的仪式时刻——v7 设计宪法第 2 节"6 个允许放飞场景"之一。
 *
 * 视觉哲学：
 * - 录课不是"在跑后台任务"，是**学习开始的仪式**
 * - 呼吸球是主角，占屏幕较大面积，让学生肉眼看见"AI 在听"
 * - 朱批红 rec-dot 标记"此刻"——不是刺眼的红警示灯，是老师笔尖的红
 * - 波形不是实时音量，是节奏——让"声音被理解"被肉眼看见
 *
 * 三种气质：
 *   - mood='listening'  : Octo 在听课的安静呼吸（默认）
 *   - mood='thinking'   : 录后处理时的整理状态
 *   - mood='paused'     : 暂停状态，呼吸球冻结但 IP 仍在场
 */

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

export interface RecordingHeroProps {
  /** 当前状态 */
  status?: 'listening' | 'thinking' | 'paused' | 'idle';
  /** 已录时长（秒），用于显示在主中央 */
  elapsedSec?: number;
  /** 副标题：课程标题或"麦克风录音 + 电脑声音" */
  subtitle?: string;
  /** 顶部 eyebrow：通常是 "正在听这节课" / "等你开口" */
  eyebrow?: string;
  /** 实时音量 0-1 范围（用于波形条幅，可选） */
  level?: number;
  /** 紧凑型（嵌入侧栏）vs 完整型（主屏幕） */
  variant?: 'compact' | 'hero';
  /** 操作槽：通常是停止 / 暂停按钮 */
  actions?: React.ReactNode;
  className?: string;
}

const MOOD_ASSET: Record<NonNullable<RecordingHeroProps['status']>, string> = {
  listening: '/images/octo-buddy/excited.png',
  thinking: '/images/octo-buddy/thinking.png',
  paused: '/images/octo-buddy/idle.png',
  idle: '/images/octo-buddy/sleeping.png',
};

function formatElapsed(sec: number): string {
  const s = Math.floor(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) {
    return `${hh}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
  }
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

/** 实时波形条 8 根 · 高度由 level + 随机相位驱动 */
function WaveBars({ level = 0.5, paused = false }: { level?: number; paused?: boolean }) {
  return (
    <div className="flex h-8 items-center justify-center gap-[3px]" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'block w-[3px] rounded-full bg-vermilion/80',
            !paused && 'animate-wave-bar',
          )}
          style={{
            height: `${10 + Math.max(0, Math.min(1, level)) * 22 + (i % 2 === 0 ? 4 : 0)}px`,
            animationDelay: `${i * 90}ms`,
            animationDuration: paused ? '0s' : '1.1s',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes wave-bar-v7 {
          0%, 100% { transform: scaleY(0.55); }
          50%      { transform: scaleY(1); }
        }
        .animate-wave-bar {
          transform-origin: center;
          animation-name: wave-bar-v7;
          animation-iteration-count: infinite;
          animation-timing-function: ease-in-out;
        }
      `}</style>
    </div>
  );
}

export function RecordingHero({
  status = 'listening',
  elapsedSec = 0,
  subtitle,
  eyebrow,
  level = 0.5,
  variant = 'hero',
  actions,
  className,
}: RecordingHeroProps) {
  const isListening = status === 'listening';
  const isPaused = status === 'paused';
  const isThinking = status === 'thinking';
  const isHero = variant === 'hero';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-3xl border border-divider bg-card',
        isHero ? 'px-8 py-10 sm:px-10 sm:py-12' : 'px-5 py-5',
        className,
      )}
      style={{
        // surface-ai 概念 + 极淡仪式光晕（仪式时刻白名单）
        boxShadow:
          '0 0 0 1px rgba(45,79,62,0.08), 0 8px 28px rgba(28,27,25,0.06), 0 32px 80px rgba(45,79,62,0.05)',
      }}
      data-testid="recording-hero"
      data-status={status}
    >
      {/* 仪式光晕 · 三色低饱和（rose/pine/vermilion）从中心扩散 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 70% 60% at 50% 30%,
              rgba(181,72,60,${isListening ? 0.10 : 0.04}), transparent 65%),
            radial-gradient(ellipse 60% 50% at 50% 70%,
              rgba(45,79,62,${isListening ? 0.08 : 0.04}), transparent 70%)
          `,
        }}
      />

      {/* 流动气息（只在 listening / thinking 显示） */}
      {(isListening || isThinking) && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-60"
          style={{
            background:
              'linear-gradient(110deg, rgba(45,79,62,0) 0%, rgba(45,79,62,0.06) 35%, rgba(181,72,60,0.08) 50%, rgba(45,79,62,0.06) 65%, rgba(45,79,62,0) 100%)',
            backgroundSize: '220% 100%',
            animation: 'rec-hero-shimmer 6s ease-in-out infinite',
          }}
        />
      )}

      <div className="relative flex flex-col items-center gap-4 text-center">
        {/* eyebrow + rec-dot */}
        <div className="flex items-center gap-2">
          {(isListening || isThinking) && (
            <span className="relative inline-flex h-2 w-2" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-vermilion/55" />
              <span className="relative h-2 w-2 rounded-full bg-vermilion" />
            </span>
          )}
          <span className="font-mono text-[10.5px] uppercase tracking-caps text-vermilion font-semibold">
            {eyebrow ?? (isListening ? '正在听这节课' : isThinking ? '正在整理' : isPaused ? '已暂停' : '等你开口')}
          </span>
        </div>

        {/* 呼吸球 + Octo 主体 */}
        <div className={cn('relative', isHero ? 'h-44 w-44' : 'h-24 w-24')}>
          {/* 三层呼吸光环（仪式时刻 · 不会出现在常规页面） */}
          {(isListening || isThinking) && (
            <>
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(181,72,60,0.20) 0%, transparent 60%)',
                  animation: 'rec-hero-breath 2.6s ease-in-out infinite',
                }}
              />
              <span
                aria-hidden
                className="absolute inset-2 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(45,79,62,0.18) 0%, transparent 65%)',
                  animation: 'rec-hero-breath 3.4s ease-in-out infinite reverse',
                }}
              />
              <span
                aria-hidden
                className="absolute inset-4 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, rgba(255,255,255,0.7) 0%, transparent 75%)',
                }}
              />
            </>
          )}
          {/* 暂停态：冻结的呼吸球（不动） */}
          {isPaused && (
            <span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, rgba(28,27,25,0.06) 0%, transparent 70%)',
              }}
            />
          )}
          {/* Octo 主体 */}
          <Image
            src={MOOD_ASSET[status]}
            alt=""
            aria-hidden
            width={isHero ? 176 : 96}
            height={isHero ? 176 : 96}
            unoptimized
            priority
            className={cn(
              'relative h-full w-full object-contain',
              isListening && 'animate-octo-listen',
              isThinking && 'animate-octo-think',
            )}
            style={{
              filter:
                'drop-shadow(0 16px 24px rgba(28,27,25,0.18)) drop-shadow(0 4px 8px rgba(45,79,62,0.12))',
            }}
          />
        </div>

        {/* 时长（mono · 朱批红） */}
        {isHero && (
          <div className="flex flex-col items-center gap-1">
            <span className="font-mono text-[40px] tabular-nums tracking-[-0.02em] text-ink leading-none sm:text-[52px]">
              {formatElapsed(elapsedSec)}
            </span>
            {subtitle ? (
              <span className="text-[13px] text-ink-secondary">{subtitle}</span>
            ) : null}
          </div>
        )}

        {!isHero && (
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[20px] tabular-nums text-ink leading-none">
              {formatElapsed(elapsedSec)}
            </span>
            {subtitle ? (
              <span className="text-[12px] text-ink-secondary">{subtitle}</span>
            ) : null}
          </div>
        )}

        {/* 实时波形 */}
        {(isListening || isThinking) && (
          <WaveBars level={level} paused={false} />
        )}
        {isPaused && (
          <p className="font-mono text-[11px] uppercase tracking-caps text-ink-muted">
            按继续 · 接着听
          </p>
        )}

        {/* 操作槽 */}
        {actions && <div className="mt-2 flex items-center gap-3">{actions}</div>}
      </div>

      <style jsx>{`
        @keyframes rec-hero-breath {
          0%, 100% { opacity: 0.55; transform: scale(0.96); }
          50%      { opacity: 1;    transform: scale(1.06); }
        }
        @keyframes rec-hero-shimmer {
          0%, 100% { background-position: 200% 0; }
          50%      { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}
