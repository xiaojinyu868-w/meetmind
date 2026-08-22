'use client';

/**
 * useBoardPlayer — 黑板播放状态机（v3）。
 *
 * Clock 抽象在 ./segment-clock（未来可插火山 bigtts，只换 Clock 实现）。
 * v3：
 * - cue 词级触发：带 cueCharIndex 的动作等 onboundary 的词级下标（不支持
 *   boundary 时降级为等比估算），无 cue 的动作仍按时间轴均分触发
 * - checkpoint 段：提问口述走 clock，讲完进入 'checkpoint' 等待态，
 *   由 BlackboardPlayer 的交互态接管，完成后 advanceFromCheckpoint 续播
 *
 * 状态机：idle → playing ⇄ paused →（checkpoint）→ finished；倍速 1x / 1.5x；
 * 翻页不擦除的语义 = 每页一块新黑板（页内动作按时间轴逐个触发）。
 *
 * v23 讲写联合调度·反向背压：cue 触发是 speech→ink 的正向联动；另一半是
 * ink→speech——嘴到新动作 cue 时笔仍有积压，就在词边界 hold 住音频等笔追上
 * （段末硬同步闸门之外的段内联动，"嘴比板书快"的根修）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardScript, CheckpointSegment } from '@/lib/ai-native/plugins/board-script';
import { segmentDisplayText } from '@/lib/ai-native/plugins/board-script';
import { buildPageTimeline, estimateNarrationMs, shouldDeferForInk, MAX_INK_HOLD_MS } from './board-model';
import type { PageTimeline } from './board-model';
import { createAudioClock, createSpeechClock, prefetchBoardTts, SPEECH_BASE_RATE } from './segment-clock';
import type { SegmentClock } from './segment-clock';
import { emitBoardTiming } from './board-timing';
import { createLogger } from '@/lib/logger';

const log = createLogger('board-player');

export type BoardPlayerStatus = 'idle' | 'playing' | 'paused' | 'checkpoint' | 'finished' | 'waiting';
export type BoardSpeed = 1 | 1.5;

/** 实际时钟速率 = 用户倍速 × 老师基础语速（0.9，依据见 segment-clock.SPEECH_BASE_RATE） */
const effectiveRate = (speed: BoardSpeed): number => speed * SPEECH_BASE_RATE;

/** 首页首段冷启动看门狗宽限：TTS 预取与播放并发，引擎冷 + 服务端串行闸下首段
 *  合成可达 10s+；15s 实测仍误杀（2026-08-19 节奏诊断：首段 15.1s 被判机器人音，
 *  用户第一耳朵听到机械音）。放宽到 30s——第一耳朵必须是真人音色，等待期间
 *  板面有「老师正在备课…」粉笔字，fetch 自身 45s 超时兜底（真挂了仍会降级）。 */
const COLD_START_WATCHDOG_MS = 30000;

// ── 播放状态机 ─────────────────────────────────────────────────────────────

export interface BoardPlayerState {
  status: BoardPlayerStatus;
  pageIndex: number;
  segmentIndex: number;
  speed: BoardSpeed;
  pageCount: number;
  /** 当前页已触发的动作 key 列表（'s{段}a{动作}'） */
  triggered: string[];
  /** 当前 segment 的讲稿（字幕用） */
  narration: string;
  /** 当前段朗读到的字符下标（字幕卡拉 OK 窗口跟随用；checkpoint/非播放态为 0） */
  charIndex: number;
  /** 当前段是 checkpoint 时透出（交互态用） */
  checkpoint: CheckpointSegment | null;
  /** v9 音画同步：当前页动作 key → 书写时间窗预算 ms（BoardCanvas 书写调速用） */
  actionBudgets: Record<string, number>;
}

export interface BoardPlayer extends BoardPlayerState {
  play(): void;
  pause(): void;
  replay(): void;
  toggleSpeed(): void;
  /** checkpoint 交互完成后续播下一段 */
  advanceFromCheckpoint(): void;
  /** 流式生成：新单元到达（或生成全部完成）时由外部通知，waiting → 续播/收束 */
  notifyScriptGrown(allDone: boolean): void;
}

export function useBoardPlayer(
  script: BoardScript | null,
  options?: {
    msPerChar?: number;
    advanceGate?: () => boolean;
    isGenerating?: () => boolean;
    /** v23 反向背压：当前页已触发但未写完的 write 数（BoardCanvas 串行队列积压） */
    inkBacklog?: () => number;
  },
): BoardPlayer {
  const [status, setStatus] = useState<BoardPlayerStatus>('idle');
  const [pageIndex, setPageIndex] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [speed, setSpeed] = useState<BoardSpeed>(1);
  const [triggered, setTriggered] = useState<string[]>([]);
  // 主循环重起信号：自动开播 / 重播 / 闸门期间暂停后恢复时 bump
  const [runId, setRunId] = useState(0);
  // 当前段朗读字位（字幕窗口跟随）
  const [charIndex, setCharIndex] = useState(0);

  const clockRef = useRef<SegmentClock | null>(null);
  const speedRef = useRef<BoardSpeed>(1);
  // 状态机当前状态（effect 闭包外的回调做守卫用）
  const statusRef = useRef(status);
  statusRef.current = status;
  // 翻页闸门（本页 write 是否全部完成），由 BoardCanvas 经 BlackboardPlayer 上报
  const gateRef = useRef<(() => boolean) | undefined>(options?.advanceGate);
  gateRef.current = options?.advanceGate;
  // 流式生成：是否还有讲解单元在生成中（waiting 与 finished 的分野）
  const generatingRef = useRef<(() => boolean) | undefined>(options?.isGenerating);
  generatingRef.current = options?.isGenerating;
  // v23 反向背压：笔的串行队列积压数（BoardCanvas 上报），handleProgress 判定用
  const inkBacklogRef = useRef<(() => number) | undefined>(options?.inkBacklog);
  inkBacklogRef.current = options?.inkBacklog;

  const pageCount = script?.pages.length ?? 0;
  const msPerChar = options?.msPerChar;
  // timeline 依赖页对象身份而非整个 script——流式追加新页时旧页引用稳定，
  // 当前段的 timeline 不重算（否则主 effect 重跑、当前段时钟重启）
  const currentPage = script?.pages[pageIndex];
  const timeline: PageTimeline | null = useMemo(
    () => (currentPage ? buildPageTimeline(currentPage, { msPerChar }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPage, msPerChar],
  );

  const rawSegment = script?.pages[pageIndex]?.segments[segmentIndex] ?? null;
  const checkpoint: CheckpointSegment | null =
    rawSegment && rawSegment.type === 'checkpoint' ? rawSegment : null;
  const segment = timeline?.segments[segmentIndex] ?? null;
  const narration = segment?.narration ?? '';

  // v9：当前页动作的书写时间窗预算（换页随 timeline 重算）。
  // 倍速折算：真实时间窗 = 预算 / (用户倍速 × 老师基础语速)，书写同步加速
  // （clamp 上限吸收），否则段末闸门要把差额全吞成段间静默（BOARD_PLAYER_SYNC.md §4）
  const actionBudgets = useMemo(() => {
    const map: Record<string, number> = {};
    timeline?.segments.forEach((timedSegment, segIndex) => {
      timedSegment.actions.forEach((timed, actIndex) => {
        if (timed.budgetMs !== undefined) map[`s${segIndex}a${actIndex}`] = timed.budgetMs / effectiveRate(speed);
      });
    });
    return map;
  }, [timeline, speed]);

  // 自动开播：脚本就位即进入 playing（runId  bump 让主循环起第一段 clock）
  useEffect(() => {
    if (script && status === 'idle') {
      setRunId((id) => id + 1);
      setStatus('playing');
    }
  }, [script, status]);

  // 冷启动预热：脚本一到就预取首页前两段音频——首段 clock 起播时命中缓存。
  // 不预热的话首段现取合成（引擎冷 + 串行闸 10s+）必撞 15s 看门狗被判机器人音
  useEffect(() => {
    const segments = script?.pages[0]?.segments;
    if (!segments) return;
    for (const segment of segments.slice(0, 2)) {
      prefetchBoardTts(segmentDisplayText(segment));
    }
  }, [script]);

  // 主循环：narration 段起一个 clock，cue 动作按词级 charIndex 触发；
  // checkpoint 段只播提问口述，讲完进入等待态交给交互 UI。
  // **status 刻意不在 deps 里（2026-08-19 音画错位根修）**：暂停/恢复只走
  // clock.pause()/resume() 直控。status 进 deps 会让 pause 的 setStatus 触发
  // cleanup 销毁 clock、resume 再为同一段新建 clock 从 0 秒重播——而黑板的
  // triggered/书写接力还在原位，就是"板书写到 30 秒、人声从头开始"。
  // 真正需要重起 clock 的场景（自动开播/重播/闸门期间暂停后恢复）用 runId 信号。
  useEffect(() => {
    if (!timeline || !segment || statusRef.current !== 'playing') return undefined;

    // checkpoint：只朗读提问，讲完进等待态（动作由交互态驱动）。
    // 与正段同一条声音链（AudioClock → speechSynthesis）——否则正段真人音色、
    // 提问突然切成浏览器机器人音，机器感最重的一处断裂。
    if (checkpoint) {
      const text = segment?.narration ?? segmentDisplayText(checkpoint);
      const estimatedMs = segment
        ? segment.endMs - segment.startMs
        : estimateNarrationMs(text, msPerChar);
      const clock = createAudioClock(text, estimatedMs, effectiveRate(speedRef.current));
      clockRef.current = clock;
      const onDone = () => {
        clockRef.current = null;
        setStatus('checkpoint');
      };
      clock.onEnd = onDone;
      clock.onUnavailable = () => {
        if (clockRef.current !== clock) return;
        // 降级前必须 cancel 原 AudioClock：它的 fetch 可能还在飞，
        // 不 cancel 等 wav 到了会叠在机器人音上（双音重合竞态，2026-08-18 实测）
        clock.cancel();
        const fallback = createSpeechClock(text, estimatedMs, effectiveRate(speedRef.current));
        clockRef.current = fallback;
        fallback.onEnd = onDone;
        fallback.start();
        // 降级发生在暂停期间：新 clock 必须继承暂停态，
        // 否则它会在暂停中自由跑完（恢复后人声消失只剩板书在写）
        if (statusRef.current === 'paused') fallback.pause();
      };
      clock.start();
      return () => {
        clock.cancel();
        clockRef.current?.cancel();
        if (clockRef.current === clock) clockRef.current = null;
      };
    }

    const segmentDurationMs = segment.endMs - segment.startMs;
    let gateTimer: ReturnType<typeof setInterval> | null = null;
    setCharIndex(0);

    // ── v23 讲写联合调度·反向背压（ink → speech）─────────────────────────
    // 嘴到新动作的 cue 而笔还有未写完的板书 → 在词边界把音频 hold 住（真人
    // 老师"写完才开口讲下一句"的自然停顿），笔追上（或 MAX_INK_HOLD_MS 超时
    // 兜底）再放行；被延后的动作在放行后的首个进度事件补触发。hold 只冻
    // 声音链（clock.pause 直控，不动 status），黑板书写接力照常跑——
    // 这正是"音等画"的生效方式。pause/ref 不背压（见 shouldDeferForInk）。
    let holdPoll: ReturnType<typeof setInterval> | null = null;
    let holdMaxTimer: ReturnType<typeof setTimeout> | null = null;
    let holding = false;
    // 超时强制放行后本段不再背压：残余漂移由段末闸门一次吸收，不许无限 hold
    let holdBroken = false;
    let holdStartAt = 0;
    let lastProgress: { elapsedMs: number; charIndex: number } | null = null;

    const clearHoldTimers = () => {
      if (holdPoll) clearInterval(holdPoll);
      if (holdMaxTimer) clearTimeout(holdMaxTimer);
      holdPoll = null;
      holdMaxTimer = null;
    };

    const fireReachedActions = (progress: { elapsedMs: number; charIndex: number }) => {
      setTriggered((prev) => {
        const next = new Set(prev);
        const absolute = segment.startMs + progress.elapsedMs;
        segment.actions.forEach((timed, actionIndex) => {
          const hit =
            timed.cueCharIndex !== undefined
              ? progress.charIndex >= timed.cueCharIndex
              : timed.startMs <= absolute;
          if (hit) next.add(`s${segmentIndex}a${actionIndex}`);
        });
        return next.size === prev.length ? prev : Array.from(next);
      });
    };

    const releaseInkHold = (forced: boolean) => {
      if (!holding) return;
      clearHoldTimers();
      holding = false;
      if (forced) {
        holdBroken = true;
        // 兜底放行：把已达到 cue 的动作立即补上，防止它们随段结束永远丢失
        if (lastProgress) fireReachedActions(lastProgress);
        emitBoardTiming('ink-hold-forced', { page: pageIndex, segment: segmentIndex });
      } else {
        emitBoardTiming('ink-hold-release', {
          page: pageIndex,
          segment: segmentIndex,
          waitedMs: Math.round(performance.now() - holdStartAt),
        });
      }
      // 用户暂停期间背压到点：不许越过用户暂停擅自出声
      if (statusRef.current === 'playing') clockRef.current?.resume();
    };

    const engageInkHold = () => {
      if (holding || holdBroken) return;
      holding = true;
      holdStartAt = performance.now();
      clockRef.current?.pause();
      emitBoardTiming('ink-hold', { page: pageIndex, segment: segmentIndex });
      holdPoll = setInterval(() => {
        if ((inkBacklogRef.current?.() ?? 0) === 0) releaseInkHold(false);
      }, 180);
      holdMaxTimer = setTimeout(() => releaseInkHold(true), MAX_INK_HOLD_MS);
    };

    const handleProgress = (progress: { elapsedMs: number; charIndex: number }) => {
      lastProgress = progress;
      setCharIndex(progress.charIndex);
      const absolute = segment.startMs + progress.elapsedMs;
      const backlog = inkBacklogRef.current?.() ?? 0;
      let needsHold = false;
      setTriggered((prev) => {
        const next = new Set(prev);
        segment.actions.forEach((timed, actionIndex) => {
          const key = `s${segmentIndex}a${actionIndex}`;
          // 已触发的不参与背压判定——否则"写着最后一个 write、后面没有新动作"
          // 的时段每个进度事件都会误判 needsHold，把本该边写边念的共现讲段冻住
          if (next.has(key)) return;
          const hit =
            timed.cueCharIndex !== undefined
              ? progress.charIndex >= timed.cueCharIndex
              : timed.startMs <= absolute;
          if (!hit) return;
          // 背压：笔还落后时新动作延后到笔追上（声音在词边界同步 hold）
          if (!holdBroken && shouldDeferForInk(timed.action, backlog)) {
            needsHold = true;
            return;
          }
          next.add(key);
        });
        return next.size === prev.length ? prev : Array.from(next);
      });
      if (needsHold) engageInkHold();
    };

    const advance = () => {
      if (segmentIndex + 1 < timeline.segments.length) {
        setSegmentIndex(segmentIndex + 1);
      } else if (pageIndex + 1 < pageCount) {
        setPageIndex(pageIndex + 1);
        setSegmentIndex(0);
        setTriggered([]);
      } else if (generatingRef.current?.()) {
        // 流式生成中：后续单元还没生成完，进入等待态（黑板显示备课中），
        // 新单元到达由 notifyScriptGrown 续播
        setStatus('waiting');
      } else {
        setStatus('finished');
      }
    };

    const handleEnd = () => {
      // 暂停守卫：clock 的 end 只许在 playing 态推进段落。任何残留的
      // 定时器在暂停中触发都不许悄悄翻段（翻了段，恢复后人声从段首重播
      // 而板书还在旧位置 = 音画错位，2026-08-19 用户实测）
      if (statusRef.current !== 'playing') return;
      clockRef.current = null;
      emitBoardTiming('segment-end', { page: pageIndex, segment: segmentIndex });
      // v9 音画同步·段末硬同步：板上已触发的板书必须全部写完才播下一段
      // （涵盖段内前进与翻页）。宁可音等画——老师写完最后一个字才开口的
      // 自然停顿——也不让音画各跑各的、漂移跨段累积。
      const hasNext = segmentIndex + 1 < timeline.segments.length || pageIndex + 1 < pageCount;
      const gate = gateRef.current;
      // v15 科学节奏·段间呼吸：老师讲完一段会换口气——页内 700ms、翻页
      // 1600ms 的确定性停顿（2026-08-18 用户实测节奏偏快，从 400/1200 上调）。
      // 闸门等待已超过呼吸时长时不再叠加（音等画本身就是停顿）。
      // 导演 pass：segment.breathMs 覆盖默认值（关键结论后停 800-1500ms）
      const turningPage = segmentIndex + 1 >= timeline.segments.length;
      const directorBreath =
        rawSegment && rawSegment.type !== 'checkpoint' ? rawSegment.breathMs : undefined;
      const breathMs = directorBreath ?? (turningPage ? 1600 : 700);
      const advanceAfterBreath = (alreadyWaitedMs: number) => {
        const remaining = breathMs - alreadyWaitedMs;
        if (remaining <= 0) {
          advance();
          return;
        }
        gateTimer = setTimeout(() => {
          gateTimer = null;
          advance();
        }, remaining) as unknown as ReturnType<typeof setInterval>;
      };
      if (hasNext && gate && !gate()) {
        const waitStart = performance.now();
        emitBoardTiming('gate-wait', { page: pageIndex, segment: segmentIndex });
        gateTimer = setInterval(() => {
          if (gateRef.current?.()) {
            if (gateTimer) clearInterval(gateTimer);
            gateTimer = null;
            const waitedMs = Math.round(performance.now() - waitStart);
            emitBoardTiming('gate-release', { page: pageIndex, segment: segmentIndex, waitedMs });
            advanceAfterBreath(waitedMs);
          }
        }, 400);
        return;
      }
      advanceAfterBreath(0);
    };

    // 时钟链：AudioClock（DashScope TTS）→ speechSynthesis → 纯 timer
    // 冷启动宽限：首页首段 TTS 预取与播放几乎同时启动，看门狗放宽（其余段
    // 靠接力预取，9s 足够）；宽限值依据见 COLD_START_WATCHDOG_MS
    const coldStart = pageIndex === 0 && segmentIndex === 0;
    let progressSeen = false;
    emitBoardTiming('segment-start', {
      page: pageIndex,
      segment: segmentIndex,
      estimatedMs: segmentDurationMs,
      chars: segment.narration.replace(/\s+/g, '').length,
    });
    const clock = createAudioClock(segment.narration, segmentDurationMs, effectiveRate(speedRef.current), {
      watchdogMs: coldStart ? COLD_START_WATCHDOG_MS : undefined,
    });
    clock.onProgress = (progress) => {
      progressSeen = true;
      handleProgress(progress);
    };
    clock.onEnd = handleEnd;
    clock.onUnavailable = () => {
      if (clockRef.current !== clock) return;
      emitBoardTiming('clock-fallback', { page: pageIndex, segment: segmentIndex });
      // 降级前必须 cancel 原 AudioClock：它的 fetch 可能还在飞，
      // 不 cancel 等 wav 到了会叠在机器人音上（双音重合竞态，2026-08-18 实测）
      clock.cancel();
      const fallback = createSpeechClock(segment.narration, segmentDurationMs, effectiveRate(speedRef.current));
      clockRef.current = fallback;
      fallback.onProgress = handleProgress;
      fallback.onEnd = handleEnd;
      fallback.start();
      // 降级发生在暂停期间：新 clock 必须继承暂停态（同上）
      if (statusRef.current === 'paused') fallback.pause();
      // 降级发生在背压 hold 期间：新 clock 同样不许自由跑（声音必须等笔）
      else if (holding) fallback.pause();
    };
    clockRef.current = clock;
    clock.start();

    // 看门狗：无进度强降级时限与音频看门狗保持一致（冷启动段同步放宽）。
    // 手势门期间（AudioContext 等用户首次点击，board:awaiting-gesture）无进度
    // 是正常等待，不是挂起——停表；手势拿到后重新武装。
    const watchdogMs = coldStart ? COLD_START_WATCHDOG_MS : 8000;
    let clockWatchdog: ReturnType<typeof setTimeout> | null = null;
    const armClockWatchdog = () => {
      if (clockWatchdog) clearTimeout(clockWatchdog);
      clockWatchdog = setTimeout(() => {
        if (!progressSeen && clockRef.current === clock) {
          log.error('board player: 无进度，强制降级时钟链');
          clock.onUnavailable?.();
        }
      }, watchdogMs);
    };
    armClockWatchdog();
    const onAwaitingGesture = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail) {
        if (clockWatchdog) {
          clearTimeout(clockWatchdog);
          clockWatchdog = null;
        }
      } else if (!progressSeen) {
        armClockWatchdog();
      }
    };
    window.addEventListener('board:awaiting-gesture', onAwaitingGesture);

    // 预取后续音频（后台，不阻塞播放）：v26 小讲解单元（一口气一段）后段变短
    // 变密，预取深度从 1 段提到 2 段，TTS 合成延迟才不会在每口气边界露头；
    // 页末溢出到下一页首段（checkpoint 提问也在 timeline 里，同被覆盖）
    const upcoming: string[] = [];
    for (let offset = 1; offset <= 2; offset += 1) {
      const ahead = timeline.segments[segmentIndex + offset];
      if (ahead) {
        upcoming.push(ahead.narration);
      } else {
        const spill = script?.pages[pageIndex + 1]?.segments[segmentIndex + offset - timeline.segments.length];
        if (spill) upcoming.push(segmentDisplayText(spill));
      }
    }
    upcoming.forEach((text) => prefetchBoardTts(text));

    return () => {
      clock.cancel();
      clockRef.current?.cancel();
      clearHoldTimers();
      if (clockWatchdog) clearTimeout(clockWatchdog);
      window.removeEventListener('board:awaiting-gesture', onAwaitingGesture);
      if (gateTimer) clearInterval(gateTimer);
      if (clockRef.current === clock) clockRef.current = null;
    };
    // segment / page / runId 切换时重起 clock；triggered 由进度回调维护；
    // status 不在 deps（暂停/恢复不销毁 clock，见上）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, segmentIndex, timeline, checkpoint, runId]);

  const pause = useCallback(() => {
    // 只直控 clock：不触发主循环重跑（clock 存活，板书/人声都冻结在原位）
    if (statusRef.current !== 'playing') return;
    clockRef.current?.pause();
    setStatus('paused');
  }, []);

  const play = useCallback(() => {
    if (statusRef.current === 'paused') {
      if (clockRef.current) {
        // 常规恢复：clock 还在，原地继续（音画都不断点）
        clockRef.current.resume();
      } else {
        // 段间闸门/呼吸期间暂停：当前段没有活 clock，重起这一段（它还没开播过）
        setRunId((id) => id + 1);
      }
      setStatus('playing');
      return;
    }
    if (statusRef.current === 'idle') {
      setRunId((id) => id + 1);
      setStatus('playing');
    }
  }, []);

  const replay = useCallback(() => {
    clockRef.current?.cancel();
    clockRef.current = null;
    setPageIndex(0);
    setSegmentIndex(0);
    setTriggered([]);
    setRunId((id) => id + 1);
    setStatus('playing');
  }, []);

  const toggleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const next: BoardSpeed = prev === 1 ? 1.5 : 1;
      speedRef.current = next;
      clockRef.current?.setRate(effectiveRate(next));
      return next;
    });
  }, []);

  const advanceFromCheckpoint = useCallback(() => {
    clockRef.current?.cancel();
    clockRef.current = null;
    const segmentCount = timeline?.segments.length ?? 0;
    if (segmentIndex + 1 < segmentCount) {
      setSegmentIndex(segmentIndex + 1);
      setStatus('playing');
    } else if (pageIndex + 1 < pageCount) {
      setPageIndex(pageIndex + 1);
      setSegmentIndex(0);
      setTriggered([]);
      setStatus('playing');
    } else {
      setStatus('finished');
    }
  }, [timeline, segmentIndex, pageIndex, pageCount]);

  // 流式生成：新单元到达 → waiting 续播下一页；全部生成完 → 收束为 finished
  const notifyScriptGrown = useCallback((allDone: boolean) => {
    if (statusRef.current !== 'waiting') return;
    if (allDone) {
      setStatus('finished');
      return;
    }
    setPageIndex((prev) => prev + 1);
    setSegmentIndex(0);
    setTriggered([]);
    setStatus('playing');
  }, []);

  return {
    status,
    pageIndex,
    segmentIndex,
    speed,
    pageCount,
    triggered,
    narration,
    charIndex,
    checkpoint,
    actionBudgets,
    play,
    pause,
    replay,
    toggleSpeed,
    advanceFromCheckpoint,
    notifyScriptGrown,
  };
}
