'use client';

/**
 * useTeachBackPanel — 「讲给同桌听」连续讲述的编排 hook（2026-09-10；面试间表现层同日重做，底层不变）。
 *
 * 像语音通话：开讲后麦克风常开 → 实时 ASR（课堂录音同一条 /api/asr-stream 通道）出转写 →
 * 能量 VAD + 句末事件判"这一段讲完了"（teach-back-turn-machine，纯逻辑）→ 听众席一位开口
 * （POST /api/apps/teach-back/turn，SSE 流式）→ 反馈流一条边说边长、按句送 TTS（三位三种声音）→
 * 你一开口听众就停（中止请求 + 停播 + 那条收成一行）。
 *
 * 这里只做三件事：把麦克风帧 / ASR 事件 / SSE 事件喂进状态机；执行状态机吐出的 effects；
 * 把画面需要的状态暴露出去（你讲过的每一段带会话内时间切片、反馈流条目、谁在说、会话时钟）。
 * 判断都在状态机与模型里，这里不写业务规则。
 *
 * 实时反馈开 / 关（偏好 meetmind:teach-back:live-feedback）：
 * - 开：回合一结束听众就开口（画面 + 声音），你随时可以插话打断；
 * - 关：回合一结束仍然请求 turn，但那条记成 held——不上屏、不出声、不占状态机（立刻 judge-close 回到听讲，
 *   所以你接着讲也不会把它中止）；讲完后按时间一条条揭示（HELD_REVEAL_INTERVAL_MS）。
 *   关着时不做 40s 检查点——"要不要先到这"记成笔记讲完再读没有意义。
 *
 * 边界：
 * - 与正在录课的 Recorder 互斥（同一时刻只有一路麦克风）：session-store.isRecording 为真不开讲，
 *   开讲后录课开始则自动停。
 * - TTS 失败只静默回退到文字（TeachSpeechPlayer 跳过该句）；听众请求失败 = 沉默。
 * - 手机切后台：AudioContext 被挂起时回前台 resume；麦克风轨道 ended → 'mic-lost'，一键重新开麦
 *   （会话时钟、已讲的段、反馈流都保留，回合号接着数）。
 *
 * 体积：编排 + 麦克风生命周期 + SSE 回合 + 揭示节奏收在一处（约 600 行）——四段共享同一批 ref，
 * 拆开只会把 ref 传来传去；判断已全部在状态机与 room-model 里。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { TeachBackJudgeId, TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import type { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';
import { buildAudioConstraints, computeRms } from '@/lib/services/asr/audio-constraints';
import { floatToPcm16, frameDurationMs } from '@/lib/services/asr/pcm';
import { judgeSpecOf, parseSseChunk } from '@/lib/ai-native/teach-back-panel';
import { SentenceSplitter, TeachSpeechPlayer } from '@/components/teach/speech-pipeline';
import { useSessionStore } from '@/stores/session-store';
import {
  createTurnMachine,
  pendingText,
  reduceTurn,
  stageMoodOf,
  type StageMood,
  type TurnEffect,
  type TurnEvent,
  type TurnMachineState,
  type TurnPhase,
} from './teach-back-turn-machine';
import { HELD_REVEAL_INTERVAL_MS, nextHeldToReveal, type FeedbackEntry, type TranscriptTurn } from './teach-back-room-model';

/** 出声 / 只看文字 的偏好 key（localStorage） */
export const TEACH_BACK_VOICE_PREF_KEY = 'meetmind:teach-back:voice';
/** 实时反馈 开 / 关 的偏好 key（localStorage） */
export const TEACH_BACK_LIVE_FEEDBACK_PREF_KEY = 'meetmind:teach-back:live-feedback';

/** 采集帧大小：@16k 128ms、@48k 43ms——VAD 分辨率与 WS 消息频率的折中 */
const PROCESSOR_BUFFER = 2048;
const TICK_MS = 250;
/** 波形保留的最近帧数 */
const LEVEL_HISTORY = 28;

export type MicStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'mic-denied'
  | 'mic-lost'
  | 'mic-busy'
  | 'asr-down'
  | 'stopped';

export interface UseTeachBackPanelInput {
  targets: TeachBackTarget[];
  transcript: TranscriptSegment[];
  metadata?: { title?: string };
  /** 与 /api/apps/teach-back/evaluate 共享的讲述记录 */
  turnsRef: MutableRefObject<TeachBackTurn[]>;
}

export interface UseTeachBackPanelResult {
  status: MicStatus;
  phase: TurnPhase;
  mood: StageMood;
  /** 最近若干帧的音量 0~1（波形） */
  levels: number[];
  /** 当前回合已识别的文字（定稿 + 尾巴） */
  liveText: string;
  /** 你讲过的每一段（会话内时间切片） */
  turns: TranscriptTurn[];
  /** 反馈流全部条目（含记下未揭示的；画面用 visibleFeedback 过滤） */
  feedback: FeedbackEntry[];
  /** 正在说的听众（回合里开口的那位） */
  activeJudge: TeachBackJudgeId | null;
  /** 此刻声音是谁的（按句：回合发言 / 复盘朗读都算）；出声关着 = null */
  speakingJudge: TeachBackJudgeId | null;
  /** 实时反馈开着、回合请求在飞、还没人开口 */
  requestInFlight: boolean;
  /** 开讲以来经过的毫秒（250ms 一跳） */
  elapsedMs: number;
  voiceEnabled: boolean;
  setVoiceEnabled: (enabled: boolean) => void;
  liveFeedback: boolean;
  setLiveFeedback: (enabled: boolean) => void;
  /** 用户手势里调：开麦（首次开讲或断开后重新开麦） */
  start: () => Promise<void>;
  /** 停麦（回到目标 / 卸载）：中止一切在飞的请求 */
  stop: () => void;
  /** 讲完了：把没提交的尾巴记进 turnsRef，停麦；记下的反馈开始按时间揭示 */
  finish: () => void;
  /** 新一场：清空本场记录（在 start 之前调） */
  reset: () => void;
  /** 打字讲一段（麦克风不可用时） */
  submitTyped: (text: string) => void;
  /** 你讲过的回合数 */
  turnCount: number;
  /** 用某位听众的声音读几句（复盘）；只看文字时不出声 */
  speakAs: (judgeId: TeachBackJudgeId | null, text: string) => void;
}

function readPref(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function writePref(key: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(key, enabled ? 'on' : 'off');
  } catch {
    /* 偏好写不进去不影响讲述 */
  }
}

let entrySeq = 0;

export function useTeachBackPanel({ targets, transcript, metadata, turnsRef }: UseTeachBackPanelInput): UseTeachBackPanelResult {
  const [status, setStatus] = useState<MicStatus>('idle');
  const [phase, setPhase] = useState<TurnPhase>('calibrating');
  const [levels, setLevels] = useState<number[]>([]);
  const [liveText, setLiveText] = useState('');
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [activeJudge, setActiveJudge] = useState<TeachBackJudgeId | null>(null);
  const [speakingJudge, setSpeakingJudge] = useState<TeachBackJudgeId | null>(null);
  const [requestInFlight, setRequestInFlight] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceEnabled, setVoiceEnabledState] = useState<boolean>(() => readPref(TEACH_BACK_VOICE_PREF_KEY));
  const [liveFeedback, setLiveFeedbackState] = useState<boolean>(() => readPref(TEACH_BACK_LIVE_FEEDBACK_PREF_KEY));
  const [finished, setFinished] = useState(false);

  const machineRef = useRef<TurnMachineState>(createTurnMachine());
  const levelsRef = useRef<number[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const asrRef = useRef<DashScopeASRClient | null>(null);
  const tickRef = useRef<number | null>(null);
  const liveRef = useRef(false);
  /** 实时反馈开着时在飞的那一个请求（新回合 / 插话会中止它） */
  const requestRef = useRef<AbortController | null>(null);
  /** 实时反馈关着时在飞的请求：互不中止，讲完了也让它们跑完（笔记要揭示） */
  const heldRequestsRef = useRef(new Set<AbortController>());
  /** turnIndex → turnsRef 里那条用户发言的位置（供迟到的定稿升级） */
  const turnPositionsRef = useRef(new Map<number, number>());
  const playerRef = useRef<TeachSpeechPlayer | null>(null);
  const splitterRef = useRef<SentenceSplitter | null>(null);
  const currentVoiceRef = useRef<TeachBackJudgeId | null>(null);
  /** 复盘朗读：一句话固定一位听众的声音（播放器是懒取的，取的时候 currentVoice 可能已经换人） */
  const voiceByTextRef = useRef(new Map<string, TeachBackJudgeId | null>());
  /** 播放器句序号 → 这句是谁说的（镜像 TeachSpeechPlayer 的 seq：只在出声开着、句子非空时 enqueue，两边才对得上） */
  const seqJudgeRef = useRef(new Map<number, TeachBackJudgeId | null>());
  const seqMirrorRef = useRef(0);
  const speakingRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;
  const liveFeedbackRef = useRef(liveFeedback);
  liveFeedbackRef.current = liveFeedback;
  /** 会话时钟起点（首次开麦；断开重连不重置） */
  const sessionStartRef = useRef<number | null>(null);
  /** 当前这一段是几时开口的（进入 speaking 那一刻） */
  const turnStartedAtRef = useRef<number | null>(null);
  /** 断开重连后回合号接着数 */
  const nextTurnIndexRef = useRef(0);

  // 请求上下文走 ref：回调保持稳定引用
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;

  const elapsedNow = useCallback(() => (sessionStartRef.current === null ? 0 : Date.now() - sessionStartRef.current), []);

  /* ── TTS 播放器：三位听众三种声音 ── */

  const dispatchRef = useRef<(event: TurnEvent) => void>(() => undefined);
  const closeJudgeRef = useRef<() => void>(() => undefined);

  const ensurePlayer = useCallback((): TeachSpeechPlayer => {
    playerRef.current ??= new TeachSpeechPlayer({
      fetchAudio: async (text) => {
        const judge = voiceByTextRef.current.has(text) ? voiceByTextRef.current.get(text) ?? null : currentVoiceRef.current;
        voiceByTextRef.current.delete(text);
        const spec = judge ? judgeSpecOf(judge) : null;
        try {
          const response = await fetch('/api/teach/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(spec ? { text, voice: spec.voice, instruct: spec.ttsInstruct } : { text }),
          });
          if (!response.ok) return null;
          return await response.blob();
        } catch {
          return null;
        }
      },
      onSentenceStart: (seq) => {
        setSpeakingJudge(seqJudgeRef.current.get(seq) ?? null);
        seqJudgeRef.current.delete(seq);
      },
      onSpeakingChange: (speaking) => {
        speakingRef.current = speaking;
        if (!speaking) {
          // 句间会有一瞬 false（下一句同步接上）；隔一拍再确认真的说完了
          window.setTimeout(() => {
            if (speakingRef.current) return;
            setSpeakingJudge(null);
            if (pendingCloseRef.current) {
              pendingCloseRef.current = false;
              closeJudgeRef.current();
            }
          }, 80);
        }
      },
    });
    playerRef.current.setMuted(!voiceEnabledRef.current);
    return playerRef.current;
  }, []);

  /** 出声：一句话 + 是谁说的（镜像播放器 seq，供 speakingJudge） */
  const enqueueVoiced = useCallback((judgeId: TeachBackJudgeId | null, sentence: string) => {
    const text = sentence.trim();
    if (!text || !voiceEnabledRef.current) return;
    const player = ensurePlayer();
    seqMirrorRef.current += 1;
    seqJudgeRef.current.set(seqMirrorRef.current, judgeId);
    player.enqueue(text);
  }, [ensurePlayer]);

  /* ── 状态同步 ── */

  const syncView = useCallback((state: TurnMachineState) => {
    setPhase(state.phase);
    setLiveText(pendingText(state));
  }, []);

  const patchEntry = useCallback((id: string, patch: Partial<FeedbackEntry> | ((entry: FeedbackEntry) => Partial<FeedbackEntry>)) => {
    setFeedback((current) => current.map((entry) => (
      entry.id === id ? { ...entry, ...(typeof patch === 'function' ? patch(entry) : patch) } : entry
    )));
  }, []);

  /* ── 听众回合（SSE） ── */

  const closeJudge = useCallback(() => {
    setActiveJudge(null);
    setRequestInFlight(false);
    dispatchRef.current({ type: 'judge-close', at: Date.now() });
  }, []);
  closeJudgeRef.current = closeJudge;

  const interruptJudge = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    pendingCloseRef.current = false;
    playerRef.current?.stopAll();
    splitterRef.current?.reset();
    seqJudgeRef.current.clear();
    setSpeakingJudge(null);
    setRequestInFlight(false);
    setActiveJudge(null);
    setFeedback((current) => current.map((entry) => (
      !entry.held && entry.state === 'streaming' ? { ...entry, state: 'interrupted' } : entry
    )));
  }, []);

  const runJudgeTurn = useCallback(async (segment: string, mode: 'turn' | 'check-in', turnIndex: number | null, held: boolean) => {
    const controller = new AbortController();
    if (held) {
      heldRequestsRef.current.add(controller);
    } else {
      requestRef.current?.abort();
      requestRef.current = controller;
      setRequestInFlight(true);
    }

    const history = turnsRef.current;
    const slimTranscript = transcriptRef.current.map((item) => ({
      text: item.text,
      startMs: item.startMs,
      endMs: item.endMs,
    }));
    let judgeId: TeachBackJudgeId | null = null;
    let entryId: string | null = null;
    let said = '';
    let settled = false;
    const settle = (close: boolean) => {
      if (settled) return;
      settled = true;
      heldRequestsRef.current.delete(controller);
      if (requestRef.current === controller) requestRef.current = null;
      if (held) return; // 记下的那条不占状态机（提交时已经 judge-close）
      if (close) closeJudgeRef.current();
      else setRequestInFlight(false);
    };
    /** 被插话打断：说了一半的话也记进本场记录（评估与复盘看得到），尾巴加省略号 */
    const recordPartial = () => {
      heldRequestsRef.current.delete(controller);
      const partial = said.trim();
      if (judgeId && partial.length >= 8) {
        turnsRef.current = [...turnsRef.current, { role: 'assistant', text: `${partial}…`, judgeId }];
      }
      if (entryId) patchEntry(entryId, { state: 'interrupted' });
    };

    try {
      const response = await fetch('/api/apps/teach-back/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targets: targetsRef.current,
          turns: history,
          segment,
          transcript: slimTranscript,
          metadata: metadataRef.current,
          mode,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        settle(true);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let carry = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) {
          recordPartial();
          return;
        }
        const chunk = decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const parsed = parseSseChunk(carry, done ? `${chunk}\n` : chunk);
        carry = parsed.carry;
        for (const event of parsed.events) {
          if (event.type === 'judge') {
            judgeId = event.judgeId;
            entrySeq += 1;
            entryId = `fb-${entrySeq}`;
            const entry: FeedbackEntry = {
              id: entryId,
              judgeId,
              turnIndex,
              at: elapsedNow(),
              text: '',
              state: 'streaming',
              held,
              revealed: false,
            };
            setFeedback((current) => [...current, entry]);
            if (!held) {
              currentVoiceRef.current = judgeId;
              splitterRef.current = new SentenceSplitter();
              setRequestInFlight(false);
              setActiveJudge(judgeId);
              dispatchRef.current({ type: 'judge-open', at: Date.now() });
            }
          } else if (event.type === 'delta' && judgeId && entryId) {
            said += event.text;
            const id = entryId;
            patchEntry(id, (entry) => ({ text: entry.text + event.text }));
            if (!held && voiceEnabledRef.current) {
              for (const sentence of splitterRef.current?.push(event.text) ?? []) enqueueVoiced(judgeId, sentence);
            }
          } else if (event.type === 'done' && judgeId && entryId) {
            const full = event.text || said;
            turnsRef.current = [...turnsRef.current, { role: 'assistant', text: full, judgeId }];
            patchEntry(entryId, { text: full, state: 'done' });
            if (!held && voiceEnabledRef.current) {
              const tail = splitterRef.current?.flush();
              if (tail) enqueueVoiced(judgeId, tail);
              const player = ensurePlayer();
              if (player.isActive && speakingRef.current) {
                pendingCloseRef.current = true; // 等声音说完再回到听讲
                settle(false);
                return;
              }
            }
            settle(true);
            return;
          } else if (event.type === 'silent' || event.type === 'error') {
            if (entryId) patchEntry(entryId, { state: 'done' });
            settle(true);
            return;
          }
        }
        if (done) break;
      }
      // 流结束但没有 done：有开口就记下说过的话
      if (judgeId && entryId && said.trim()) {
        turnsRef.current = [...turnsRef.current, { role: 'assistant', text: said.trim(), judgeId }];
        patchEntry(entryId, { state: 'done' });
      }
      settle(true);
    } catch {
      if (controller.signal.aborted) {
        // 被插话打断：状态机已经转到"你在讲"
        recordPartial();
        return;
      }
      if (entryId) patchEntry(entryId, { state: 'done' });
      settle(true);
    }
  }, [elapsedNow, enqueueVoiced, ensurePlayer, patchEntry, turnsRef]);

  /* ── effects 执行 ── */

  const pushTurn = useCallback((turnIndex: number, text: string) => {
    const endedAt = elapsedNow();
    const startedAt = turnStartedAtRef.current === null
      ? endedAt
      : Math.max(0, Math.min(endedAt, turnStartedAtRef.current - (sessionStartRef.current ?? 0)));
    turnStartedAtRef.current = null;
    setTurns((current) => [...current, { turnIndex, text, startedAt, endedAt }]);
    nextTurnIndexRef.current = turnIndex + 1;
  }, [elapsedNow]);

  const applyEffects = useCallback((effects: TurnEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'turn-commit': {
          turnPositionsRef.current.set(effect.turnIndex, turnsRef.current.length);
          turnsRef.current = [...turnsRef.current, { role: 'user', text: effect.text }];
          pushTurn(effect.turnIndex, effect.text);
          const held = !liveFeedbackRef.current;
          void runJudgeTurn(effect.text, 'turn', effect.turnIndex, held);
          // 实时反馈关着：听众只记不说，状态机不用等谁开口——下一拍就回到听讲
          if (held) window.setTimeout(() => dispatchRef.current({ type: 'judge-close', at: Date.now() }), 0);
          break;
        }
        case 'turn-upgrade': {
          const position = turnPositionsRef.current.get(effect.turnIndex);
          if (position !== undefined && turnsRef.current[position]?.role === 'user') {
            const next = [...turnsRef.current];
            next[position] = { role: 'user', text: effect.text };
            turnsRef.current = next;
            setTurns((current) => current.map((turn) => (turn.turnIndex === effect.turnIndex ? { ...turn, text: effect.text } : turn)));
          }
          break;
        }
        case 'interrupt':
          interruptJudge();
          break;
        case 'idle-nudge':
          if (liveFeedbackRef.current) {
            void runJudgeTurn('', 'check-in', null, false);
          } else {
            window.setTimeout(() => dispatchRef.current({ type: 'judge-close', at: Date.now() }), 0);
          }
          break;
        case 'finish':
          if (effect.text) {
            turnsRef.current = [...turnsRef.current, { role: 'user', text: effect.text }];
            pushTurn(nextTurnIndexRef.current, effect.text);
          }
          break;
        default:
          break;
      }
    }
  }, [interruptJudge, pushTurn, runJudgeTurn, turnsRef]);

  const dispatch = useCallback((event: TurnEvent) => {
    const before = machineRef.current;
    const step = reduceTurn(before, event);
    machineRef.current = step.state;
    if (step.state.phase !== before.phase) {
      syncView(step.state);
      // 从听讲 / 听众发言进入"你在讲"= 新一段开口的时刻（pausing / settling 回到 speaking 还是同一段）
      if (step.state.phase === 'speaking' && before.phase !== 'pausing' && before.phase !== 'settling') {
        turnStartedAtRef.current = event.at;
      }
    } else if (event.type === 'asr-interim' || event.type === 'asr-final' || event.type === 'typed') {
      setLiveText(pendingText(step.state));
    }
    if (event.type === 'frame') {
      const history = levelsRef.current;
      history.push(step.state.level);
      if (history.length > LEVEL_HISTORY) history.splice(0, history.length - LEVEL_HISTORY);
      setLevels([...history]);
    }
    if (event.type === 'tick') setElapsedMs(elapsedNow());
    if (step.effects.length > 0) applyEffects(step.effects);
  }, [applyEffects, elapsedNow, syncView]);
  dispatchRef.current = dispatch;

  /* ── 麦克风 + ASR 生命周期 ── */

  const teardown = useCallback((nextStatus: MicStatus, abortHeld: boolean) => {
    liveRef.current = false;
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    requestRef.current?.abort();
    requestRef.current = null;
    if (abortHeld) {
      heldRequestsRef.current.forEach((controller) => controller.abort());
      heldRequestsRef.current.clear();
    }
    pendingCloseRef.current = false;
    playerRef.current?.stopAll();
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null;
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const asr = asrRef.current;
    asrRef.current = null;
    if (asr) void asr.stop().catch(() => undefined);
    setStatus(nextStatus);
    setRequestInFlight(false);
    setActiveJudge(null);
    setSpeakingJudge(null);
    seqJudgeRef.current.clear();
    setElapsedMs(elapsedNow());
    levelsRef.current = [];
    setLevels([]);
  }, [elapsedNow]);

  const start = useCallback(async () => {
    if (liveRef.current || status === 'connecting') return;
    if (useSessionStore.getState().isRecording) {
      setStatus('mic-busy');
      return;
    }
    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      setStatus('mic-denied');
      return;
    }
    setStatus('connecting');
    setFinished(false);
    ensurePlayer().unlock();
    sessionStartRef.current ??= Date.now();
    // 重新开麦：新状态机，回合号接着上一段数
    machineRef.current = { ...createTurnMachine(), turnIndex: nextTurnIndexRef.current };
    syncView(machineRef.current);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(buildAudioConstraints());
    } catch {
      setStatus('mic-denied');
      return;
    }
    streamRef.current = stream;

    // 先把采集链挂起来再连 ASR：连接期间的帧由 DashScopeASRClient 排队、ready 后按序补送，
    // 一个字不丢；VAD 也趁这一秒做校准（否则连接慢时用户已在开讲，校准窗口里全是说话声）
    const { DashScopeASRClient } = await import('@/lib/services/dashscope-asr-service');
    if (streamRef.current !== stream) return; // 等 import 期间已经停麦
    const asr = new DashScopeASRClient('', {
      onSentence: (sentence) => {
        if (asrRef.current !== asr || !sentence.isFinal || !sentence.text) return;
        dispatchRef.current({ type: 'asr-final', text: sentence.text, at: Date.now() });
      },
      onInterim: (interim) => {
        if (asrRef.current !== asr) return;
        dispatchRef.current({ type: 'asr-interim', text: (interim?.text || '').trim(), at: Date.now() });
      },
      onError: () => {
        if (asrRef.current !== asr) return;
        teardown('asr-down', false);
      },
    });
    asrRef.current = asr;

    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext();
    } catch {
      teardown('mic-denied', false);
      return;
    }
    audioContextRef.current = audioContext;
    const source = audioContext.createMediaStreamSource(stream);
    sourceRef.current = source;
    const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    processorRef.current = processor;
    const sampleRate = audioContext.sampleRate;
    processor.onaudioprocess = (event) => {
      if (asrRef.current !== asr) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = floatToPcm16(input, sampleRate);
      asr.sendAudio(pcm.buffer as ArrayBuffer);
      dispatchRef.current({
        type: 'frame',
        rms: computeRms(input),
        at: Date.now(),
        durationMs: frameDurationMs(input.length, sampleRate),
      });
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    // 手机切页面：轨道被系统收走 → 提示一键重新开麦
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (streamRef.current === stream) teardown('mic-lost', false);
      };
    });

    const connected = await asr.start().catch(() => false);
    if (asrRef.current !== asr) return; // 连接期间已停麦
    if (!connected) {
      teardown('asr-down', false);
      return;
    }
    liveRef.current = true;
    tickRef.current = window.setInterval(() => dispatchRef.current({ type: 'tick', at: Date.now() }), TICK_MS);
    setStatus('live');
  }, [ensurePlayer, status, syncView, teardown]);

  const stop = useCallback(() => {
    teardown('stopped', true);
  }, [teardown]);

  const finish = useCallback(() => {
    dispatchRef.current({ type: 'finish', at: Date.now() });
    teardown('stopped', false);
    setFinished(true);
  }, [teardown]);

  const reset = useCallback(() => {
    teardown('idle', true);
    machineRef.current = createTurnMachine();
    turnPositionsRef.current.clear();
    sessionStartRef.current = null;
    turnStartedAtRef.current = null;
    nextTurnIndexRef.current = 0;
    setTurns([]);
    setFeedback([]);
    setLiveText('');
    setElapsedMs(0);
    setFinished(false);
    setPhase('calibrating');
  }, [teardown]);

  const submitTyped = useCallback((text: string) => {
    dispatchRef.current({ type: 'typed', text, at: Date.now() });
  }, []);

  const speakAs = useCallback((judgeId: TeachBackJudgeId | null, text: string) => {
    if (!voiceEnabledRef.current) return;
    const line = text.trim();
    if (!line) return;
    const splitter = new SentenceSplitter();
    const sentences = [...splitter.push(line)];
    const tail = splitter.flush();
    if (tail) sentences.push(tail);
    for (const sentence of sentences) {
      voiceByTextRef.current.set(sentence.trim(), judgeId);
      enqueueVoiced(judgeId, sentence);
    }
  }, [enqueueVoiced]);

  const setVoiceEnabled = useCallback((enabled: boolean) => {
    setVoiceEnabledState(enabled);
    writePref(TEACH_BACK_VOICE_PREF_KEY, enabled);
    ensurePlayer().setMuted(!enabled);
    if (!enabled && pendingCloseRef.current) {
      pendingCloseRef.current = false;
      closeJudgeRef.current();
    }
  }, [ensurePlayer]);

  const setLiveFeedback = useCallback((enabled: boolean) => {
    setLiveFeedbackState(enabled);
    writePref(TEACH_BACK_LIVE_FEEDBACK_PREF_KEY, enabled);
  }, []);

  /* ── 讲完了：记下的反馈按时间一条条揭示 ── */

  useEffect(() => {
    if (!finished) return undefined;
    const next = nextHeldToReveal(feedback);
    if (!next) return undefined;
    const timer = window.setTimeout(() => patchEntry(next.id, { revealed: true }), HELD_REVEAL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [feedback, finished, patchEntry]);

  /* ── 与录课互斥 / 页面切换 / 卸载 ── */

  useEffect(() => {
    const unsubscribe = useSessionStore.subscribe((state, previous) => {
      if (state.isRecording && !previous.isRecording && liveRef.current) teardown('mic-busy', false);
    });
    return unsubscribe;
  }, [teardown]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const context = audioContextRef.current;
      if (context && context.state === 'suspended' && liveRef.current) void context.resume().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const teardownRef = useRef(teardown);
  teardownRef.current = teardown;
  useEffect(() => () => teardownRef.current('stopped', true), []);

  const mood = useMemo(() => stageMoodOf(phase), [phase]);

  return {
    status,
    phase,
    mood,
    levels,
    liveText,
    turns,
    feedback,
    activeJudge,
    speakingJudge,
    requestInFlight,
    elapsedMs,
    voiceEnabled,
    setVoiceEnabled,
    liveFeedback,
    setLiveFeedback,
    start,
    stop,
    finish,
    reset,
    submitTyped,
    turnCount: turns.length,
    speakAs,
  };
}
