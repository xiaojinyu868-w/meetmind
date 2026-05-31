'use client';

/**
 * v7 错误态：
 * Octo · surprised 表情 + 朱批语义（错误 = 提醒，不是惊吓）。
 * 不再用红色斜杠图标，让用户感觉是"同桌没接住"，不是"系统报错"。
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { OctoAvatar } from '@/components/ui/octo-avatar';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 可以在这里上报错误到监控服务
    console.error('Application Error:', error);
  }, [error]);

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 30%, rgba(181,72,60,0.08), transparent 60%)',
        }}
      />

      <div className="relative max-w-md w-full text-center">
        <div className="mx-auto mb-8">
          <OctoAvatar mood="surprised" size="xl" aura priority />
        </div>

        {/* 标题 */}
        <p className="font-mono text-[11px] font-semibold uppercase tracking-caps text-vermilion mb-3">
          OOPS · 出了点问题
        </p>
        <h1 className="text-2xl font-semibold tracking-display text-ink mb-3">
          Octo 没接住这条
        </h1>
        <p className="text-sm leading-relaxed text-ink-secondary mb-6">
          原文应该还在，重试通常能成功。
          <br />
          如果一直不行，再回首页或联系我们。
        </p>

        {/* 错误详情（开发环境显示） */}
        {process.env.NODE_ENV === 'development' && (
          <div className="mb-6 p-4 bg-paper-warm rounded-lg text-left">
            <p className="font-mono text-xs text-ink-secondary break-all leading-relaxed">
              {error.message}
            </p>
            {error.digest && (
              <p className="font-mono text-[11px] text-ink-muted mt-2">
                Error ID: {error.digest}
              </p>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-ink text-white font-medium text-sm rounded-md transition-all duration-150 ease-out hover:bg-black hover:-translate-y-0.5 active:scale-[0.98]"
          >
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            重试
          </button>
          <Link
            href="/app"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-card text-ink-secondary font-medium text-sm rounded-md border border-divider transition-all duration-150 ease-out hover:border-pine hover:text-pine"
          >
            返回首页
          </Link>
        </div>

        {/* 帮助提示 */}
        <p className="mt-8 text-xs text-ink-muted">
          如果问题持续存在，
          <Link href="/feedback" className="text-pine hover:underline mx-1 underline-offset-4">
            联系我们
          </Link>
          或发送邮件至 <span className="font-mono">originedu@meetmind.online</span>
        </p>
      </div>
    </main>
  );
}
