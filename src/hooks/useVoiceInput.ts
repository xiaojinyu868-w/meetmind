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

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: {
    transcript: string;
  };
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

const getSpeechRecognitionConstructor = (): BrowserSpeechRecognitionConstructor | null => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

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
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const usingNativeRecognitionRef = useRef(false);
  const isRecordingRef = useRef(false);
  const interimTextRef = useRef('');
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<VoiceInputStatus>('idle');

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

  const resetState = useCallback(() => {
    isRecordingRef.current = false;
    usingNativeRecognitionRef.current = false;
    setInterimText('');
    setStatus('idle');
  }, []);

  const cleanupTransport = useCallback(() => {
    clearConnectTimeout();

    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort?.();
      } catch {
        // ignore cleanup errors
      }
      recognitionRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (asrClientRef.current) {
      asrClientRef.current.stop().catch(() => {});
      asrClientRef.current = null;
    }
  }, [clearConnectTimeout]);

  useEffect(() => {
    return () => {
      cleanupTransport();
    };
  }, [cleanupTransport]);

  const resampleTo16kHz = useCallback((inputBuffer: Float32Array, inputSampleRate: number): Int16Array => {
    const ratio = inputSampleRate / 16000;
    const outputLength = Math.round(inputBuffer.length / ratio);
    const output = new Int16Array(outputLength);

    for (let index = 0; index < outputLength; index += 1) {
      const sourceIndex = Math.min(Math.round(index * ratio), inputBuffer.length - 1);
      const sample = Math.max(-1, Math.min(1, inputBuffer[sourceIndex]));
      output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return output;
  }, []);

  const stopNativeRecognition = useCallback(async () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    clearConnectTimeout();

    if (interimTextRef.current.trim()) {
      onTranscript(interimTextRef.current.trim());
    }

    try {
      recognition.stop();
    } catch {
      recognition.abort?.();
    }

    recognitionRef.current = null;
    resetState();
  }, [clearConnectTimeout, onTranscript, resetState]);

  const startNativeRecognition = useCallback(async (): Promise<boolean> => {
    const RecognitionCtor = getSpeechRecognitionConstructor();
    if (!RecognitionCtor) return false;

    try {
      const recognition = new RecognitionCtor();
      usingNativeRecognitionRef.current = true;
      recognitionRef.current = recognition;

      recognition.lang = 'zh-CN';
      recognition.interimResults = true;
      recognition.continuous = true;

      recognition.onstart = () => {
        clearConnectTimeout();
        setStatus('recording');
      };

      recognition.onresult = (event) => {
        let finalText = '';
        let nextInterim = '';

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result?.[0]?.transcript?.trim() || '';
          if (!transcript) continue;

          if (result.isFinal) {
            finalText += `${transcript} `;
          } else {
            nextInterim += transcript;
          }
        }

        if (finalText.trim()) {
          onTranscript(finalText.trim());
        }

        const normalizedInterim = nextInterim.trim();
        setInterimText(normalizedInterim);
        onInterim?.(normalizedInterim);
      };

      recognition.onerror = (event) => {
        const errorCode = event.error || '';
        const message =
          errorCode === 'not-allowed'
            ? '请先允许麦克风权限，再开始语音听写。'
            : errorCode === 'no-speech'
              ? '没有听到语音，再试一次。'
              : '语音听写暂时不可用，请稍后重试。';

        onError?.(message);
        cleanupTransport();
        setStatus('error');
        window.setTimeout(() => {
          if (statusRef.current === 'error') {
            setStatus('idle');
          }
        }, 1600);
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        if (statusRef.current === 'recording' || statusRef.current === 'connecting') {
          resetState();
        }
      };

      setStatus('connecting');
      setInterimText('');

      connectTimeoutRef.current = setTimeout(() => {
        if (statusRef.current === 'connecting') {
          onError?.('语音听写启动超时，请再试一次。');
          cleanupTransport();
          setStatus('error');
          window.setTimeout(() => {
            if (statusRef.current === 'error') {
              setStatus('idle');
            }
          }, 1600);
        }
      }, 1800);

      isRecordingRef.current = true;
      recognition.start();
      return true;
    } catch (error) {
      console.warn('[VoiceInput] Native recognition unavailable, fallback to ASR:', error);
      recognitionRef.current = null;
      usingNativeRecognitionRef.current = false;
      clearConnectTimeout();
      return false;
    }
  }, [cleanupTransport, clearConnectTimeout, onError, onInterim, onTranscript, resetState]);

  const startDashScopeRecognition = useCallback(async () => {
    setStatus('connecting');
    setInterimText('');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 16000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    mediaStreamRef.current = stream;

    const asrClient = new DashScopeASRClient('', {
      onSentence: (sentence) => {
        if (sentence.text && sentence.isFinal) {
          onTranscript(sentence.text);
          setInterimText('');
        }
      },
      onInterim: (interim) => {
        const text = interim?.text || '';
        setInterimText(text);
        onInterim?.(text);
      },
      onError: (error) => {
        console.error('[VoiceInput] ASR error:', error);
        onError?.(error);
        cleanupTransport();
        setStatus('error');
        window.setTimeout(() => {
          if (statusRef.current === 'error') {
            setStatus('idle');
          }
        }, 2000);
      },
      onStatusChange: (nextStatus) => {
        if (nextStatus === 'transcribing') {
          clearConnectTimeout();
          setStatus('recording');
        }
      },
    });
    asrClientRef.current = asrClient;

    connectTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'connecting') {
        onError?.('语音听写连接超时，请检查网络后重试。');
        cleanupTransport();
        setStatus('error');
        window.setTimeout(() => {
          if (statusRef.current === 'error') {
            setStatus('idle');
          }
        }, 2000);
      }
    }, 8000);

    const connected = await asrClient.start();
    if (!connected) {
      throw new Error('语音识别连接失败，请重试。');
    }

    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;
    await audioContext.resume().catch(() => {});

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    const browserSampleRate = audioContext.sampleRate;

    processor.onaudioprocess = (event) => {
      if (!isRecordingRef.current) return;

      const inputData = event.inputBuffer.getChannelData(0);
      let pcm16: Int16Array;

      if (Math.abs(browserSampleRate - 16000) < 100) {
        pcm16 = new Int16Array(inputData.length);
        for (let index = 0; index < inputData.length; index += 1) {
          const sample = Math.max(-1, Math.min(1, inputData[index]));
          pcm16[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
      } else {
        pcm16 = resampleTo16kHz(inputData, browserSampleRate);
      }

      asrClient.sendAudio(pcm16.buffer as ArrayBuffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    isRecordingRef.current = true;
  }, [cleanupTransport, clearConnectTimeout, onError, onInterim, onTranscript, resampleTo16kHz]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || statusRef.current === 'connecting') return;

    try {
      const usedNative = await startNativeRecognition();
      if (usedNative) return;

      await startDashScopeRecognition();
    } catch (error) {
      console.error('[VoiceInput] Start failed:', error);
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '请先允许麦克风权限，再开始语音听写。'
          : error instanceof Error && error.message
            ? error.message
            : '启动语音听写失败，请稍后再试。';

      onError?.(message);
      cleanupTransport();
      setStatus('error');
      window.setTimeout(() => {
        if (statusRef.current === 'error') {
          setStatus('idle');
        }
      }, 2000);
    }
  }, [cleanupTransport, onError, startDashScopeRecognition, startNativeRecognition]);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current && statusRef.current !== 'connecting') return;

    if (usingNativeRecognitionRef.current) {
      await stopNativeRecognition();
      return;
    }

    isRecordingRef.current = false;

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (asrClientRef.current) {
      await asrClientRef.current.stop().catch(() => {});
      asrClientRef.current = null;
    }

    if (interimTextRef.current.trim()) {
      onTranscript(interimTextRef.current.trim());
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    clearConnectTimeout();
    resetState();
  }, [clearConnectTimeout, onTranscript, resetState, stopNativeRecognition]);

  const toggleRecording = useCallback(async () => {
    if (isRecordingRef.current || statusRef.current === 'connecting') {
      await stopRecording();
      return;
    }

    await startRecording();
  }, [startRecording, stopRecording]);

  return {
    status,
    isRecording: status === 'recording' || status === 'connecting',
    interimText,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}

export default useVoiceInput;

