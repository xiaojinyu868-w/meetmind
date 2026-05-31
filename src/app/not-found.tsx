'use client';

/**
 * v7 404 态：
 * Octo · sleeping 表情，配合"页面睡着了"的隐喻——温柔而非冷冰冰。
 */

import Link from 'next/link';
import { OctoAvatar } from '@/components/ui/octo-avatar';

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 40% at 50% 30%, rgba(45,79,62,0.06), transparent 60%)',
        }}
      />

      <div className="relative max-w-md w-full text-center">
        {/* 大字 404 + Octo 叠层 */}
        <div className="relative mb-6 flex justify-center items-center min-h-[180px]">
          <div className="font-serif italic text-[160px] font-normal leading-none text-pine/12 select-none pointer-events-none">
            404
          </div>
          <div className="absolute inset-0 flex items-center justify-center">
            <OctoAvatar mood="sleeping" size="xl" aura priority />
          </div>
        </div>

        {/* 标题 */}
        <p className="font-mono text-[11px] font-semibold uppercase tracking-caps text-pine mb-3">
          PAGE NOT FOUND
        </p>
        <h1 className="text-2xl font-semibold tracking-display text-ink mb-3">
          这一页<span className="font-serif italic font-normal text-vermilion"> 走丢了</span>
        </h1>
        <p className="text-sm leading-relaxed text-ink-secondary mb-8">
          可能链接被改过，或者你访问的内容已移除。
          <br />
          要不回首页继续看看？
        </p>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/app"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-ink text-white font-medium text-sm rounded-md transition-all duration-150 ease-out hover:bg-black hover:-translate-y-0.5 active:scale-[0.98]"
          >
            返回首页
          </Link>
          <button
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-card text-ink-secondary font-medium text-sm rounded-md border border-divider transition-all duration-150 ease-out hover:border-pine hover:text-pine"
          >
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回上页
          </button>
        </div>

        <p className="mt-8 text-xs text-ink-muted">
          需要帮助？
          <Link href="/help" className="text-pine hover:underline ml-1 underline-offset-4">
            访问帮助中心
          </Link>
        </p>
      </div>
    </main>
  );
}
