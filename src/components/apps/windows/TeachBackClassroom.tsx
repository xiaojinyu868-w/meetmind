'use client';

/**
 * 讲给同桌听 · 像素小教室（纯视觉场景）
 *
 * 2026-08 决策：实时语音通话下线（/api/tutor-call 已拆除），语音讲课模式移除，
 * 本组件不再连接 useOmniRealtimeCall，退化为纯视觉场景——
 * 黑板粉笔目标 + 前后两排 Octo 学生，供入口页与打字讲课做背景。
 * 讲课与核对走 TeachBackWindow 的文字模式（同一 /api/apps/teach-back/evaluate）。
 */

import { useEffect, useMemo, useState } from 'react';
import type { TeachBackTarget } from '@/lib/ai-native/types';
import { OctoBuddySprite } from '@/components/classroom/OctoBuddy';
import { COPY } from '@/lib/ui/copy';

interface TeachBackClassroomProps {
  lessonTitle?: string;
  targets: TeachBackTarget[];
}

const STUDENTS = [
  { id: 'back-left', row: 'back' as const, size: 'md' as const, deskWidth: 120 },
  { id: 'back-mid', row: 'back' as const, size: 'md' as const, deskWidth: 130 },
  { id: 'back-right', row: 'back' as const, size: 'md' as const, deskWidth: 120 },
  { id: 'front-left', row: 'front' as const, size: 'lg' as const, deskWidth: 155 },
  { id: 'front-right', row: 'front' as const, size: 'lg' as const, deskWidth: 155 },
];

export function TeachBackClassroom({ lessonTitle, targets }: TeachBackClassroomProps) {
  const [isNarrow, setIsNarrow] = useState(false);

  /* 窄屏只留三名学生：后中 + 前两，避免课桌叠课桌 */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const visibleStudentIndexes = useMemo(
    () => (isNarrow ? [1, 3, 4] : STUDENTS.map((_, index) => index)),
    [isNarrow],
  );

  const chalkTargets = useMemo(() => targets.slice(0, 5), [targets]);

  return (
    <div className="tbc-stage">
      {/* ── 后墙 + 黑板 + 墙面装饰 ── */}
      <div className="tbc-wall">
        <div className="tbc-clock" aria-hidden>
          <span className="tbc-clock-hand-h" />
          <span className="tbc-clock-hand-m" />
        </div>
        <div className="tbc-blackboard">
          <div className="tbc-board-head">
            <p className="tbc-board-title">{lessonTitle || COPY.apps.teachBack.appName}</p>
          </div>
          <div className="tbc-board-chalk">
            {chalkTargets.map((target) => (
              <span key={target.id} className="tbc-chalk-line">
                ▸ {target.point}
              </span>
            ))}
          </div>
        </div>
        <div className="tbc-poster" aria-hidden>
          <span className="tbc-poster-block tbc-poster-block-pine" />
          <span className="tbc-poster-block tbc-poster-block-vermilion" />
        </div>
      </div>

      {/* ── 学生席（前后两排） ── */}
      <div className="tbc-floor">
        {visibleStudentIndexes.map((index) => {
          const student = STUDENTS[index];
          return (
            <div key={student.id} className={`tbc-student tbc-student-${student.row} tbc-student-${index}`}>
              {index === 3 ? (
                <div className="tbc-bubble">{COPY.apps.teachBack.classroomWaiting}</div>
              ) : null}
              <OctoBuddySprite mood="idle" size={student.size} />
              <div className="tbc-desk" style={{ width: student.deskWidth }} />
            </div>
          );
        })}
      </div>

      <style jsx>{`
        .tbc-stage {
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          overflow: hidden;
          background:
            repeating-linear-gradient(0deg, rgba(32, 49, 42, 0.025) 0 2px, transparent 2px 4px),
            linear-gradient(180deg, #F2F0E9 0%, #EDE9DD 62%, #E4DCC9 100%);
        }
        /* ── 后墙与黑板 ── */
        .tbc-wall {
          position: relative;
          flex: 0 0 36%;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 18px 16px 0;
        }
        .tbc-clock {
          position: absolute;
          left: 7%;
          top: 24px;
          width: 44px;
          height: 44px;
          border: 4px solid #7A5C3E;
          border-radius: 999px;
          background: #FBFAF5;
          box-shadow: 0 4px 0 -1px rgba(32, 49, 42, 0.16);
        }
        .tbc-clock-hand-h,
        .tbc-clock-hand-m {
          position: absolute;
          left: 50%;
          bottom: 50%;
          width: 3px;
          background: #20312A;
          transform-origin: 50% 100%;
        }
        .tbc-clock-hand-h { height: 10px; transform: translateX(-50%) rotate(300deg); }
        .tbc-clock-hand-m { height: 15px; transform: translateX(-50%) rotate(60deg); }
        .tbc-poster {
          position: absolute;
          right: 6%;
          top: 28px;
          width: 56px;
          height: 72px;
          border: 4px solid #7A5C3E;
          background: #FBFAF5;
          box-shadow: 0 4px 0 -1px rgba(32, 49, 42, 0.16);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .tbc-poster-block { display: block; width: 28px; height: 14px; }
        .tbc-poster-block-pine { background: #2F6B55; }
        .tbc-poster-block-vermilion { background: #C45E4C; width: 20px; }
        .tbc-blackboard {
          width: min(600px, 88%);
          height: 100%;
          max-height: 230px;
          border: 6px solid #7A5C3E;
          box-shadow:
            inset 0 0 0 2px rgba(246, 248, 246, 0.12),
            0 10px 0 -4px rgba(32, 49, 42, 0.18);
          background:
            repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0 3px, transparent 3px 6px),
            #2F4A3C;
          padding: 12px 18px;
          overflow: hidden;
        }
        .tbc-board-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          border-bottom: 2px dashed rgba(246, 248, 246, 0.25);
          padding-bottom: 8px;
        }
        .tbc-board-title {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 15px;
          font-weight: 600;
          letter-spacing: 0.04em;
          color: rgba(246, 248, 246, 0.92);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tbc-board-chalk {
          margin-top: 9px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tbc-chalk-line {
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 11px;
          color: rgba(246, 248, 246, 0.55);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* ── 学生席 ── */
        .tbc-floor {
          position: relative;
          flex: 1 1 auto;
          min-height: 0;
          background:
            linear-gradient(180deg, transparent 0%, transparent 40%, rgba(122, 92, 62, 0.5) 40%, rgba(122, 92, 62, 0.5) calc(40% + 4px), transparent calc(40% + 4px)),
            linear-gradient(180deg, transparent 0%, transparent calc(40% + 4px), #D9C9A8 calc(40% + 4px), #CDBB96 100%);
        }
        .tbc-student {
          position: absolute;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .tbc-student-back { bottom: 60%; }
        .tbc-student-front { bottom: 30%; }
        .tbc-student-0 { left: 18%; }
        .tbc-student-1 { left: 50%; }
        .tbc-student-2 { left: 82%; }
        .tbc-student-3 { left: 33%; }
        .tbc-student-4 { left: 63%; }
        .tbc-desk {
          height: 32px;
          margin-top: -13px;
          background:
            repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.06) 0 4px, transparent 4px 8px),
            #B08A5E;
          border: 3px solid #7A5C3E;
          border-radius: 4px;
          box-shadow: 0 6px 0 -2px rgba(32, 49, 42, 0.20);
        }
        .tbc-bubble {
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%;
          transform: translateX(-50%);
          z-index: 5;
          width: max-content;
          max-width: 220px;
          padding: 8px 12px;
          border: 2px solid #20312A;
          border-radius: 4px;
          background: #FFFFFF;
          box-shadow: 3px 3px 0 rgba(32, 49, 42, 0.28);
          font-size: 12px;
          font-weight: 600;
          line-height: 1.5;
          color: #20312A;
          animation: tbcBubbleIn 180ms ease-out both;
        }
        .tbc-bubble::after {
          content: '';
          position: absolute;
          top: 100%;
          left: 50%;
          width: 8px;
          height: 8px;
          margin-left: -5px;
          background: #FFFFFF;
          border-right: 2px solid #20312A;
          border-bottom: 2px solid #20312A;
          transform: rotate(45deg) translateY(-4px);
        }
        @keyframes tbcBubbleIn {
          from { opacity: 0; transform: translateX(-50%) translateY(6px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @media (max-width: 640px) {
          .tbc-clock, .tbc-poster { display: none; }
          .tbc-blackboard { max-height: 190px; }
          .tbc-student-back { bottom: 55%; }
          .tbc-student-front { bottom: 22%; }
          .tbc-student-0 { left: 14%; }
          .tbc-student-1 { left: 50%; }
          .tbc-student-2 { left: 86%; }
          .tbc-student-3 { left: 30%; }
          .tbc-student-4 { left: 68%; }
          .tbc-floor {
            background:
              linear-gradient(180deg, transparent 0%, transparent 44%, rgba(122, 92, 62, 0.5) 44%, rgba(122, 92, 62, 0.5) calc(44% + 4px), transparent calc(44% + 4px)),
              linear-gradient(180deg, transparent 0%, transparent calc(44% + 4px), #D9C9A8 calc(44% + 4px), #CDBB96 100%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tbc-bubble { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default TeachBackClassroom;
