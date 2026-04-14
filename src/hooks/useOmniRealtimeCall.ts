'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type OmniRealtimeCallStatus = 'idle' | 'connecting' | 'authorizing' | 'listening' | 'thinking' | 'responding' | 'muted' | 'error';

interface UseOmniRealtimeCallOptions {
  instructions: string;
  voice?: string;
  enableSearch?: boolean;
  connectOnMount?: boolean;
  onUserTranscript?: (text: string) => void;
  onAssistantTranscriptChange?: (text: string) => void;
  onAssistantTranscriptDone?: (text: string) => void;
  onAssistantResponseStart?: () => void;
  onAssistantResponseEnd?: () => void;
  onError?: (message: string) => void;
}

interface UseOmniRealtimeCallReturn {
  status: OmniRealtimeCallStatus;
  isConnected: boolean;
  isMuted: boolean;
  capturedText: string;
  assistantText: string;
  errorMessage: string;
  connectSession: () => Promise<void>;
  disconnectSession: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  cancelResponse: () => void;
}

function normalizeCallError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '请先允许麦克风权限。';
    if (error.name === 'NotFoundError') return '没有检测到可用麦克风。';
    if (error.name === 'NotReadableError') return '麦克风正在被别的应用占用。';
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }

  return '语音通话暂时不可用，请稍后再试。';
}

function resampleTo16kHz(inputBuffer: Float32Array, inputSampleRate: number): Int16Array {
  const outputSampleRate = 16000;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputBuffer.length / ratio);
  const output = new Int16Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const srcIndex = Math.min(Math.round(index * ratio), inputBuffer.length - 1);
    const sample = Math.max(-1, Math.min(1, inputBuffer[srcIndex]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

function decodeBase64Audio(base64: string): Int16Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Int16Array(bytes.buffer);
}

async function getMicrophonePermissionState(): Promise<PermissionState | 'unknown'> {
  if (typeof navigator === 'undefined' || typeof navigator.permissions?.query !== 'function') {
    return 'unknown';
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

const DEFAULT_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    sampleRate: { ideal: 16000 },
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

let primedMediaStream: MediaStream | null = null;
let primedInputContext: AudioContext | null = null;
let primedCleanupTimer: number | null = null;

function clearPrimedCleanupTimer() {
  if (primedCleanupTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(primedCleanupTimer);
    primedCleanupTimer = null;
  }
}

async function releasePrimedRealtimeCallResources() {
  clearPrimedCleanupTimer();

  if (primedMediaStream) {
    primedMediaStream.getTracks().forEach((track) => track.stop());
    primedMediaStream = null;
  }

  if (primedInputContext) {
    try {
      await primedInputContext.close();
    } catch {
      // noop
    }
    primedInputContext = null;
  }
}

function schedulePrimedRealtimeCallCleanup() {
  if (typeof window === 'undefined') return;

  clearPrimedCleanupTimer();
  primedCleanupTimer = window.setTimeout(() => {
    void releasePrimedRealtimeCallResources();
  }, 15000);
}

function consumePrimedRealtimeCallResources(): {
  mediaStream: MediaStream | null;
  inputContext: AudioContext | null;
} {
  clearPrimedCleanupTimer();

  const mediaStream = primedMediaStream;
  const inputContext = primedInputContext;

  primedMediaStream = null;
  primedInputContext = null;

  return { mediaStream, inputContext };
}

export async function primeOmniRealtimeCallEntry(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.isSecureContext) {
    return false;
  }

  if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    return false;
  }

  try {
    if (primedMediaStream?.active && primedInputContext && primedInputContext.state !== 'closed') {
      if (primedInputContext.state === 'suspended') {
        await primedInputContext.resume();
      }
      schedulePrimedRealtimeCallCleanup();
      return true;
    }

    await releasePrimedRealtimeCallResources();

    primedMediaStream = await navigator.mediaDevices.getUserMedia(DEFAULT_AUDIO_CONSTRAINTS);
    primedInputContext = new AudioContext();

    if (primedInputContext.state === 'suspended') {
      await primedInputContext.resume();
    }

    schedulePrimedRealtimeCallCleanup();
    return true;
  } catch {
    await releasePrimedRealtimeCallResources();
    return false;
  }
}

export function useOmniRealtimeCall({
  instructions,
  voice = 'Ethan',
  enableSearch = false,
  connectOnMount = false,
  onUserTranscript,
  onAssistantTranscriptChange,
  onAssistantTranscriptDone,
  onAssistantResponseStart,
  onAssistantResponseEnd,
  onError,
}: UseOmniRealtimeCallOptions): UseOmniRealtimeCallReturn {
  const [status, setStatus] = useState<OmniRealtimeCallStatus>('idle');
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [capturedText, setCapturedText] = useState('');
  const [assistantText, setAssistantText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const connectPromiseRef = useRef<Promise<void> | null>(null);
  const wsReadyRef = useRef(false);
  const statusRef = useRef<OmniRealtimeCallStatus>('idle');
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlaybackTimeRef = useRef(0);
  const assistantTranscriptRef = useRef('');
  const userTranscriptThisTurnRef = useRef('');
  const isManualDisconnectRef = useRef(false);
  const readyTimeoutRef = useRef<number | null>(null);
  const isMutedRef = useRef(false);
  const hasInputFramesRef = useRef(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearPlaybackSources = useCallback(() => {
    for (const source of playbackSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // noop
      }
    }
    playbackSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
  }, []);

  const clearReadyTimeout = useCallback(() => {
    if (readyTimeoutRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
  }, []);

  const syncMuteState = useCallback((muted: boolean) => {
    isMutedRef.current = muted;
    setIsMuted(muted);
  }, []);

  const getIdleLikeStatus = useCallback((): OmniRealtimeCallStatus => (
    isMutedRef.current ? 'muted' : 'idle'
  ), []);

  const wakeAudioContexts = useCallback(async (): Promise<boolean> => {
    let inputReady = true;
    let outputReady = true;

    if (inputContextRef.current) {
      if (inputContextRef.current.state === 'suspended') {
        try {
          await inputContextRef.current.resume();
        } catch {
          // noop
        }
      }
      inputReady = inputContextRef.current.state === 'running';
    }

    if (outputContextRef.current) {
      if (outputContextRef.current.state === 'suspended') {
        try {
          await outputContextRef.current.resume();
        } catch {
          // noop
        }
      }
      outputReady = outputContextRef.current.state === 'running';
    }

    return inputReady && outputReady;
  }, []);

  const ensureOutputContext = useCallback(async () => {
    if (typeof window === 'undefined') return null;

    if (!outputContextRef.current) {
      outputContextRef.current = new AudioContext({ sampleRate: 24000 });
    }

    if (outputContextRef.current.state === 'suspended') {
      await outputContextRef.current.resume();
    }

    return outputContextRef.current;
  }, []);

  const enqueueAssistantAudio = useCallback(async (base64Audio: string) => {
    const audioContext = await ensureOutputContext();
    if (!audioContext || !base64Audio) return;

    const pcm16 = decodeBase64Audio(base64Audio);
    if (pcm16.length === 0) return;

    const float32 = new Float32Array(pcm16.length);
    for (let index = 0; index < pcm16.length; index += 1) {
      float32[index] = pcm16[index] / 0x8000;
    }

    const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);

    const startAt = Math.max(audioContext.currentTime + 0.02, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + audioBuffer.duration;

    playbackSourcesRef.current.push(source);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((item) => item !== source);
    };
  }, [ensureOutputContext]);

  const closeMicrophone = useCallback(async () => {
    hasInputFramesRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (inputContextRef.current) {
      try {
        await inputContextRef.current.close();
      } catch {
        // noop
      }
      inputContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const openMicrophone = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      throw new Error('当前链接不是安全连接，手机端语音通话需要 HTTPS 或本机访问。');
    }

    if (typeof navigator === 'undefined' || typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      throw new Error('当前浏览器不支持语音通话。');
    }

    if (mediaStreamRef.current && inputContextRef.current && processorRef.current) {
      const resumed = await wakeAudioContexts();
      syncMuteState(false);
      if (!resumed || !hasInputFramesRef.current) {
        setStatus('authorizing');
      } else {
        setStatus(getIdleLikeStatus());
      }
      return;
    }

    const microphonePermissionState = await getMicrophonePermissionState();
    if (microphonePermissionState === 'denied') {
      throw new Error('浏览器已拒绝麦克风权限。请点地址栏里的麦克风图标，允许当前页面使用麦克风。');
    }

    await ensureOutputContext();

    const { mediaStream: primedStream, inputContext: primedInputContextToUse } = consumePrimedRealtimeCallResources();

    const stream = primedStream ?? await navigator.mediaDevices.getUserMedia(DEFAULT_AUDIO_CONSTRAINTS);

    mediaStreamRef.current = stream;

    const inputContext = primedInputContextToUse && primedInputContextToUse.state !== 'closed'
      ? primedInputContextToUse
      : new AudioContext();
    inputContextRef.current = inputContext;
    inputContext.onstatechange = () => {
      if (inputContext.state === 'running' && wsReadyRef.current && mediaStreamRef.current && hasInputFramesRef.current) {
        setStatus(getIdleLikeStatus());
        return;
      }

      if ((inputContext.state === 'suspended' || !hasInputFramesRef.current) && mediaStreamRef.current) {
        setStatus('authorizing');
      }
    };

    const source = inputContext.createMediaStreamSource(stream);
    sourceNodeRef.current = source;
    const processor = inputContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    const sampleRate = inputContext.sampleRate;

    processor.onaudioprocess = (event) => {
      if (!hasInputFramesRef.current) {
        hasInputFramesRef.current = true;
        if (statusRef.current === 'authorizing' && wsReadyRef.current && !isMutedRef.current) {
          setStatus(getIdleLikeStatus());
        }
      }

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16 = Math.abs(sampleRate - 16000) < 100
        ? Int16Array.from(inputData, (sample) => {
            const normalized = Math.max(-1, Math.min(1, sample));
            return normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
          })
        : resampleTo16kHz(inputData, sampleRate);

      wsRef.current.send(pcm16.buffer);
    };

    source.connect(processor);
    processor.connect(inputContext.destination);
    syncMuteState(false);
    const resumed = await wakeAudioContexts();
    if (!resumed || !hasInputFramesRef.current) {
      setStatus('authorizing');
    }
  }, [ensureOutputContext, getIdleLikeStatus, syncMuteState, wakeAudioContexts]);

  const sendSessionConfig = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({
      type: 'session-config',
      instructions,
      voice,
      enableSearch,
    }));
  }, [enableSearch, instructions, voice]);

  const handleSocketError = useCallback((message: string) => {
    const normalized = normalizeCallError(new Error(message));
    setErrorMessage(normalized);
    setStatus('error');
    onError?.(normalized);
  }, [onError]);

  const connect = useCallback(async () => {
    if (typeof window === 'undefined') {
      throw new Error('当前环境暂不支持实时语音通话。');
    }

    if (wsRef.current && wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    if (connectPromiseRef.current) {
      return connectPromiseRef.current;
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/tutor-call`;

    connectPromiseRef.current = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      let settled = false;

      ws.onopen = () => {
        sendSessionConfig();
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data || '{}'));

          switch (payload.event) {
            case 'ready':
              clearReadyTimeout();
              wsReadyRef.current = true;
              setIsConnected(true);
              setErrorMessage('');
              if (!settled) {
                settled = true;
                resolve();
              }
              break;
            case 'speech_started':
              clearPlaybackSources();
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && statusRef.current === 'responding') {
                wsRef.current.send(JSON.stringify({ action: 'cancel' }));
              }
              setCapturedText('');
              setStatus('listening');
              break;
            case 'speech_stopped':
              if (!isMutedRef.current) {
                setStatus('thinking');
              }
              break;
            case 'user_transcript':
              if (typeof payload.transcript === 'string') {
                setCapturedText(payload.transcript);
                if (payload.isFinal) {
                  userTranscriptThisTurnRef.current = payload.transcript;
                  onUserTranscript?.(payload.transcript);
                }
              }
              break;
            case 'assistant_response_start':
              assistantTranscriptRef.current = '';
              setAssistantText('');
              setStatus('responding');
              onAssistantResponseStart?.();
              break;
            case 'assistant_transcript':
              if (typeof payload.text === 'string') {
                assistantTranscriptRef.current = payload.text;
                setAssistantText(payload.text);
                onAssistantTranscriptChange?.(payload.text);
                if (payload.isFinal) {
                  onAssistantTranscriptDone?.(payload.text);
                }
              }
              break;
            case 'assistant_audio':
              if (typeof payload.audio === 'string') {
                void enqueueAssistantAudio(payload.audio);
              }
              break;
            case 'assistant_response_end':
              setStatus(getIdleLikeStatus());
              onAssistantResponseEnd?.();
              break;
            case 'cancelled':
              assistantTranscriptRef.current = '';
              setAssistantText('');
              setStatus(getIdleLikeStatus());
              break;
            case 'error':
              handleSocketError(typeof payload.error === 'string' ? payload.error : '语音通话出错了。');
              break;
            default:
              break;
          }
        } catch {
          handleSocketError('语音通话返回了无法解析的数据。');
        }
      };

      ws.onerror = () => {
        clearReadyTimeout();
        setIsConnected(false);
        if (!settled) {
          settled = true;
          reject(new Error('语音通话连接失败。'));
        }
        handleSocketError('语音通话连接失败。');
      };

      ws.onclose = () => {
        clearReadyTimeout();
        wsReadyRef.current = false;
        wsRef.current = null;
        setIsConnected(false);
        if (isManualDisconnectRef.current) {
          isManualDisconnectRef.current = false;
          setStatus('idle');
          setErrorMessage('');
          return;
        }
        if (!settled) {
          settled = true;
          reject(new Error('语音通话连接已关闭。'));
        }
      };

      if (typeof window !== 'undefined') {
        readyTimeoutRef.current = window.setTimeout(() => {
          clearReadyTimeout();
          if (settled) return;
          settled = true;
          try {
            ws.close(4000, 'ready timeout');
          } catch {
            // noop
          }
          reject(new Error('老师暂时没接上，请点重连再试一次。'));
        }, 10000);
      }
    }).finally(() => {
      connectPromiseRef.current = null;
    });

    return connectPromiseRef.current;
  }, [
    clearPlaybackSources,
    clearReadyTimeout,
    enqueueAssistantAudio,
    handleSocketError,
    getIdleLikeStatus,
    onAssistantResponseEnd,
    onAssistantResponseStart,
    onAssistantTranscriptChange,
    onAssistantTranscriptDone,
    onUserTranscript,
    sendSessionConfig,
  ]);

  const connectSession = useCallback(async () => {
    if (statusRef.current === 'connecting' || statusRef.current === 'authorizing') return;

    setStatus('connecting');
    setErrorMessage('');
    isManualDisconnectRef.current = false;

    try {
      await connect();
      setStatus('authorizing');
      await openMicrophone();
      if ((inputContextRef.current?.state === 'running' && hasInputFramesRef.current) || !mediaStreamRef.current) {
        setStatus(getIdleLikeStatus());
      } else {
        setStatus('authorizing');
      }
    } catch (error) {
      await closeMicrophone();
      handleSocketError(normalizeCallError(error));
      throw error;
    }
  }, [closeMicrophone, connect, getIdleLikeStatus, handleSocketError, openMicrophone]);

  useEffect(() => {
    if (wsReadyRef.current) {
      sendSessionConfig();
    }
  }, [instructions, voice, enableSearch, sendSessionConfig]);

  useEffect(() => {
    if (!connectOnMount) return;

    void connectSession().catch(() => {});
  }, [connectOnMount, connectSession]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isConnected) return;

    const handleWake = () => {
      void wakeAudioContexts().then((ready) => {
        if (ready && mediaStreamRef.current && hasInputFramesRef.current) {
          setStatus(getIdleLikeStatus());
        }
      });
    };

    window.addEventListener('pointerdown', handleWake);
    window.addEventListener('keydown', handleWake);
    window.addEventListener('touchstart', handleWake, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleWake);
      window.removeEventListener('keydown', handleWake);
      window.removeEventListener('touchstart', handleWake);
    };
  }, [getIdleLikeStatus, isConnected, wakeAudioContexts]);

  const startRecording = useCallback(async () => {
    if (statusRef.current === 'connecting') return;

    if (statusRef.current === 'authorizing') {
      const ready = await wakeAudioContexts();
      if (ready && mediaStreamRef.current) {
        syncMuteState(false);
        setStatus(getIdleLikeStatus());
      }
      return;
    }

    if (!isConnected || !wsReadyRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await connectSession();
      return;
    }

    try {
      await openMicrophone();
      if ((inputContextRef.current?.state === 'running' && hasInputFramesRef.current) || !mediaStreamRef.current) {
        setStatus(getIdleLikeStatus());
      } else {
        setStatus('authorizing');
      }
    } catch (error) {
      await closeMicrophone();
      handleSocketError(normalizeCallError(error));
    }
  }, [closeMicrophone, connectSession, getIdleLikeStatus, handleSocketError, isConnected, openMicrophone, syncMuteState, wakeAudioContexts]);

  const stopRecording = useCallback(async () => {
    if (!mediaStreamRef.current && isMutedRef.current) return;

    await closeMicrophone();
    syncMuteState(true);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'clear' }));
    }

    setStatus(isConnected ? 'muted' : 'idle');
  }, [closeMicrophone, isConnected, syncMuteState]);

  const disconnectSession = useCallback(async () => {
    isManualDisconnectRef.current = true;
    clearReadyTimeout();
    await closeMicrophone();
    clearPlaybackSources();
    syncMuteState(false);
    setCapturedText('');
    setAssistantText('');

    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      wsRef.current.close(1000, 'manual disconnect');
    }

    wsRef.current = null;
    wsReadyRef.current = false;
    setIsConnected(false);
    setStatus('idle');
    setErrorMessage('');
  }, [clearPlaybackSources, clearReadyTimeout, closeMicrophone, syncMuteState]);

  const cancelResponse = useCallback(() => {
    clearPlaybackSources();
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'cancel' }));
    }
    setStatus(getIdleLikeStatus());
  }, [clearPlaybackSources, getIdleLikeStatus]);

  const toggleRecording = useCallback(async () => {
    if (statusRef.current === 'connecting') {
      return;
    }

    if (!isConnected || isMutedRef.current) {
      await startRecording();
      return;
    }

    if (!isMutedRef.current) {
      await stopRecording();
      return;
    }
  }, [isConnected, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      void closeMicrophone();
      clearReadyTimeout();
      clearPlaybackSources();
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'component unmounted');
      }
      wsRef.current = null;
      wsReadyRef.current = false;
    };
  }, [clearPlaybackSources, clearReadyTimeout, closeMicrophone]);

  return {
    status,
    isConnected,
    isMuted,
    capturedText,
    assistantText,
    errorMessage,
    connectSession,
    disconnectSession,
    startRecording,
    stopRecording,
    toggleRecording,
    cancelResponse,
  };
}

export default useOmniRealtimeCall;
