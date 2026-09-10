'use client';

/**
 * useTeachBackPanel — 「讲给同桌听」连续讲述版的编排 hook（2026-09-10）。
 *
 * 像语音通话：走上讲台后麦克风常开 → 实时 ASR（课堂录音同一条 /api/asr-stream 通道）出转写 →
 * 能量 VAD + 句末事件判"这一段讲完了"（teach-back-turn-machine，纯逻辑）→ 评委席一位开口
 * （POST /api/apps/teach-back/turn，SSE 流式）→ 气泡边说边长、按句送 TTS（三位评委三种声音）→
 * 你一开口评委就停（中止请求 + 停播 + 气泡收成一行）。
 *
 * 这里只做三件事：把麦克风帧 / ASR 事件 / SSE 事件喂进状态机；执行状态机吐出的 effects；
 * 把画面需要的状态暴露出去。判断都在状态机与模型里，这里不写业务规则。
 *
 * 边界：
 * - 与正在录课的 Recorder 互斥（同一时刻只有一路麦克风）：session-store.isRecording 为真不上台，
 *   上台后录课开始则自动下台。
 * - TTS 失败只静默回退到文字（TeachSpeechPlayer 跳过该句）；评委请求失败 = 沉默。
 * - 手机切后台：AudioContext 被挂起时回前台 resume；麦克风轨道 ended → 'mic-lost'，一键重新上台。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { TeachBackJudgeId, TeachBackTarget, TeachBackTurn } from '@/lib/ai-native/types';
import type { TranscriptSegment } from '@/types';
import type { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';
import { buildAudioConstraints, computeRms } from '@/lib/services/asr/audio-constraints';
import { floatToPcm16, frameDurationMs } from '@/lib/services/asr/pcm';
import { judgeSpecOf, parseSseChunk, TEACH_BACK_JUDGE_IDS } from '@/lib/ai-native/teach-back-panel';
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

/** 出声 / 只看文字 的偏好 key（localStorage） */
export const TEACH_BACK_VOICE_PREF_KEY = 'meetmind:teach-back:voice';

/** 采集帧大小：@16k 128ms、@48k 43ms——VAD 分辨率与 WS 消息频率的折中 */
const PROCESSOR_BUFFER = 2048;
const TICK_MS = 250;
/** 波形保留的最近帧数 */
const LEVEL_HISTORY = 28;

export type PodiumStatus =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'mic-denied'
  | 'mic-lost'
  | 'mic-busy'
  | 'asr-down'
  | 'stopped';

export interface TeachBackJudgeView {
  id: TeachBackJudgeId;
  /** 正在说（气泡展开、抬头） */
  speaking: boolean;
  /** 气泡里的文字（流式增长） */
  bubble: string;
  /** 被打断：气泡收成一行 */
  collapsed: boolean;
}

export interface UseTeachBackPanelInput {
  targets: TeachBackTarget[];
  transcript: TranscriptSegment[];
  metadata?: { title?: string };
  /** 与 /api/apps/teach-back/evaluate 共享的讲述记录 */
  turnsRef: MutableRefObject<TeachBackTurn[]>;
}

export interface UseTeachBackPanelResult {
  status: PodiumStatus;
  phase: TurnPhase;
  mood: StageMood;
  /** 最近若干帧的音量 0~1（波形） */
  levels: number[];
  /** 当前回合已识别的文字（定稿 + 尾巴） */
  liveText: string;
  /** 上一个已提交回合的文字（淡出显示） */
  lastCommitted: string;
  judges: TeachBackJudgeView[];
  activeJudge: TeachBackJudgeId | null;
  /** 评委席在想（请求在飞、还没人开口） */
  judgeThinking: boolean;
  voiceEnabled: boolean;
  setVoiceEnabled: (enabled: boolean) => void;
  /** 用户手势里调：走上讲台 */
  start: () => Promise<void>;
  /** 下台（回到目标 / 卸载） */
  stop: () => void;
  /** 讲完了：把没提交的尾巴记进 turnsRef，停掉一切 */
  finish: () => void;
  /** 打字讲一段（麦克风不可用时） */
  submitTyped: (text: string) => void;
  /** 记录用户开讲以来经过的回合数 */
  turnCount: number;
  /** 用默认声音读一句（结果页 headline）；只看文字时不出声 */
  speakLine: (text: string) => void;
}

function readVoicePref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(TEACH_BACK_VOICE_PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeVoicePref(enabled: boolean): void {
  try {
    window.localStorage.setItem(TEACH_BACK_VOICE_PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    /* 偏好写不进去不影响讲述 */
  }
}

function emptyJudges(): TeachBackJudgeView[] {
  return TEACH_BACK_JUDGE_IDS.map((id) => ({ id, speaking: false, bubble: '', collapsed: false }));
}

export function useTeachBackPanel({ targets, transcript, metadata, turnsRef }: UseTeachBackPanelInput): UseTeachBackPanelResult {
  const [status, setStatus] = useState<PodiumStatus>('idle');
  const [phase, setPhase] = useState<TurnPhase>('calibrating');
  const [levels, setLevels] = useState<number[]>([]);
  const [liveText, setLiveText] = useState('');
  const [lastCommitted, setLastCommitted] = useState('');
  const [judges, setJudges] = useState<TeachBackJudgeView[]>(emptyJudges);
  const [activeJudge, setActiveJudge] = useState<TeachBackJudgeId | null>(null);
  const [judgeThinking, setJudgeThinking] = useState(false);
  const [voiceEnabled, setVoiceEnabledState] = useState<boolean>(readVoicePref);
  const [turnCount, setTurnCount] = useState(0);

  const machineRef = useRef<TurnMachineState>(createTurnMachine());
  const levelsRef = useRef<number[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const asrRef = useRef<DashScopeASRClient | null>(null);
  const tickRef = useRef<number | null>(null);
  const liveRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  /** turnIndex → turnsRef 里那条用户发言的位置（供迟到的定稿升级） */
  const turnPositionsRef = useRef(new Map<number, number>());
  const playerRef = useRef<TeachSpeechPlayer | null>(null);
  const splitterRef = useRef<SentenceSplitter | null>(null);
  const currentVoiceRef = useRef<TeachBackJudgeId | null>(null);
  const speakingRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  voiceEnabledRef.current = voiceEnabled;

  // 请求上下文走 ref：回调保持稳定引用
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;

  /* ── TTS 播放器：三位评委三种声音，voice 随 currentVoiceRef ── */

  const dispatchRef = useRef<(event: TurnEvent) => void>(() => undefined);
  const closeJudgeRef = useRef<() => void>(() => undefined);

  const ensurePlayer = useCallback((): TeachSpeechPlayer => {
    playerRef.current ??= new TeachSpeechPlayer({
      fetchAudio: async (text) => {
        const judge = currentVoiceRef.current;
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
      onSpeakingChange: (speaking) => {
        speakingRef.current = speaking;
        if (!speaking && pendingCloseRef.current) {
          // 句间会有一瞬 false（下一句同步接上）；隔一拍再确认真的说完了
          window.setTimeout(() => {
            if (!speakingRef.current && pendingCloseRef.current) {
              pendingCloseRef.current = false;
              closeJudgeRef.current();
            }
          }, 80);
        }
      },
    });
    return playerRef.current;
  }, []);

  /* ── 状态同步 ── */

  const syncView = useCallback((state: TurnMachineState) => {
    setPhase(state.phase);
    setLiveText(pendingText(state));
  }, []);

  /* ── 评委回合（SSE） ── */

  const closeJudge = useCallback(() => {
    setJudges((current) => current.map((judge) => (judge.speaking ? { ...judge, speaking: false } : judge)));
    setActiveJudge(null);
    setJudgeThinking(false);
    dispatchRef.current({ type: 'judge-close', at: Date.now() });
  }, []);
  closeJudgeRef.current = closeJudge;

  const interruptJudge = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    pendingCloseRef.current = false;
    playerRef.current?.stopAll();
    splitterRef.current?.reset();
    setJudgeThinking(false);
    setActiveJudge(null);
    setJudges((current) => current.map((judge) => (
      judge.speaking ? { ...judge, speaking: false, collapsed: Boolean(judge.bubble) } : judge
    )));
  }, []);

  const runJudgeTurn = useCallback(async (segment: string, mode: 'turn' | 'check-in') => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setJudgeThinking(true);
    // 新回合开始：上一位评委的气泡收起
    setJudges((current) => current.map((judge) => (judge.bubble ? { ...judge, collapsed: true, speaking: false } : judge)));

    const history = turnsRef.current;
    const slimTranscript = transcriptRef.current.map((item) => ({
      text: item.text,
      startMs: item.startMs,
      endMs: item.endMs,
    }));
    let judgeId: TeachBackJudgeId | null = null;
    let said = '';
    let settled = false;
    const settle = (close: boolean) => {
      if (settled) return;
      settled = true;
      if (requestRef.current === controller) requestRef.current = null;
      if (close) closeJudgeRef.current();
    };
    /** 被插话打断：评委说了一半的话也记进本场回合（结果页回看得到），尾巴加省略号 */
    const recordPartial = () => {
      const partial = said.trim();
      if (judgeId && partial.length >= 8) {
        turnsRef.current = [...turnsRef.current, { role: 'assistant', text: `${partial}…`, judgeId }];
      }
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
            currentVoiceRef.current = judgeId;
            splitterRef.current = new SentenceSplitter();
            setJudgeThinking(false);
            setActiveJudge(judgeId);
            setJudges((current) => current.map((judge) => (
              judge.id === judgeId ? { ...judge, speaking: true, bubble: '', collapsed: false } : { ...judge, speaking: false }
            )));
            dispatchRef.current({ type: 'judge-open', at: Date.now() });
          } else if (event.type === 'delta' && judgeId) {
            said += event.text;
            const speaker = judgeId;
            setJudges((current) => current.map((judge) => (judge.id === speaker ? { ...judge, bubble: judge.bubble + event.text } : judge)));
            if (voiceEnabledRef.current) {
              for (const sentence of splitterRef.current?.push(event.text) ?? []) ensurePlayer().enqueue(sentence);
            }
          } else if (event.type === 'done' && judgeId) {
            turnsRef.current = [...turnsRef.current, { role: 'assistant', text: event.text || said, judgeId }];
            if (voiceEnabledRef.current) {
              const tail = splitterRef.current?.flush();
              if (tail) ensurePlayer().enqueue(tail);
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
            settle(true);
            return;
          }
        }
        if (done) break;
      }
      // 流结束但没有 done：有开口就记下说过的话
      if (judgeId && said.trim()) {
        turnsRef.current = [...turnsRef.current, { role: 'assistant', text: said.trim(), judgeId }];
      }
      settle(true);
    } catch {
      if (controller.signal.aborted) {
        // 被插话打断：状态机已经转到"你在讲"
        recordPartial();
        return;
      }
      settle(true);
    }
  }, [ensurePlayer, turnsRef]);

  /* ── effects 执行 ── */

  const applyEffects = useCallback((effects: TurnEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case 'turn-commit': {
          turnPositionsRef.current.set(effect.turnIndex, turnsRef.current.length);
          turnsRef.current = [...turnsRef.current, { role: 'user', text: effect.text }];
          setLastCommitted(effect.text);
          setTurnCount((count) => count + 1);
          void runJudgeTurn(effect.text, 'turn');
          break;
        }
        case 'turn-upgrade': {
          const position = turnPositionsRef.current.get(effect.turnIndex);
          if (position !== undefined && turnsRef.current[position]?.role === 'user') {
            const next = [...turnsRef.current];
            next[position] = { role: 'user', text: effect.text };
            turnsRef.current = next;
            setLastCommitted(effect.text);
          }
          break;
        }
        case 'interrupt':
          interruptJudge();
          break;
        case 'idle-nudge':
          void runJudgeTurn('', 'check-in');
          break;
        case 'finish':
          if (effect.text) {
            turnsRef.current = [...turnsRef.current, { role: 'user', text: effect.text }];
          }
          break;
        default:
          break;
      }
    }
  }, [interruptJudge, runJudgeTurn, turnsRef]);

  const dispatch = useCallback((event: TurnEvent) => {
    const before = machineRef.current;
    const step = reduceTurn(before, event);
    machineRef.current = step.state;
    if (step.state.phase !== before.phase) {
      syncView(step.state);
      // 你一开口：所有评委的气泡收成一行（无论刚才是谁在说）
      if (step.state.phase === 'speaking') {
        setJudges((current) => current.map((judge) => (judge.bubble ? { ...judge, collapsed: true } : judge)));
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
    if (step.effects.length > 0) applyEffects(step.effects);
  }, [applyEffects, syncView]);
  dispatchRef.current = dispatch;

  /* ── 麦克风 + ASR 生命周期 ── */

  const teardown = useCallback((nextStatus: PodiumStatus) => {
    liveRef.current = false;
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
    requestRef.current?.abort();
    requestRef.current = null;
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
    setJudgeThinking(false);
    setActiveJudge(null);
    setJudges((current) => current.map((judge) => ({ ...judge, speaking: false })));
    levelsRef.current = [];
    setLevels([]);
  }, []);

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
    ensurePlayer().unlock();
    machineRef.current = createTurnMachine();
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
    if (streamRef.current !== stream) return; // 等 import 期间已经下台
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
        teardown('asr-down');
      },
    });
    asrRef.current = asr;

    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext();
    } catch {
      teardown('mic-denied');
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

    // 手机切页面：轨道被系统收走 → 提示一键重新上台
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (streamRef.current === stream) teardown('mic-lost');
      };
    });

    const connected = await asr.start().catch(() => false);
    if (asrRef.current !== asr) return; // 连接期间已下台
    if (!connected) {
      teardown('asr-down');
      return;
    }
    liveRef.current = true;
    tickRef.current = window.setInterval(() => dispatchRef.current({ type: 'tick', at: Date.now() }), TICK_MS);
    setStatus('live');
  }, [ensurePlayer, status, syncView, teardown]);

  const stop = useCallback(() => {
    teardown('stopped');
  }, [teardown]);

  const finish = useCallback(() => {
    dispatchRef.current({ type: 'finish', at: Date.now() });
    teardown('stopped');
  }, [teardown]);

  const submitTyped = useCallback((text: string) => {
    dispatchRef.current({ type: 'typed', text, at: Date.now() });
  }, []);

  const speakLine = useCallback((text: string) => {
    if (!voiceEnabledRef.current) return;
    const line = text.trim();
    if (!line) return;
    currentVoiceRef.current = null;
    const splitter = new SentenceSplitter();
    const player = ensurePlayer();
    for (const sentence of splitter.push(line)) player.enqueue(sentence);
    const tail = splitter.flush();
    if (tail) player.enqueue(tail);
  }, [ensurePlayer]);

  const setVoiceEnabled = useCallback((enabled: boolean) => {
    setVoiceEnabledState(enabled);
    writeVoicePref(enabled);
    ensurePlayer().setMuted(!enabled);
    if (!enabled && pendingCloseRef.current) {
      pendingCloseRef.current = false;
      closeJudgeRef.current();
    }
  }, [ensurePlayer]);

  /* ── 与录课互斥 / 页面切换 / 卸载 ── */

  useEffect(() => {
    const unsubscribe = useSessionStore.subscribe((state, previous) => {
      if (state.isRecording && !previous.isRecording && liveRef.current) teardown('mic-busy');
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
  useEffect(() => () => teardownRef.current('stopped'), []);

  const mood = useMemo(() => stageMoodOf(phase), [phase]);

  return {
    status,
    phase,
    mood,
    levels,
    liveText,
    lastCommitted,
    judges,
    activeJudge,
    judgeThinking,
    voiceEnabled,
    setVoiceEnabled,
    start,
    stop,
    finish,
    submitTyped,
    turnCount,
    speakLine,
  };
}
