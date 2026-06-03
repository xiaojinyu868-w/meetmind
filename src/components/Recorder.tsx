'use client';

import { forwardRef, useState, useRef, useCallback, useEffect, useImperativeHandle } from 'react';
import { Mic } from 'lucide-react';
import type { TranscriptSegment } from '@/types';
import { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';
import { useCaptureEditorStore } from '@/stores/capture-editor-store';
import { TranscriptFlowView } from './TranscriptFlowView';
import { TranscriptEnhanceManager, type EnhancedTranscriptSegment } from '@/lib/services/transcript-enhancer';
import { recordTranscriptEditDiff } from '@/lib/db/lexicon';

// --- 拆分子模块 ---
import type { RecorderProps, RecorderHandle, RecorderCallbackMeta, RecorderStatus, ServiceStatus, TranscribeMode } from './recorder/recorder-types';
export type { RecorderCallbackMeta, RecorderHandle } from './recorder/recorder-types';
import {
  CORRECTION_MODEL,
  CORRECTION_FALLBACK_MODEL,
} from './recorder/recorder-types';
import {
  chooseBatchTranscribeEndpoints,
  mergeRealtimeTranscriptSegment,
  normalizeCompareText,
  normalizeRecorderErrorMessage,
  normalizeRecorderErrorDetail,
  formatRecorderTime,
  resamplePcm,
  float32ToInt16,
} from './recorder/recorder-utils';
import { acquireAudioStream } from './recorder/recorder-audio-source';
import { buildAudioConstraints } from '@/lib/services/asr/audio-constraints';

export const Recorder = forwardRef<RecorderHandle, RecorderProps>(function Recorder({
  onRecordingStart,
  onRecordingStop,
  onTranscriptionError,
  onTranscriptUpdate,
  onTranscriptTextUpdate,
  onTranscriptEnhanced,
  onAnchorMark,
  onTranscribing,
  disabled = false,
  activeSessionId,
  continueCurrentSession = false,
  autoStartSignal = 0,
  compactMode = false,
  contextHint = '',
  languageMode = 'auto',
  audioSource = 'mic',
}: RecorderProps, ref) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [transcribeProgress, setTranscribeProgress] = useState<string>('');
  const [transcribeStartedAt, setTranscribeStartedAt] = useState<number | null>(null);
  const [transcribeElapsedMs, setTranscribeElapsedMs] = useState(0);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);

  // M7-fix3: 转写期间显示 elapsed，让用户知道进程没死
  useEffect(() => {
    if (transcribeStartedAt === null) {
      setTranscribeElapsedMs(0);
      return;
    }
    const tick = () => setTranscribeElapsedMs(Date.now() - transcribeStartedAt);
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [transcribeStartedAt]);

  // 把 interim 实时同步到全局 store，供课堂录课视图订阅「正在跟读」那一行。
  // 组件卸载或录音停止时，interimText 会被清空，这里跟着清。
  useEffect(() => {
    useCaptureEditorStore.getState().actions.setLiveInterimText(interimText);
    return () => {
      // 这个 effect 每次 interimText 变都 cleanup，不做清空；只在最外层组件卸载时清
    };
  }, [interimText]);

  useEffect(() => {
    return () => {
      // 组件卸载时清空，避免残留
      useCaptureEditorStore.getState().actions.setLiveInterimText('');
    };
  }, []);
  const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>('streaming');
  const [streamingAvailable, setStreamingAvailable] = useState(true);
  const [apiKey, setApiKey] = useState<string>('');
  const [wsModel, setWsModel] = useState<string>('qwen3-asr-flash-realtime');
  const [wsSampleRate, setWsSampleRate] = useState<number>(16000);
  const [anchorCount, setAnchorCount] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  /**
   * 录音源采集的 cleanup 回调（由 acquireAudioStream 返回）。
   * 负责释放底层的麦克风 track / 系统音频 track / mixed 模式的 AudioContext。
   * 每次 startRecording 成功后写入；stopRecording / restartRecording / 异常路径必须调用。
   */
  const audioCleanupRef = useRef<(() => void) | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string>('');
  const recordingIdRef = useRef<string>('');
  const lastAnchorTimeRef = useRef<number>(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const asrClientRef = useRef<DashScopeASRClient | null>(null);
  const transcriptRef = useRef<TranscriptSegment[]>([]);
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const isStartingRecordingRef = useRef(false);
  const lastAutoStartSignalRef = useRef(0);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const manuallyEditedSegmentIdsRef = useRef<Set<string>>(new Set());
  const interimItemIdRef = useRef<string | null>(null);
  const noiseFloorRef = useRef(0.02);
  const contextUpdateCountRef = useRef(0);
  const CONTEXT_UPDATE_EVERY_N_SEGMENTS = 8;
  const [asrReconnecting, setAsrReconnecting] = useState(false);
  const pauseTimestampRef = useRef<number>(0);
  
  const enhanceManagerRef = useRef<TranscriptEnhanceManager | null>(null);
  const [enhancedSegments, setEnhancedSegments] = useState<Map<string, EnhancedTranscriptSegment>>(new Map());
  const [enhanceStats, setEnhanceStats] = useState({ enhanced: 0, total: 0, isEnhancing: false });
  // PRD v1.1 / 手机端 P0：解耦 compactMode（UI 紧凑布局）和 transcribeMode（转写模式）。
  // 旧实现 `compactMode ? 'batch' : transcribeMode` 错误地把 UI 紧凑度耦合到转写模式，
  // 导致手机端 compactMode={true} 强制 batch、无流式 ASR、用户看不到任何反馈。
  // compactMode 现在只影响布局尺寸；转写模式由 transcribeMode 状态决定，默认 'streaming'。
  const effectiveTranscribeMode: TranscribeMode = transcribeMode;

  const vadStateRef = useRef({
    isSpeaking: false,
    speechStartMs: 0,
    silenceStartMs: 0,
  });

  const VAD_CONFIG = {
    baseEnergyThreshold: 0.05,
    noiseMargin: 0.035,
    speakingNoiseMargin: 0.02,
    silenceDuration: 1200,
    minSpeechDuration: 300,
  };

  const getCallbackMeta = useCallback((): RecorderCallbackMeta => ({
    recordingId: recordingIdRef.current,
    sessionId: sessionIdRef.current,
    isContinuation: Boolean(continueCurrentSession && activeSessionId),
    durationMs: elapsedMs,
  }), [activeSessionId, continueCurrentSession, elapsedMs]);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/asr-config');
        if (response.ok) {
          const config = await response.json();
          setApiKey(config.apiKey);
          if (config.model) setWsModel(config.model);
          if (config.sampleRate) setWsSampleRate(config.sampleRate);
          setStreamingAvailable(true);
          setServiceStatus('available');
        } else {
          setStreamingAvailable(false);
          setServiceStatus('unavailable');
        }
      } catch {
        setStreamingAvailable(false);
        setServiceStatus('unavailable');
      }
    };
    fetchConfig();
  }, []);

  const formatTime = formatRecorderTime;

  const stopMediaRecorderSafely = useCallback(async (): Promise<Blob | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return null;

    const mimeType = recorder.mimeType || 'audio/webm';

    try {
      if (recorder.state !== 'inactive') {
        const stopped = new Promise<void>((resolve) => {
          recorder.addEventListener('stop', () => resolve(), { once: true });
        });

        try {
          recorder.requestData();
        } catch {
          // requestData may throw during edge states; stop() still flushes the final chunk.
        }

        recorder.stop();
        await stopped;
      }

      return new Blob(audioChunksRef.current, { type: mimeType });
    } finally {
      recorder.stream.getTracks().forEach((track) => track.stop());
      if (mediaRecorderRef.current === recorder) {
        mediaRecorderRef.current = null;
      }
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (isStartingRecordingRef.current || status !== 'idle') return;

    isStartingRecordingRef.current = true;
    setIsStartingRecording(true);
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;

    try {
      setError(null);
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (pcmProcessorRef.current) {
        pcmProcessorRef.current.disconnect();
        pcmProcessorRef.current.onaudioprocess = null;
        pcmProcessorRef.current = null;
      }
      if (mediaRecorderRef.current) {
        await stopMediaRecorderSafely();
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }

      audioChunksRef.current = [];
      setTranscript([]);
      transcriptRef.current = [];
      manuallyEditedSegmentIdsRef.current.clear();
      setInterimText('');
      interimItemIdRef.current = null;
      setAnchorCount(0);

      setEnhancedSegments(new Map());
      setEnhanceStats({ enhanced: 0, total: 0, isEnhancing: false });
      enhanceManagerRef.current = new TranscriptEnhanceManager({
        minBatchSize: 1,
        silenceThreshold: 3000,
        model: CORRECTION_MODEL,
        fallbackModel: CORRECTION_FALLBACK_MODEL,
        strategy: 'layered',
        lexiconScope: 'classroom',
        contextHint: contextHint || '',
        onTermsDiscovered: (termsHint) => {
          // When auto-discovered terms become available, also push them to ASR
          if (asrClientRef.current?.isConnected() && termsHint.trim()) {
            asrClientRef.current.sendContextHint(termsHint.trim(), languageMode);
          }
        },
        onEnhanced: (segments) => {

          setEnhancedSegments(prev => {
            const newMap = new Map(prev);
            for (const seg of segments) {
              if (manuallyEditedSegmentIdsRef.current.has(seg.id)) continue;
              newMap.set(seg.id, seg);
            }

            const currentTranscript = transcriptRef.current;
            const enhancedTranscript = currentTranscript.map(seg => {
              if (manuallyEditedSegmentIdsRef.current.has(seg.id)) return seg;
              const enhanced = newMap.get(seg.id);
              if (enhanced && enhanced.enhanceStatus === 'enhanced' && enhanced.text !== seg.text) {
                // M8-A2: silent correction — 把原文塞进 originalText 让 UI
                // 悬停 600ms 后能展示"机器修过：XXX"。
                // 后端 enhance 可能已经自己填了 originalText（更权威的 raw ASR），
                // 优先用后端的；兜底用当前 seg.text 作为原文。
                return {
                  ...seg,
                  text: enhanced.text,
                  originalText: enhanced.originalText || seg.originalText || seg.text,
                  correctionLevel: enhanced.correctionLevel,
                };
              }
              return seg;
            });

            onTranscriptEnhanced?.(enhancedTranscript);

            // Update transcriptRef so that sendContextUpdate sends corrected text to ASR
            transcriptRef.current = enhancedTranscript;

            return newMap;
          });
          setEnhanceStats(prev => ({
            ...prev,
            enhanced: prev.enhanced + segments.filter(s => s.enhanceStatus === 'enhanced').length,
            isEnhancing: false,
          }));
        },
      });

      // 根据 audioSource 决定采集路径——详见 recorder-audio-source.ts。
      // 'mic'    : 只麦克风（收集页永远走这个；线下课堂默认）
      // 'system' : 只采电脑发出的声音（在家听网课的场景——课堂来自扬声器，不是麦克风前景）
      // 'mixed'  : 两路合并到一个 stream，下游 (MediaRecorder / Analyser / PCM pipeline) 不用动
      //
      // 失败策略：
      //   - system 失败 → 抛错（用户点了电脑声音但没勾"分享音频"，需要明确提示）
      //   - mixed  失败 → acquireAudioStream 内部降级为纯 mic，effectiveSource='mic'
      const acquired = await acquireAudioStream({
        source: audioSource,
        // 中心化的 AEC/NS/AGC 约束（src/lib/services/asr/audio-constraints.ts），
        // 环境变量 NEXT_PUBLIC_ASR_* 覆盖默认值。
        micConstraints: (buildAudioConstraints().audio as MediaTrackConstraints),
      });
      stream = acquired.stream;
      audioCleanupRef.current = acquired.cleanup;

      startTimeRef.current = Date.now();
      
      vadStateRef.current = {
        isSpeaking: false,
        speechStartMs: 0,
        silenceStartMs: 0,
      };
      noiseFloorRef.current = 0.02;
      
      let actualSampleRate = wsSampleRate;
      let source: MediaStreamAudioSourceNode | null = null;
      // 手机端 P0 修复：原本 `if (!compactMode)` 把 AudioContext / VAD / level 整块跳过，
      // 导致 compactMode 路径无 source / analyser，连 streaming ASR 都没法初始化。
      // 现在改为：流式转写时 AudioContext+source+analyser 一定要建（VAD 需要 analyser），
      // 仅当 compact 时跳过 level 显示（meter UI 本身在紧凑布局里也是隐藏的）。
      const needsAudioPipeline = effectiveTranscribeMode === 'streaming' || !compactMode;
      if (needsAudioPipeline) {
        audioContext = new AudioContext();
        if (audioContext.state === 'suspended') {
          try {
            await audioContext.resume();
          } catch (resumeError) {
            console.warn('[Recorder] AudioContext resume on start failed:', resumeError);
          }
        }
        audioContextRef.current = audioContext;
        source = audioContext.createMediaStreamSource(stream);
        sourceNodeRef.current = source;
        actualSampleRate = audioContext.sampleRate;
        analyserRef.current = audioContext.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        const checkLevel = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const normalizedLevel = average / 255;
          setLevel(normalizedLevel);

          if (startTimeRef.current > 0) {
            const currentElapsedMs = Date.now() - startTimeRef.current;
            const vadState = vadStateRef.current;

            if (!vadState.isSpeaking) {
              noiseFloorRef.current = noiseFloorRef.current * 0.96 + normalizedLevel * 0.04;
            } else {
              noiseFloorRef.current = noiseFloorRef.current * 0.995 + normalizedLevel * 0.005;
            }

            const dynamicThreshold = Math.max(
              VAD_CONFIG.baseEnergyThreshold,
              noiseFloorRef.current + (vadState.isSpeaking ? VAD_CONFIG.speakingNoiseMargin : VAD_CONFIG.noiseMargin)
            );

            if (normalizedLevel > dynamicThreshold) {
              if (!vadState.isSpeaking) {
                vadState.isSpeaking = true;
                vadState.speechStartMs = currentElapsedMs;
                vadState.silenceStartMs = 0;

                if (asrClientRef.current?.isConnected()) {
                  asrClientRef.current.sendVADEvent('start', vadState.speechStartMs);
                }
              }

              vadState.silenceStartMs = 0;
            } else if (vadState.isSpeaking) {
              if (vadState.silenceStartMs === 0) {
                vadState.silenceStartMs = currentElapsedMs;
              } else {
                const silenceDuration = currentElapsedMs - vadState.silenceStartMs;
                if (silenceDuration >= VAD_CONFIG.silenceDuration) {
                  const speechDuration = vadState.silenceStartMs - vadState.speechStartMs;
                  if (speechDuration >= VAD_CONFIG.minSpeechDuration) {
                    if (asrClientRef.current?.isConnected()) {
                      asrClientRef.current.sendVADEvent('end', vadState.silenceStartMs);
                    }
                  }
                  vadState.isSpeaking = false;
                  vadState.speechStartMs = 0;
                  vadState.silenceStartMs = 0;
                }
              }
            }
          }

          animationIdRef.current = requestAnimationFrame(checkLevel);
        };
        checkLevel();
      } else {
        setLevel(0);
        analyserRef.current = null;
        sourceNodeRef.current = null;
      }

      const shouldContinueIntoCurrentSession = Boolean(continueCurrentSession && activeSessionId);
      sessionIdRef.current = shouldContinueIntoCurrentSession
        ? activeSessionId!
        : `session-${Date.now()}`;
      recordingIdRef.current = `recording-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      if (effectiveTranscribeMode === 'streaming' && streamingAvailable && apiKey && audioContext && source) {
        asrClientRef.current = new DashScopeASRClient(apiKey, {
          onSentence: (sentence) => {
            const segment: TranscriptSegment = {
              id: sentence.id,
              text: sentence.text,
              startMs: sentence.beginTime,
              endMs: sentence.endTime || sentence.beginTime,
              confidence: sentence.confidence ?? 0.95,
              isFinal: true,
              provisional: false,
              sourceItemId: sentence.itemId,
            };

            if (sentence.itemId && interimItemIdRef.current === sentence.itemId) {
              interimItemIdRef.current = null;
              setInterimText('');
            } else {
              setInterimText((prev) => {
                if (!prev) return prev;
                const prevKey = normalizeCompareText(prev);
                const finalKey = normalizeCompareText(sentence.text);
                return prevKey && prevKey === finalKey ? '' : prev;
              });
            }

            const mergeResult = mergeRealtimeTranscriptSegment(transcriptRef.current, segment, {
              replaceIds: sentence.replaces,
            });
            if (mergeResult.action === 'ignore') return;

            const nextTranscript = mergeResult.segments;
            const appended = mergeResult.action === 'append';

            transcriptRef.current = nextTranscript;
            setTranscript(nextTranscript);
            onTranscriptUpdate?.(nextTranscript, getCallbackMeta());

            if (enhanceManagerRef.current && !sentence.provisional && appended) {
              enhanceManagerRef.current.addSegment(segment);
              setEnhanceStats((prev) => ({ ...prev, total: prev.total + 1 }));
            }

            // Periodically send context update with recent transcript for better ASR consistency
            contextUpdateCountRef.current++;
            if (
              contextUpdateCountRef.current >= CONTEXT_UPDATE_EVERY_N_SEGMENTS &&
              asrClientRef.current?.isConnected()
            ) {
              contextUpdateCountRef.current = 0;
              const recentText = nextTranscript
                .slice(-15)
                .map((s) => s.text)
                .join('');
              asrClientRef.current.sendContextUpdate(recentText);
            }
          },
          onInterim: (interim) => {
            if (interim.itemId) {
              interimItemIdRef.current = interim.itemId;
            }

            const nextText = (interim.text || '').trim();
            if (!nextText) {
              if (!interim.itemId || interim.itemId === interimItemIdRef.current) {
                interimItemIdRef.current = null;
                setInterimText('');
              }
            } else {
              const lastFinal = transcriptRef.current[transcriptRef.current.length - 1];
              const interimKey = normalizeCompareText(nextText);
              const lastKey = normalizeCompareText(lastFinal?.text || '');
              setInterimText(interimKey && interimKey === lastKey ? '' : nextText);
            }

            if (enhanceManagerRef.current) {
              enhanceManagerRef.current.updateActivity();
            }
          },
        onError: (err) => setError(err),
          onStatusChange: (newStatus) => {
            if (newStatus === 'transcribing') setServiceStatus('available');
          },
        }, {
          model: wsModel,
          sampleRate: wsSampleRate,
          format: 'pcm',
          initialContextHint: contextHint.trim(),
          initialLanguageMode: languageMode,
          maxReconnectAttempts: 30,
          reconnectBaseMs: 800,
          reconnectCapMs: 15_000,
        });
        
        const started = await asrClientRef.current.start();
        if (!started) {
          asrClientRef.current = null;
        } else {
          contextUpdateCountRef.current = 0;

          const bufferSize = 4096;
          pcmProcessorRef.current = audioContext.createScriptProcessor(bufferSize, 1, 1);
          
          pcmProcessorRef.current.onaudioprocess = (e) => {
            if (asrClientRef.current?.isConnected()) {
              const inputData = e.inputBuffer.getChannelData(0);
              const resampledData = resamplePcm(inputData, actualSampleRate, wsSampleRate);
              const pcmData = float32ToInt16(resampledData);
              asrClientRef.current.sendAudio(pcmData.buffer as ArrayBuffer);
            }
          };
          
          source.connect(pcmProcessorRef.current);
          pcmProcessorRef.current.connect(audioContext.destination);
        }
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;

      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      setStatus('recording');
      onRecordingStart?.(sessionIdRef.current, { isContinuation: shouldContinueIntoCurrentSession });

    } catch (err) {
      // 有可能 stream 已经通过 acquireAudioStream 拿到并注册了 cleanup；
      // 也有可能还没走到那一步（比如 enhanceManager 初始化失败）。两边都兜住。
      if (audioCleanupRef.current) {
        try { audioCleanupRef.current(); } catch { /* ignore */ }
        audioCleanupRef.current = null;
      } else if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (pcmProcessorRef.current) {
        pcmProcessorRef.current.disconnect();
        pcmProcessorRef.current.onaudioprocess = null;
        pcmProcessorRef.current = null;
      }
      if (audioContext) {
        await audioContext.close().catch(() => {});
        if (audioContextRef.current === audioContext) {
          audioContextRef.current = null;
        }
      }
      analyserRef.current = null;
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setError(err instanceof Error ? err.message : '\u5f55\u97f3\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002');
    } finally {
      isStartingRecordingRef.current = false;
      setIsStartingRecording(false);
    }
  }, [
    activeSessionId,
    apiKey,
    audioSource,
    contextHint,
    languageMode,
    continueCurrentSession,
    getCallbackMeta,
    onRecordingStart,
    onTranscriptEnhanced,
    onTranscriptUpdate,
    status,
    stopMediaRecorderSafely,
    compactMode,
    effectiveTranscribeMode,
    streamingAvailable,
    VAD_CONFIG.baseEnergyThreshold,
    VAD_CONFIG.minSpeechDuration,
    VAD_CONFIG.noiseMargin,
    VAD_CONFIG.silenceDuration,
    VAD_CONFIG.speakingNoiseMargin,
    wsModel,
    wsSampleRate,
  ]);

  useEffect(() => {
    if (!autoStartSignal) return;
    if (autoStartSignal === lastAutoStartSignalRef.current) return;

    lastAutoStartSignalRef.current = autoStartSignal;

    if (disabled || status !== 'idle') return;

    void startRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartSignal, disabled, status]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      // 挂起 AudioContext，暂停 ScriptProcessor 和 ASR 音频发送。
      audioContextRef.current?.suspend();
      if (timerRef.current) clearInterval(timerRef.current);
      pauseTimestampRef.current = Date.now();
      setStatus('paused');
    }
  }, []);

  /** Rebuild the PCM->ASR pipeline after ASR reconnection. */
  const rebuildPcmPipeline = useCallback(() => {
    const audioContext = audioContextRef.current;
    const source = sourceNodeRef.current;
    if (!audioContext || !source || !asrClientRef.current?.isConnected()) return;

    // Disconnect old processor
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.disconnect();
      pcmProcessorRef.current.onaudioprocess = null;
      pcmProcessorRef.current = null;
    }

    const actualSampleRate = audioContext.sampleRate;
    const bufferSize = 4096;
    pcmProcessorRef.current = audioContext.createScriptProcessor(bufferSize, 1, 1);

    pcmProcessorRef.current.onaudioprocess = (e) => {
      if (asrClientRef.current?.isConnected()) {
        const inputData = e.inputBuffer.getChannelData(0);
        const resampledData = resamplePcm(inputData, actualSampleRate, wsSampleRate);
        const pcmData = float32ToInt16(resampledData);
        asrClientRef.current.sendAudio(pcmData.buffer as ArrayBuffer);
      }
    };

    source.connect(pcmProcessorRef.current);
    pcmProcessorRef.current.connect(audioContext.destination);
  }, [wsSampleRate]);

  const resumeRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state !== 'paused') return;

    mediaRecorderRef.current.resume();

    // Check if ASR WebSocket is still alive
    const asrAlive = asrClientRef.current?.isConnected();
    const pauseDurationMs = Date.now() - pauseTimestampRef.current;

    if (!asrAlive && effectiveTranscribeMode === 'streaming' && streamingAvailable && apiKey) {
      console.warn(`[Recorder] ASR disconnected during pause (${(pauseDurationMs / 1000).toFixed(1)}s). Reconnecting...`);
      setAsrReconnecting(true);
      setError(null);

      // Stop old client gracefully
      if (asrClientRef.current) {
        try { await asrClientRef.current.stop(); } catch { /* ignore */ }
        asrClientRef.current = null;
      }

      // Create new ASR client with same callbacks
      asrClientRef.current = new DashScopeASRClient(apiKey, {
        onSentence: (sentence) => {
          const segment: TranscriptSegment = {
            id: sentence.id,
            text: sentence.text,
            startMs: sentence.beginTime,
            endMs: sentence.endTime || sentence.beginTime,
            confidence: sentence.confidence ?? 0.95,
            isFinal: true,
            provisional: false,
            sourceItemId: sentence.itemId,
          };

          if (sentence.itemId && interimItemIdRef.current === sentence.itemId) {
            interimItemIdRef.current = null;
            setInterimText('');
          } else {
            setInterimText((prev) => {
              if (!prev) return prev;
              const prevKey = normalizeCompareText(prev);
              const finalKey = normalizeCompareText(sentence.text);
              return prevKey && prevKey === finalKey ? '' : prev;
            });
          }

          const mergeResult = mergeRealtimeTranscriptSegment(transcriptRef.current, segment, {
            replaceIds: sentence.replaces,
          });
          if (mergeResult.action === 'ignore') return;

          const nextTranscript = mergeResult.segments;
          const appended = mergeResult.action === 'append';

          transcriptRef.current = nextTranscript;
          setTranscript(nextTranscript);
          onTranscriptUpdate?.(nextTranscript, getCallbackMeta());

          if (enhanceManagerRef.current && !sentence.provisional && appended) {
            enhanceManagerRef.current.addSegment(segment);
            setEnhanceStats((prev) => ({ ...prev, total: prev.total + 1 }));
          }

          contextUpdateCountRef.current++;
          if (
            contextUpdateCountRef.current >= CONTEXT_UPDATE_EVERY_N_SEGMENTS &&
            asrClientRef.current?.isConnected()
          ) {
            contextUpdateCountRef.current = 0;
            const recentText = nextTranscript
              .slice(-15)
              .map((s) => s.text)
              .join('');
            asrClientRef.current.sendContextUpdate(recentText);
          }
        },
        onInterim: (interim) => {
          if (interim.itemId) {
            interimItemIdRef.current = interim.itemId;
          }
          const nextText = (interim.text || '').trim();
          if (!nextText) {
            if (!interim.itemId || interim.itemId === interimItemIdRef.current) {
              interimItemIdRef.current = null;
              setInterimText('');
            }
          } else {
            const lastFinal = transcriptRef.current[transcriptRef.current.length - 1];
            const interimKey = normalizeCompareText(nextText);
            const lastKey = normalizeCompareText(lastFinal?.text || '');
            setInterimText(interimKey && interimKey === lastKey ? '' : nextText);
          }
          if (enhanceManagerRef.current) {
            enhanceManagerRef.current.updateActivity();
          }
        },
        onError: (err) => setError(err),
        onStatusChange: (newStatus) => {
          if (newStatus === 'transcribing') setServiceStatus('available');
        },
      }, {
        model: wsModel,
        sampleRate: wsSampleRate,
        format: 'pcm',
        initialContextHint: contextHint.trim(),
        initialLanguageMode: languageMode,
        maxReconnectAttempts: 30,
        reconnectBaseMs: 800,
        reconnectCapMs: 15_000,
      });

      const started = await asrClientRef.current.start();
      if (started) {
        const recentText = transcriptRef.current
          .slice(-15)
          .map((s) => s.text)
          .join('');
        if (recentText) {
          asrClientRef.current.sendContextUpdate(recentText);
        }
        contextUpdateCountRef.current = 0;

        // Rebuild PCM pipeline
        rebuildPcmPipeline();
      } else {
        console.error('[Recorder] ASR reconnect failed - recording continues without live transcription');
        setError('\u5b9e\u65f6\u8f6c\u5199\u91cd\u8fde\u5931\u8d25\uff0c\u5f55\u97f3\u4ecd\u5728\u7ee7\u7eed\uff0c\u97f3\u9891\u4e0d\u4f1a\u4e22\u5931\u3002');
        asrClientRef.current = null;
      }
      setAsrReconnecting(false);
    }

    if (effectiveTranscribeMode === 'streaming') {
      await audioContextRef.current?.resume();
    }

    const pausedTime = elapsedMs;
    startTimeRef.current = Date.now() - pausedTime;
    timerRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);

    vadStateRef.current = {
      isSpeaking: false,
      speechStartMs: 0,
      silenceStartMs: 0,
    };
    noiseFloorRef.current = 0.02;

    setStatus('recording');
  }, [
    apiKey,
    contextHint,
    languageMode,
    elapsedMs,
    getCallbackMeta,
    onTranscriptUpdate,
    rebuildPcmPipeline,
    streamingAvailable,
    compactMode,
    effectiveTranscribeMode,
    wsModel,
    wsSampleRate,
  ]);

  const transcribeWithQwenASR = useCallback(async (audioBlob: Blob, options?: { skipEnhancement?: boolean; emitStopCallback?: boolean }) => {
    const skipEnhancement = options?.skipEnhancement ?? false;
    const emitStopCallback = options?.emitStopCallback ?? true;
    setStatus('transcribing');
    setTranscribeStartedAt(Date.now());
    setTranscribeProgress(skipEnhancement ? '正在转录这段原声...' : '正在转录音频...');
    onTranscribing?.(true);
    let deferredTranscriptionError: string | null = null;

    try {
      const createFormData = () => {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        if (contextHint.trim()) {
          formData.append('context', contextHint.trim());
        }
        formData.append('language', languageMode);
        return formData;
      };

      let response: Response | null = null;
      let data: {
        success?: boolean;
        segments?: Array<{
          id: string;
          text: string;
          startMs: number;
          endMs: number;
          confidence?: number;
        }>;
        error?: string;
        code?: string;
        sentences?: Array<{
          id?: string;
          text: string;
          beginTime?: number;
          endTime?: number;
        }>;
      } = {};
      let lastErrorMessage = '转录失败';

      const endpoints = chooseBatchTranscribeEndpoints({
        durationMs: elapsedMs,
        sizeBytes: audioBlob.size,
      });
      for (let index = 0; index < endpoints.length; index += 1) {
        const endpoint = endpoints[index];
        setTranscribeProgress(
          endpoint === '/api/transcribe-turbo'
            ? '本地先用极速转写接住这段原声...'
            : endpoint === '/api/transcribe-fast'
              ? '这段比较长，切成几段稳定转写...'
              : '前一种转写没接住，切到标准转写再试一次...'
        );

        try {
          response = await fetch(endpoint, {
            method: 'POST',
            body: createFormData(),
          });
          data = (await response.json().catch(() => ({}))) as typeof data;

          if (response.ok && data.success) {
            break;
          }

          const detail = typeof (data as { detail?: unknown }).detail === 'string'
            ? (data as { detail?: string }).detail
            : '';
          lastErrorMessage = [data.error, detail].filter(Boolean).join('：') || lastErrorMessage;
        } catch (endpointError) {
          lastErrorMessage = endpointError instanceof Error ? endpointError.message : String(endpointError);
          response = null;
          data = {};
          continue;
        }
      }

      if (!response || !response.ok || !data.success) {
        throw new Error(data.error || lastErrorMessage);
      }

      if (data.success && data.segments) {
        const segments: TranscriptSegment[] = data.segments.map((seg: {
          id: string;
          text: string;
          startMs: number;
          endMs: number;
          confidence?: number;
        }) => ({
          id: seg.id,
          text: seg.text,
          startMs: seg.startMs,
          endMs: seg.endMs,
          confidence: seg.confidence || 0.95,
          isFinal: true,
        }));

        setTranscript(segments);
        transcriptRef.current = segments;
        onTranscriptUpdate?.(segments, getCallbackMeta());
        
        if (segments.length > 0 && !skipEnhancement) {
          setTranscribeProgress('转录完成，正在优化文本...');
          setEnhanceStats(prev => ({ ...prev, total: segments.length, isEnhancing: true }));
          
          enhanceManagerRef.current = new TranscriptEnhanceManager({
            minBatchSize: 1,
            silenceThreshold: 0,
            model: CORRECTION_MODEL,
            fallbackModel: CORRECTION_FALLBACK_MODEL,
            strategy: 'layered',
            lexiconScope: 'classroom',
            contextHint: contextHint || '',
            onEnhanced: (enhancedSegs) => {
              setEnhancedSegments(prev => {
                const newMap = new Map(prev);
                for (const seg of enhancedSegs) {
                  if (manuallyEditedSegmentIdsRef.current.has(seg.id)) continue;
                  newMap.set(seg.id, seg);
                }

                const enhancedTranscript = segments.map(seg => {
                  if (manuallyEditedSegmentIdsRef.current.has(seg.id)) return seg;
                  const enhanced = newMap.get(seg.id);
                  if (enhanced && enhanced.enhanceStatus === 'enhanced' && enhanced.text !== seg.text) {
                    // M8-A2: silent correction — carry originalText so UI hover
                    // can reveal "机器修过：XXX" without any in-your-face badge.
                    return {
                      ...seg,
                      text: enhanced.text,
                      originalText: enhanced.originalText || seg.originalText || seg.text,
                      correctionLevel: enhanced.correctionLevel,
                    };
                  }
                  return seg;
                });

                onTranscriptEnhanced?.(enhancedTranscript);

                return newMap;
              });
              setEnhanceStats(prev => ({
                ...prev,
                enhanced: prev.enhanced + enhancedSegs.filter(s => s.enhanceStatus === 'enhanced').length,
                isEnhancing: false,
              }));
            },
          });
          
          for (const seg of segments) {
            enhanceManagerRef.current.addSegment(seg);
          }
          
          enhanceManagerRef.current.finalize().then(() => {
            const enhancedCount = enhanceManagerRef.current?.getAllEnhanced().filter(s => s.enhanceStatus === 'enhanced').length || 0;
            setTranscribeProgress(`转录完成，共 ${segments.length} 段，已优化 ${enhancedCount} 段`);
            enhanceManagerRef.current?.dispose();
            enhanceManagerRef.current = null;
          });
        } else if (segments.length > 0) {
          setTranscribeProgress(`转录完成，共 ${segments.length} 段`);
        } else {
          setTranscribeProgress(`转录完成，共 ${segments.length} 段`);
          deferredTranscriptionError = '这段原声没有转出可用文字。';
        }
      } else {
        setTranscribeProgress('转录完成，但没有获取到文本。');
        deferredTranscriptionError = '这段原声没有转出可用文字。';
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '转录失败';
      setError(rawMessage);
      // 延后到 onRecordingStop 之后派发：外层需要先创建 pending audio，才能把失败态写回卡片和 session。
      deferredTranscriptionError = normalizeRecorderErrorMessage(rawMessage);
      setTranscribeProgress('');
    } finally {
      onTranscribing?.(false);
      setStatus('stopped');
      setTranscribeStartedAt(null);
      if (emitStopCallback) {
        onRecordingStop?.(audioBlob ?? undefined, getCallbackMeta());
      }
      if (deferredTranscriptionError) {
        onTranscriptionError?.(deferredTranscriptionError, getCallbackMeta());
      }
    }
  }, [contextHint, elapsedMs, getCallbackMeta, languageMode, onRecordingStop, onTranscriptEnhanced, onTranscriptUpdate, onTranscribing, onTranscriptionError]);

  const stopRecording = useCallback(async () => {
    // 把每一步清理都 try/catch 包起来：任何一步出错都不能阻止 audioBlob 走到 onRecordingStop，
    // 否则用户停录后什么都看不到（体感就是"录完没记录也存不下来"）。

    try {
      if (asrClientRef.current) {
        await asrClientRef.current.stop();
        asrClientRef.current = null;
      }
    } catch (err) {
      console.error('[Recorder] asrClient stop error:', err);
      asrClientRef.current = null;
    }

    try {
      if (pcmProcessorRef.current) {
        pcmProcessorRef.current.disconnect();
        pcmProcessorRef.current.onaudioprocess = null;
        pcmProcessorRef.current = null;
      }
    } catch (err) {
      console.error('[Recorder] pcmProcessor disconnect error:', err);
      pcmProcessorRef.current = null;
    }

    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    let audioBlob: Blob | null = null;
    try {
      audioBlob = await stopMediaRecorderSafely();
    } catch (err) {
      console.error('[Recorder] stopMediaRecorderSafely error:', err);
    }

    try {
      if (audioContextRef.current) {
        await audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
    } catch (err) {
      console.error('[Recorder] audioContext close error:', err);
      audioContextRef.current = null;
    }
    // acquireAudioStream 返回的 cleanup：释放底层麦克风/系统音频 track、关闭 mixed 模式下的合并 AudioContext
    if (audioCleanupRef.current) {
      try { audioCleanupRef.current(); } catch { /* ignore */ }
      audioCleanupRef.current = null;
    }
    sourceNodeRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setInterimText('');
    interimItemIdRef.current = null;

    if (enhanceManagerRef.current && effectiveTranscribeMode === 'streaming') {
      setEnhanceStats(prev => ({ ...prev, isEnhancing: true }));
      try {
        await enhanceManagerRef.current.finalize();
      } catch (err) {
        console.error('[Recorder] Enhancement finalize error:', err);
      }

      // await 过程中 ref 可能被别处（990 行 batch 的 .then）异步置 null，裸调会炸
      try {
        enhanceManagerRef.current?.dispose();
      } catch (err) {
        console.error('[Recorder] enhanceManager dispose error:', err);
      }
      enhanceManagerRef.current = null;
    }

    // 兜底批量转写的最小 blob 阈值：< 8KB 基本是静音/噪声，转也是空，不浪费一次 API。
    const MIN_FALLBACK_BLOB_BYTES = 8 * 1024;

    // 关键修复（2026-06-03）：流式实时 ASR 一句没出，但 blob 是好的 → 必须兜底批量转写。
    //
    // 真实用户 case：手机录 1.5 小时会议，全程流式模式，但手机锁屏 / 切后台 /
    // 网络抖动会断掉实时 ASR 的 WebSocket，导致 transcriptRef 收到 0 段。
    // 之前这里直接走 else 分支「什么都不转」，blob 被存下来却从没送去转写，
    // session 永远卡在「正在整理」——录了等于没录。
    //
    // 现在：streaming 模式收到 0 段但 blob 有效 → 自动降级走 transcribeWithQwenASR
    // （内部 chooseBatchTranscribeEndpoints 会为长音频选分片转写接口）。
    // 这不是 fallback 掩盖问题，是真的把音频转出来。
    const streamingProducedNothing =
      effectiveTranscribeMode === 'streaming' && transcriptRef.current.length === 0;
    const blobIsUsable = Boolean(audioBlob && audioBlob.size > MIN_FALLBACK_BLOB_BYTES);

    if (effectiveTranscribeMode === 'batch' && audioBlob && audioBlob.size > 0) {
      onRecordingStop?.(audioBlob ?? undefined, getCallbackMeta());
      try {
        await transcribeWithQwenASR(audioBlob, {
          skipEnhancement: compactMode,
          emitStopCallback: false,
        });
      } catch (err) {
        console.error('[Recorder] transcribeWithQwenASR error:', err);
      }
    } else if (streamingProducedNothing && blobIsUsable && audioBlob) {
      // 实时没接住，但音频在 → 兜底批量转写，绝不让录音白录
      // eslint-disable-next-line no-console
      console.warn('[Recorder] streaming produced 0 segments — falling back to batch transcription', {
        blobBytes: audioBlob.size,
      });
      // 先派发 onRecordingStop（外层据此创建 pending audio + 落盘 blob），
      // 再跑批量转写，转好的段会通过 onTranscriptUpdate 回填那条 pending session。
      onRecordingStop?.(audioBlob, getCallbackMeta());
      try {
        await transcribeWithQwenASR(audioBlob, {
          skipEnhancement: compactMode,
          emitStopCallback: false,
        });
      } catch (err) {
        console.error('[Recorder] streaming→batch fallback transcription error:', err);
      }
    } else {
      if (effectiveTranscribeMode === 'streaming' && transcriptRef.current.length > 0) {
        const enhancedCount = enhanceStats.enhanced;
        const totalCount = transcriptRef.current.length;
        const enhanceInfo = enhancedCount > 0 ? `，已优化 ${enhancedCount} 段` : '';
        setTranscribeProgress(`文字已整理，共 ${totalCount} 段${enhanceInfo}`);
        onTranscriptUpdate?.(transcriptRef.current, getCallbackMeta());
      }
      setStatus('stopped');
      onRecordingStop?.(audioBlob ?? undefined, getCallbackMeta());
    }
  }, [
    enhanceStats.enhanced,
    getCallbackMeta,
    onRecordingStop,
    onTranscriptUpdate,
    stopMediaRecorderSafely,
    compactMode,
    effectiveTranscribeMode,
    transcribeWithQwenASR,
  ]);

  /** Stop current recording, clean up all state, and immediately start a fresh recording session. */
  const restartRecording = async () => {
    setShowRestartConfirm(false);

    // 1. Tear down current recording infrastructure
    if (asrClientRef.current) {
      try { await asrClientRef.current.stop(); } catch { /* ignore */ }
      asrClientRef.current = null;
    }
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.disconnect();
      pcmProcessorRef.current.onaudioprocess = null;
      pcmProcessorRef.current = null;
    }
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current) {
      await stopMediaRecorderSafely();
    }
    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (audioCleanupRef.current) {
      try { audioCleanupRef.current(); } catch { /* ignore */ }
      audioCleanupRef.current = null;
    }
    sourceNodeRef.current = null;
    analyserRef.current = null;
    if (enhanceManagerRef.current) {
      enhanceManagerRef.current.dispose();
      enhanceManagerRef.current = null;
    }

    // 2. Reset all state
    setLevel(0);
    setElapsedMs(0);
    setTranscript([]);
    transcriptRef.current = [];
    setInterimText('');
    interimItemIdRef.current = null;
    setTranscribeProgress('');
    setTranscribeStartedAt(null);
    setAnchorCount(0);
    setEnhancedSegments(new Map());
    setEnhanceStats({ enhanced: 0, total: 0, isEnhancing: false });
    manuallyEditedSegmentIdsRef.current.clear();
    audioChunksRef.current = [];
    setError(null);
    setAsrReconnecting(false);

    // 3. Go to idle, then immediately trigger new recording
    setStatus('idle');
    // Use microtask to let React flush the idle state, then start
    await new Promise(resolve => setTimeout(resolve, 50));
    await startRecording();
  };

  useImperativeHandle(ref, () => ({
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
  }), [pauseRecording, resumeRecording, startRecording, stopRecording]);

  const markAnchor = useCallback(() => {
    if (status !== 'recording') return;
    
    const timestamp = elapsedMs;
    lastAnchorTimeRef.current = timestamp;
    onAnchorMark?.(timestamp);
    setAnchorCount(prev => prev + 1);
  }, [status, elapsedMs, onAnchorMark]);

  useEffect(() => {
    return () => {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (pcmProcessorRef.current) {
        pcmProcessorRef.current.disconnect();
        pcmProcessorRef.current.onaudioprocess = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) audioContextRef.current.close().catch(() => {});
      sourceNodeRef.current = null;
      if (asrClientRef.current) asrClientRef.current.stop();
      if (enhanceManagerRef.current) enhanceManagerRef.current.dispose();
      // acquireAudioStream cleanup——卸载时兜底释放采集资源
      if (audioCleanupRef.current) {
        try { audioCleanupRef.current(); } catch { /* ignore */ }
        audioCleanupRef.current = null;
      }
    };
  }, []);

  const isRecording = status === 'recording';
  const isTranscribing = status === 'transcribing';
  const isStopped = status === 'stopped';
  const isIdle = status === 'idle';

  const handleSegmentTextUpdate = useCallback((segmentId: string, nextText: string) => {
    const normalized = nextText.trim();
    if (!normalized) return;

    const target = transcriptRef.current.find((seg) => seg.id === segmentId);
    if (!target || target.text === normalized) return;

    const updatedTranscript = transcriptRef.current.map((seg) =>
      seg.id === segmentId
        ? {
            ...seg,
            text: normalized,
            lockedByUser: true,
            rawText: seg.rawText || seg.text,
          }
        : seg
    );

    transcriptRef.current = updatedTranscript;
    setTranscript(updatedTranscript);
    onTranscriptUpdate?.(updatedTranscript, getCallbackMeta());

    manuallyEditedSegmentIdsRef.current.add(segmentId);
    setEnhancedSegments((prev) => {
      if (!prev.has(segmentId)) return prev;
      const next = new Map(prev);
      next.delete(segmentId);
      return next;
    });

    onTranscriptTextUpdate?.(segmentId, normalized);

    void recordTranscriptEditDiff({
      originalText: target.text,
      correctedText: normalized,
      scope: 'classroom',
    }).catch((error) => {
      console.warn('[Recorder] Failed to record transcript edit diff:', error);
    });

    // M6.7: 把纠错同步到服务端（/api/asr/corrections），供 AsrCorrection 聚合为
    // AsrHotword，下次 ASR 通过 buildASRContextHint.userHotwords 注入。
    // 本地 IndexedDB + 服务端两条管道并行，互不干扰。
    if (typeof window !== 'undefined') {
      const token = window.localStorage.getItem('auth_token');
      if (token) {
        void fetch('/api/asr/corrections', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            sessionId: getCallbackMeta().sessionId ?? `recorder-${Date.now()}`,
            wrongText: target.text,
            correctedText: normalized,
            beginMs: target.startMs,
            endMs: target.endMs,
            asrMode: effectiveTranscribeMode === 'streaming' ? 'realtime' : 'async',
          }),
          keepalive: true,
        }).catch(() => {
          /* silent — 本地已记录，服务端 miss 不致命 */
        });
      }
    }
  }, [effectiveTranscribeMode, getCallbackMeta, onTranscriptTextUpdate, onTranscriptUpdate]);

  const displayTranscript = transcript.map(seg => {
    if (seg.lockedByUser || manuallyEditedSegmentIdsRef.current.has(seg.id)) return seg;
    const enhanced = enhancedSegments.get(seg.id);
    if (enhanced && enhanced.enhanceStatus === 'enhanced' && enhanced.text !== seg.text) {
      return {
        ...seg,
        text: enhanced.text,
        originalText: seg.text,
        correctionLevel: enhanced.correctionLevel,
        rawText: enhanced.rawText || seg.rawText || seg.text,
      };
    }
    return seg;
  });

  const compactPreviewText =
    interimText.trim() ||
    displayTranscript
      .slice(-2)
      .map((segment) => segment.text)
      .join(' ')
      .trim();

  const compactStatusLabel = isRecording
    ? '原声消息录制中'
    : asrReconnecting
      ? '正在重连'
      : '录音已暂停';
  const compactStatusTone = isRecording ? 'text-[#1C1B19] font-semibold' : 'text-[#5C5A55]';

  if (isIdle) {
    if (compactMode) {
      return (
        <div className="flex items-center gap-3 rounded-[18px] border border-[#E8E2D5] bg-white px-3 py-3 animate-fade-in">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FDF3C0] text-[#1C1B19]">
            {isStartingRecording ? (
              <div className="h-4 w-4 rounded-full border-2 border-[#1C1B19] border-t-transparent animate-spin" />
            ) : (
              <Mic size={16} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[#1C1B19]">
              {isStartingRecording ? '正在打开麦克风...' : '准备录一段语音'}
            </p>
            <p className="mt-1 text-[12px] leading-5 text-[#5C5A55]">
              这段录音会和文字一起进入当前收集流。
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="card p-0 overflow-hidden animate-fade-in">
        <div className="border-b border-[#E8E2D5] bg-[#FAF7F2] px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                serviceStatus === 'checking' ? 'bg-[#FDF3C0] animate-pulse' :
                serviceStatus === 'available' ? 'bg-[#D1F4E0]' :
                'bg-[#E8E2D5]'
              }`} />
              <span className="text-xs text-[#5C5A55]">
                {serviceStatus === 'checking'
                  ? '连接中...'
                  : serviceStatus === 'available'
                    ? '实时转写就绪'
                    : '本地模式'}
              </span>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1 rounded-xl bg-white p-1">
                <button
                  onClick={() => setTranscribeMode('streaming')}
                  disabled={!streamingAvailable}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    effectiveTranscribeMode === 'streaming'
                      ? 'bg-[#FDF3C0] text-[#1C1B19] font-medium'
                      : 'text-[#5C5A55] hover:text-[#1C1B19]'
                  } ${!streamingAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  边录边转
                </button>
                <button
                  onClick={() => setTranscribeMode('batch')}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    transcribeMode === 'batch'
                      ? 'bg-[#F2EDE3] text-[#1C1B19] font-medium'
                      : 'text-[#5C5A55] hover:text-[#1C1B19]'
                  }`}
                >
                  录完整理
                </button>
              </div>
              <span className="text-[12px] text-[#5C5A55]">
                {effectiveTranscribeMode === 'streaming' ? '适合边录边出文字' : '适合先录完再整理'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="rounded-[28px] border border-[#E8E2D5] bg-[#FAF7F2] p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <span className="inline-flex items-center rounded-full border border-[#E8E2D5] bg-white px-2.5 py-1 text-[12px] font-semibold tracking-[0.08em] text-[#5C5A55]">
                  语音收集
                </span>
                <h3 className="mt-2 text-xl font-bold text-[#1C1B19] sm:text-2xl">现在想让 MeetMind 记住什么？</h3>
                <p className="mt-2 text-sm leading-6 text-[#5C5A55]">
                  点一下就开始录。刚听到的课、突然冒出来的问题、课后的灵感，都可以先扔进来，后面再慢慢整理。
                </p>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={startRecording}
                  disabled={disabled || isStartingRecording}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-[#1C1B19] text-white transition hover:bg-[#3a3a39] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="开始录音"
                >
                  <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="6" />
                  </svg>
                </button>
                <div>
                  <p className="text-sm font-semibold text-[#1C1B19]">
                    {isStartingRecording ? '正在打开麦克风...' : '开始一段新的语音收集'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#5C5A55]">
                    停下后它会自动进入这次收集流，你不用立刻切去别的页面。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-[#FADEC9] bg-[#FADEC9]/30 p-4 text-sm text-[#1C1B19] animate-slide-up">
              <div className="flex items-center gap-2">
                <span>⚠</span>
                <span>{error}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isTranscribing) {
    const elapsedSec = Math.floor(transcribeElapsedMs / 1000);
    // 超过 10s 才显示计时，避免短音频的闪烁
    const showElapsed = elapsedSec >= 10;
    return (
      <div className="card p-8 animate-fade-in">
        <div className="flex flex-col items-center py-12">
          <div className="w-20 h-20 rounded-full bg-[#FDF3C0] flex items-center justify-center mb-6">
            <div className="w-8 h-8 border-3 border-[#1C1B19] border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="mb-2 text-lg font-medium text-[#1C1B19]">正在把这段语音整理进收集流</div>
          <p className="text-sm text-[#5C5A55]">
            {transcribeProgress || '请稍等...'}
            {showElapsed ? (
              <span className="ml-2 font-mono text-[#5C5A55]/80">· 已处理 {elapsedSec}s</span>
            ) : null}
          </p>
        </div>
      </div>
    );
  }

  if (isStopped) {
    return (
      <div className="card p-0 overflow-hidden animate-fade-in">
        <div className="border-b border-[#D1F4E0] bg-[#D1F4E0]/30 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.08em] text-[#1C1B19]">已加入收集流</p>
              <h3 className="mt-1 text-lg font-semibold text-[#1C1B19]">这段语音已经整理好了</h3>
              <p className="mt-1 text-sm leading-6 text-[#5C5A55]">
                你可以马上再录一段，也可以继续往当前会话里补充资料、标记问题。
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-[#1C1B19]">
              {displayTranscript.length} 段
            </span>
          </div>
        </div>

        <div className="p-5">
          {transcribeProgress && (
            <div className="rounded-2xl border border-[#D1F4E0] bg-[#D1F4E0]/30 px-4 py-3 text-sm text-[#1C1B19]">
              {transcribeProgress}
            </div>
          )}

          {displayTranscript.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-[#E8E2D5] bg-[#FAF7F2] p-4">
              <p className="text-xs font-semibold tracking-[0.08em] text-[#5C5A55]">刚刚收进来的内容</p>
              <p className="mt-2 text-sm leading-7 text-[#1C1B19]">
                {displayTranscript.slice(0, 4).map((segment) => segment.text).join(' ')}
              </p>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => {
                setStatus('idle');
                setElapsedMs(0);
                setTranscript([]);
                transcriptRef.current = [];
                setInterimText('');
                interimItemIdRef.current = null;
                setTranscribeProgress('');
                setAnchorCount(0);
                setEnhancedSegments(new Map());
                setEnhanceStats({ enhanced: 0, total: 0, isEnhancing: false });
                manuallyEditedSegmentIdsRef.current.clear();
                audioChunksRef.current = [];
              }}
              className="rounded-2xl bg-[#1C1B19] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#3a3a39]"
            >
              再录一段
            </button>
            <span className="text-xs text-[#5C5A55]">不用跳页，继续在当前收集流里追加就行。</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden border border-divider bg-white animate-fade-in ${
        compactMode ? 'rounded-[24px]' : 'rounded-2xl'
      }`}
    >
      {/* */}
      <div className={`flex-shrink-0 flex items-center justify-between border-b border-[#E8E2D5] ${
        compactMode ? 'h-[58px] px-3.5' : 'h-[84px] px-4 sm:h-[60px]'
      } bg-[#FAF7F2]`}>
      {/* */}
        <div className={`flex items-center ${compactMode ? 'gap-2' : 'gap-3 sm:gap-3'}`}>
          {/* */}
          <div className={`flex items-center ${compactMode ? 'gap-1.5' : 'gap-2 sm:gap-2'}`}>
            <div className={`${compactMode ? 'h-2.5 w-2.5' : 'w-3.5 h-3.5 sm:w-2.5 sm:h-2.5'} rounded-full ${
              isRecording ? 'bg-[#1C1B19] animate-pulse' : asrReconnecting ? 'bg-[#FDF3C0] animate-pulse' : 'bg-[#E8E2D5]'
            }`} />
            <span className={`${compactMode ? 'text-[13px]' : 'text-lg sm:text-sm'} font-medium ${compactMode ? compactStatusTone : isRecording ? 'text-[#1C1B19]' : 'text-[#5C5A55]'}`}>
              {compactMode ? compactStatusLabel : isRecording ? '正在录音' : (asrReconnecting ? '重连中' : '已暂停')}
            </span>
          </div>
          
          {/* */}
          <div className={`font-mono font-semibold tabular-nums ${compactMode ? 'text-base' : 'text-4xl sm:text-2xl'} ${isRecording ? 'text-[#1C1B19]' : 'text-[#5C5A55]'}`}>
            {formatTime(elapsedMs)}
          </div>
          
          {/* */}
          {isRecording && !compactMode && (
            <div className="hidden sm:flex items-center gap-0.5 h-5">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all duration-75 ${
                    level * 5 > i ? 'bg-[#D1F4E0]' : 'bg-[#E8E2D5]'
                  }`}
                  style={{ 
                    height: `${Math.max(4, Math.min(16, (level * 20) + Math.sin(Date.now() / 200 + i) * 2))}px`
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* */}
        <div className={`flex items-center ${compactMode ? 'gap-2' : 'gap-4 sm:gap-4'}`}>
          {/* */}
          <span className={`text-sm text-ink-muted ${compactMode ? 'hidden' : 'hidden sm:inline'}`}>
            {effectiveTranscribeMode === 'streaming' ? '边录边出文字' : '录完再整理'}
          </span>
          
          {/* */}
          <div className={`flex items-center ${compactMode ? 'gap-2' : 'gap-4 sm:gap-2'}`}>
            {isRecording ? (
              <button
                onClick={pauseRecording}
                className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[72px] h-[72px] sm:w-[48px] sm:h-[48px]'} rounded-full bg-[#FDF3C0] text-[#1C1B19] flex items-center justify-center hover:bg-[#FDF3C0] transition-all active:scale-95`}
                aria-label="暂停"
              >
                <svg className={`${compactMode ? 'h-5 w-5' : 'w-9 h-9 sm:w-6 sm:h-6'}`} fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={resumeRecording}
                disabled={asrReconnecting}
                className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[72px] h-[72px] sm:w-[48px] sm:h-[48px]'} rounded-full flex items-center justify-center transition-all active:scale-95 ${
                  asrReconnecting
                    ? 'cursor-wait bg-divider-light text-ink-muted'
                    : 'bg-mint-100 text-mint-700 hover:bg-mint-200'
                }`}
                aria-label="继续"
              >
                {asrReconnecting ? (
                  <div className={`${compactMode ? 'h-4 w-4' : 'w-6 h-6 sm:w-5 sm:h-5'} border-2 border-[#1C1B19] border-t-transparent rounded-full animate-spin`} />
                ) : (
                  <svg className={`${compactMode ? 'h-5 w-5' : 'w-9 h-9 sm:w-6 sm:h-6'}`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={stopRecording}
              className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[72px] h-[72px] sm:w-[48px] sm:h-[48px]'} rounded-full ${compactMode ? 'bg-[#1C1B19] text-white hover:bg-[#3a3a39]' : 'bg-[#F2EDE3] text-[#1C1B19] hover:bg-[#E8E2D5]'} flex items-center justify-center transition-all active:scale-95`}
              aria-label="停止"
            >
              <svg className={`${compactMode ? 'h-5 w-5' : 'w-9 h-9 sm:w-6 sm:h-6'}`} fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
            {!compactMode ? (
              <button
                onClick={() => setShowRestartConfirm(true)}
                className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[48px] h-[48px] sm:w-[36px] sm:h-[36px]'} rounded-full bg-white border border-[#E8E2D5] text-[#5C5A55] flex items-center justify-center hover:bg-[#FADEC9]/30 hover:text-[#1C1B19] hover:border-[#FADEC9] transition-all active:scale-95`}
                aria-label="重新开始"
                title="清空并重新录音"
              >
                <svg className={`${compactMode ? 'h-4 w-4' : 'w-5 h-5 sm:w-4 sm:h-4'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* 错误提示：M7-fix2 两段式——先说是什么，再说下一步怎么办 */}
      {error && (() => {
        const hint = normalizeRecorderErrorDetail(error);
        return (
          <div className={`flex-shrink-0 rounded-xl border border-[#FADEC9] bg-[#FADEC9]/30 text-[#1C1B19] animate-slide-up ${
            compactMode ? 'mx-2 mt-1.5 px-3 py-2 text-[12px] leading-5' : 'mx-4 mt-3 p-3 text-sm'
          }`}>
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className="flex-shrink-0">!</span>
              <div className="flex-1 min-w-0">
                <div>{hint.message}</div>
                {hint.action ? (
                  <div className={compactMode ? 'mt-1 text-[12px] opacity-80' : 'mt-1 text-xs opacity-80'}>
                    {hint.action}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ASR 重连提示 */}
      {asrReconnecting && !compactMode && (
        <div className={`flex-shrink-0 rounded-xl border border-[#FDF3C0] bg-[#FDF3C0]/30 text-[#1C1B19] animate-slide-up ${
          compactMode ? 'mx-2 mt-1.5 px-3 py-2 text-[12px]' : 'mx-4 mt-2 p-2.5 text-xs'
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-[#1C1B19] border-t-transparent rounded-full animate-spin" />
            <span>正在重新接上文字...</span>
          </div>
        </div>
      )}

      {/* 重新开始确认弹窗 */}
      {showRestartConfirm && (
        <div className="flex-shrink-0 mx-4 mt-3 p-4 bg-white border border-[#E8E2D5] rounded-xl animate-scale-in">
          <p className="text-sm text-[#1C1B19] mb-3">
            确定要清空当前录音并重新开始吗？已经录下的内容不会保留。
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowRestartConfirm(false)}
              className="px-4 py-1.5 text-xs font-medium text-[#5C5A55] bg-[#F2EDE3] rounded-lg hover:bg-[#E8E2D5] transition-colors"
            >
              取消
            </button>
            <button
              onClick={restartRecording}
              className="px-4 py-1.5 text-xs font-medium text-white bg-[#1C1B19] rounded-lg hover:bg-[#3a3a39] transition-colors"
            >
              确定重录
            </button>
          </div>
        </div>
      )}

      {/* */}
      {effectiveTranscribeMode === 'streaming' && enhanceStats.total > 0 && !compactMode && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 text-xs text-[#5C5A55]">
          {enhanceStats.isEnhancing ? (
            <>
              <div className="w-3 h-3 border-2 border-[#1C1B19] border-t-transparent rounded-full animate-spin" />
              <span>正在优化文本...</span>
            </>
          ) : enhanceStats.enhanced > 0 ? (
            <>
              <span className="text-[#1C1B19]">OK</span>
              <span>已优化 {enhanceStats.enhanced}/{enhanceStats.total} 段</span>
            </>
          ) : null}
        </div>
      )}

      {/* */}
      {compactMode ? (
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="rounded-[18px] border border-[#D1F4E0] bg-[#D1F4E0]/20 px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1C1B19] text-white">
                <Mic size={14} />
              </div>
              <div className="flex items-center gap-1.5 text-[#1C1B19]">
                {[8, 12, 16, 11, 15, 9].map((height, index) => (
                  <span
                    key={`compact-wave-${height}-${index}`}
                    className="w-[3px] rounded-full bg-current"
                    style={{ height: `${height}px`, opacity: isRecording ? 0.95 : 0.45 }}
                  />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-[#1C1B19]">
                  {isRecording ? '语音录制中，停下后会直接发进收集流' : '这条语音已暂停，继续说就接着记'}
                </p>
                <p className="mt-1 text-[12px] leading-5 text-[#5C5A55]">
                  {compactPreviewText || (isRecording ? '继续说，我先帮你记住这段内容。' : '结束后会自动变成文字并留在收集流里。')}
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <TranscriptFlowView
            segments={displayTranscript}
            variant="live"
            interimText={interimText}
            isRecording={isRecording}
            transcribeMode={transcribeMode}
            editable={true}
            onSegmentTextUpdate={handleSegmentTextUpdate}
            defaultExpanded={!compactMode}
            showHeader={!compactMode}
            enableWordExplainer={true}
            enableEnToZhTranslation={true}
            paragraphGapMs={5000}
          />
        </div>
      )}

      {/* */}
      {compactMode ? (
        <div className="flex-shrink-0 border-t border-divider bg-white px-2.5 pb-2 pt-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={markAnchor}
              disabled={!isRecording}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-full px-3 text-[12px] font-medium transition ${
                isRecording
                  ? 'bg-[#FADEC9] text-[#1C1B19] hover:bg-[#FADEC9]/80'
                  : 'cursor-not-allowed bg-divider-light text-ink-muted'
              }`}
            >
              <span className="text-sm">!</span>
              <span>卡住了</span>
            </button>
            {anchorCount > 0 ? (
              <span className="rounded-full bg-divider-light px-2.5 py-1 text-[12px] text-ink-secondary">
                已记 {anchorCount} 处卡点
              </span>
            ) : (
              <span className="text-[12px] text-ink-muted">听不懂时点一下</span>
            )}
            <button
              type="button"
              onClick={() => setShowRestartConfirm(true)}
              className="ml-auto inline-flex h-8 items-center rounded-full px-3 text-[12px] text-ink-muted transition hover:bg-divider-light hover:text-ink-secondary"
            >
              重录
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-[#E8E2D5] bg-[#FAF7F2]">
          <button
            onClick={markAnchor}
            disabled={!isRecording}
            className={`w-full flex items-center justify-center gap-3 transition-all h-14 ${
              isRecording 
                ? 'bg-[#1C1B19] text-white hover:bg-[#3a3a39] active:scale-[0.99]' 
                : 'bg-[#F2EDE3] text-[#5C5A55] cursor-not-allowed'
            }`}
          >
            <span className="text-xl">!</span>
            <span className="font-medium">没听懂？点这里！</span>
            {anchorCount > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                isRecording ? 'bg-white/20' : 'bg-[#E8E2D5]'
              }`}>
                已标记 {anchorCount}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
});
