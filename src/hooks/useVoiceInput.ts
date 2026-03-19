'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';

export type VoiceInputStatus = 'idle' | 'connecting' | 'recording' | 'error';

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  status: VoiceInputStatus;
  isRecording: boolean;
  interimText: string;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleRecording: () => Promise<void>;
}

export function shouldPreferBufferedVoiceInput(env: {
  userAgent?: string;
  maxTouchPoints?: number;
} = {}): boolean {
  const ua = String(env.userAgent || '').toLowerCase();
  const maxTouchPoints = Number(env.maxTouchPoints || 0);
  const isWechat = /micromessenger/.test(ua);
  const isMobile = /(iphone|ipad|ipod|android|mobile)/.test(ua) || maxTouchPoints > 1;
  return isWechat || isMobile;
}

function normalizeVoiceInputError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '请先允许麦克风权限，再开始语音听写。';
    if (error.name === 'NotFoundError') return '没有检测到可用的麦克风设备。';
    if (error.name === 'NotReadableError') return '麦克风当前被别的应用占用，请稍后再试。';
  }

  if (error instanceof Error) {
    const message = (error.message || '').trim();
    if (!message) return '语音听写暂时不可用，请稍后重试。';
    if (/所有连接端口均失败|websocket 连接错误|连接失败/i.test(message)) {
      return '语音听写连接失败，请检查网络后再试。';
    }
    if (/连接超时/i.test(message)) {
      return '语音听写启动超时，请再试一次。';
    }
    return message;
  }

  return '语音听写暂时不可用，请稍后重试。';
}

function resampleTo16kHz(inputBuffer: Float32Array, inputSampleRate: number): Int16Array {
  const outputSampleRate = 16000;
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(inputBuffer.length / ratio);
  const output = new Int16Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const srcIndex = Math.min(Math.round(i * ratio), inputBuffer.length - 1);
    const sample = Math.max(-1, Math.min(1, inputBuffer[srcIndex]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output;
}

export function useVoiceInput({
  onTranscript,
  onInterim,
  onError,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [interimText, setInterimText] = useState('');

  const asrClientRef = useRef<DashScopeASRClient | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const isRecordingRef = useRef(false);
  const interimTextRef = useRef('');
  const statusRef = useRef<VoiceInputStatus>('idle');
  const connectTimeoutRef = useRef<number | null>(null);
  const autoResetErrorTimerRef = useRef<number | null>(null);

  useEffect(() => {
    interimTextRef.current = interimText;
  }, [interimText]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearConnectTimeout = useCallback(() => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const clearAutoResetErrorTimer = useCallback(() => {
    if (autoResetErrorTimerRef.current) {
      clearTimeout(autoResetErrorTimerRef.current);
      autoResetErrorTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(async () => {
    isRecordingRef.current = false;
    clearConnectTimeout();

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        // noop
      }
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (asrClientRef.current) {
      try {
        await asrClientRef.current.stop();
      } catch {
        // noop
      }
      asrClientRef.current = null;
    }

    setInterimText('');
    interimTextRef.current = '';
    onInterim?.('');
  }, [clearConnectTimeout, onInterim]);

  const recoverFromError = useCallback((message: string) => {
    onError?.(message);
    clearAutoResetErrorTimer();
    setStatus('error');
    autoResetErrorTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === 'error') {
        setStatus('idle');
      }
    }, 2200);
  }, [clearAutoResetErrorTimer, onError]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || statusRef.current === 'connecting') {
      return;
    }

    clearAutoResetErrorTimer();
    setStatus('connecting');
    setInterimText('');
    interimTextRef.current = '';
    onInterim?.('');

    try {
      if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        throw new Error('当前环境暂不支持语音听写，请换一个浏览器试试。');
      }
      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        throw new Error('当前环境暂不支持语音听写，请换一个浏览器试试。');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const asrClient = new DashScopeASRClient('', {
        onSentence: (sentence) => {
          if (!sentence.text || !sentence.isFinal) return;
          onTranscript(sentence.text);
          setInterimText('');
          interimTextRef.current = '';
          onInterim?.('');
        },
        onInterim: (interim) => {
          const text = (interim?.text || '').trim();
          setInterimText(text);
          interimTextRef.current = text;
          onInterim?.(text);
        },
        onError: (errorMessage) => {
          const message = normalizeVoiceInputError(new Error(errorMessage));
          void cleanup().finally(() => {
            recoverFromError(message);
          });
        },
        onStatusChange: (nextStatus) => {
          if (nextStatus === 'transcribing') {
            clearConnectTimeout();
            setStatus('recording');
          }
        },
      });
      asrClientRef.current = asrClient;

      connectTimeoutRef.current = window.setTimeout(() => {
        if (statusRef.current === 'connecting') {
          void cleanup().finally(() => {
            recoverFromError('语音听写启动超时，请再试一次。');
          });
        }
      }, 9000);

      const connected = await asrClient.start();
      if (!connected) {
        throw new Error('语音识别连接失败，请重试');
      }

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const browserSampleRate = audioContext.sampleRate;
      processor.onaudioprocess = (event) => {
        if (!isRecordingRef.current) return;
        const inputData = event.inputBuffer.getChannelData(0);
        const pcm16 = Math.abs(browserSampleRate - 16000) < 100
          ? Int16Array.from(inputData, (sample) => {
              const normalized = Math.max(-1, Math.min(1, sample));
              return normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
            })
          : resampleTo16kHz(inputData, browserSampleRate);
        asrClient.sendAudio(pcm16.buffer as ArrayBuffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      isRecordingRef.current = true;
      setStatus('recording');
    } catch (error) {
      const message = normalizeVoiceInputError(error);
      await cleanup();
      recoverFromError(message);
    }
  }, [cleanup, clearAutoResetErrorTimer, clearConnectTimeout, onInterim, onTranscript, recoverFromError]);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current && statusRef.current !== 'connecting') {
      return;
    }

    isRecordingRef.current = false;
    clearConnectTimeout();

    const pendingInterim = interimTextRef.current.trim();
    await cleanup();

    if (pendingInterim) {
      onTranscript(pendingInterim);
    }

    clearAutoResetErrorTimer();
    setStatus('idle');
  }, [cleanup, clearAutoResetErrorTimer, clearConnectTimeout, onTranscript]);

  const toggleRecording = useCallback(async () => {
    if (isRecordingRef.current || statusRef.current === 'connecting') {
      await stopRecording();
      return;
    }

    await startRecording();
  }, [startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      clearConnectTimeout();
      clearAutoResetErrorTimer();
      void cleanup();
    };
  }, [cleanup, clearAutoResetErrorTimer, clearConnectTimeout]);

  return {
    status,
    isRecording: status === 'recording',
    interimText,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}

export default useVoiceInput;
