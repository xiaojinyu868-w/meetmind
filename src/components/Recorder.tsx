'use client';

import { forwardRef, useState, useRef, useCallback, useEffect, useImperativeHandle } from 'react';
import { Mic } from 'lucide-react';
import type { TranscriptSegment } from '@/types';
import { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';
import { TranscriptFlowView } from './TranscriptFlowView';
import { TranscriptEnhanceManager, type EnhancedTranscriptSegment } from '@/lib/services/transcript-enhancer';
import { calculateSimilarity } from '@/lib/utils/transcript-utils';
import { recordTranscriptEditDiff } from '@/lib/db/lexicon';

interface RecorderProps {
  onRecordingStart?: (sessionId: string, meta?: { isContinuation?: boolean }) => void;
  onRecordingStop?: (audioBlob?: Blob, meta?: { sessionId?: string; isContinuation?: boolean; durationMs?: number }) => void;
  onTranscriptionError?: (message: string, meta?: { sessionId?: string; isContinuation?: boolean; durationMs?: number }) => void;
  onTranscriptUpdate?: (segments: TranscriptSegment[]) => void;
  onTranscriptTextUpdate?: (segmentId: string, text: string) => void;

  onTranscriptEnhanced?: (segments: TranscriptSegment[]) => void;
  onAnchorMark?: (timestamp: number) => void;
  onTranscribing?: (isTranscribing: boolean) => void;
  disabled?: boolean;
  activeSessionId?: string;
  continueCurrentSession?: boolean;
  autoStartSignal?: number;
  compactMode?: boolean;
  /** Optional context hint (course topic, terms, references) for ASR hot-word injection */
  contextHint?: string;
}

export interface RecorderHandle {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => Promise<void>;
}

type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped' | 'transcribing';
type ServiceStatus = 'checking' | 'available' | 'unavailable' | 'asr-ready';
type TranscribeMode = 'batch' | 'streaming';

const DEDUP_SIMILARITY = Number(process.env.NEXT_PUBLIC_ASR_DEDUP_SIMILARITY || 0.95);
const DEDUP_GAP_MS = Number(process.env.NEXT_PUBLIC_ASR_DEDUP_GAP_MS || 1500);
const ENABLE_AUTO_GAIN_CONTROL = String(process.env.NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL || 'true').toLowerCase() !== 'false';
const ENABLE_ECHO_CANCELLATION = String(process.env.NEXT_PUBLIC_ASR_ECHO_CANCELLATION || 'false').toLowerCase() !== 'false';
const ENABLE_NOISE_SUPPRESSION = String(process.env.NEXT_PUBLIC_ASR_NOISE_SUPPRESSION || 'true').toLowerCase() !== 'false';
const CORRECTION_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_LIGHT_MODEL || 'qwen-turbo';
const CORRECTION_FALLBACK_MODEL = process.env.NEXT_PUBLIC_TRANSCRIPT_FALLBACK_MODEL || 'qwen-plus';

function normalizeCompareText(text: string): string {
  return (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s，。！？、,.!?;；:“”"'（）()【】\[\]-]/g, '');
}

function shouldReplaceLastSegment(last: TranscriptSegment, next: TranscriptSegment): boolean {
  const gap = Math.max(0, next.startMs - last.endMs);
  const overlap = next.startMs <= last.endMs;
  const similarity = calculateSimilarity(last.text, next.text);

  if (similarity >= DEDUP_SIMILARITY && (overlap || gap <= DEDUP_GAP_MS)) {
    return true;
  }

  const lastKey = normalizeCompareText(last.text);
  const nextKey = normalizeCompareText(next.text);
  return !!lastKey && lastKey === nextKey && (overlap || gap <= DEDUP_GAP_MS);
}

function normalizeRecorderErrorMessage(message: string): string {
  const text = (message || '').trim();
  if (!text) return '\u5f55\u97f3\u51fa\u4e86\u70b9\u95ee\u9898\uff0c\u8bf7\u518d\u8bd5\u4e00\u6b21\u3002';
  if (/session already started or finished or failed/i.test(text)) {
    return '\u5b9e\u65f6\u8f6c\u5199\u521a\u521a\u5728\u91cd\u8fde\uff0c\u7a0d\u7b49\u4e00\u79d2\u518d\u7ee7\u7eed\u5f55\u5c31\u597d\u3002';
  }
  if (/公网地址|可访问的公网地址|PUBLIC_DOMAIN|PUBLIC_HOST/i.test(text)) {
    return '当前环境没配公网转写地址，这段原声会先留住，但暂时还转不成文字。';
  }
  return text;
}

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
}: RecorderProps, ref) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [transcribeProgress, setTranscribeProgress] = useState<string>('');
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
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
  const animationIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string>('');
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
  const effectiveTranscribeMode: TranscribeMode = compactMode ? 'batch' : transcribeMode;


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


  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    
    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
    }
    return `${pad(minutes)}:${pad(seconds % 60)}`;
  };

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
            asrClientRef.current.sendContextHint(termsHint.trim());
            console.log('[Recorder] Auto-discovered terms sent to ASR, length:', termsHint.trim().length);
          }
        },
        onEnhanced: (segments) => {

          console.log('[Recorder] Enhanced callback received:', segments.length, 'segments');
          console.log('[Recorder] Enhanced segments:', segments.map(s => ({ id: s.id, status: s.enhanceStatus, text: s.text?.slice(0, 30) })));
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
                return { ...seg, text: enhanced.text };
              }
              return seg;
            });
            

            console.log('[Recorder] Notifying parent of enhanced transcript:', enhancedTranscript.length, 'segments');
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
      console.log('[Recorder] TranscriptEnhanceManager initialized');

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: ENABLE_ECHO_CANCELLATION,
          noiseSuppression: ENABLE_NOISE_SUPPRESSION,
          autoGainControl: ENABLE_AUTO_GAIN_CONTROL,
        },
      });



      startTimeRef.current = Date.now();
      

      vadStateRef.current = {
        isSpeaking: false,
        speechStartMs: 0,
        silenceStartMs: 0,
      };
      noiseFloorRef.current = 0.02;
      
      let actualSampleRate = wsSampleRate;
      let source: MediaStreamAudioSourceNode | null = null;
      if (!compactMode) {
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
        console.log('[Recorder] AudioContext sampleRate:', actualSampleRate);
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
                console.log(
                  '[VAD] Speech started at',
                  vadState.speechStartMs,
                  'ms, level:',
                  normalizedLevel.toFixed(3),
                  'noiseFloor:',
                  noiseFloorRef.current.toFixed(3),
                  'threshold:',
                  dynamicThreshold.toFixed(3)
                );

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
                    console.log(
                      '[VAD] Speech ended:',
                      vadState.speechStartMs,
                      '-',
                      vadState.silenceStartMs,
                      'ms, duration:',
                      speechDuration,
                      'ms'
                    );
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


      if (!compactMode && effectiveTranscribeMode === 'streaming' && streamingAvailable && apiKey && audioContext && source) {
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

            const nextTranscript = [...transcriptRef.current];
            let replaced = false;

            if (sentence.replaces?.length) {
              for (const replaceId of sentence.replaces) {
                const replaceIndex = nextTranscript.findIndex((seg) => seg.id === replaceId);
                if (replaceIndex >= 0) {
                  nextTranscript[replaceIndex] = segment;
                  replaced = true;
                  break;
                }
              }
            }

            if (!replaced && nextTranscript.length > 0) {
              const last = nextTranscript[nextTranscript.length - 1];
              if (shouldReplaceLastSegment(last, segment)) {
                nextTranscript[nextTranscript.length - 1] = segment;
                replaced = true;
              }
            }

            if (!replaced) {
              nextTranscript.push(segment);
            }

            transcriptRef.current = nextTranscript;
            setTranscript(nextTranscript);
            onTranscriptUpdate?.(nextTranscript);

            if (enhanceManagerRef.current && !sentence.provisional && !replaced) {
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
          onError: (err) => setError(normalizeRecorderErrorMessage(err)),
          onStatusChange: (newStatus) => {
            if (newStatus === 'transcribing') setServiceStatus('available');
          },
        }, {
          model: wsModel,
          sampleRate: wsSampleRate,
          format: 'pcm',
        });
        
        const started = await asrClientRef.current.start();
        if (!started) {
          asrClientRef.current = null;
        } else {
          // Send context hint for hot-word injection
          if (contextHint.trim()) {
            asrClientRef.current.sendContextHint(contextHint.trim());
            console.log('[Recorder] Sent context hint to ASR, length:', contextHint.trim().length);
          }
          contextUpdateCountRef.current = 0;

          const bufferSize = 4096;
          pcmProcessorRef.current = audioContext.createScriptProcessor(bufferSize, 1, 1);
          

          const resample = (inputData: Float32Array, fromRate: number, toRate: number): Float32Array => {
            if (fromRate === toRate) return inputData;
            const ratio = fromRate / toRate;
            const newLength = Math.round(inputData.length / ratio);
            const result = new Float32Array(newLength);
            for (let i = 0; i < newLength; i++) {
              const srcIndex = i * ratio;
              const srcIndexFloor = Math.floor(srcIndex);
              const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
              const t = srcIndex - srcIndexFloor;

              result[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
            }
            return result;
          };
          
          pcmProcessorRef.current.onaudioprocess = (e) => {
            if (asrClientRef.current?.isConnected()) {
              const inputData = e.inputBuffer.getChannelData(0);

              const resampledData = resample(inputData, actualSampleRate, wsSampleRate);
              const pcmData = new Int16Array(resampledData.length);
              for (let i = 0; i < resampledData.length; i++) {
                pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(resampledData[i] * 32768)));
              }
              asrClientRef.current.sendAudio(pcmData.buffer);
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
      if (stream) {
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
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '\u8bf7\u5141\u8bb8\u9ea6\u514b\u98ce\u6743\u9650\u540e\u518d\u91cd\u8bd5\u3002'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? '\u6ca1\u6709\u68c0\u6d4b\u5230\u53ef\u7528\u7684\u9ea6\u514b\u98ce\u8bbe\u5907\u3002'
            : err instanceof Error
              ? normalizeRecorderErrorMessage(err.message)
              : '\u5f55\u97f3\u542f\u52a8\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002'
      );
    } finally {
      isStartingRecordingRef.current = false;
      setIsStartingRecording(false);
    }
  }, [
    activeSessionId,
    apiKey,
    contextHint,
    continueCurrentSession,
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

    const resample = (inputData: Float32Array, fromRate: number, toRate: number): Float32Array => {
      if (fromRate === toRate) return inputData;
      const ratio = fromRate / toRate;
      const newLength = Math.round(inputData.length / ratio);
      const result = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
        const t = srcIndex - srcIndexFloor;
        result[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
      }
      return result;
    };

    pcmProcessorRef.current.onaudioprocess = (e) => {
      if (asrClientRef.current?.isConnected()) {
        const inputData = e.inputBuffer.getChannelData(0);
        const resampledData = resample(inputData, actualSampleRate, wsSampleRate);
        const pcmData = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(resampledData[i] * 32768)));
        }
        asrClientRef.current.sendAudio(pcmData.buffer);
      }
    };

    source.connect(pcmProcessorRef.current);
    pcmProcessorRef.current.connect(audioContext.destination);
    console.log('[Recorder] PCM->ASR pipeline rebuilt after reconnection');
  }, [wsSampleRate]);


  const resumeRecording = useCallback(async () => {
    if (mediaRecorderRef.current?.state !== 'paused') return;

    mediaRecorderRef.current.resume();

    // Check if ASR WebSocket is still alive
    const asrAlive = asrClientRef.current?.isConnected();
    const pauseDurationMs = Date.now() - pauseTimestampRef.current;

    if (!compactMode && !asrAlive && effectiveTranscribeMode === 'streaming' && streamingAvailable && apiKey) {
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

          const nextTranscript = [...transcriptRef.current];
          let replaced = false;

          if (sentence.replaces?.length) {
            for (const replaceId of sentence.replaces) {
              const replaceIndex = nextTranscript.findIndex((seg) => seg.id === replaceId);
              if (replaceIndex >= 0) {
                nextTranscript[replaceIndex] = segment;
                replaced = true;
                break;
              }
            }
          }

          if (!replaced && nextTranscript.length > 0) {
            const last = nextTranscript[nextTranscript.length - 1];
            if (shouldReplaceLastSegment(last, segment)) {
              nextTranscript[nextTranscript.length - 1] = segment;
              replaced = true;
            }
          }

          if (!replaced) {
            nextTranscript.push(segment);
          }

          transcriptRef.current = nextTranscript;
          setTranscript(nextTranscript);
          onTranscriptUpdate?.(nextTranscript);

          if (enhanceManagerRef.current && !sentence.provisional && !replaced) {
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
        onError: (err) => setError(normalizeRecorderErrorMessage(err)),
        onStatusChange: (newStatus) => {
          if (newStatus === 'transcribing') setServiceStatus('available');
        },
      }, {
        model: wsModel,
        sampleRate: wsSampleRate,
        format: 'pcm',
      });

      const started = await asrClientRef.current.start();
      if (started) {
        // Send context hint + recent transcript to new session
        if (contextHint.trim()) {
          asrClientRef.current.sendContextHint(contextHint.trim());
        }
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
        console.log('[Recorder] ASR reconnected successfully after pause');
      } else {
        console.error('[Recorder] ASR reconnect failed - recording continues without live transcription');
        setError('\u5b9e\u65f6\u8f6c\u5199\u91cd\u8fde\u5931\u8d25\uff0c\u5f55\u97f3\u4ecd\u5728\u7ee7\u7eed\uff0c\u97f3\u9891\u4e0d\u4f1a\u4e22\u5931\u3002');
        asrClientRef.current = null;
      }
      setAsrReconnecting(false);
    }

    if (!compactMode) {
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
    elapsedMs,
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
    setTranscribeProgress(skipEnhancement ? '正在转录这段原声...' : '正在转录音频...');
    onTranscribing?.(true);

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '转录失败');
      }

      const data = await response.json();

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
        onTranscriptUpdate?.(segments);
        

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
            onEnhanced: (enhancedSegs) => {
              console.log('[Recorder] Batch mode enhanced:', enhancedSegs.length, 'segments');
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
                    return { ...seg, text: enhanced.text };
                  }
                  return seg;
                });
                

                console.log('[Recorder] Notifying parent of batch enhanced transcript:', enhancedTranscript.length, 'segments');
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
          onTranscriptionError?.('这段原声没有转出可用文字。', {
            sessionId: sessionIdRef.current,
            isContinuation: Boolean(continueCurrentSession && activeSessionId),
            durationMs: elapsedMs,
          });
        }
      } else {
        setTranscribeProgress('转录完成，但没有获取到文本。');
        onTranscriptionError?.('这段原声没有转出可用文字。', {
          sessionId: sessionIdRef.current,
          isContinuation: Boolean(continueCurrentSession && activeSessionId),
          durationMs: elapsedMs,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? normalizeRecorderErrorMessage(err.message) : '转录失败';
      setError(message);
      onTranscriptionError?.(message, {
        sessionId: sessionIdRef.current,
        isContinuation: Boolean(continueCurrentSession && activeSessionId),
        durationMs: elapsedMs,
      });
      setTranscribeProgress('');
    } finally {
      onTranscribing?.(false);
      setStatus('stopped');
      if (emitStopCallback) {
        onRecordingStop?.(audioBlob ?? undefined, {
          sessionId: sessionIdRef.current,
          isContinuation: Boolean(continueCurrentSession && activeSessionId),
          durationMs: elapsedMs,
        });
      }
    }
  }, [activeSessionId, continueCurrentSession, elapsedMs, onRecordingStop, onTranscriptEnhanced, onTranscriptUpdate, onTranscribing, onTranscriptionError]);

  const stopRecording = useCallback(async () => {

    if (asrClientRef.current) {
      await asrClientRef.current.stop();
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

    const audioBlob = await stopMediaRecorderSafely();

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    sourceNodeRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setInterimText('');
    interimItemIdRef.current = null;


    if (enhanceManagerRef.current && effectiveTranscribeMode === 'streaming') {
      setEnhanceStats(prev => ({ ...prev, isEnhancing: true }));
      console.log('[Recorder] Finalizing transcript enhancement...');
      try {
        await enhanceManagerRef.current.finalize();
      } catch (err) {
        console.error('[Recorder] Enhancement finalize error:', err);
      }

      enhanceManagerRef.current.dispose();
      enhanceManagerRef.current = null;
    }

    if (effectiveTranscribeMode === 'batch' && audioBlob && audioBlob.size > 0) {
      onRecordingStop?.(audioBlob ?? undefined, {
        sessionId: sessionIdRef.current,
        isContinuation: Boolean(continueCurrentSession && activeSessionId),
        durationMs: elapsedMs,
      });
      await transcribeWithQwenASR(audioBlob, {
        skipEnhancement: compactMode,
        emitStopCallback: false,
      });
    } else {
      if (effectiveTranscribeMode === 'streaming' && transcriptRef.current.length > 0) {
        const enhancedCount = enhanceStats.enhanced;
        const totalCount = transcriptRef.current.length;
        const enhanceInfo = enhancedCount > 0 ? `，已优化 ${enhancedCount} 段` : '';
        setTranscribeProgress(`转录完成，共 ${totalCount} 段${enhanceInfo}`);
        onTranscriptUpdate?.(transcriptRef.current);
      }
      setStatus('stopped');
      onRecordingStop?.(audioBlob ?? undefined, {
        sessionId: sessionIdRef.current,
        isContinuation: Boolean(continueCurrentSession && activeSessionId),
        durationMs: elapsedMs,
      });
    }
  }, [
    activeSessionId,
    continueCurrentSession,
    elapsedMs,
    enhanceStats.enhanced,
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
    onTranscriptUpdate?.(updatedTranscript);

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
  }, [onTranscriptTextUpdate, onTranscriptUpdate]);

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
  const compactStatusTone = isRecording ? 'text-coral' : 'text-slate-500';


  if (isIdle) {
    if (compactMode) {
      return (
        <div className="flex items-center gap-3 rounded-[18px] border border-slate-200 bg-white px-3 py-3 shadow-sm animate-fade-in">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            {isStartingRecording ? (
              <div className="h-4 w-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
            ) : (
              <Mic size={16} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              {isStartingRecording ? '正在打开麦克风...' : '准备开始录原声'}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-slate-500">
              这段原声会和转写一起进入当前收集流。
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="card p-0 overflow-hidden animate-fade-in">
        <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full transition-colors ${
                serviceStatus === 'checking' ? 'bg-sunflower animate-pulse' :
                serviceStatus === 'available' ? 'bg-mint' :
                'bg-gray-300'
              }`} />
              <span className="text-xs text-gray-500">
                {serviceStatus === 'checking'
                  ? '连接中...'
                  : serviceStatus === 'available'
                    ? '实时转写就绪'
                    : '本地模式'}
              </span>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-sm">
                <button
                  onClick={() => setTranscribeMode('streaming')}
                  disabled={!streamingAvailable}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    effectiveTranscribeMode === 'streaming'
                      ? 'bg-amber-50 text-amber-700'
                      : 'text-gray-500 hover:text-gray-700'
                  } ${!streamingAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  边录边转
                </button>
                <button
                  onClick={() => setTranscribeMode('batch')}
                  className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
                    transcribeMode === 'batch'
                      ? 'bg-slate-100 text-slate-700'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  录完整理
                </button>
              </div>
              <span className="text-[10px] text-gray-400">
                {effectiveTranscribeMode === 'streaming' ? '适合边听边记' : '适合先录整段再转成文字'}
              </span>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(145deg,#ffffff_0%,#fff7ed_58%,#eef6ff_100%)] p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <span className="inline-flex items-center rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] text-slate-500">
                  语音收集
                </span>
                <h3 className="mt-2 text-xl font-bold text-slate-900 sm:text-2xl">现在想让 MeetMind 记住什么？</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  点一下就开始录。刚听到的课、突然冒出来的问题、课后的灵感，都可以先扔进来，后面再慢慢整理。
                </p>
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={startRecording}
                  disabled={disabled || isStartingRecording}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-coral-500 via-orange-500 to-amber-500 text-white shadow-[0_18px_32px_rgba(249,115,22,0.32)] transition hover:scale-[1.02] hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="开始录音"
                  data-onboarding="record-button"
                >
                  <svg className="h-7 w-7" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="6" />
                  </svg>
                </button>
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {isStartingRecording ? '正在打开麦克风...' : '开始一段新的语音收集'}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    停下后它会自动进入这次收集流，你不用立刻切去别的页面。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-coral-100 bg-coral-50 p-4 text-sm text-coral-600 animate-slide-up">
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
    return (
      <div className="card p-8 animate-fade-in">
        <div className="flex flex-col items-center py-12">
          <div className="w-20 h-20 rounded-full bg-sunflower-100 flex items-center justify-center mb-6">
            <div className="w-8 h-8 border-3 border-sunflower border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="mb-2 text-lg font-medium text-gray-700">正在把这段语音整理进收集流</div>
          <p className="text-sm text-gray-500">{transcribeProgress || '请稍等...'}</p>
        </div>
      </div>
    );
  }


  if (isStopped) {
    return (
      <div className="card p-0 overflow-hidden animate-fade-in">
        <div className="border-b border-mint-100 bg-mint-50/70 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.08em] text-mint-700">已加入收集流</p>
              <h3 className="mt-1 text-lg font-semibold text-slate-900">这段语音已经整理好了</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                你可以马上再录一段，也可以继续往当前会话里补充资料、标记问题。
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-mint-700 shadow-sm">
              {displayTranscript.length} 段
            </span>
          </div>
        </div>

        <div className="p-5">
          {transcribeProgress && (
            <div className="rounded-2xl border border-mint-100 bg-mint-50 px-4 py-3 text-sm text-mint-700">
              {transcribeProgress}
            </div>
          )}

          {displayTranscript.length > 0 ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-xs font-semibold tracking-[0.08em] text-slate-500">刚刚收进来的内容</p>
              <p className="mt-2 text-sm leading-7 text-slate-700">
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
              className="rounded-2xl bg-gradient-to-r from-coral-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(249,115,22,0.22)] transition hover:brightness-105"
            >
              再录一段
            </button>
            <span className="text-xs text-slate-500">不用跳页，继续在当前收集流里追加就行。</span>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden border border-gray-100 bg-white shadow-sm animate-fade-in ${
        compactMode ? 'rounded-[24px] border-slate-200/90 shadow-[0_18px_36px_rgba(15,23,42,0.10)]' : 'rounded-2xl'
      }`}
    >
      {/* */}
      <div className={`flex-shrink-0 flex items-center justify-between border-b border-gray-100 ${
        compactMode ? 'h-[58px] px-3.5' : 'h-[84px] px-4 sm:h-[60px]'
      } ${
        compactMode
          ? 'bg-[linear-gradient(145deg,#ffffff_0%,#f8fafc_60%,#fff7ed_100%)]'
          : isRecording
            ? 'bg-gradient-to-r from-gray-50 to-white'
            : 'bg-gradient-to-r from-amber-50/60 to-white'
      }`}>
      {/* */}
        <div className={`flex items-center ${compactMode ? 'gap-2' : 'gap-3 sm:gap-3'}`}>
          {/* */}
          <div className={`flex items-center ${compactMode ? 'gap-1.5' : 'gap-2 sm:gap-2'}`}>
            <div className={`${compactMode ? 'h-2.5 w-2.5' : 'w-3.5 h-3.5 sm:w-2.5 sm:h-2.5'} rounded-full ${
              isRecording ? 'bg-coral animate-pulse' : asrReconnecting ? 'bg-amber-400 animate-pulse' : 'bg-slate-300'
            }`} />
            <span className={`${compactMode ? 'text-[13px]' : 'text-lg sm:text-sm'} font-medium ${compactMode ? compactStatusTone : isRecording ? 'text-coral' : 'text-sunflower-600'}`}>
              {compactMode ? compactStatusLabel : isRecording ? '正在录音' : (asrReconnecting ? '重连中' : '已暂停')}
            </span>
          </div>
          
          {/* */}
          <div className={`font-mono font-semibold tabular-nums ${compactMode ? 'text-base' : 'text-4xl sm:text-2xl'} ${isRecording ? 'text-gray-800' : 'text-gray-500'}`}>
            {formatTime(elapsedMs)}
          </div>
          
          {/* */}
          {isRecording && !compactMode && (
            <div className="hidden sm:flex items-center gap-0.5 h-5">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full transition-all duration-75 ${
                    level * 5 > i ? 'bg-mint' : 'bg-gray-200'
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
          <span className={`text-sm sm:text-xs text-gray-400 ${compactMode ? 'hidden' : 'hidden sm:inline'}`}>
            {effectiveTranscribeMode === 'streaming' ? '边录边转' : '整段转写'}
          </span>
          
          {/* */}
          <div className={`flex items-center ${compactMode ? 'gap-2' : 'gap-4 sm:gap-2'}`}>
            {isRecording ? (
              <button
                onClick={pauseRecording}
                className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[72px] h-[72px] sm:w-[48px] sm:h-[48px]'} rounded-full bg-amber-100 text-amber-700 flex items-center justify-center hover:bg-amber-200 transition-all active:scale-95 shadow-sm`}
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
                className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[72px] h-[72px] sm:w-[48px] sm:h-[48px]'} rounded-full flex items-center justify-center transition-all active:scale-95 shadow-sm ${
                  asrReconnecting
                    ? 'bg-gray-100 text-gray-400 cursor-wait'
                    : 'bg-mint-100 text-mint-700 hover:bg-mint-200'
                }`}
                aria-label="继续"
              >
                {asrReconnecting ? (
                  <div className={`${compactMode ? 'h-4 w-4' : 'w-6 h-6 sm:w-5 sm:h-5'} border-2 border-amber-400 border-t-transparent rounded-full animate-spin`} />
                ) : (
                  <svg className={`${compactMode ? 'h-5 w-5' : 'w-9 h-9 sm:w-6 sm:h-6'}`} fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
            )}
            <button
              onClick={stopRecording}
              className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[72px] h-[72px] sm:w-[48px] sm:h-[48px]'} rounded-full ${compactMode ? 'bg-slate-900 text-white hover:bg-slate-800' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'} flex items-center justify-center transition-all active:scale-95 shadow-sm`}
              aria-label="停止"
            >
              <svg className={`${compactMode ? 'h-5 w-5' : 'w-9 h-9 sm:w-6 sm:h-6'}`} fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
            {!compactMode ? (
              <button
                onClick={() => setShowRestartConfirm(true)}
                className={`${compactMode ? 'h-[34px] w-[34px]' : 'w-[48px] h-[48px] sm:w-[36px] sm:h-[36px]'} rounded-full bg-white border border-gray-200 text-gray-400 flex items-center justify-center hover:bg-coral-50 hover:text-coral-500 hover:border-coral-200 transition-all active:scale-95`}
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

      {/* */}
      {error && (
        <div className={`flex-shrink-0 rounded-xl border border-coral-100 bg-coral-50 text-coral-600 animate-slide-up ${
          compactMode ? 'mx-2 mt-1.5 px-2.5 py-1.5 text-[11px] leading-5' : 'mx-4 mt-3 p-3 text-sm'
        }`}>
          <div className="flex items-center gap-2">
            <span>!</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* ASR 重连提示 */}
      {asrReconnecting && !compactMode && (
        <div className={`flex-shrink-0 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 animate-slide-up ${
          compactMode ? 'mx-2 mt-1.5 px-2.5 py-1.5 text-[11px]' : 'mx-4 mt-2 p-2.5 text-xs'
        }`}>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            <span>正在重连实时转录...</span>
          </div>
        </div>
      )}

      {/* 重新开始确认弹窗 */}
      {showRestartConfirm && (
        <div className="flex-shrink-0 mx-4 mt-3 p-4 bg-white border border-coral-200 rounded-xl shadow-lg animate-scale-in">
          <p className="text-sm text-gray-700 mb-3">
            确定要清空当前录音并重新开始吗？已经录下的内容不会保留。
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowRestartConfirm(false)}
              className="px-4 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={restartRecording}
              className="px-4 py-1.5 text-xs font-medium text-white bg-coral-500 rounded-lg hover:bg-coral-600 transition-colors"
            >
              确定重录
            </button>
          </div>
        </div>
      )}

      {/* */}
      {effectiveTranscribeMode === 'streaming' && enhanceStats.total > 0 && !compactMode && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 text-xs text-gray-400">
          {enhanceStats.isEnhancing ? (
            <>
              <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span>正在优化文本...</span>
            </>
          ) : enhanceStats.enhanced > 0 ? (
            <>
              <span className="text-mint-600">OK</span>
              <span>已优化 {enhanceStats.enhanced}/{enhanceStats.total} 段</span>
            </>
          ) : null}
        </div>
      )}

      {/* */}
      {compactMode ? (
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="rounded-[18px] border border-[#b8e7a6] bg-[#f6fff3] px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#07c160] text-white shadow-[0_8px_18px_rgba(7,193,96,0.18)]">
                <Mic size={14} />
              </div>
              <div className="flex items-center gap-1.5 text-[#62a542]">
                {[8, 12, 16, 11, 15, 9].map((height, index) => (
                  <span
                    key={`compact-wave-${height}-${index}`}
                    className="w-[3px] rounded-full bg-current"
                    style={{ height: `${height}px`, opacity: isRecording ? 0.95 : 0.45 }}
                  />
                ))}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-[#2f6f1f]">
                  {isRecording ? '原声录制中，停下后会直接发进收集流' : '这条原声已暂停，继续说就接着记'}
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  {compactPreviewText || (isRecording ? '继续说，我先帮你记住原话。' : '结束后会自动转文字并留在聊天流里。')}
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
            paragraphGapMs={5000}
          />
        </div>
      )}

      {/* */}
      {compactMode ? (
        <div className="flex-shrink-0 border-t border-gray-100 bg-white px-2.5 pb-2 pt-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={markAnchor}
              disabled={!isRecording}
              className={`inline-flex h-8 items-center justify-center gap-2 rounded-full px-3 text-[11px] font-medium transition ${
                isRecording
                  ? 'bg-coral-50 text-coral-600 hover:bg-coral-100'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
              data-onboarding="confusion-button"
            >
              <span className="text-sm">!</span>
              <span>卡住了</span>
            </button>
            {anchorCount > 0 ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-500">
                已记 {anchorCount} 处卡点
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">听不懂时点一下</span>
            )}
            <button
              type="button"
              onClick={() => setShowRestartConfirm(true)}
              className="ml-auto inline-flex h-8 items-center rounded-full px-3 text-[11px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              重录
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-shrink-0 border-t border-gray-100 bg-gradient-to-r from-white to-gray-50">
          <button
            onClick={markAnchor}
            disabled={!isRecording}
            className={`w-full flex items-center justify-center gap-3 transition-all h-14 ${
              isRecording 
                ? 'bg-gradient-to-r from-coral-500 to-warmOrange-500 text-white hover:from-coral-600 hover:to-warmOrange-600 active:scale-[0.99]' 
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
            data-onboarding="confusion-button"
          >
            <span className="text-xl">!</span>
            <span className="font-medium">没听懂？点这里！</span>
            {anchorCount > 0 && (
              <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                isRecording ? 'bg-white/20' : 'bg-gray-200'
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

