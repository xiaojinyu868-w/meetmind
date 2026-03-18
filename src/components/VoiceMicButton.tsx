'use client';

import React, { useCallback, useState, useEffect } from 'react';
import { useVoiceInput } from '@/hooks/useVoiceInput';

interface VoiceMicButtonProps {
  /** 识别到的最终文字追加到输入框 */
  onTranscript: (text: string) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 按钮尺寸 */
  size?: 'sm' | 'md';
  /** 额外的 className */
  className?: string;
  /** 暗色主题（用于 ConfusionCard） */
  dark?: boolean;
}

/** 麦克风 SVG 图标 */
function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0m7 7v4m-4 0h8m-4-16a3 3 0 00-3 3v4a3 3 0 006 0V6a3 3 0 00-3-3z" />
    </svg>
  );
}

/** 录音中的声波动画条 */
function VoiceWaveBars({ size }: { size: 'sm' | 'md' }) {
  const barCount = size === 'sm' ? 3 : 4;
  const barH = size === 'sm' ? 'h-2.5' : 'h-3.5';
  const barW = size === 'sm' ? 'w-[2px]' : 'w-[2.5px]';
  const gap = size === 'sm' ? 'gap-[2px]' : 'gap-[3px]';

  return (
    <div className={`flex items-center ${gap}`}>
      {Array.from({ length: barCount }).map((_, i) => (
        <span
          key={i}
          className={`${barW} ${barH} bg-white rounded-full`}
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

/**
 * 语音输入麦克风按钮 — 微信风格
 * 
 * - 默认态：绿色圆形按钮 + 麦克风图标
 * - 录音中：深绿色 + 声波动画条 + 外圈脉冲
 * - 连接中：绿色呼吸闪烁
 * - 错误态：短暂红色后自动恢复
 */
export function VoiceMicButton({
  onTranscript,
  disabled = false,
  size = 'md',
  className = '',
  dark = false,
}: VoiceMicButtonProps) {
  const [errorFlash, setErrorFlash] = useState(false);

  const {
    status,
    isRecording,
    interimText,
    toggleRecording,
  } = useVoiceInput({
    onTranscript,
    onError: (err) => {
      console.warn('[VoiceMic]', err);
      setErrorFlash(true);
    },
  });

  // 错误闪烁后 2s 自动恢复
  useEffect(() => {
    if (errorFlash) {
      const t = setTimeout(() => setErrorFlash(false), 2000);
      return () => clearTimeout(t);
    }
  }, [errorFlash]);

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setErrorFlash(false);
    await toggleRecording();
  }, [disabled, toggleRecording]);

  const suppressFocusJump = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
  }, []);

  // 尺寸
  const sizeClasses = size === 'sm' ? 'w-8 h-8' : 'w-10 h-10';
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  const pulseSize = size === 'sm' ? 'inset-[-4px]' : 'inset-[-5px]';

  // 按钮样式
  const getButtonStyles = () => {
    if (errorFlash) {
      return 'bg-red-500 text-white shadow-red-500/30';
    }
    if (isRecording) {
      return dark
        ? 'bg-[#232322] hover:bg-[#111111] text-white '
        : 'bg-[#232322] hover:bg-[#232322] text-white ';
    }
    if (status === 'connecting') {
      return dark
        ? 'bg-[#232322] text-white animate-pulse'
        : 'bg-[#D1F4E0] text-white animate-pulse';
    }
    // idle
    return dark
      ? 'bg-slate-800 text-[#787774] hover:bg-[#232322] hover:text-white border border-slate-700 hover:border-[#D1F4E0]'
      : 'bg-[#D1F4E0]/30 text-[#232322] hover:bg-[#D1F4E0]/300 hover:text-white border border-[#D1F4E0] hover:border-[#D1F4E0]';
  };

  const getTitle = () => {
    if (errorFlash) return '语音识别出错，点击重试';
    switch (status) {
      case 'recording': return '点击停止语音输入';
      case 'connecting': return '正在连接语音识别...';
      default: return '点击说话';
    }
  };

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {/* 录音中的外圈脉冲 */}
      {isRecording && (
        <>
          <span
            className={`absolute ${pulseSize} rounded-full pointer-events-none`}
            style={{
              background: 'radial-gradient(circle, rgba(16,185,129,0.25) 0%, transparent 70%)',
              animation: 'micPulse 1.5s ease-in-out infinite',
            }}
          />
          <span
            className={`absolute ${pulseSize} rounded-full border-2 pointer-events-none`}
            style={{
              borderColor: dark ? 'rgba(16,185,129,0.4)' : 'rgba(16,185,129,0.35)',
              animation: 'micRing 1.5s ease-out infinite',
            }}
          />
        </>
      )}

      <button
        type="button"
        onMouseDown={suppressFocusJump}
        onPointerDown={suppressFocusJump}
        onClick={handleClick}
        disabled={disabled || status === 'connecting'}
        title={getTitle()}
        className={`
          relative ${sizeClasses} rounded-full flex items-center justify-center
          transition-all duration-200 ease-out flex-shrink-0
          active:scale-90 
          disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
          ${getButtonStyles()}
        `}
      >
        <span className="relative z-10 flex items-center justify-center">
          {isRecording ? (
            <VoiceWaveBars size={size} />
          ) : (
            <MicIcon className={`${iconSize} transition-transform duration-200 ${status === 'idle' && !disabled ? 'group-hover:scale-110' : ''}`} />
          )}
        </span>
      </button>

      {/* 实时识别中间结果气泡 */}
      {isRecording && interimText && (
        <div
          className={`
            absolute bottom-full mb-2 left-1/2 -translate-x-1/2
            px-3 py-1.5 rounded-xl text-xs max-w-[220px] truncate
            pointer-events-none z-50
            animate-in fade-in slide-in-from-bottom-1 duration-200
            ${dark
              ? 'bg-slate-800 text-[#D1F4E0] border border-slate-700'
              : 'bg-white text-gray-700 border border-[#D1F4E0] '
            }
          `}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#232322] mr-1.5 animate-pulse" />
          {interimText}
        </div>
      )}

      {/* 错误提示 */}
      {errorFlash && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-xl text-xs whitespace-nowrap pointer-events-none z-50 bg-red-50 text-red-600 border border-red-200">
          语音识别出错，请重试
        </div>
      )}

      {/* 全局动画 keyframes */}
      <style jsx>{`
        @keyframes micPulse {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.15); opacity: 0.3; }
        }
        @keyframes micRing {
          0% { transform: scale(0.95); opacity: 0.6; }
          100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export default VoiceMicButton;
