'use client';

/**
 * GuestSyncHint — 访客录完课后的一句安静入口（2026-09-11）：
 * 「登录后，这节课会跟着你到任何设备 · 登录」。和 UnfinishedLessonBar 同一套语言
 * （白底 hairline、左侧 3px 细柱），不弹窗、不占屏、不催。
 */

import Link from 'next/link';
import { COPY } from '@/lib/ui/copy';

export function GuestSyncHint({ next = '/app' }: { next?: string }) {
  return (
    <div
      className="relative mb-6 overflow-hidden rounded-2xl bg-white px-5 py-3.5 ring-[0.5px] ring-ink/[0.08]"
      data-testid="guest-sync-hint"
    >
      <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-r-full bg-ink/20" aria-hidden />
      <div className="flex items-center gap-4 pl-2">
        <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink-secondary">
          {COPY.recording.guestSync.line}
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="flex-shrink-0 text-[13px] font-medium text-pine transition hover:text-pine-deep"
        >
          {COPY.recording.guestSync.action}
        </Link>
      </div>
    </div>
  );
}
