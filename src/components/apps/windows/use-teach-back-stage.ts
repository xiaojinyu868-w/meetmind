'use client';

/**
 * useTeachBackStage — 评委脚下的话 与 对话记录 的编排（面试间 v3 表现层，2026-09-10）。
 *
 * 评委席上任何时刻最多一段话在"台上"（某位脚下），其余都在下面的对话记录里。台上的话有两种来源：
 *   1. 讲的时候（实时反馈开）：听众回合的那条反馈——文字随 SSE 流长，声音说完（activeJudge 清空）后
 *      留 SPEECH_LINGER_MS 再淡进记录；你一开口把它打断 → 立刻收进记录（一行灰字）。
 *   2. 讲完了以后的"表演"：实时反馈关着时记下的笔记（hook 每 600ms 揭示一条）与复盘的三段话，
 *      按顺序一条条由那位评委说出来——逐字流出 + speakAs 出声，字打完、读够、声音安静了才轮到下一条
 *      （performanceFinished，纯函数），中间留 PERFORM_SETTLE_MS。
 *
 * 这里只管"谁的话此刻在台上、以什么不透明度、记录里有哪些"；判断都在 teach-back-room-model 的纯函数里，
 * 声音本身在 use-teach-back-panel（speakAs / speakingJudge）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TeachBackJudgeId } from '@/lib/ai-native/types';
import {
  lingerOpacity,
  PERFORM_SETTLE_MS,
  performanceFinished,
  shouldShowEntry,
  sortRecord,
  SPEECH_LINGER_MS,
  speechPhaseOf,
  typedChars,
  type FeedbackEntry,
  type RecordEntry,
  type RoomStage,
} from './teach-back-room-model';

/** 台上（某位评委脚下）的那段话 */
export interface StageUtterance {
  id: string;
  judgeId: TeachBackJudgeId;
  /** 此刻露出的文字（实时的流到哪算哪；表演的按 typedChars 截） */
  text: string;
  /** 文字还在长 */
  typing: boolean;
  phase: 'speaking' | 'lingering';
  opacity: number;
  kind: RecordEntry['kind'];
  /** 这段话说的是哪几个目标点（复盘专用）：左边对应的手卡会亮一下 */
  targetIds: string[];
}

/** 复盘的一段话（文案由窗口用 copy 拼好；一位评委可以分几段说，每段一个 id） */
export interface ReviewUtterance {
  id: string;
  judgeId: TeachBackJudgeId;
  text: string;
  /** 说的是哪几个目标点 */
  targetIds: string[];
}

interface StageInput {
  stage: RoomStage;
  feedback: FeedbackEntry[];
  activeJudge: TeachBackJudgeId | null;
  speakingJudge: TeachBackJudgeId | null;
  voiceEnabled: boolean;
  /** 复盘三段（evaluate 到了才有） */
  review: ReviewUtterance[] | null;
  speakAs: (judgeId: TeachBackJudgeId, text: string) => void;
  /** 讲完那一刻的会话时钟：复盘在记录里排在最上 */
  finishedAt: number;
}

interface StageOutput {
  current: StageUtterance | null;
  record: RecordEntry[];
  /** 还有人等着说（记下的 / 复盘） */
  performing: boolean;
  /** 复盘三段都说完了 */
  reviewDone: boolean;
}

interface Performance {
  id: string;
  judgeId: TeachBackJudgeId;
  text: string;
  kind: RecordEntry['kind'];
  at: number;
  turnIndex: number | null;
  targetIds: string[];
  startedAt: number;
  /** 说完了、留一会（null = 还在说） */
  settledAt: number | null;
}

const NO_TARGETS: string[] = [];

/** 表演淡出比实时短一点 */
const PERFORM_FADE_MS = 600;
const TICK_MS = 100;

function toRecord(entry: FeedbackEntry): RecordEntry {
  return {
    id: entry.id,
    judgeId: entry.judgeId,
    text: entry.text.trim(),
    at: entry.at,
    turnIndex: entry.turnIndex,
    kind: entry.held ? 'note' : 'turn',
    interrupted: entry.state === 'interrupted',
  };
}

export function useTeachBackStage({ stage, feedback, activeJudge, speakingJudge, voiceEnabled, review, speakAs, finishedAt }: StageInput): StageOutput {
  const [now, setNow] = useState(() => Date.now());
  const [closedAt, setClosedAt] = useState<Map<string, number>>(() => new Map());
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [performed, setPerformed] = useState<RecordEntry[]>([]);
  const voiceHeardRef = useRef(false);
  const quietSinceRef = useRef<number | null>(null);
  const speakAsRef = useRef(speakAs);
  speakAsRef.current = speakAs;

  /* ── 新一场：全部清空 ── */
  useEffect(() => {
    if (stage === 'finished') return;
    setClosedAt(new Map());
    setPerformance(null);
    setPerformed([]);
  }, [stage]);

  /* ── 实时的那条：谁在台上 ── */

  const liveEntry = useMemo(() => {
    let latest: FeedbackEntry | null = null;
    for (const entry of feedback) {
      if (entry.held) continue;
      const onStage = entry.state === 'streaming' || (entry.state === 'done' && activeJudge === entry.judgeId);
      if (onStage && (!latest || entry.at >= latest.at)) latest = entry;
    }
    return latest;
  }, [feedback, activeJudge]);

  // 下台的时刻：说完（声音也停了）记 now；被打断的直接算到期；有新人上台时留着的那条立刻让位
  useEffect(() => {
    const at = Date.now();
    setClosedAt((current) => {
      let next: Map<string, number> | null = null;
      const write = (id: string, value: number) => {
        next ??= new Map(current);
        next.set(id, value);
      };
      for (const entry of feedback) {
        if (entry.held || entry.id === liveEntry?.id) continue;
        if (entry.state === 'streaming') continue;
        const known = current.get(entry.id);
        if (known === undefined) {
          write(entry.id, entry.state === 'interrupted' ? at - SPEECH_LINGER_MS : at);
        } else if (liveEntry && speechPhaseOf(known, at) === 'lingering') {
          write(entry.id, at - SPEECH_LINGER_MS);
        }
      }
      return next ?? current;
    });
  }, [feedback, liveEntry]);

  /* ── 讲完后的表演：记下的 → 复盘，一条条来 ── */

  const performedIds = useMemo(() => new Set(performed.map((entry) => entry.id)), [performed]);

  const queue = useMemo<Performance[]>(() => {
    if (stage !== 'finished') return [];
    const notes = feedback
      .filter((entry) => entry.held && entry.revealed && entry.state !== 'streaming' && entry.text.trim() && !performedIds.has(entry.id))
      .sort((a, b) => a.at - b.at)
      .map((entry): Performance => ({
        id: entry.id,
        judgeId: entry.judgeId,
        text: entry.text.trim(),
        kind: 'note',
        at: entry.at,
        turnIndex: entry.turnIndex,
        targetIds: NO_TARGETS,
        startedAt: 0,
        settledAt: null,
      }));
    const reviews = (review ?? [])
      .map((item, index): Performance => ({
        id: item.id,
        judgeId: item.judgeId,
        text: item.text.trim(),
        kind: 'review',
        at: finishedAt + 1 + index,
        turnIndex: null,
        targetIds: item.targetIds,
        startedAt: 0,
        settledAt: null,
      }))
      .filter((item) => item.text && !performedIds.has(item.id));
    return [...notes, ...reviews];
  }, [stage, feedback, review, performedIds, finishedAt]);

  // 轮到下一条：开口（出声开着就 speakAs）；台上留着的实时那条让位
  useEffect(() => {
    if (stage !== 'finished' || performance || queue.length === 0) return;
    const next = queue[0];
    const at = Date.now();
    voiceHeardRef.current = false;
    quietSinceRef.current = null;
    setPerformance({ ...next, startedAt: at });
    setClosedAt((current) => {
      let changed = false;
      const updated = new Map(current);
      for (const [id, closed] of current) {
        if (speechPhaseOf(closed, at) === 'lingering') {
          updated.set(id, at - SPEECH_LINGER_MS);
          changed = true;
        }
      }
      return changed ? updated : current;
    });
    speakAsRef.current(next.judgeId, next.text);
  }, [stage, performance, queue]);

  // 声音：响过 / 安静了多久
  useEffect(() => {
    if (!performance || performance.settledAt !== null) return;
    if (speakingJudge === performance.judgeId) {
      voiceHeardRef.current = true;
      quietSinceRef.current = null;
    } else if (voiceHeardRef.current && quietSinceRef.current === null) {
      quietSinceRef.current = Date.now();
    }
  }, [speakingJudge, performance]);

  // 说完了吗 → 留一会 → 进记录
  useEffect(() => {
    if (!performance) return;
    if (performance.settledAt === null) {
      const finished = performanceFinished({
        text: performance.text,
        elapsedMs: now - performance.startedAt,
        voiceEnabled,
        voiceHeard: voiceHeardRef.current,
        quietForMs: quietSinceRef.current === null ? null : now - quietSinceRef.current,
      });
      if (finished) setPerformance({ ...performance, settledAt: now });
      return;
    }
    if (now - performance.settledAt >= PERFORM_SETTLE_MS) {
      const done = performance;
      setPerformed((current) => [...current, {
        id: done.id,
        judgeId: done.judgeId,
        text: done.text,
        at: done.at,
        turnIndex: done.turnIndex,
        kind: done.kind,
        interrupted: false,
      }]);
      setPerformance(null);
    }
  }, [now, performance, voiceEnabled]);

  /* ── 时钟：台上有话（留着的 / 表演中）才走 ── */

  const lingering = useMemo(() => {
    for (const [, closed] of closedAt) if (speechPhaseOf(closed, now) === 'lingering') return true;
    return false;
  }, [closedAt, now]);
  const needsClock = lingering || performance !== null;
  useEffect(() => {
    if (!needsClock) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [needsClock]);

  /* ── 派生：台上的话 / 记录 ── */

  const current = useMemo<StageUtterance | null>(() => {
    if (performance) {
      const elapsed = now - performance.startedAt;
      if (performance.settledAt === null) {
        const shown = typedChars(performance.text, elapsed);
        return {
          id: performance.id,
          judgeId: performance.judgeId,
          text: performance.text.slice(0, shown),
          typing: shown < performance.text.length,
          phase: 'speaking',
          opacity: 1,
          kind: performance.kind,
          targetIds: performance.targetIds,
        };
      }
      return {
        id: performance.id,
        judgeId: performance.judgeId,
        text: performance.text,
        typing: false,
        phase: 'lingering',
        opacity: lingerOpacity(performance.settledAt, now, PERFORM_SETTLE_MS, PERFORM_FADE_MS),
        kind: performance.kind,
        targetIds: performance.targetIds,
      };
    }
    if (liveEntry) {
      return {
        id: liveEntry.id,
        judgeId: liveEntry.judgeId,
        text: liveEntry.text,
        typing: liveEntry.state === 'streaming',
        phase: 'speaking',
        opacity: 1,
        kind: 'turn',
        targetIds: NO_TARGETS,
      };
    }
    let latest: FeedbackEntry | null = null;
    for (const entry of feedback) {
      if (entry.held) continue;
      const closed = closedAt.get(entry.id);
      if (closed === undefined || speechPhaseOf(closed, now) !== 'lingering') continue;
      if (!latest || entry.at >= latest.at) latest = entry;
    }
    if (!latest) return null;
    return {
      id: latest.id,
      judgeId: latest.judgeId,
      text: latest.text,
      typing: false,
      phase: 'lingering',
      opacity: lingerOpacity(closedAt.get(latest.id) ?? now, now),
      kind: 'turn',
      targetIds: NO_TARGETS,
    };
  }, [performance, liveEntry, feedback, closedAt, now]);

  const record = useMemo<RecordEntry[]>(() => {
    const gone: RecordEntry[] = [];
    for (const entry of feedback) {
      if (entry.held) continue;
      const closed = closedAt.get(entry.id);
      if (closed === undefined || speechPhaseOf(closed, now) !== 'gone') continue;
      if (!shouldShowEntry(entry)) continue;
      gone.push(toRecord(entry));
    }
    return sortRecord([...gone, ...performed]);
  }, [feedback, closedAt, now, performed]);

  const reviewDone = useMemo(
    () => review !== null && review.length > 0 && review.every((item) => performedIds.has(item.id)),
    [review, performedIds],
  );

  const performing = performance !== null || queue.length > 0;

  return useMemo(() => ({ current, record, performing, reviewDone }), [current, record, performing, reviewDone]);
}
