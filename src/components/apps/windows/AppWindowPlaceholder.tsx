'use client';

/**
 * AppWindowPlaceholder — 通用应用窗口占位组件 (v7)
 *
 * 诚实 loading：
 *   - 不假装有 step；让模型/服务端做事，UI 只表达"还在做"
 *   - Octo Buddy 听课呼吸态（IP 即视觉主角）
 *   - 真实 elapsed 秒数（不骗用户"已经第几步"）
 *   - 长时（>30s / >60s）才换更柔和的文案，承认"内容多"
 *
 * v7 视觉：
 *   - 米白 paper 底 + 极淡 pine 光晕
 *   - thinking-strip 让"AI 在做"被肉眼看见
 *   - error 用 vermilion 朱批语义（提醒，不是惊吓）
 */

import * as React from 'react';
import { COPY } from '@/lib/ui/copy';
import { OctoBuddySprite } from '@/components/classroom/OctoBuddy';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { ThinkingStrip } from '@/components/ui/thinking-strip';

interface AppWindowPlaceholderProps {
  /** 占位状态 */
  status: 'loading' | 'empty' | 'error';
  /** 应用中文名称（用于文案） */
  appName?: string;
  /** 错误消息 */
  errorMessage?: string;
  /** 重试回调 */
  onRetry?: () => void;
  /** 返回回调 */
  onBack?: () => void;
  /** 自定义描述文案 */
  description?: string;
}

/* ------------------------------------------------------------------ */
/*  Loading：诚实的「同学在听」                                          */
/* ------------------------------------------------------------------ */

function useElapsedSec(): number {
  const [seconds, setSeconds] = React.useState(0);
  React.useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds;
}

function ListeningLoading({ appName }: { appName: string }) {
  const seconds = useElapsedSec();

  // 文案分级：30s 内一句温柔陪伴；30-60s 承认内容多；>60s 表达耐心
  const message =
    seconds <= 30
      ? COPY.stages.listenStart(appName)
      : seconds <= 60
        ? COPY.stages.listenSlow
        : COPY.stages.listenVerySlow;

  return (
    <div className="relative flex h-full min-h-[420px] flex-col items-center justify-center gap-7 px-6 py-12">
      {/* 极淡 pine / vermilion 双色光晕（v7 仪式时刻） */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 40% at 50% 35%, rgba(45,79,62,0.06), transparent 65%),
            radial-gradient(ellipse 50% 30% at 50% 70%, rgba(181,72,60,0.04), transparent 70%)
          `,
        }}
      />

      {/* Octo Buddy listening · 主角不能小 */}
      <div className="relative">
        <OctoBuddySprite mood="listening" size="lg" />
      </div>

      <div className="relative flex flex-col items-center gap-3 text-center">
        <p className="text-[15px] font-medium tracking-[-0.01em] text-ink">
          {message}
        </p>
        <ThinkingStrip>
          <span className="font-mono tabular-nums text-pine">
            {seconds.toString().padStart(2, '0')}s
          </span>
          <span>· Octo 在听这节课</span>
        </ThinkingStrip>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  空态引导                                                            */
/* ------------------------------------------------------------------ */

function EmptyGuide({ appName, description, onRetry, onBack }: {
  appName: string;
  description?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-6 rounded-2xl border border-dashed border-divider bg-paper p-10">
      {/* Octo idle · 静静等着 */}
      <OctoAvatar mood="idle" size="lg" aura />

      {/* 文案 */}
      <div className="text-center">
        <p className="text-[15px] font-medium text-ink">
          还没整理过<span className="font-serif italic text-pine"> {appName}</span>
        </p>
        <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-ink-muted">
          {description || `点击"再做一版"或返回应用目录，让 Octo 为当前课堂整理${appName}。`}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white shadow-soft transition hover:opacity-85 active:scale-[0.97]"
          >
            再做一版
          </button>
        ) : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-divider bg-card px-4 py-2 text-sm font-medium text-ink-secondary transition hover:border-pine hover:text-pine"
          >
            返回应用
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  错误态                                                              */
/* ------------------------------------------------------------------ */

function ErrorState({ appName, errorMessage, onRetry, onBack }: {
  appName: string;
  errorMessage?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <div className="relative flex h-full min-h-[360px] flex-col items-center justify-center gap-6 px-8 py-12">
      {/* 朱批红光晕 · 错误是"提醒"不是"惊吓" */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 50% 40% at 50% 35%, rgba(181,72,60,0.06), transparent 65%)',
        }}
      />
      <div className="relative">
        <OctoBuddySprite mood="surprised" size="md" />
      </div>
      <div className="relative text-center">
        <p className="text-[15px] font-medium text-ink">
          <span className="font-serif italic text-vermilion">{appName}</span> 刚才没做好
        </p>
        {errorMessage ? (
          <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-ink-muted" title={errorMessage}>
            {errorMessage.length > 120 ? `${errorMessage.slice(0, 120)}…` : errorMessage}
          </p>
        ) : (
          <p className="mt-2 text-[12.5px] text-ink-muted">网络可能有点慢，再试一次看看</p>
        )}
      </div>
      <div className="relative flex items-center gap-3">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-ink px-5 py-2 text-[13px] font-medium text-white shadow-soft transition hover:opacity-85 active:scale-[0.97]"
          >
            再试一次
          </button>
        ) : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-divider bg-card px-5 py-2 text-[13px] font-medium text-ink-secondary transition hover:border-pine hover:text-pine"
          >
            返回应用
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  主组件                                                              */
/* ------------------------------------------------------------------ */

export function AppWindowPlaceholder(props: AppWindowPlaceholderProps) {
  const { status, appName = '应用内容', errorMessage, onRetry, onBack, description } = props;

  if (status === 'loading') {
    return <ListeningLoading appName={appName} />;
  }

  if (status === 'error') {
    return <ErrorState appName={appName} errorMessage={errorMessage} onRetry={onRetry} onBack={onBack} />;
  }

  return <EmptyGuide appName={appName} description={description} onRetry={onRetry} onBack={onBack} />;
}
