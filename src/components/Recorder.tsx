'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TranscriptSegment } from '@/types';
import { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';

interface RecorderProps {
  onRecordingStart?: (sessionId: string) => void;
  onRecordingStop?: (audioBlob?: Blob) => void;
  onTranscriptUpdate?: (segments: TranscriptSegment[]) => void;
  onAnchorMark?: (timestamp: number) => void;
  onTranscribing?: (isTranscribing: boolean) => void;
  disabled?: boolean;
}

type RecorderStatus = 'idle' | 'recording' | 'paused' | 'stopped' | 'transcribing';
type ServiceStatus = 'checking' | 'available' | 'unavailable' | 'asr-ready';
type TranscribeMode = 'batch' | 'streaming';  // batch=非流式, streaming=流式

export function Recorder({
  onRecordingStart,
  onRecordingStop,
  onTranscriptUpdate,
  onAnchorMark,
  onTranscribing,
  disabled = false,
}: RecorderProps) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('checking');
  const [transcribeProgress, setTranscribeProgress] = useState<string>('');
  const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>('streaming');  // 默认流式优先
  const [streamingAvailable, setStreamingAvailable] = useState(true);  // 启用流式
  const [apiKey, setApiKey] = useState<string>('');
  const [wsModel, setWsModel] = useState<string>('qwen-asr-realtime-v1');
  const [wsSampleRate, setWsSampleRate] = useState<number>(16000);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string>('');
  const lastAnchorTimeRef = useRef<number>(0);
  const audioChunksRef = useRef<Blob[]>([]);  // 存储录音数据
  const asrClientRef = useRef<DashScopeASRClient | null>(null);  // 百炼流式转录客户端
  const transcriptRef = useRef<TranscriptSegment[]>([]);  // 用于流式更新
  const pcmProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // 获取 API Key 并检查服务状态
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
          console.log('[Recorder] ASR service ready (streaming preferred)', config.model || 'default');
        } else {
          setStreamingAvailable(false);
          setServiceStatus('unavailable');
          console.error('[Recorder] Failed to get ASR config');
        }
      } catch (err) {
        setStreamingAvailable(false);
        setServiceStatus('unavailable');
        console.error('[Recorder] Error fetching ASR config:', err);
      }
    };
    fetchConfig();
  }, []);

  // 格式化时间
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

  // 开始录音
  const startRecording = async () => {
    try {
      setError(null);
      audioChunksRef.current = [];  // 清空之前的录音数据
      setTranscript([]);
      transcriptRef.current = [];
      setInterimText('');

      // 请求麦克风权限
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 创建音频分析器
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      // 音量监测
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const checkLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setLevel(average / 255);
        animationIdRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();

      // 生成会话 ID
      sessionIdRef.current = `session-${Date.now()}`;

      // 流式模式：初始化百炼 ASR 客户端
      if (transcribeMode === 'streaming' && streamingAvailable && apiKey) {
        asrClientRef.current = new DashScopeASRClient(apiKey, {
          onSentence: (sentence) => {
            const segment: TranscriptSegment = {
              id: sentence.id,
              text: sentence.text,
              startMs: sentence.beginTime,
              endMs: sentence.endTime || sentence.beginTime,
              confidence: 0.95,
              isFinal: true,
            };
            transcriptRef.current = [...transcriptRef.current, segment];
            setTranscript(transcriptRef.current);
            onTranscriptUpdate?.(transcriptRef.current);
          },
          onInterim: (text) => {
            setInterimText(text);
          },
          onError: (err) => {
            console.error('[Streaming] Error:', err);
            setError(err);
          },
          onStatusChange: (newStatus) => {
            console.log('[Streaming] Status:', newStatus);
            if (newStatus === 'transcribing') {
              setServiceStatus('available');
            }
          },
        }, {
          model: wsModel,
          sampleRate: wsSampleRate,
          format: 'pcm',
        });
        
        // 启动流式转录
        const started = await asrClientRef.current.start();
        if (!started) {
          console.warn('[Recorder] Failed to start streaming ASR, falling back to batch mode');
          asrClientRef.current = null;
        } else {
          // 创建 PCM 处理器发送音频数据
          const bufferSize = 4096;
          pcmProcessorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
          
          pcmProcessorRef.current.onaudioprocess = (e) => {
            if (asrClientRef.current?.isConnected()) {
              const inputData = e.inputBuffer.getChannelData(0);
              // 转换为 16-bit PCM
              const pcmData = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) {
                pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
              }
              asrClientRef.current.sendAudio(pcmData.buffer);
            }
          };
          
          source.connect(pcmProcessorRef.current);
          pcmProcessorRef.current.connect(audioContextRef.current.destination);
        }
      }

      // 创建 MediaRecorder（用于保存完整录音）
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 64000,
      });

      // 处理音频数据（保存用于非流式转录或备份）
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // 每秒保存一次数据
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;

      // 开始计时
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      setStatus('recording');
      onRecordingStart?.(sessionIdRef.current);

    } catch (err) {
      setError(err instanceof Error ? err.message : '录音启动失败');
    }
  };

  // 暂停录音
  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setStatus('paused');
    }
  };

  // 继续录音
  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      const pausedTime = elapsedMs;
      startTimeRef.current = Date.now() - pausedTime;
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);
      setStatus('recording');
    }
  };

  // 停止录音
  const stopRecording = async () => {
    // 停止动画
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }

    // 停止计时
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // 停止 PCM 处理器
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.disconnect();
      pcmProcessorRef.current = null;
    }

    // 停止录音
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }

    // 关闭音频上下文
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // 停止流式转录
    if (asrClientRef.current) {
      await asrClientRef.current.stop();
      asrClientRef.current = null;
    }

    // 合并音频数据
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    console.log('[Recorder] Audio blob size:', audioBlob.size);

    mediaRecorderRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setInterimText('');

    // 非流式模式：使用 qwen-asr-flash 进行转录
    if (transcribeMode === 'batch' && audioBlob.size > 0) {
      await transcribeWithQwenASR(audioBlob);
    } else {
      // 流式模式已经实时转录完成
      if (transcribeMode === 'streaming' && transcriptRef.current.length > 0) {
        setTranscribeProgress(`流式转录完成，共 ${transcriptRef.current.length} 个句子`);
        onTranscriptUpdate?.(transcriptRef.current);
      }
      setStatus('stopped');
      onRecordingStop?.(audioBlob);
    }
  };

  // 使用 qwen-asr-flash 进行非流式转录
  const transcribeWithQwenASR = async (audioBlob: Blob) => {
    setStatus('transcribing');
    setTranscribeProgress('正在转录音频...');
    onTranscribing?.(true);

    console.log('[Recorder] Starting transcription with Qwen ASR...');
    console.log('[Recorder] Audio blob:', { size: audioBlob.size, type: audioBlob.type });

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      console.log('[Recorder] Sending request to /api/transcribe...');
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });

      console.log('[Recorder] Response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[Recorder] Transcription API error:', errorData);
        throw new Error(errorData.error || '转录失败');
      }

      const data = await response.json();
      console.log('[Recorder] Transcription result:', JSON.stringify(data, null, 2));

      if (data.success && data.segments) {
        // 更新转录结果
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
        onTranscriptUpdate?.(segments);
        setTranscribeProgress(`转录完成，共 ${segments.length} 个句子`);
      } else {
        setTranscribeProgress('转录完成，但未获取到文本');
      }
    } catch (err) {
      console.error('[Recorder] Transcription error:', err);
      setError(err instanceof Error ? err.message : '转录失败');
      setTranscribeProgress('');
    } finally {
      onTranscribing?.(false);
      setStatus('stopped');
      onRecordingStop?.(audioBlob);
    }
  };

  // 标记断点
  const markAnchor = useCallback(() => {
    if (status !== 'recording') return;
    
    const timestamp = elapsedMs;
    lastAnchorTimeRef.current = timestamp;
    onAnchorMark?.(timestamp);
    setCanUndo(true);

    // 5秒后取消撤销能力
    setTimeout(() => {
      setCanUndo(false);
    }, 5000);
  }, [status, elapsedMs, onAnchorMark]);

  // 清理
  useEffect(() => {
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (pcmProcessorRef.current) {
        pcmProcessorRef.current.disconnect();
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (asrClientRef.current) {
        asrClientRef.current.stop();
      }
    };
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      {/* 服务状态指示器 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            serviceStatus === 'checking' ? 'bg-yellow-500 animate-pulse' :
            serviceStatus === 'available' ? 'bg-green-500' :
            serviceStatus === 'asr-ready' ? 'bg-blue-500' :
            'bg-gray-400'
          }`} />
          <span className="text-xs text-gray-500">
            {serviceStatus === 'checking' ? '检查服务...' :
             serviceStatus === 'available' ? '百炼 ASR 已连接（流式）' :
             serviceStatus === 'asr-ready' ? 'Qwen ASR 就绪' :
             '本地录音模式'}
          </span>
        </div>
        
        {/* 转录模式切换 */}
        {status === 'idle' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">转录模式：</span>
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setTranscribeMode('batch')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  transcribeMode === 'batch' 
                    ? 'bg-blue-500 text-white' 
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                非流式（高精度）
              </button>
              <button
                onClick={() => setTranscribeMode('streaming')}
                disabled={!streamingAvailable}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  transcribeMode === 'streaming' 
                    ? 'bg-green-500 text-white' 
                    : streamingAvailable 
                      ? 'text-gray-600 hover:bg-gray-200' 
                      : 'text-gray-400 cursor-not-allowed'
                }`}
                title={!streamingAvailable ? '流式服务暂不可用（浏览器限制）' : ''}
              >
                流式（实时）{!streamingAvailable && ' 🚫'}
              </button>
            </div>
          </div>
        )}
        
        {/* 录音中显示当前模式 */}
        {status === 'recording' && (
          <span className={`text-xs px-2 py-1 rounded-full ${
            transcribeMode === 'streaming' 
              ? 'bg-green-100 text-green-700' 
              : 'bg-blue-100 text-blue-700'
          }`}>
            {transcribeMode === 'streaming' ? '流式转录中' : '录音后转录'}
          </span>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 转录进度提示 */}
      {status === 'transcribing' && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm flex items-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {transcribeProgress || '正在转录...'}
        </div>
      )}

      {/* 录音状态 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          {/* 录音指示器 */}
          <div className={`w-4 h-4 rounded-full ${
            status === 'recording' ? 'bg-red-500 animate-pulse' :
            status === 'paused' ? 'bg-yellow-500' :
            status === 'transcribing' ? 'bg-blue-500 animate-pulse' :
            status === 'stopped' ? 'bg-gray-400' :
            'bg-gray-300'
          }`} />
          
          {/* 时间显示 */}
          <span className="text-2xl font-mono font-bold text-gray-900">
            {formatTime(elapsedMs)}
          </span>
        </div>

        {/* 音量指示器 */}
        {status === 'recording' && (
          <div className="flex items-center gap-1">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className={`w-1 rounded-full transition-all ${
                  level * 10 > i ? 'bg-green-500' : 'bg-gray-200'
                }`}
                style={{ height: `${8 + i * 2}px` }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 控制按钮 */}
      <div className="flex items-center justify-center gap-4 mb-6">
        {status === 'idle' && (
          <button
            onClick={startRecording}
            disabled={disabled}
            className="flex items-center gap-2 px-6 py-3 bg-red-500 text-white rounded-full hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="6" />
            </svg>
            开始录音
          </button>
        )}

        {status === 'recording' && (
          <>
            <button
              onClick={pauseRecording}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-full hover:bg-yellow-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="5" y="4" width="3" height="12" rx="1" />
                <rect x="12" y="4" width="3" height="12" rx="1" />
              </svg>
              暂停
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              {transcribeMode === 'batch' ? '结束并转录' : '结束录音'}
            </button>
          </>
        )}

        {status === 'paused' && (
          <>
            <button
              onClick={resumeRecording}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6 4l10 6-10 6V4z" />
              </svg>
              继续
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-full hover:bg-gray-600 transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <rect x="4" y="4" width="12" height="12" rx="2" />
              </svg>
              {transcribeMode === 'batch' ? '结束并转录' : '结束录音'}
            </button>
          </>
        )}

        {status === 'transcribing' && (
          <button
            disabled
            className="flex items-center gap-2 px-6 py-3 bg-blue-400 text-white rounded-full cursor-not-allowed"
          >
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            转录中...
          </button>
        )}

        {status === 'stopped' && (
          <button
            onClick={() => {
              setStatus('idle');
              setElapsedMs(0);
              setTranscript([]);
              setInterimText('');
              setTranscribeProgress('');
              audioChunksRef.current = [];
            }}
            className="flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            新录音
          </button>
        )}
      </div>

      {/* 断点标记按钮 */}
      {(status === 'recording' || status === 'paused') && (
        <div className="border-t border-gray-200 pt-4">
          <button
            onClick={markAnchor}
            disabled={status !== 'recording'}
            className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-semibold text-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform active:scale-95"
          >
            🎯 我没听懂这里
          </button>
          <p className="text-center text-xs text-gray-400 mt-2">
            {canUndo ? '5秒内可撤销' : '按下标记困惑点'}
          </p>
        </div>
      )}

      {/* 实时转录预览 */}
      {(transcript.length > 0 || interimText) && (
        <div className="mt-4 border-t border-gray-200 pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
            {status === 'transcribing' ? '转录结果' : 
             transcribeMode === 'streaming' ? '实时转录' : '转录结果'}
            {transcribeMode === 'streaming' && (status === 'recording' || transcript.length > 0) && (
              <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                百炼 Paraformer
              </span>
            )}
            {transcribeMode === 'batch' && transcript.length > 0 && (
              <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                Qwen ASR
              </span>
            )}
          </h4>
          <div className="max-h-48 overflow-y-auto text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            {transcript.slice(-10).map((seg) => (
              <p key={seg.id} className="mb-1">
                <span className="text-xs text-gray-400 mr-2">
                  {formatTime(seg.startMs)}
                </span>
                {seg.text}
              </p>
            ))}
            {interimText && (
              <p className="mb-1 text-gray-400 italic">
                <span className="text-xs mr-2">...</span>
                {interimText}
              </p>
            )}
          </div>
          {transcript.length > 10 && (
            <p className="text-xs text-gray-400 mt-1 text-center">
              显示最近 10 条，共 {transcript.length} 条
            </p>
          )}
        </div>
      )}

      {/* 转录完成提示 */}
      {status === 'stopped' && transcribeProgress && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          ✅ {transcribeProgress}
        </div>
      )}
    </div>
  );
}
