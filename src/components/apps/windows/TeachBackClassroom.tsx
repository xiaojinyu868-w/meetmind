'use client';

/**
 * 讲给同桌听 · 像素小教室（v2）
 *
 * 你站在讲台前讲，学生们坐在下面听：
 * - 黑板上的粉笔目标**讲到哪划掉哪**（轻量覆盖检测，门槛低于课后正式核对）
 * - 你讲完一段，有学生会心地点点头
 * - 有人跟不上或发现你还有没讲到的点，会举手提问（气泡里是真实问题）
 * - 静音时他们打瞌睡
 * 语音链路复用 useOmniRealtimeCall；视觉是 DOM 分层像素场景。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, PenLine, PhoneOff } from 'lucide-react';
import type { TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import { useOmniRealtimeCall } from '@/hooks/useOmniRealtimeCall';
import { OctoBuddySprite, type OctoBuddyMood } from '@/components/classroom/OctoBuddy';
import { COPY } from '@/lib/ui/copy';

interface TeachBackClassroomProps {
  instructions: string;
  lessonTitle?: string;
  targets: TeachBackTarget[];
  onUserTurn: (text: string) => void;
  onAssistantTurn: (text: string) => void;
  /** 挂断（讲完了）；父级决定接下来进核对还是回目标 */
  onExit: () => void;
  onSwitchToText: () => void;
  /**
   * false = 预习态：场景纯展示（不连语音、不出控制区），
   * 用于「走上讲台」之前的入口画面。
   */
  interactive?: boolean;
}

const STUDENTS = [
  { id: 'back-left', row: 'back' as const, size: 'md' as const, deskWidth: 120 },
  { id: 'back-mid', row: 'back' as const, size: 'md' as const, deskWidth: 130 },
  { id: 'back-right', row: 'back' as const, size: 'md' as const, deskWidth: 120 },
  { id: 'front-left', row: 'front' as const, size: 'lg' as const, deskWidth: 155 },
  { id: 'front-right', row: 'front' as const, size: 'lg' as const, deskWidth: 155 },
];

/** 每积累这么多新讲述字数就做一次轻量覆盖检测 */
const COVER_CHECK_MIN_CHARS = 120;
const COVER_CHECK_INTERVAL_MS = 16_000;

export function TeachBackClassroom({
  instructions,
  lessonTitle,
  targets,
  onUserTurn,
  onAssistantTurn,
  onExit,
  onSwitchToText,
  interactive = true,
}: TeachBackClassroomProps) {
  const {
    status,
    isConnected,
    isMuted,
    capturedText,
    assistantText,
    errorMessage,
    connectSession,
    disconnectSession,
    toggleRecording,
  } = useOmniRealtimeCall({
    instructions,
    connectOnMount: interactive,
    onUserTranscript: (text) => {
      if (!text.trim()) return;
      recordTurn({ role: 'user', text: text.trim() });
      onUserTurn(text);
    },
    onAssistantTranscriptDone: (text) => {
      if (!text.trim()) return;
      recordTurn({ role: 'assistant', text: text.trim() });
      onAssistantTurn(text);
    },
  });

  const [speakerIndex, setSpeakerIndex] = useState<number | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [coveredIds, setCoveredIds] = useState<ReadonlySet<string>>(new Set());
  // interval 闭包只能拿到创建帧的 state，用 ref 同步最新集合，
  // 否则「全部目标已划掉后停止轮询」永远不生效
  const coveredIdsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    coveredIdsRef.current = coveredIds;
  }, [coveredIds]);
  const [noddingIds, setNoddingIds] = useState<ReadonlySet<string>>(new Set());
  const [isNarrow, setIsNarrow] = useState(false);
  const lastSpeakerRef = useRef(-1);
  const turnsLogRef = useRef<TeachBackTurn[]>([]);
  const pendingCharsRef = useRef(0);
  const coverInFlightRef = useRef(false);

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

  const isListening = status === 'listening';
  const isThinking = status === 'thinking';
  const isResponding = status === 'responding';
  const userSpeaking = isListening && capturedText.trim().length > 0;

  function recordTurn(turn: TeachBackTurn) {
    turnsLogRef.current.push(turn);
    if (turn.role === 'user') {
      pendingCharsRef.current += turn.text.length;
      // 讲完一段，随机一名学生会心点头（2.2s）
      const pool = visibleStudentIndexes;
      const student = STUDENTS[pool[Math.floor(Math.random() * pool.length)]];
      setNoddingIds((prev) => new Set(prev).add(student.id));
      window.setTimeout(() => {
        setNoddingIds((prev) => {
          const next = new Set(prev);
          next.delete(student.id);
          return next;
        });
      }, 2_200);
    }
  }

  useEffect(() => {
    if (capturedText.trim().length > 0) setHasStarted(true);
  }, [capturedText]);

  /* ── 粉笔划掉：轻量覆盖检测（讲到了 ≠ 讲对了，对错留给课后核对） ── */

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (coverInFlightRef.current) return;
      if (pendingCharsRef.current < COVER_CHECK_MIN_CHARS) return;
      const alreadyCovered = coveredRefSize();
      if (alreadyCovered >= targets.length) return;
      pendingCharsRef.current = 0;
      coverInFlightRef.current = true;
      void (async () => {
        try {
          const response = await fetch('/api/apps/teach-back/cover-check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets, teachingTurns: turnsLogRef.current }),
          });
          const data = await response.json().catch(() => null) as { ok?: boolean; covered?: string[] } | null;
          if (data?.ok && Array.isArray(data.covered) && data.covered.length > 0) {
            setCoveredIds((prev) => {
              const next = new Set(prev);
              for (const id of data.covered ?? []) next.add(id);
              return next;
            });
          }
        } catch {
          // 覆盖检测是增强体验，失败静默，下次再试
        } finally {
          coverInFlightRef.current = false;
        }
      })();
    }, COVER_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [targets]);

  const coveredRefSize = () => coveredIdsRef.current.size;

  /* AI 开口时，随机点一名学生举手提问（不连续点同一个） */
  useEffect(() => {
    if (!isResponding) return;
    if (speakerIndex !== null) return;
    const pool = visibleStudentIndexes;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    const next = picked === lastSpeakerRef.current && pool.length > 1
      ? pool[(pool.indexOf(picked) + 1) % pool.length]
      : picked;
    lastSpeakerRef.current = next;
    setSpeakerIndex(next);
  }, [isResponding, speakerIndex, visibleStudentIndexes]);

  useEffect(() => {
    if (!isResponding && speakerIndex !== null) {
      const timer = window.setTimeout(() => setSpeakerIndex(null), 4_000);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isResponding, speakerIndex]);

  const studentMood = (index: number): OctoBuddyMood => {
    const student = STUDENTS[index];
    if (isMuted) return 'sleeping';
    if (noddingIds.has(student.id)) return 'happy';
    if (speakerIndex === index) return isResponding ? 'surprised' : 'thinking';
    if (isThinking && index === 1) return 'thinking';
    if (userSpeaking || isResponding) return 'listening';
    return 'idle';
  };

  const handleHangUp = () => {
    const pendingUser = capturedText.trim();
    if (pendingUser) onUserTurn(pendingUser);
    const pendingAssistant = assistantText.trim();
    if (pendingAssistant) onAssistantTurn(pendingAssistant);
    void disconnectSession().then(onExit);
  };

  const chalkTargets = useMemo(() => targets.slice(0, 5), [targets]);
  const nextTargetId = chalkTargets.find((target) => !coveredIds.has(target.id))?.id;

  return (
    <div className={`tbc-stage ${interactive ? '' : 'tbc-stage-preview'}`}>
      {/* ── 后墙 + 黑板 + 墙面装饰 ── */}
      <div className="tbc-wall">
        <div className="tbc-clock" aria-hidden>
          <span className="tbc-clock-hand-h" />
          <span className="tbc-clock-hand-m" />
        </div>
        <div className="tbc-blackboard">
          <div className="tbc-board-head">
            <p className="tbc-board-title">{lessonTitle || COPY.apps.teachBack.appName}</p>
            {hasStarted && chalkTargets.length > 0 ? (
              <span className="tbc-board-count">{coveredIds.size}/{chalkTargets.length}</span>
            ) : null}
          </div>
          <div className="tbc-board-chalk">
            {chalkTargets.map((target) => {
              const covered = coveredIds.has(target.id);
              const isNext = !covered && target.id === nextTargetId;
              return (
                <span
                  key={target.id}
                  className={`tbc-chalk-line ${covered ? 'tbc-chalk-covered' : ''} ${isNext && hasStarted ? 'tbc-chalk-next' : ''}`}
                >
                  {covered ? '✓' : '▸'} {target.point}
                </span>
              );
            })}
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
              {speakerIndex === index && assistantText.trim() ? (
                <div className="tbc-bubble">{assistantText.trim()}</div>
              ) : null}
              {index === 3 && (!interactive || isConnected) && !hasStarted && !isResponding && !assistantText.trim() ? (
                <div className="tbc-bubble">{COPY.apps.teachBack.classroomWaiting}</div>
              ) : null}
              <OctoBuddySprite mood={studentMood(index)} size={student.size} />
              <div className="tbc-desk" style={{ width: student.deskWidth }} />
            </div>
          );
        })}

        {/* ── 讲台：你站的地方（预习态虚位以待） ── */}
        <div className={`tbc-podium ${userSpeaking ? 'tbc-podium-live' : ''} ${interactive ? '' : 'tbc-podium-idle'}`}>
          <div className="tbc-podium-mic">
            <span className="tbc-podium-mic-dot" />
            <span className="tbc-podium-bars" aria-hidden>
              <i /><i /><i />
            </span>
          </div>
          <div className="tbc-podium-body" />
        </div>
      </div>

      {/* ── 讲台字幕：你正在讲的话 ── */}
      {interactive ? (
        <div className="tbc-caption">
          {userSpeaking ? (
            <p className="tbc-caption-live">{capturedText.trim()}</p>
          ) : (
            <p className="tbc-caption-status">
              {errorMessage
                ? COPY.realtime.reconnect
                : status === 'connecting' || status === 'authorizing'
                  ? COPY.realtime.connecting
                  : isThinking
                    ? COPY.realtime.thinking
                    : isMuted
                      ? COPY.realtime.muted
                      : COPY.realtime.listening}
            </p>
          )}
        </div>
      ) : null}

      {/* ── 控制区 ── */}
      {interactive ? (
        <div className="tbc-controls">
          {errorMessage && !isConnected ? (
            <button type="button" onClick={() => void connectSession()} className="tbc-btn tbc-btn-primary">
              {COPY.apps.teachBack.classroomReconnect}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void toggleRecording()}
              className={`tbc-btn ${isMuted ? '' : 'tbc-btn-primary'}`}
              aria-label={isMuted ? COPY.realtime.unmute : COPY.realtime.mute}
            >
              {isMuted ? <Mic size={16} strokeWidth={2} /> : <MicOff size={16} strokeWidth={2} />}
            </button>
          )}
          <button type="button" onClick={onSwitchToText} className="tbc-btn" aria-label={COPY.apps.teachBack.switchToText}>
            <PenLine size={16} strokeWidth={2} />
          </button>
          <button type="button" onClick={handleHangUp} className="tbc-btn tbc-btn-danger">
            <PhoneOff size={16} strokeWidth={2} />
            <span>{COPY.apps.teachBack.endCall}</span>
          </button>
        </div>
      ) : null}

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
        .tbc-board-count {
          flex-shrink: 0;
          font-family: var(--font-mono, 'JetBrains Mono', monospace);
          font-size: 12px;
          font-weight: 700;
          color: #FFD98A;
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
          transition: color 400ms ease, opacity 400ms ease;
        }
        .tbc-chalk-covered {
          color: rgba(246, 248, 246, 0.32);
          text-decoration: line-through;
          text-decoration-color: rgba(255, 217, 138, 0.6);
          text-decoration-thickness: 2px;
        }
        .tbc-chalk-next {
          color: rgba(255, 217, 138, 0.95);
          animation: tbcChalkGlow 2.2s ease-in-out infinite;
        }
        @keyframes tbcChalkGlow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
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
        .tbc-student-back { bottom: 52%; }
        .tbc-student-front { bottom: 18%; }
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
        /* ── 讲台 ── */
        .tbc-podium {
          position: absolute;
          left: 7%;
          bottom: 8%;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .tbc-podium-mic {
          display: flex;
          align-items: flex-end;
          gap: 5px;
          margin-bottom: -4px;
          z-index: 1;
        }
        .tbc-podium-mic-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #5C5A55;
          border: 2px solid #20312A;
          transition: background 200ms ease;
        }
        .tbc-podium-live .tbc-podium-mic-dot { background: #C45E4C; }
        .tbc-podium-bars {
          display: none;
          align-items: flex-end;
          gap: 2px;
          height: 12px;
        }
        .tbc-podium-live .tbc-podium-bars { display: inline-flex; }
        .tbc-podium-bars i {
          width: 3px;
          background: #C45E4C;
          animation: tbcBar 640ms ease-in-out infinite;
        }
        .tbc-podium-bars i:nth-child(1) { height: 6px; animation-delay: 0ms; }
        .tbc-podium-bars i:nth-child(2) { height: 12px; animation-delay: 140ms; }
        .tbc-podium-bars i:nth-child(3) { height: 8px; animation-delay: 300ms; }
        @keyframes tbcBar {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
        .tbc-podium-idle { opacity: 0.45; filter: saturate(0.7); }
        /* 预习态：学生整体上移，给底部上台面板让位 */
        .tbc-stage-preview .tbc-student-back { bottom: 60%; }
        .tbc-stage-preview .tbc-student-front { bottom: 30%; }
        .tbc-stage-preview .tbc-podium { display: none; }
        .tbc-podium-body {
          width: 86px;
          height: 46px;
          background:
            repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.07) 0 4px, transparent 4px 8px),
            #A87F52;
          border: 3px solid #7A5C3E;
          border-radius: 4px 4px 0 0;
          box-shadow: 0 6px 0 -2px rgba(32, 49, 42, 0.22);
        }
        /* ── 字幕条 ── */
        .tbc-caption {
          flex: 0 0 auto;
          display: flex;
          justify-content: center;
          padding: 0 16px 10px;
          min-height: 44px;
        }
        .tbc-caption-live {
          max-width: 640px;
          padding: 8px 14px;
          border: 2px solid rgba(32, 49, 42, 0.35);
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.9);
          font-size: 13px;
          line-height: 1.6;
          color: #20312A;
        }
        .tbc-caption-status {
          align-self: center;
          font-size: 12px;
          color: rgba(32, 49, 42, 0.55);
        }
        /* ── 控制区 ── */
        .tbc-controls {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 0 16px 18px;
        }
        .tbc-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          border: 2px solid #20312A;
          border-radius: 4px;
          background: #FFFFFF;
          box-shadow: 3px 3px 0 rgba(32, 49, 42, 0.28);
          font-size: 13px;
          font-weight: 600;
          color: #20312A;
          cursor: pointer;
          transition: transform 80ms ease, box-shadow 80ms ease;
        }
        .tbc-btn:active {
          transform: translate(2px, 2px);
          box-shadow: 1px 1px 0 rgba(32, 49, 42, 0.28);
        }
        .tbc-btn-primary { background: #2F6B55; border-color: #24533F; color: #F6F8F6; }
        .tbc-btn-danger { background: #C45E4C; border-color: #9E4A3B; color: #FFF7F2; }
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
          .tbc-podium { display: none; }
          .tbc-floor {
            background:
              linear-gradient(180deg, transparent 0%, transparent 44%, rgba(122, 92, 62, 0.5) 44%, rgba(122, 92, 62, 0.5) calc(44% + 4px), transparent calc(44% + 4px)),
              linear-gradient(180deg, transparent 0%, transparent calc(44% + 4px), #D9C9A8 calc(44% + 4px), #CDBB96 100%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .tbc-bubble, .tbc-podium-bars i { animation: none; }
          .tbc-chalk-next { animation: none; }
        }
      `}</style>
    </div>
  );
}

export default TeachBackClassroom;
