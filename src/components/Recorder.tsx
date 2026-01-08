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
type TranscribeMode = 'batch' | 'streaming';

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
  const [transcribeMode, setTranscribeMode] = useState<TranscribeMode>('streaming');
  const [streamingAvailable, setStreamingAvailable] = useState(true);
  const [apiKey, setApiKey] = useState<string>('');
  const [wsModel, setWsModel] = useState<string>('qwen-asr-realtime-v1');
  const [wsSampleRate, setWsSampleRate] = useState<number>(16000);
  const [anchorCount, setAnchorCount] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const sessionIdRef = useRef<string>('');
  const lastAnchorTimeRef = useRef<number>(0);
  const audioChunksRef = useRef<Blob[]>([]);
  const asrClientRef = useRef<DashScopeASRClient | null>(null);
  const transcriptRef = useRef<TranscriptSegment[]>([]);
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
      audioChunksRef.current = [];
      setTranscript([]);
      transcriptRef.current = [];
      setInterimText('');
      setAnchorCount(0);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      const checkLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setLevel(average / 255);
        animationIdRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();

      sessionIdRef.current = `session-${Date.now()}`;

      // 流式模式
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
          onInterim: (text) => setInterimText(text),
          onError: (err) => setError(err),
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
          const bufferSize = 4096;
          pcmProcessorRef.current = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
          
          pcmProcessorRef.current.onaudioprocess = (e) => {
            if (asrClientRef.current?.isConnected()) {
              const inputData = e.inputBuffer.getChannelData(0);
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
      if (timerRef.current) clearInterval(timerRef.current);
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
      pcmProcessorRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    if (asrClientRef.current) {
      await asrClientRef.current.stop();
      asrClientRef.current = null;
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

    mediaRecorderRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setInterimText('');

    if (transcribeMode === 'batch' && audioBlob.size > 0) {
      await transcribeWithQwenASR(audioBlob);
    } else {
      if (transcribeMode === 'streaming' && transcriptRef.current.length > 0) {
        setTranscribeProgress(`转录完成，共 ${transcriptRef.current.length} 句`);
        onTranscriptUpdate?.(transcriptRef.current);
      }
      setStatus('stopped');
      onRecordingStop?.(audioBlob);
    }
  };

  // 非流式转录
  const transcribeWithQwenASR = async (audioBlob: Blob) => {
    setStatus('transcribing');
    setTranscribeProgress('正在转录音频...');
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
        onTranscriptUpdate?.(segments);
        setTranscribeProgress(`转录完成，共 ${segments.length} 句`);
      } else {
        setTranscribeProgress('转录完成，但未获取到文本');
      }
    } catch (err) {
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
    setAnchorCount(prev => prev + 1);
    setCanUndo(true);

    setTimeout(() => setCanUndo(false), 5000);
  }, [status, elapsedMs, onAnchorMark]);

  // 清理
  useEffect(() => {
    return () => {
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (pcmProcessorRef.current) pcmProcessorRef.current.disconnect();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
      if (audioContextRef.current) audioContextRef.current.close();
      if (asrClientRef.current) asrClientRef.current.stop();
    };
  }, []);

  const isRecording = status === 'recording';
  const isPaused = status === 'paused';
  const isTranscribing = status === 'transcribing';
  const isStopped = status === 'stopped';
  const isIdle = status === 'idle';

  return (
    <div className="card p-8 animate-fade-in">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between mb-8">
        {/* 服务状态 */}
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full transition-colors ${
            serviceStatus === 'checking' ? 'bg-amber-400 animate-pulse' :
            serviceStatus === 'available' ? 'bg-emerald-400' :
            'bg-gray-300'
          }`} />
          <span className="text-xs text-gray-500">
            {serviceStatus === 'checking' ? '连接中...' :
             serviceStatus === 'available' ? '实时转录就绪' :
             '本地模式'}
          </span>
        </div>
        
        {/* 模式切换 */}
        {isIdle && (
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => setTranscribeMode('streaming')}
              disabled={!streamingAvailable}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                transcribeMode === 'streaming' 
                  ? 'bg-white text-rose-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700'
              } ${!streamingAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              ⚡ 实时
            </button>
            <button
              onClick={() => setTranscribeMode('batch')}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                transcribeMode === 'batch' 
                  ? 'bg-white text-accent-600 shadow-sm' 
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              🎯 高精度
            </button>
          </div>
        )}
        
        {/* 录音中状态 */}
        {(isRecording || isPaused) && (
          <span className={`badge ${transcribeMode === 'streaming' ? 'badge-streaming' : 'badge-demo'}`}>
            {transcribeMode === 'streaming' ? '实时转录中' : '录音后转录'}
          </span>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm animate-slide-up">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* 转录进度 */}
      {isTranscribing && (
        <div className="mb-6 p-4 bg-accent-50 border border-accent-100 rounded-xl animate-slide-up">
          <div className="flex items-center gap-3">
            <div className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <span className="text-sm text-accent-700">{transcribeProgress || '正在转录...'}</span>
          </div>
        </div>
      )}

      {/* 主录音区域 */}
      <div className="flex flex-col items-center">
        {/* 时间显示 */}
        <div className="mb-8 text-center">
          <div className={`text-5xl font-mono font-bold tracking-tight transition-colors ${
            isRecording ? 'text-rose-500' : 
            isPaused ? 'text-amber-500' : 
            'text-gray-300'
          }`}>
            {formatTime(elapsedMs)}
          </div>
          {isRecording && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-gray-400">
              <span className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
              正在录音
            </div>
          )}
        </div>

        {/* 音量可视化 */}
        {(isRecording || isPaused) && (
          <div className="flex items-end justify-center gap-1 h-8 mb-8">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className={`w-1.5 rounded-full transition-all duration-75 ${
                  isRecording && level * 12 > i ? 'bg-emerald-400' : 'bg-gray-200'
                }`}
                style={{ 
                  height: isRecording 
                    ? `${Math.max(8, Math.min(32, (level * 40) + Math.sin(Date.now() / 200 + i) * 4))}px`
                    : '8px'
                }}
              />
            ))}
          </div>
        )}

        {/* 控制按钮 */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {isIdle && (
            <button
              onClick={startRecording}
              disabled={disabled}
              className="record-btn"
              aria-label="开始录音"
            >
              <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="6" />
              </svg>
            </button>
          )}

          {isRecording && (
            <>
              <button
                onClick={pauseRecording}
                className="w-14 h-14 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center hover:bg-amber-200 transition-all active:scale-95"
                aria-label="暂停"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
              <button
                onClick={stopRecording}
                className="w-14 h-14 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200 transition-all active:scale-95"
                aria-label="停止"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </>
          )}

          {isPaused && (
            <>
              <button
                onClick={resumeRecording}
                className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center hover:bg-emerald-200 transition-all active:scale-95"
                aria-label="继续"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
              <button
                onClick={stopRecording}
                className="w-14 h-14 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200 transition-all active:scale-95"
                aria-label="停止"
              >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </>
          )}

          {isTranscribing && (
            <div className="w-20 h-20 rounded-full bg-accent-100 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-accent-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {isStopped && (
            <button
              onClick={() => {
                setStatus('idle');
                setElapsedMs(0);
                setTranscript([]);
                setInterimText('');
                setTranscribeProgress('');
                setAnchorCount(0);
                audioChunksRef.current = [];
              }}
              className="btn btn-primary px-8 py-4 text-lg"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
              </svg>
              新录音
            </button>
          )}
        </div>

        {/* 困惑点按钮 */}
        {(isRecording || isPaused) && (
          <div className="w-full animate-slide-up">
            <button
              onClick={markAnchor}
              disabled={!isRecording}
              className="confusion-btn"
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                <span className="text-2xl">🎯</span>
                <span>没听懂？点这里！</span>
              </span>
            </button>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
              <span>{canUndo ? '5秒内可撤销' : '标记你的困惑点'}</span>
              {anchorCount > 0 && (
                <span className="text-rose-500">已标记 {anchorCount} 个</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 实时转录预览 */}
      {(transcript.length > 0 || interimText) && (
        <div className="mt-8 pt-6 border-t border-gray-100 animate-fade-in">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
              {transcribeMode === 'streaming' ? '📝 实时转录' : '📝 转录结果'}
              <span className="badge badge-streaming">
                {transcribeMode === 'streaming' ? '百炼 ASR' : 'Qwen ASR'}
              </span>
            </h4>
            <span className="text-xs text-gray-400">{transcript.length} 句</span>
          </div>
          
          <div className="max-h-40 overflow-y-auto space-y-2 p-3 bg-gray-50 rounded-xl">
            {transcript.slice(-8).map((seg) => (
              <div key={seg.id} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-gray-400 font-mono shrink-0 mt-0.5">
                  {formatTime(seg.startMs)}
                </span>
                <span className="text-gray-700">{seg.text}</span>
              </div>
            ))}
            {interimText && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-xs text-gray-300 font-mono shrink-0 mt-0.5">...</span>
                <span className="text-gray-400 italic">{interimText}</span>
              </div>
            )}
          </div>
          
          {transcript.length > 8 && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              显示最近 8 句
            </p>
          )}
        </div>
      )}

      {/* 完成提示 */}
      {isStopped && transcribeProgress && (
        <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl animate-scale-in">
          <div className="flex items-center gap-2 text-emerald-700">
            <span className="text-lg">✅</span>
            <span className="text-sm font-medium">{transcribeProgress}</span>
          </div>
        </div>
      )}
    </div>
  );
}
