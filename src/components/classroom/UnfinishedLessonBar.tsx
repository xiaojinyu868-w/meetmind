'use client';

/**
 * UnfinishedLessonBar — 「有一节课没结束」的恢复条（2026-09-10 录课不丢）。
 *
 * 一行字 + 两个文字动作，白底 hairline，和 ActiveLessonPill 同一套语言（左侧 3px 细柱，
 * 用 pine 而不是朱砂：这不是"正在发生"，是"等你决定"）。不弹窗、不占屏。
 *   继续录 —— 先收好前半段，立刻开一段新的
 *   就到这里 —— 收好，出理解
 */

import type { UnfinishedLesson } from '@/hooks/useUnfinishedRecordings';
import { COPY } from '@/lib/ui/copy';

interface UnfinishedLessonBarProps {
  lessons: UnfinishedLesson[];
  busySessionId?: string | null;
  onResume: (sessionId: string) => void;
  onFinish: (sessionId: string) => void;
}

export function UnfinishedLessonBar({ lessons, busySessionId, onResume, onFinish }: UnfinishedLessonBarProps) {
  if (lessons.length === 0) return null;
  return (
    <div className="mb-6 flex flex-col gap-2" data-testid="unfinished-lesson-bar">
      {lessons.map((lesson) => {
        const busy = busySessionId === lesson.sessionId;
        return (
          <div
            key={lesson.sessionId}
            className="relative overflow-hidden rounded-2xl bg-white px-5 py-3.5 ring-[0.5px] ring-ink/[0.08]"
          >
            <span className="absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded-r-full bg-pine" aria-hidden />
            <div className="flex items-center gap-4 pl-2">
              <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                {COPY.recording.unfinished.line(lesson.title, lesson.minutes)}
              </p>
              <div className="flex flex-shrink-0 items-center gap-4 text-[13px] font-medium">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onResume(lesson.sessionId)}
                  className="text-pine transition hover:text-pine-deep disabled:opacity-50"
                >
                  {COPY.recording.unfinished.resume}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onFinish(lesson.sessionId)}
                  className="text-ink-secondary transition hover:text-ink disabled:opacity-50"
                >
                  {COPY.recording.unfinished.finish}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
