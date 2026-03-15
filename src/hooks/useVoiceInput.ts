'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

const getPreferredRecordingMimeType = (): string => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'audio/webm';
  }

  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const supported = candidates.find((type) => MediaRecorder.isTypeSupported(type));
  return supported || 'audio/webm';
};

const getFileExtensionFromMimeType = (mimeType: string): string => {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
};

export function useVoiceInput({
  onTranscript,
  onInterim,
  onError,
}: UseVoiceInputOptions): UseVoiceInputReturn {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [interimText, setInterimText] = useState('');

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const bufferedMimeTypeRef = useRef('audio/webm');
  const usingNativeRecognitionRef = useRef(false);
  const usingBufferedFallbackRef = useRef(false);
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

  const releaseMediaStream = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    isRecordingRef.current = false;
    usingNativeRecognitionRef.current = false;
    usingBufferedFallbackRef.current = false;
    recordedChunksRef.current = [];
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

    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // ignore cleanup errors
      }
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onerror = null;
      mediaRecorderRef.current.onstart = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current = null;
    }

    releaseMediaStream();
    recordedChunksRef.current = [];
  }, [clearConnectTimeout, releaseMediaStream]);

  useEffect(() => {
    return () => {
      cleanupTransport();
    };
  }, [cleanupTransport]);

  const setTemporaryError = useCallback(
    (message: string, delayMs = 1800) => {
      onError?.(message);
      cleanupTransport();
      setStatus('error');
      window.setTimeout(() => {
        if (statusRef.current === 'error') {
          resetState();
        }
      }, delayMs);
    },
    [cleanupTransport, onError, resetState]
  );

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
        if (errorCode === 'aborted') return;

        const message =
          errorCode === 'not-allowed'
            ? '请先允许麦克风权限，再开始语音听写。'
            : errorCode === 'no-speech'
              ? '没有听到语音，再试一次。'
              : '语音听写暂时不可用，请稍后重试。';

        setTemporaryError(message, 1600);
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
          setTemporaryError('语音听写启动超时，请再试一次。', 1600);
        }
      }, 1800);

      isRecordingRef.current = true;
      recognition.start();
      return true;
    } catch (error) {
      console.warn('[VoiceInput] Native recognition unavailable, fallback to buffered recording:', error);
      recognitionRef.current = null;
      usingNativeRecognitionRef.current = false;
      clearConnectTimeout();
      return false;
    }
  }, [clearConnectTimeout, onInterim, onTranscript, resetState, setTemporaryError]);

  const transcribeBufferedAudio = useCallback(
    async (audioBlob: Blob) => {
      if (!audioBlob.size) {
        throw new Error('没有录到有效语音，请再试一次。');
      }

      const mimeType = bufferedMimeTypeRef.current || audioBlob.type || 'audio/webm';
      const extension = getFileExtensionFromMimeType(mimeType);
      const audioFile = new File([audioBlob], `voice-input.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      });

      const formData = new FormData();
      formData.append('audio', audioFile);
      formData.append('language', 'zh');

      const response = await fetch('/api/transcribe-turbo', {
        method: 'POST',
        body: formData,
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        sentences?: Array<{ text?: string }>;
      };

      if (!response.ok) {
        throw new Error(payload.error || payload.detail || '语音听写暂时不可用，请稍后重试。');
      }

      const transcript = (payload.sentences || [])
        .map((sentence) => sentence.text?.trim() || '')
        .filter(Boolean)
        .join(' ')
        .trim();

      if (!transcript) {
        throw new Error('没有听清这段话，再试一次。');
      }

      onTranscript(transcript);
    },
    [onTranscript]
  );

  const startBufferedRecognition = useCallback(async () => {
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前设备暂不支持语音听写。');
    }

    setStatus('connecting');
    setInterimText('');
    onInterim?.('');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    mediaStreamRef.current = stream;

    const mimeType = getPreferredRecordingMimeType();
    bufferedMimeTypeRef.current = mimeType;
    recordedChunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    usingBufferedFallbackRef.current = true;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      setTemporaryError('语音听写暂时不可用，请稍后重试。');
    };

    recorder.onstart = () => {
      clearConnectTimeout();
      setStatus('recording');
      setInterimText('正在听你说…');
      onInterim?.('正在听你说…');
    };

    recorder.onstop = () => {
      mediaRecorderRef.current = null;
      releaseMediaStream();
    };

    connectTimeoutRef.current = setTimeout(() => {
      if (statusRef.current === 'connecting') {
        setTemporaryError('语音听写启动超时，请再试一次。', 1600);
      }
    }, 2500);

    isRecordingRef.current = true;
    recorder.start();
  }, [clearConnectTimeout, onInterim, releaseMediaStream, setTemporaryError]);

  const stopBufferedRecognition = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) {
      resetState();
      return;
    }

    clearConnectTimeout();
    isRecordingRef.current = false;
    setInterimText('');
    onInterim?.('');

    const stopPromise = new Promise<void>((resolve) => {
      const handleStop = () => {
        recorder.removeEventListener('stop', handleStop);
        resolve();
      };
      recorder.addEventListener('stop', handleStop);
    });

    try {
      recorder.stop();
    } catch {
      cleanupTransport();
      resetState();
      throw new Error('语音听写暂时不可用，请稍后重试。');
    }

    await stopPromise;

    const audioBlob = new Blob(recordedChunksRef.current, { type: bufferedMimeTypeRef.current || 'audio/webm' });
    recordedChunksRef.current = [];
    resetState();

    try {
      await transcribeBufferedAudio(audioBlob);
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : '语音听写暂时不可用，请稍后重试。';
      onError?.(message);
      setStatus('error');
      window.setTimeout(() => {
        if (statusRef.current === 'error') {
          resetState();
        }
      }, 1800);
    }
  }, [clearConnectTimeout, cleanupTransport, onError, onInterim, resetState, transcribeBufferedAudio]);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current || statusRef.current === 'connecting') return;

    try {
      const usedNative = await startNativeRecognition();
      if (usedNative) return;

      await startBufferedRecognition();
    } catch (error) {
      console.error('[VoiceInput] Start failed:', error);
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? '请先允许麦克风权限，再开始语音听写。'
          : error instanceof Error && error.message
            ? error.message
            : '启动语音听写失败，请稍后再试。';

      setTemporaryError(message);
    }
  }, [setTemporaryError, startBufferedRecognition, startNativeRecognition]);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current && statusRef.current !== 'connecting') return;

    if (usingNativeRecognitionRef.current) {
      await stopNativeRecognition();
      return;
    }

    if (usingBufferedFallbackRef.current) {
      await stopBufferedRecognition();
      return;
    }

    resetState();
  }, [resetState, stopBufferedRecognition, stopNativeRecognition]);

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
