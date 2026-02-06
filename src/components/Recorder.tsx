'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TranscriptSegment } from '@/types';
import { DashScopeASRClient } from '@/lib/services/dashscope-asr-service';
import { TranscriptPreviewPanel } from './TranscriptPreviewPanel';
import { TranscriptEnhanceManager, type EnhancedTranscriptSegment } from '@/lib/services/transcript-enhancer';

interface RecorderProps {
  onRecordingStart?: (sessionId: string) => void;
  onRecordingStop?: (audioBlob?: Blob) => void;
  onTranscriptUpdate?: (segments: TranscriptSegment[]) => void;
  /** 转录增强完成后的回调，传递优化后的文本 */
  onTranscriptEnhanced?: (segments: TranscriptSegment[]) => void;
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
  onTranscriptEnhanced,
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
  const isStartingRecordingRef = useRef(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  
  // ASR 后处理增强管理器
  const enhanceManagerRef = useRef<TranscriptEnhanceManager | null>(null);
  const [enhancedSegments, setEnhancedSegments] = useState<Map<string, EnhancedTranscriptSegment>>(new Map());
  const [enhanceStats, setEnhanceStats] = useState({ enhanced: 0, total: 0, isEnhancing: false });

  // VAD 检测状态
  const vadStateRef = useRef({
    isSpeaking: false,           // 当前是否在说话
    speechStartMs: 0,            // 语音开始时间 (elapsedMs)
    silenceStartMs: 0,           // 静音开始时间 (elapsedMs)
  });

  // VAD 配置常量
  const VAD_CONFIG = {
    energyThreshold: 0.08,       // 能量阈值 (0-1)，根据环境噪音调整
    silenceDuration: 600,        // 静音判定时长 (毫秒)，与百炼 server_vad 对齐
    minSpeechDuration: 200,      // 最小语音时长 (毫秒)，过滤误触发
  };

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
    if (isStartingRecordingRef.current || status !== 'idle') return;

    isStartingRecordingRef.current = true;
    setIsStartingRecording(true);
    let stream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;

    try {
      setError(null);
      audioChunksRef.current = [];
      setTranscript([]);
      transcriptRef.current = [];
      setInterimText('');
      setAnchorCount(0);

      // 防御性清理：处理上一次异常中断遗留的音频节点
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
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        mediaRecorderRef.current = null;
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      // 初始化 ASR 后处理增强管理器
      setEnhancedSegments(new Map());
      setEnhanceStats({ enhanced: 0, total: 0, isEnhancing: false });
      enhanceManagerRef.current = new TranscriptEnhanceManager({
        minBatchSize: 1,          // 最少 1 句就可以触发优化（降低门槛方便测试）
        silenceThreshold: 3000,   // 3 秒静音触发优化
        model: 'qwen3-max-2026-01-23',       // 使用思考模式的 qwen3-max 模型
        onEnhanced: (segments) => {
          // 优化完成回调：更新增强后的文本
          console.log('[Recorder] Enhanced callback received:', segments.length, 'segments');
          console.log('[Recorder] Enhanced segments:', segments.map(s => ({ id: s.id, status: s.enhanceStatus, text: s.text?.slice(0, 30) })));
          setEnhancedSegments(prev => {
            const newMap = new Map(prev);
            for (const seg of segments) {
              newMap.set(seg.id, seg);
            }
            
            // 【关键】构建完整的增强后转录文本并通知父组件
            // 使用 function 形式获取最新的 transcriptRef
            const currentTranscript = transcriptRef.current;
            const enhancedTranscript = currentTranscript.map(seg => {
              const enhanced = newMap.get(seg.id);
              if (enhanced && enhanced.enhanceStatus === 'enhanced' && enhanced.text !== seg.text) {
                return { ...seg, text: enhanced.text };
              }
              return seg;
            });
            
            // 通知父组件增强后的文本
            console.log('[Recorder] Notifying parent of enhanced transcript:', enhancedTranscript.length, 'segments');
            onTranscriptEnhanced?.(enhancedTranscript);
            
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
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 不强制指定采样率，让 AudioContext 自动匹配设备
      // 某些设备（如手机）不支持指定采样率，会导致 createMediaStreamSource 报错
      audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const actualSampleRate = audioContext.sampleRate;
      console.log('[Recorder] AudioContext sampleRate:', actualSampleRate);
      analyserRef.current = audioContext.createAnalyser();
      analyserRef.current.fftSize = 256;
      source.connect(analyserRef.current);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      
      // 重要：提前初始化 startTimeRef，确保 VAD 时间戳基准正确
      // 此时录音实际上已开始准备，与 MediaRecorder.start() 几乎同时
      startTimeRef.current = Date.now();
      
      // 重置 VAD 状态
      vadStateRef.current = {
        isSpeaking: false,
        speechStartMs: 0,
        silenceStartMs: 0,
      };
      
      const checkLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const normalizedLevel = average / 255;
        setLevel(normalizedLevel);

        // VAD 能量检测逻辑
        // 确保 startTimeRef 已初始化（> 0）
        if (startTimeRef.current > 0) {
          const currentElapsedMs = Date.now() - startTimeRef.current;
          const vadState = vadStateRef.current;
          
          if (normalizedLevel > VAD_CONFIG.energyThreshold) {
            // 检测到声音
            if (!vadState.isSpeaking) {
              // 语音开始 - 立即发送开始时间戳给后端
              vadState.isSpeaking = true;
              vadState.speechStartMs = currentElapsedMs;
              vadState.silenceStartMs = 0;
              console.log('[VAD] Speech started at', vadState.speechStartMs, 'ms, level:', normalizedLevel.toFixed(3));
              
              // 发送 speech-start 事件
              if (asrClientRef.current?.isConnected()) {
                asrClientRef.current.sendVADEvent('start', vadState.speechStartMs);
              }
            }
            // 重置静音计时
            vadState.silenceStartMs = 0;
          } else {
            // 静音状态
            if (vadState.isSpeaking) {
              // 正在说话但检测到静音
              if (vadState.silenceStartMs === 0) {
                // 开始计时静音
                vadState.silenceStartMs = currentElapsedMs;
              } else {
                // 检查静音是否达到阈值
                const silenceDuration = currentElapsedMs - vadState.silenceStartMs;
                if (silenceDuration >= VAD_CONFIG.silenceDuration) {
                  // 语音结束
                  const speechDuration = vadState.silenceStartMs - vadState.speechStartMs;
                  if (speechDuration >= VAD_CONFIG.minSpeechDuration) {
                    // 有效语音段结束，发送结束时间戳
                    console.log('[VAD] Speech ended:', vadState.speechStartMs, '-', vadState.silenceStartMs, 'ms, duration:', speechDuration, 'ms');
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
        }

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
            
            // 将新句子添加到增强管理器，等待批量优化
            if (enhanceManagerRef.current) {
              console.log('[Recorder] Adding segment to enhance manager:', segment.id, segment.text?.slice(0, 30));
              enhanceManagerRef.current.addSegment(segment);
              setEnhanceStats(prev => ({ ...prev, total: prev.total + 1 }));
            }
          },
          onInterim: (text) => {
            setInterimText(text);
            // 更新活动时间，用于静音检测
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
        });
        
        const started = await asrClientRef.current.start();
        if (!started) {
          asrClientRef.current = null;
        } else {
          const bufferSize = 4096;
          pcmProcessorRef.current = audioContext.createScriptProcessor(bufferSize, 1, 1);
          
          // 重采样函数：将设备采样率转换为目标采样率 (16000Hz)
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
              // 线性插值
              result[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
            }
            return result;
          };
          
          pcmProcessorRef.current.onaudioprocess = (e) => {
            if (asrClientRef.current?.isConnected()) {
              const inputData = e.inputBuffer.getChannelData(0);
              // 重采样到 16000Hz
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

      // startTimeRef.current 已在 checkLevel 初始化前设置，此处仅启动计时器
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 100);

      setStatus('recording');
      onRecordingStart?.(sessionIdRef.current);

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
      setError(err instanceof Error ? err.message : '录音启动失败');
    } finally {
      isStartingRecordingRef.current = false;
      setIsStartingRecording(false);
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
      
      // 重置 VAD 状态，避免暂停期间的静音被误判
      vadStateRef.current = {
        isSpeaking: false,
        speechStartMs: 0,
        silenceStartMs: 0,
      };
      
      setStatus('recording');
    }
  };

  // 停止录音
  const stopRecording = async () => {
    // 首先停止 ASR，阻止继续处理音频
    if (asrClientRef.current) {
      await asrClientRef.current.stop();
      asrClientRef.current = null;
    }

    // 断开音频处理器
    if (pcmProcessorRef.current) {
      pcmProcessorRef.current.disconnect();
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

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

    mediaRecorderRef.current = null;
    analyserRef.current = null;
    setLevel(0);
    setInterimText('');

    // 触发最终的 ASR 后处理优化
    if (enhanceManagerRef.current && transcribeMode === 'streaming') {
      setEnhanceStats(prev => ({ ...prev, isEnhancing: true }));
      console.log('[Recorder] Finalizing transcript enhancement...');
      try {
        await enhanceManagerRef.current.finalize();
      } catch (err) {
        console.error('[Recorder] Enhancement finalize error:', err);
      }
      // 清理增强管理器
      enhanceManagerRef.current.dispose();
      enhanceManagerRef.current = null;
    }

    if (transcribeMode === 'batch' && audioBlob.size > 0) {
      await transcribeWithQwenASR(audioBlob);
    } else {
      if (transcribeMode === 'streaming' && transcriptRef.current.length > 0) {
        const enhancedCount = enhanceStats.enhanced;
        const totalCount = transcriptRef.current.length;
        const enhanceInfo = enhancedCount > 0 ? `，已优化 ${enhancedCount} 句` : '';
        setTranscribeProgress(`转录完成，共 ${totalCount} 句${enhanceInfo}`);
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
        
        // 【新增】batch 模式下也触发转录增强
        if (segments.length > 0) {
          setTranscribeProgress(`转录完成，正在优化文本...`);
          setEnhanceStats(prev => ({ ...prev, total: segments.length, isEnhancing: true }));
          
          // 初始化增强管理器
          enhanceManagerRef.current = new TranscriptEnhanceManager({
            minBatchSize: 1,
            silenceThreshold: 0, // batch 模式下立即触发
            model: 'qwen3-max-2026-01-23',
            onEnhanced: (enhancedSegs) => {
              console.log('[Recorder] Batch mode enhanced:', enhancedSegs.length, 'segments');
              setEnhancedSegments(prev => {
                const newMap = new Map(prev);
                for (const seg of enhancedSegs) {
                  newMap.set(seg.id, seg);
                }
                
                // 【关键】构建完整的增强后转录文本并通知父组件
                const enhancedTranscript = segments.map(seg => {
                  const enhanced = newMap.get(seg.id);
                  if (enhanced && enhanced.enhanceStatus === 'enhanced' && enhanced.text !== seg.text) {
                    return { ...seg, text: enhanced.text };
                  }
                  return seg;
                });
                
                // 通知父组件增强后的文本
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
          
          // 添加所有句子到增强管理器
          for (const seg of segments) {
            enhanceManagerRef.current.addSegment(seg);
          }
          
          // 触发最终优化
          enhanceManagerRef.current.finalize().then(() => {
            const enhancedCount = enhanceManagerRef.current?.getAllEnhanced().filter(s => s.enhanceStatus === 'enhanced').length || 0;
            setTranscribeProgress(`转录完成，共 ${segments.length} 句，已优化 ${enhancedCount} 句`);
            enhanceManagerRef.current?.dispose();
            enhanceManagerRef.current = null;
          });
        } else {
          setTranscribeProgress(`转录完成，共 ${segments.length} 句`);
        }
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
      if (enhanceManagerRef.current) enhanceManagerRef.current.dispose();
    };
  }, []);


  const isRecording = status === 'recording';
  const isTranscribing = status === 'transcribing';
  const isStopped = status === 'stopped';
  const isIdle = status === 'idle';

  // 合并原始转录和增强后的文本，优先显示增强版本
  const displayTranscript = transcript.map(seg => {
    const enhanced = enhancedSegments.get(seg.id);
    if (enhanced && enhanced.enhanceStatus === 'enhanced' && enhanced.text !== seg.text) {
      return {
        ...seg,
        text: enhanced.text,
        originalText: seg.text, // 保留原始文本以便对比
      };
    }
    return seg;
  });

  // ===== 闲置状态：显示开始录音界面 =====
  if (isIdle) {
    return (
      <div className="card p-8 animate-fade-in">
        {/* 顶部状态栏 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-colors ${
              serviceStatus === 'checking' ? 'bg-sunflower animate-pulse' :
              serviceStatus === 'available' ? 'bg-mint' :
              'bg-gray-300'
            }`} />
            <span className="text-xs text-gray-500">
              {serviceStatus === 'checking' ? '连接中...' :
               serviceStatus === 'available' ? '实时转录就绪' :
               '本地模式'}
            </span>
          </div>
          
          {/* 模式切换 */}
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
              <button
                onClick={() => setTranscribeMode('streaming')}
                disabled={!streamingAvailable}
                className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                  transcribeMode === 'streaming' 
                    ? 'bg-white text-amber-600 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                } ${!streamingAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                ⚡ 边录边转
              </button>
              <button
                onClick={() => setTranscribeMode('batch')}
                className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                  transcribeMode === 'batch' 
                    ? 'bg-white text-accent-600 shadow-sm' 
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                🎯 录完转译
              </button>
            </div>
            <span className="text-[10px] text-gray-400">
              {transcribeMode === 'streaming' ? '边听边看文字，适合上课' : '录完再转，更准确'}
            </span>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mb-6 p-4 bg-coral-50 border border-coral-100 rounded-xl text-coral-600 text-sm animate-slide-up">
            <div className="flex items-center gap-2">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* 开始录音区域 */}
        <div className="flex flex-col items-center py-12">
          <div className="text-6xl font-mono font-bold text-gray-200 mb-4">
            00:00
          </div>
          <p className="text-sm text-gray-400 mb-8">点击开始录制课堂</p>
          <button
            onClick={startRecording}
            disabled={disabled || isStartingRecording}
            className="record-btn"
            aria-label="开始录音"
            data-onboarding="record-button"
          >
            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ===== 转录中状态 =====
  if (isTranscribing) {
    return (
      <div className="card p-8 animate-fade-in">
        <div className="flex flex-col items-center py-12">
          <div className="w-20 h-20 rounded-full bg-sunflower-100 flex items-center justify-center mb-6">
            <div className="w-8 h-8 border-3 border-sunflower border-t-transparent rounded-full animate-spin" />
          </div>
          <div className="text-lg font-medium text-gray-700 mb-2">正在转录</div>
          <p className="text-sm text-gray-500">{transcribeProgress || '请稍候...'}</p>
        </div>
      </div>
    );
  }

  // ===== 停止状态：显示完成界面 =====
  if (isStopped) {
    return (
      <div className="card p-8 animate-fade-in">
        {/* 完成提示 */}
        {transcribeProgress && (
          <div className="mb-6 p-4 bg-mint-50 border border-mint-200 rounded-xl animate-scale-in">
            <div className="flex items-center gap-2 text-mint-700">
              <span className="text-lg">✅</span>
              <span className="text-sm font-medium">{transcribeProgress}</span>
            </div>
          </div>
        )}

        {/* 转录结果预览 - 使用增强后的文本 */}
        <TranscriptPreviewPanel
          transcript={displayTranscript}
          interimText=""
          isRecording={false}
          transcribeMode={transcribeMode}
          collapsedCount={10}
          formatTime={formatTime}
          defaultExpanded={true}
        />

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => {
              setStatus('idle');
              setElapsedMs(0);
              setTranscript([]);
              setInterimText('');
              setTranscribeProgress('');
              setAnchorCount(0);
              setEnhancedSegments(new Map());
              setEnhanceStats({ enhanced: 0, total: 0, isEnhancing: false });
              audioChunksRef.current = [];
            }}
            className="btn btn-primary px-8 py-3"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
            </svg>
            开始新录音
          </button>
        </div>
      </div>
    );
  }

  // ===== 录音活动状态：沉浸式转录布局 =====
  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-fade-in">
      {/* ===== 极简顶栏 (移动端 84px / 桌面端 60px) ===== */}
      <div className="flex-shrink-0 h-[84px] sm:h-[60px] px-4 flex items-center justify-between border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        {/* 左侧：状态和时间 */}
        <div className="flex items-center gap-3 sm:gap-3">
          {/* 录音状态指示器 */}
          <div className="flex items-center gap-2 sm:gap-2">
            <div className={`w-3.5 h-3.5 sm:w-2.5 sm:h-2.5 rounded-full ${isRecording ? 'bg-coral animate-pulse' : 'bg-sunflower-500'}`} />
            <span className={`text-lg sm:text-sm font-medium ${isRecording ? 'text-coral' : 'text-sunflower-600'}`}>
              {isRecording ? '录音中' : '已暂停'}
            </span>
          </div>
          
          {/* 时间显示 - 移动端更大 (放大1.3倍) */}
          <div className={`font-mono text-4xl sm:text-2xl font-semibold tabular-nums ${isRecording ? 'text-gray-800' : 'text-gray-500'}`}>
            {formatTime(elapsedMs)}
          </div>
          
          {/* 音量指示器 - 仅桌面端显示 */}
          {isRecording && (
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

        {/* 右侧：控制按钮和模式标签 */}
        <div className="flex items-center gap-4 sm:gap-4">
          {/* 模式标签 */}
          <span className="text-sm sm:text-xs text-gray-400 hidden sm:inline">
            {transcribeMode === 'streaming' ? '边录边转' : '录完转译'}
          </span>
          
          {/* 控制按钮组 - 移动端大触摸目标 (72px，放大1.3倍)，桌面端 (48px) */}
          <div className="flex items-center gap-4 sm:gap-2">
            {isRecording ? (
              <button
                onClick={pauseRecording}
                className="w-[72px] h-[72px] sm:w-[48px] sm:h-[48px] rounded-full bg-sunflower-100 text-sunflower-700 flex items-center justify-center hover:bg-sunflower-200 transition-all active:scale-95 shadow-sm"
                aria-label="暂停"
              >
                <svg className="w-9 h-9 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              </button>
            ) : (
              <button
                onClick={resumeRecording}
                className="w-[72px] h-[72px] sm:w-[48px] sm:h-[48px] rounded-full bg-mint-100 text-mint-700 flex items-center justify-center hover:bg-mint-200 transition-all active:scale-95 shadow-sm"
                aria-label="继续"
              >
                <svg className="w-9 h-9 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </button>
            )}
            <button
              onClick={stopRecording}
              className="w-[72px] h-[72px] sm:w-[48px] sm:h-[48px] rounded-full bg-gray-100 text-gray-600 flex items-center justify-center hover:bg-gray-200 transition-all active:scale-95 shadow-sm"
              aria-label="停止"
            >
              <svg className="w-9 h-9 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ===== 错误提示（如有） ===== */}
      {error && (
        <div className="flex-shrink-0 mx-4 mt-3 p-3 bg-coral-50 border border-coral-100 rounded-xl text-coral-600 text-sm animate-slide-up">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* ===== ASR 后处理优化状态指示器 ===== */}
      {transcribeMode === 'streaming' && enhanceStats.total > 0 && (
        <div className="flex-shrink-0 mx-4 mt-2 flex items-center gap-2 text-xs text-gray-400">
          {enhanceStats.isEnhancing ? (
            <>
              <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span>正在优化文本...</span>
            </>
          ) : enhanceStats.enhanced > 0 ? (
            <>
              <span className="text-mint-600">✨</span>
              <span>已优化 {enhanceStats.enhanced}/{enhanceStats.total} 句</span>
            </>
          ) : null}
        </div>
      )}

      {/* ===== 沉浸式转录区域（占据主要空间，可滚动） ===== */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <TranscriptPreviewPanel
          transcript={displayTranscript}
          interimText={interimText}
          isRecording={isRecording}
          transcribeMode={transcribeMode}
          collapsedCount={999}
          formatTime={formatTime}
          defaultExpanded={true}
          immersiveMode={true}
        />
      </div>

      {/* ===== 固定底部：困惑点按钮 (48px) ===== */}
      <div className="flex-shrink-0 border-t border-gray-100 bg-gradient-to-r from-white to-gray-50">
        <button
          onClick={markAnchor}
          disabled={!isRecording}
          className={`w-full h-14 flex items-center justify-center gap-3 transition-all ${
            isRecording 
              ? 'bg-gradient-to-r from-coral-500 to-warmOrange-500 text-white hover:from-coral-600 hover:to-warmOrange-600 active:scale-[0.99]' 
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
          data-onboarding="confusion-button"
        >
          <span className="text-xl">🎯</span>
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
    </div>
  );
}
