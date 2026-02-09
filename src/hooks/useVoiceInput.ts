'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';

export type VoiceInputStatus = 'idle' | 'connecting' | 'recording' | 'error';

interface UseVoiceInputOptions {
  /** 识别到文字时的回调，文字会追加到现有输入 */
  onTranscript: (text: string) => void;
  /** 中间结果回调（可选，用于显示实时识别中的文字） */
  onInterim?: (text: string) => void;
  /** 错误回调 */
  onError?: (error: string) => void;
}

interface UseVoiceInputReturn {
  /** 当前状态 */
  status: VoiceInputStatus;
  /** 是否正在录音 */
  isRecording: boolean;
  /** 实时中间结果文字 */
  interimText: string;
  /** 开始录音 */
  startRecording: () => Promise<void>;
  /** 停止录音 */
  stopRecording: () => Promise<void>;
  /** 切换录音状态 */
  toggleRecording: () => Promise<void>;
}

/**
 * 语音输入 Hook
 * 
 * 使用麦克风录音 + 阿里云 DashScope 实时 ASR 流式转文字
 * 识别结果通过 onTranscript 回调追加到输入框
 * 
 * 优化点：
 * - 停止时自动提交残余中间结果
 * - 错误后自动恢复到 idle 状态
 * - 连接超时处理（8s）
 */
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
  const isRecordingRef = useRef(false);
  const interimTextRef = useRef('');
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 同步 interimText ref
  useEffect(() => {
    interimTextRef.current = interimText;
  }, [interimText]);

  // 清理资源
  const cleanup = useCallback(() => {
    isRecordingRef.current = false;

    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
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
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (asrClientRef.current) {
      asrClientRef.current.stop().catch(() => {});
      asrClientRef.current = null;
    }

    setInterimText('');
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => { cleanup(); };
  }, [cleanup]);

  /**
   * PCM 重采样：浏览器采样率 -> 16kHz
   */
  const resampleTo16kHz = useCallback((inputBuffer: Float32Array, inputSampleRate: number): Int16Array => {
    const ratio = inputSampleRate / 16000;
    const outputLength = Math.round(inputBuffer.length / ratio);
    const output = new Int16Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.min(Math.round(i * ratio), inputBuffer.length - 1);
      const sample = Math.max(-1, Math.min(1, inputBuffer[srcIndex]));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    return output;
  }, []);

  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;

    try {
      setStatus('connecting');
      setInterimText('');

      // 1. 获取麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 16000 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;

      // 2. 创建 ASR 客户端
      const asrClient = new DashScopeASRClient('', {
        onSentence: (sentence) => {
          if (sentence.text && sentence.isFinal) {
            onTranscript(sentence.text);
            setInterimText('');
          }
        },
        onInterim: (text) => {
          setInterimText(text);
          onInterim?.(text);
        },
        onError: (error) => {
          console.error('[VoiceInput] ASR error:', error);
          onError?.(error);
          setStatus('error');
          // 错误后自动恢复到 idle
          setTimeout(() => {
            setStatus(prev => prev === 'error' ? 'idle' : prev);
          }, 2000);
          cleanup();
        },
        onStatusChange: (s) => {
          if (s === 'transcribing') {
            setStatus('recording');
            // 连接成功，清除超时计时器
            if (connectTimeoutRef.current) {
              clearTimeout(connectTimeoutRef.current);
              connectTimeoutRef.current = null;
            }
          }
        },
      });
      asrClientRef.current = asrClient;

      // 连接超时处理（8s）
      connectTimeoutRef.current = setTimeout(() => {
        if (status === 'connecting') {
          onError?.('连接超时，请检查网络后重试');
          setStatus('error');
          setTimeout(() => setStatus(prev => prev === 'error' ? 'idle' : prev), 2000);
          cleanup();
        }
      }, 8000);

      // 3. 连接 WebSocket
      const connected = await asrClient.start();
      if (!connected) {
        onError?.('语音识别连接失败，请重试');
        setStatus('error');
        setTimeout(() => setStatus(prev => prev === 'error' ? 'idle' : prev), 2000);
        cleanup();
        return;
      }

      // 4. 创建 AudioContext 采集 PCM
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const browserSampleRate = audioContext.sampleRate;

      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        const inputData = e.inputBuffer.getChannelData(0);

        let pcm16: Int16Array;
        if (Math.abs(browserSampleRate - 16000) < 100) {
          pcm16 = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const s = Math.max(-1, Math.min(1, inputData[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
        } else {
          pcm16 = resampleTo16kHz(inputData, browserSampleRate);
        }

        asrClient.sendAudio(pcm16.buffer as ArrayBuffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      isRecordingRef.current = true;
      setStatus('recording');

    } catch (error) {
      console.error('[VoiceInput] Start failed:', error);
      const msg = error instanceof DOMException && error.name === 'NotAllowedError'
        ? '请允许麦克风权限后重试'
        : '启动录音失败';
      onError?.(msg);
      setStatus('error');
      setTimeout(() => setStatus(prev => prev === 'error' ? 'idle' : prev), 2000);
      cleanup();
    }
  }, [onTranscript, onInterim, onError, cleanup, resampleTo16kHz, status]);

  const stopRecording = useCallback(async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;

    // 先断开音频处理
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    // 停止 ASR（会等待服务端处理完剩余音频）
    if (asrClientRef.current) {
      await asrClientRef.current.stop();
      asrClientRef.current = null;
    }

    // 如果还有未提交的中间结果，作为最终结果提交
    if (interimTextRef.current.trim()) {
      onTranscript(interimTextRef.current.trim());
    }

    // 清理媒体流和 AudioContext
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      await audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    setInterimText('');
    setStatus('idle');
  }, [onTranscript]);

  const toggleRecording = useCallback(async () => {
    if (isRecordingRef.current) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [startRecording, stopRecording]);

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
