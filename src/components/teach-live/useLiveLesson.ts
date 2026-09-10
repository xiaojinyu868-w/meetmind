'use client';

/**
 * useLiveLesson —— 舞台页的会话 hook：把三样东西接在一起。
 *
 *   服务端事件（live-client SSE）──► reducer（live-model：到达时间轴，块正文增长）
 *                                └──► Director（director.ts：演出时间轴，按语音节奏 reveal / cue）
 *   Director ──► TeachSpeechPlayer（/api/teach/tts 按句合成、预取、串行播）
 *
 * 事件按 rAF 批量喂 reducer（一轮 700+ 事件，逐个 dispatch 会让 React 忙死）。
 * 打断 = director.reset() + discard-unrevealed + 服务端 interrupt（附文字即续讲）。
 * 历史课程：事件日志 replay 直接终态（不经 Director），再订阅续讲。
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { TeachStreamEvent } from '@/lib/services/teach-codex/event-bus';
import type { LiveAttrs, LiveCueName } from '@/types/teach-live';
import { TeachSpeechPlayer } from '@/components/teach/speech-pipeline';
import { buildLocalLearnerContext } from '@/components/learner-context-local';
import { Director, SentenceCutter, cleanSpeechText, type CaptionPhase, type SpeechPort } from './director';
import { liveCreateThread, liveFetchEvents, livePostInterrupt, livePostMessage, liveSubscribe, type LiveSubscription } from './live-client';
import { createLessonState, isSpeechKind, lessonReducer, resolveTarget, type LessonState } from './live-model';

export interface Caption {
  text: string;
  phase: CaptionPhase;
  ask: boolean;
}

export interface PointerTarget {
  blockId: string;
  innerId: string | null;
  /** 触发时间（同一目标连续 point 也要重新动一下） */
  at: number;
}

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting';

/** 首条学生消息：开课口令（不进课堂记录） */
const START_MESSAGE = '开始上课';

/** TeachSpeechPlayer → Director 的语音口 */
class PlayerSpeechPort implements SpeechPort {
  readonly player: TeachSpeechPlayer;
  private waiters = new Map<number, (started: boolean) => void>();

  constructor(onSpeakingChange: (speaking: boolean) => void) {
    this.player = new TeachSpeechPlayer({
      onSpeakingChange,
      onSentenceStart: (seq) => {
        const resolve = this.waiters.get(seq);
        if (resolve) {
          this.waiters.delete(seq);
          resolve(true);
        }
      },
    });
  }

  speak(text: string): Promise<boolean> {
    const clean = cleanSpeechText(text);
    if (!clean || !this.player.isActive) return Promise.resolve(false);
    const seq = this.player.lastSeq + 1;
    const promise = new Promise<boolean>((resolve) => this.waiters.set(seq, resolve));
    this.player.enqueue(clean);
    // enqueue 被静音等原因吞掉（seq 没涨）：立刻放行
    if (this.player.lastSeq < seq) {
      this.waiters.delete(seq);
      return Promise.resolve(false);
    }
    return promise;
  }

  stop(): void {
    this.player.stopAll();
    for (const resolve of this.waiters.values()) resolve(false);
    this.waiters.clear();
  }
}

export function useLiveLesson() {
  const [state, dispatch] = useReducer(lessonReducer, undefined, () => createLessonState({ threadId: null, title: '', topic: '' }));
  const stateRef = useRef<LessonState>(state);
  stateRef.current = state;

  const [caption, setCaption] = useState<Caption | null>(null);
  const [speaking, setSpeakingState] = useState(false);
  const speakingRef = useRef(false);
  const setSpeaking = useCallback((value: boolean) => {
    speakingRef.current = value;
    setSpeakingState(value);
  }, []);
  const [muted, setMutedState] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [pointer, setPointer] = useState<PointerTarget | null>(null);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  const subscriptionRef = useRef<LiveSubscription | null>(null);
  const eventBufferRef = useRef<TeachStreamEvent[]>([]);
  const flushScheduledRef = useRef(false);
  const cutterRef = useRef(new SentenceCutter());
  const speechBlockRef = useRef<{ id: string; ask: boolean } | null>(null);
  /** 会话代数：换课后迟到的事件全部作废 */
  const epochRef = useRef(0);
  const pointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const port = useMemo(() => new PlayerSpeechPort(setSpeaking), [setSpeaking]);
  const director = useMemo(
    () =>
      new Director(port, {
        onReveal: (segmentId) => dispatch({ type: 'reveal', segmentId }),
        onCue: (name: LiveCueName, args: LiveAttrs) => {
          if (name === 'point') {
            const target = resolveTarget(stateRef.current, args.at ?? '');
            if (target) {
              setPointer({ ...target, at: Date.now() });
              if (pointerTimerRef.current) clearTimeout(pointerTimerRef.current);
              pointerTimerRef.current = setTimeout(() => setPointer(null), 3600);
            }
            return;
          }
          dispatch({ type: 'stage-cue', name, args });
        },
        onCaption: (text, meta) => {
          // 上一句还在播时，下一句的「合成中」不抢字幕；只有真的没声音时才提前露出下一句
          if (meta.phase === 'pending' && text && speakingRef.current) return;
          setCaption(text ? { text, phase: meta.phase, ask: meta.ask } : null);
        },
        onDrain: () => setDirectorBusy(false),
      }),
    [port],
  );

  useEffect(() => {
    return () => {
      subscriptionRef.current?.close();
      director.reset();
      if (pointerTimerRef.current) clearTimeout(pointerTimerRef.current);
    };
  }, [director]);

  // ---------- 事件喂入 ----------

  const feedLiveEvent = useCallback(
    (ev: TeachStreamEvent) => {
      dispatch({ type: 'server', event: ev });
      switch (ev.type) {
        case 'block-open':
          if (isSpeechKind(ev.kind)) {
            cutterRef.current.reset();
            speechBlockRef.current = { id: ev.id, ask: ev.kind === 'ask' };
          } else {
            director.push({ kind: 'reveal', segmentId: ev.id, blockId: ev.id });
          }
          setDirectorBusy(true);
          break;
        case 'text-delta': {
          const speech = speechBlockRef.current;
          if (!speech) break;
          for (const sentence of cutterRef.current.push(ev.text)) {
            const clean = cleanSpeechText(sentence);
            if (clean) director.push({ kind: 'speech', blockId: speech.id, text: clean, ask: speech.ask });
          }
          break;
        }
        case 'block-close': {
          const speech = speechBlockRef.current;
          if (speech && speech.id === ev.id) {
            const rest = cutterRef.current.flush();
            const cleanRest = rest ? cleanSpeechText(rest) : '';
            if (cleanRest) director.push({ kind: 'speech', blockId: speech.id, text: cleanRest, ask: speech.ask });
            if (speech.ask) director.push({ kind: 'reveal', segmentId: ev.id, blockId: ev.id });
            speechBlockRef.current = null;
          }
          break;
        }
        case 'cue':
          director.push({ kind: 'cue', name: ev.name, args: ev.args });
          break;
        default:
          break;
      }
    },
    [director],
  );

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    requestAnimationFrame(() => {
      flushScheduledRef.current = false;
      const batch = eventBufferRef.current;
      eventBufferRef.current = [];
      for (const ev of batch) feedLiveEvent(ev);
    });
  }, [feedLiveEvent]);

  const rebuildFromLog = useCallback(
    async (threadId: string, epoch: number) => {
      const { events, title, topic } = await liveFetchEvents(threadId);
      if (epoch !== epochRef.current) return;
      director.reset();
      eventBufferRef.current = [];
      speechBlockRef.current = null;
      dispatch({ type: 'reset', threadId, title, topic });
      let turn = 0;
      for (const ev of events) {
        if ((ev as { type: string }).type === 'student-message') {
          turn += 1;
          const text = (ev as { text: string }).text;
          dispatch({ type: 'student-message', text, silent: turn === 1 && text === START_MESSAGE });
          continue;
        }
        dispatch({ type: 'server', event: ev, replay: true });
      }
      setCaption(null);
    },
    [director],
  );

  const subscribe = useCallback(
    (threadId: string, epoch: number) => {
      subscriptionRef.current?.close();
      setConnection('connecting');
      subscriptionRef.current = liveSubscribe(threadId, {
        onEvent: (ev) => {
          if (epoch !== epochRef.current) return;
          eventBufferRef.current.push(ev);
          scheduleFlush();
        },
        onOpen: (reconnected) => {
          if (epoch !== epochRef.current) return;
          setConnection('open');
          if (reconnected) {
            // 断线期间可能漏事件：整体按日志重建（终态），演出中断可以接受
            void rebuildFromLog(threadId, epoch);
          }
        },
        onError: () => {
          if (epoch === epochRef.current) setConnection('reconnecting');
        },
      });
    },
    [scheduleFlush, rebuildFromLog],
  );

  // ---------- 对外动作 ----------

  const unlockAudio = useCallback(() => port.player.unlock(), [port]);

  const setMuted = useCallback(
    (value: boolean) => {
      setMutedState(value);
      port.player.setMuted(value);
    },
    [port],
  );

  const startLesson = useCallback(
    async (topic: string) => {
      const clean = topic.trim().slice(0, 100);
      if (!clean) return;
      unlockAudio();
      setStarting(true);
      const epoch = ++epochRef.current;
      try {
        // 「这个学习者」读槽：开课带本机切片（跨课掌握状态），老师知道哪些概念还没稳
        let learner: unknown;
        try {
          learner = buildLocalLearnerContext({ appId: 'teach' });
        } catch {
          learner = undefined;
        }
        const thread = await liveCreateThread(clean, learner);
        if (epoch !== epochRef.current) return;
        director.reset();
        setCaption(null);
        setPointer(null);
        dispatch({ type: 'reset', threadId: thread.id, title: thread.title, topic: thread.topic });
        subscribe(thread.id, epoch);
        dispatch({ type: 'student-message', text: START_MESSAGE, silent: true });
        await livePostMessage(thread.id, START_MESSAGE);
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('t', thread.id);
          window.history.replaceState(null, '', url.toString());
        }
      } finally {
        if (epoch === epochRef.current) setStarting(false);
      }
    },
    [director, subscribe, unlockAudio],
  );

  const openLesson = useCallback(
    async (threadId: string) => {
      unlockAudio();
      const epoch = ++epochRef.current;
      subscriptionRef.current?.close();
      setPointer(null);
      await rebuildFromLog(threadId, epoch);
      if (epoch !== epochRef.current) return;
      subscribe(threadId, epoch);
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('t', threadId);
        window.history.replaceState(null, '', url.toString());
      }
    },
    [rebuildFromLog, subscribe, unlockAudio],
  );

  /** 学生开口：老师在讲就打断（服务端仍在生成 → interrupt 附文字；已生成完 → 直接发） */
  const send = useCallback(
    async (text: string) => {
      const threadId = stateRef.current.threadId;
      const clean = text.trim();
      if (!threadId || !clean) return;
      unlockAudio();
      const wasGenerating = stateRef.current.generating;
      director.reset();
      setCaption(null);
      setPointer(null);
      dispatch({ type: 'discard-unrevealed' });
      dispatch({ type: 'student-message', text: clean });
      speechBlockRef.current = null;
      cutterRef.current.reset();
      if (wasGenerating) await livePostInterrupt(threadId, clean);
      else await livePostMessage(threadId, clean);
    },
    [director, unlockAudio],
  );

  /** 举手：老师立刻闭嘴（学生准备说话） */
  const hush = useCallback(async () => {
    const threadId = stateRef.current.threadId;
    director.reset();
    setCaption(null);
    dispatch({ type: 'discard-unrevealed' });
    if (threadId && stateRef.current.generating) await livePostInterrupt(threadId);
  }, [director]);

  const leaveLesson = useCallback(() => {
    epochRef.current += 1;
    subscriptionRef.current?.close();
    subscriptionRef.current = null;
    director.reset();
    setCaption(null);
    setPointer(null);
    setConnection('idle');
    dispatch({ type: 'reset', threadId: null, title: '', topic: '' });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('t');
      window.history.replaceState(null, '', url.toString());
    }
  }, [director]);

  const viewPage = useCallback((pageId: string | null) => dispatch({ type: 'view-page', pageId }), []);

  return {
    state,
    caption,
    speaking,
    muted,
    setMuted,
    connection,
    pointer,
    /** 老师这边还有没演完的内容（生成中或演出中） */
    busy: state.generating || directorBusy,
    starting,
    startLesson,
    openLesson,
    send,
    hush,
    leaveLesson,
    viewPage,
  };
}

export type LiveLessonController = ReturnType<typeof useLiveLesson>;
