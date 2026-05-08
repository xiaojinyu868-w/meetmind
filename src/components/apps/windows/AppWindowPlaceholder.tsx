'use client';

/**
 * AppWindowPlaceholder — 通用应用窗口占位组件
 *
 * v2 — M8 agent-native：loading 态升级为"三阶段叙事性骨架"。
 * 过去 60-120 秒的白空只有一个 spinner + 一行静态文字；
 * 现在按时间推进三句"同学在做什么"的描述：
 *   📖 正在读你的课堂…
 *   🎯 正在挑核心…
 *   ✨ 正在排版…
 * 已完成的阶段收成一条 ✓ 灰线，当前阶段有 shimmer 扫光。
 * 结果到了以后整个骨架 200ms 淡出，真实内容 200ms 淡入。
 *
 * 为什么是客户端时间驱动（不依赖 SSE 实时信号）：
 *   - LLM 调用时长有大致可预测的分布（15-90s），按比例推进已经够"像"
 *   - 避免把 /api/apps/execute 改成 SSE 的工程复杂度
 *   - 真正返回早/晚时：早 → 三阶段都变 ✓；晚 → 停在第三阶段加"稍等"行
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { COPY } from '@/lib/ui/copy';

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
/*  三阶段叙事骨架                                                      */
/* ------------------------------------------------------------------ */

type Stage = 0 | 1 | 2;

/** 三阶段文案 + 各阶段目标占比（累积）。
 *  实际大多数 app 在 30-60s 完成；按比例推进即可营造"在做事"的叙事。 */
const STAGE_ITEMS = [
  { icon: '📖', label: COPY.stages.reading },
  { icon: '🎯', label: COPY.stages.selecting },
  { icon: '✨', label: COPY.stages.composing },
] as const;

// 每个阶段预计停留的毫秒。当真实执行比这快时，阶段会被一起"打勾"。
const STAGE_DURATIONS_MS = [8000, 18000, 24000];
// 超过 STAGE_DURATIONS_MS 总和后，停在最后阶段并显示"慢一点没关系"的软提示
const STAGE_SLOW_HINT_AFTER_MS = STAGE_DURATIONS_MS.reduce((a, b) => a + b, 0);

function useStageProgression(): { stage: Stage; slow: boolean } {
  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    const startedAt = Date.now();
    const tick = () => setElapsed(Date.now() - startedAt);
    // 800ms 刷一次即可——阶段转换密度低，不需要每帧重渲染
    const timer = window.setInterval(tick, 800);
    return () => window.clearInterval(timer);
  }, []);

  let acc = 0;
  for (let i = 0; i < STAGE_DURATIONS_MS.length; i++) {
    acc += STAGE_DURATIONS_MS[i];
    if (elapsed < acc) {
      return { stage: i as Stage, slow: false };
    }
  }
  return { stage: 2, slow: elapsed > STAGE_SLOW_HINT_AFTER_MS };
}

function StagedLoading({ appName }: { appName: string }) {
  const { stage, slow } = useStageProgression();

  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-6 rounded-2xl bg-white p-8">
      <div className="flex flex-col gap-3 w-full max-w-[320px]">
        <p className="text-center text-[13px] text-ink-muted">
          {`正在为你整理${appName}`}
        </p>

        <ul className="flex flex-col gap-2">
          {STAGE_ITEMS.map((item, idx) => {
            const done = idx < stage;
            const active = idx === stage;
            return (
              <li
                key={item.label}
                className={cn(
                  'relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] transition-all',
                  done && 'text-ink-muted/70',
                  active && 'bg-[#F7F7F5] text-ink stage-shimmer',
                  !done && !active && 'text-ink-muted/40',
                )}
                aria-current={active ? 'step' : undefined}
              >
                <span
                  className={cn(
                    'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center text-[13px]',
                    done && 'opacity-60',
                  )}
                  aria-hidden
                >
                  {done ? '✓' : item.icon}
                </span>
                <span className="flex-1">
                  {item.label}
                  {active && <span className="ml-0.5">…</span>}
                </span>
              </li>
            );
          })}
        </ul>

        {slow ? (
          <p className="mt-1 text-center text-[11.5px] text-ink-muted/70">
            {COPY.stages.slow}
          </p>
        ) : null}
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
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8">
      {/* 空态图标 */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
        <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>

      {/* 文案 */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-600">
          暂未生成{appName}
        </p>
        <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-slate-400">
          {description || `点击"重新生成"或返回应用目录，为当前课堂生成${appName}内容。`}
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2.5">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-lavender-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-lavender-600 hover:active:scale-[0.97]"
          >
            重新生成
          </button>
        ) : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
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
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-5 rounded-2xl border border-coral-200 bg-[#FADEC9]/30 p-8">
      {/* 错误图标 */}
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-coral-100">
        <svg className="h-7 w-7 text-coral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
      </div>

      {/* 文案 */}
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">
          {appName}生成失败
        </p>
        {errorMessage ? (
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-slate-500" title={errorMessage}>
            {errorMessage.length > 120 ? `${errorMessage.slice(0, 120)}...` : errorMessage}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-400">请检查网络连接后重试，或尝试切换 AI 模型。</p>
        )}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-2.5">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-lavender-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-lavender-600 hover:active:scale-[0.97]"
          >
            重试
          </button>
        ) : null}
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50"
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
    return <StagedLoading appName={appName} />;
  }

  if (status === 'error') {
    return <ErrorState appName={appName} errorMessage={errorMessage} onRetry={onRetry} onBack={onBack} />;
  }

  return <EmptyGuide appName={appName} description={description} onRetry={onRetry} onBack={onBack} />;
}
