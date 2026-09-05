'use client';

/**
 * VoiceMicButton — 一段录音 → 一段文字（M13 重写）
 *
 * 行为变化（M12 → M13）：
 *   - 旧：流式 ASR（DashScope WebSocket），录音过程中实时转写
 *     问题：WebSocket 不稳，线上经常"听写连接失败"。
 *     问题：流式中间结果会闪到对话输入框边上，扰人。
 *   - 新：push-to-record（点击录、再点击停 / 60s 自动停 → 上传 → 一次性回填）
 *     好处：HTTP 接口稳；UI 状态简单（idle / recording / transcribing）；
 *     好处：用户感知"录一段→转一段"，不用看实时打字。
 *
 * 技术：
 *   - MediaRecorder API（浏览器原生，不依赖 ASR Web SDK）
 *   - 录音格式：audio/webm;codecs=opus（默认，体积小延迟低）
 *   - 上传到 /api/asr/oneshot（multipart/form-data, 'audio' 字段）
 *   - 服务端调 qwen3-asr-flash 同步识别（短音频 < 60s）
 *
 * UX 细节：
 *   - 录音中：墨黑实心 + 4 条声波动画 + 外圈呼吸 ring + 倒计时（最后 10s 红色警告）
 *   - 转写中：转圈 spinner + "听写中…" tooltip
 *   - 错误：sonner toast + 按钮 2s 红色闪烁后自动恢复
 *
 * 简化（不做的事）：
 *   - 不做实时音量条（v7 克制 + 流式 ASR 已退役）
 *   - 不做"按住录、松开停"长按模式（点击 toggle 更通用，移动端体验更好）
 *   - 不做"录到一半切到流式"（fallback 路径只会让代码更乱）
 */

import * as React from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface VoiceMicButtonProps {
  /** 识别完成的最终文字（一次性回填到输入框） */
  onTranscript: (text: string) => void;
  /** 录音真正开始的回调（父级可借此让播放中的 TTS 闭嘴） */
  onRecordingStart?: () => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 按钮尺寸 */
  size?: 'sm' | 'md';
  /** 暗色主题（沉浸式背景上） */
  dark?: boolean;
  className?: string;
}

type MicState = 'idle' | 'recording' | 'transcribing' | 'error';

/** 录音上限：60s（服务端 maxDuration 90s 兜底） */
const MAX_RECORD_SECONDS = 60;

/** 录音格式协商：优先 opus，fallback default */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return undefined;
}

function VoiceWaveBars({ size }: { size: 'sm' | 'md' }) {
  const barCount = 4;
  const barH = size === 'sm' ? 'h-2.5' : 'h-3.5';
  const barW = size === 'sm' ? 'w-[2px]' : 'w-[2.5px]';
  return (
    <div className="flex items-center gap-[2px]">
      {Array.from({ length: barCount }).map((_, i) => (
        <span
          key={i}
          className={`${barW} ${barH} rounded-full bg-white`}
          style={{
            animation: `voiceBar 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
          }}
        />
      ))}
      <style jsx>{`
        @keyframes voiceBar {
          0% { transform: scaleY(0.3); opacity: 0.6; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function VoiceMicButton({
  onTranscript,
  onRecordingStart,
  disabled = false,
  size = 'md',
  dark = false,
  className = '',
}: VoiceMicButtonProps) {
  const [state, setState] = React.useState<MicState>('idle');
  const [secondsLeft, setSecondsLeft] = React.useState(MAX_RECORD_SECONDS);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const tickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = React.useRef<MicState>('idle');

  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const cleanup = React.useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
    recorderRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    chunksRef.current = [];
    setSecondsLeft(MAX_RECORD_SECONDS);
  }, []);

  React.useEffect(() => () => cleanup(), [cleanup]);

  const finishUpload = React.useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        setState('idle');
        toast.info('没录到声音');
        return;
      }
      setState('transcribing');
      try {
        const form = new FormData();
        form.append('audio', blob, 'voice.webm');
        const res = await fetch('/api/asr/oneshot', {
          method: 'POST',
          body: form,
        });
        const data = (await res.json().catch(() => ({}))) as {
          text?: string;
          error?: string;
        };
        if (!res.ok || data.error) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const text = (data.text ?? '').trim();
        if (!text) {
          toast.info('没听清——再说一次？');
          setState('idle');
          return;
        }
        onTranscript(text);
        setState('idle');
      } catch (err) {
        const msg = err instanceof Error ? err.message : '识别失败';
        toast.error(msg);
        setState('error');
        setTimeout(() => {
          if (stateRef.current === 'error') setState('idle');
        }, 1800);
      }
    },
    [onTranscript],
  );

  const startRecording = React.useCallback(async () => {
    if (disabled || state !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        chunksRef.current = [];
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        // 触发上传（在 onstop 里——MediaRecorder 保证此时 chunks 已 flush）
        void finishUpload(blob);
      };

      recorder.start();
      setState('recording');
      setSecondsLeft(MAX_RECORD_SECONDS);
      onRecordingStart?.();

      // 倒计时
      tickRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            // 触发自动停止
            if (recorderRef.current && recorderRef.current.state !== 'inactive') {
              try {
                recorderRef.current.stop();
              } catch {
                /* noop */
              }
            }
            if (tickRef.current) {
              clearInterval(tickRef.current);
              tickRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      cleanup();
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? '请允许麦克风权限'
          : err instanceof DOMException && err.name === 'NotFoundError'
            ? '没有可用的麦克风'
            : err instanceof Error
              ? err.message
              : '麦克风启动失败';
      toast.error(message);
      setState('error');
      setTimeout(() => {
        if (stateRef.current === 'error') setState('idle');
      }, 1800);
    }
  }, [disabled, state, finishUpload, cleanup, onRecordingStart]);

  const stopRecording = React.useCallback(() => {
    if (state !== 'recording') return;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    // 停止 recorder → 触发 onstop → finishUpload
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop();
      } catch {
        /* noop */
      }
    }
  }, [state]);

  const handleClick = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      if (state === 'idle' || state === 'error') void startRecording();
      else if (state === 'recording') stopRecording();
      // transcribing 时点击无效（防重复触发）
    },
    [disabled, state, startRecording, stopRecording],
  );

  const sizeClasses = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
  const iconSize = size === 'sm' ? 14 : 18;
  const pulseSize = size === 'sm' ? 'inset-[-4px]' : 'inset-[-5px]';

  let buttonClasses = '';
  if (state === 'error') {
    buttonClasses = 'bg-vermilion text-white';
  } else if (state === 'recording') {
    buttonClasses = 'bg-ink text-white';
  } else if (state === 'transcribing') {
    buttonClasses = dark
      ? 'bg-white/15 text-white border border-white/20'
      : 'bg-pine/10 text-pine border border-pine/30';
  } else {
    // idle
    buttonClasses = dark
      ? 'bg-white/10 text-white/80 border border-white/15 hover:bg-white/20'
      : 'bg-paper-warm text-ink-secondary border border-divider hover:bg-pine/10 hover:text-pine hover:border-pine/30';
  }

  const title =
    state === 'recording'
      ? `录音中 · ${secondsLeft}s · 点击结束`
      : state === 'transcribing'
        ? '正在听写…'
        : state === 'error'
          ? '出错了，再试一次'
          : '点击录音 · 60 秒上限';

  const showCountdownWarn = state === 'recording' && secondsLeft <= 10;

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      {/* 录音中的外圈呼吸 */}
      {state === 'recording' ? (
        <span
          aria-hidden
          className={cn('pointer-events-none absolute rounded-full', pulseSize)}
          style={{
            background:
              'radial-gradient(circle, rgba(28,27,25,0.18) 0%, transparent 70%)',
            animation: 'micPulse 1.4s ease-in-out infinite',
          }}
        />
      ) : null}

      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || state === 'transcribing'}
        title={title}
        aria-label={title}
        className={cn(
          'relative flex shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-out',
          'active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
          sizeClasses,
          buttonClasses,
        )}
      >
        {state === 'recording' ? (
          <VoiceWaveBars size={size} />
        ) : state === 'transcribing' ? (
          <Loader2 size={iconSize} strokeWidth={2} className="animate-spin" />
        ) : (
          <Mic size={iconSize} strokeWidth={1.8} />
        )}
      </button>

      {/* 录音中倒计时 tooltip */}
      {state === 'recording' ? (
        <span
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-md px-2 py-0.5 font-mono text-[10.5px] tabular-nums backdrop-blur-sm',
            showCountdownWarn ? 'bg-vermilion text-white' : 'bg-ink/85 text-white',
          )}
        >
          {secondsLeft}s
        </span>
      ) : null}

      {/* 转写中 tooltip */}
      {state === 'transcribing' ? (
        <span
          className={cn(
            'pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px]',
            dark
              ? 'bg-white/15 text-white backdrop-blur'
              : 'bg-pine text-white',
          )}
        >
          听写中…
        </span>
      ) : null}

      <style jsx>{`
        @keyframes micPulse {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.15); opacity: 0.25; }
        }
      `}</style>
    </div>
  );
}

export default VoiceMicButton;
