'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  FileText,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import { useOmniRealtimeCall } from '@/hooks/useOmniRealtimeCall';

/* ─── Props ─── */

interface TutorRealtimeCallScreenProps {
  title?: string;
  contextLabel?: string;
  disabled?: boolean;
  instructions: string;
  enableSearch?: boolean;
  onExit: () => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscriptChange: (text: string) => void;
  onAssistantTranscriptDone: (text: string) => void;
  onAssistantResponseStart?: () => void;
  onAssistantResponseEnd?: () => void;
}

interface CallControlButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  large?: boolean;
}

/* ─── Helpers ─── */

function formatCallDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/* ─── Voice Orb ─── */

function VoiceOrb({ state }: { state: 'idle' | 'listening' | 'thinking' | 'responding' | 'muted' }) {
  const isActive = state === 'listening' || state === 'responding' || state === 'thinking';
  const orbLabel = state === 'listening' ? '在听你说' : state === 'thinking' ? '在想' : state === 'responding' ? '在说' : '';

  return (
    <div className="relative flex flex-col items-center gap-5">
      {/* 呼吸光环 */}
      <div className="relative flex h-40 w-40 items-center justify-center">
        {isActive ? (
          <>
            <span
              className="absolute inset-0 rounded-full border border-[#232322]"
              style={{
                opacity: 0.06,
                animation: 'orbPulse 2.4s ease-in-out infinite',
              }}
            />
            <span
              className="absolute inset-[-8px] rounded-full border border-[#232322]"
              style={{
                opacity: 0.03,
                animation: 'orbPulse 2.4s ease-in-out 0.4s infinite',
              }}
            />
          </>
        ) : null}

        {/* 外圈 */}
        <span className="absolute inset-0 rounded-full border border-[#DAD8D2] bg-white" />
        <span className="absolute inset-[10px] rounded-full border border-[#ECEBE6]" />

        {/* 核心圆 */}
        <span className="relative z-10 flex h-[104px] w-[104px] items-center justify-center rounded-full bg-[#232322]">
          {/* 声纹条 */}
          <div className="flex h-[20px] items-end justify-center gap-[4px]">
            {Array.from({ length: 5 }).map((_, i) => (
              <span
                key={i}
                className="w-[3px] rounded-full bg-white"
                style={{
                  height: isActive ? '100%' : '24%',
                  opacity: isActive ? 1 : 0.25,
                  animation: isActive
                    ? `voiceBar 0.6s ease-in-out ${i * 0.08}s infinite alternate`
                    : 'none',
                }}
              />
            ))}
          </div>
        </span>
      </div>

      {/* 状态文字（极淡） */}
      {orbLabel ? (
        <span className="text-[13px] font-medium text-[#A3A39E]">{orbLabel}</span>
      ) : null}

      <style jsx>{`
        @keyframes orbPulse {
          0%, 100% { transform: scale(1); opacity: 0.06; }
          50% { transform: scale(1.08); opacity: 0.12; }
        }
        @keyframes voiceBar {
          0% { height: 20%; opacity: 0.3; }
          100% { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ─── Control Button ─── */

function CallControlButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = 'default',
  large = false,
}: CallControlButtonProps) {
  const sizeClass = large ? 'h-[72px] w-[72px]' : 'h-[56px] w-[56px]';
  const iconSize = large ? 26 : 20;

  const toneClass =
    tone === 'danger'
      ? 'border border-[#232322] bg-[#232322] text-white'
      : tone === 'primary'
        ? 'border border-[#232322] bg-[#232322] text-white'
        : 'border border-[#E9E9E7] bg-white text-[#232322]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-[80px] flex-col items-center gap-2.5 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`inline-flex ${sizeClass} items-center justify-center rounded-full ${toneClass} transition-colors duration-200`}>
        <Icon size={iconSize} strokeWidth={1.8} />
      </span>
      <span className="whitespace-nowrap text-[11px] font-medium text-[#A3A39E] transition-colors duration-200">{label}</span>
    </button>
  );
}

/* ─── Main Screen ─── */

export function TutorRealtimeCallScreen({
  title = '真人老师',
  contextLabel = '整节课',
  disabled = false,
  instructions,
  enableSearch = false,
  onExit,
  onUserTranscript,
  onAssistantTranscriptChange,
  onAssistantTranscriptDone,
  onAssistantResponseStart,
  onAssistantResponseEnd,
}: TutorRealtimeCallScreenProps) {
  const {
    status,
    isConnected,
    isMuted,
    capturedText,
    assistantText,
    errorMessage,
    connectSession,
    disconnectSession,
    toggleRecording,
  } = useOmniRealtimeCall({
    instructions,
    enableSearch,
    connectOnMount: !disabled,
    onUserTranscript,
    onAssistantTranscriptChange,
    onAssistantTranscriptDone,
    onAssistantResponseStart,
    onAssistantResponseEnd,
  });

  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [showTranscript, setShowTranscript] = useState(false);

  const isConnecting = status === 'connecting';
  const isAuthorizing = status === 'authorizing';
  const isListening = status === 'listening';
  const isThinking = status === 'thinking';
  const isResponding = status === 'responding';

  /* ── 计时器 ── */

  useEffect(() => {
    if (!isConnected) {
      setConnectedAt(null);
      setShowTranscript(false);
      return;
    }
    setConnectedAt((prev) => prev ?? Date.now());
  }, [isConnected]);

  useEffect(() => {
    if (!connectedAt) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connectedAt]);

  const elapsed = connectedAt ? formatCallDuration(tick - connectedAt) : '00:00';

  /* ── Orb 状态映射 ── */

  const orbState = useMemo(() => {
    if (isMuted) return 'muted' as const;
    if (isListening) return 'listening' as const;
    if (isThinking) return 'thinking' as const;
    if (isResponding) return 'responding' as const;
    return 'idle' as const;
  }, [isMuted, isListening, isThinking, isResponding]);

  /* ── 顶部一句话状态 ── */

  const statusLine = useMemo(() => {
    if (disabled) return '先收一条课堂内容';
    if (errorMessage) return '没接通，点重连';
    if (isConnecting) return '正在拨号…';
    if (isAuthorizing) return '点下面按钮开始';
    if (isMuted && isConnected) return '已静音 · 老师还在';
    if (isListening) return '在听你说…';
    if (isThinking) return '老师在想…';
    if (isResponding) return '老师在说…';
    if (isConnected) return '已接通 · 直接说';
    return '准备中…';
  }, [disabled, errorMessage, isConnecting, isAuthorizing, isMuted, isConnected, isListening, isThinking, isResponding]);

  /* ── 按钮逻辑 ── */

  const primaryDisabled = disabled || isConnecting;
  const primaryTone = isMuted || isAuthorizing ? 'default' : 'primary';
  const primaryLabel = isConnecting ? '拨号中' : isAuthorizing ? '开始' : isMuted ? '开麦' : '静音';
  const primaryIcon = isMuted || isAuthorizing ? Mic : MicOff;

  const hasTranscript = Boolean(assistantText.trim() || capturedText.trim());

  /* ── 左侧按钮：错误时显示重连，否则显示查看文字（需有内容时才亮） ── */

  const leftAction = useMemo(() => {
    if (errorMessage && !isConnected) {
      return {
        icon: RotateCcw,
        label: '重连',
        onClick: () => void connectSession(),
        disabled: false,
      };
    }
    return {
      icon: FileText,
      label: '查看文字',
      onClick: () => setShowTranscript(true),
      disabled: !hasTranscript,
    };
  }, [connectSession, errorMessage, hasTranscript, isConnected]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#F7F7F5] px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">

      {/* ── 文字面板（从底部滑出） ── */}
      {showTranscript ? (
        <>
          <button
            type="button"
            aria-label="关闭文字面板"
            onClick={() => setShowTranscript(false)}
            className="absolute inset-0 z-20 bg-[#232322]/8"
          />
          <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border border-[#E9E9E7] bg-white px-5 pb-[max(env(safe-area-inset-bottom),18px)] pt-5">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold text-[#232322]">本轮对话文字</p>
              <button
                type="button"
                onClick={() => setShowTranscript(false)}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-[#E9E9E7] bg-[#F7F7F5] px-3 text-[12px] font-medium text-[#787774]"
              >
                收起
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pb-1">
              {assistantText.trim() ? (
                <div className="rounded-[20px] border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#A3A39E]">老师</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-[#232322]">{assistantText.trim()}</p>
                </div>
              ) : null}
              {capturedText.trim() ? (
                <div className="rounded-[20px] border border-[#E9E9E7] bg-white px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#A3A39E]">你</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-[#232322]">{capturedText.trim()}</p>
                </div>
              ) : null}
              {!assistantText.trim() && !capturedText.trim() ? (
                <p className="py-8 text-center text-[14px] text-[#A3A39E]">还没有对话内容</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {/* ── 顶部 badge ── */}
      <div className="flex justify-center pb-2 pt-1">
        <span className="inline-flex items-center rounded-full border border-[#E9E9E7] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#787774]">
          {contextLabel}
        </span>
      </div>

      {/* ── 中央舞台：Orb + 标题 + 状态 ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <VoiceOrb state={orbState} />

        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-[32px] font-semibold tracking-[-0.04em] text-[#232322]">{title}</h1>

          <div className="inline-flex items-center gap-2 rounded-full border border-[#E9E9E7] bg-white px-3 py-1.5">
            <span className={`inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-[#C9C8C3]'}`} />
            <span className="text-[13px] font-medium text-[#787774]">{statusLine}</span>
            {isConnected ? (
              <span className="text-[13px] font-semibold text-[#232322]">{elapsed}</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── 底部控制区（绝对稳定） ── */}
      <div className="flex w-full items-end justify-center gap-6 pb-2 pt-4">
        <CallControlButton
          icon={leftAction.icon}
          label={leftAction.label}
          onClick={leftAction.onClick}
          disabled={leftAction.disabled}
        />

        <CallControlButton
          icon={primaryIcon}
          label={primaryLabel}
          onClick={() => void (!primaryDisabled ? toggleRecording() : Promise.resolve())}
          disabled={primaryDisabled}
          tone={primaryTone}
          large
        />

        <CallControlButton
          icon={PhoneOff}
          label="结束通话"
          onClick={() => void (async () => {
            // 先结束当前响应轮次（重置 finalize 标记），再 flush 最终文本
            onAssistantResponseEnd?.();

            const pendingUser = capturedText.trim();
            if (pendingUser) {
              onUserTranscript(pendingUser);
            }
            const pendingAssistant = assistantText.trim();
            if (pendingAssistant) {
              onAssistantTranscriptDone(pendingAssistant);
            }

            await disconnectSession();
            onExit();
          })()}
          disabled={disabled}
          tone="danger"
        />
      </div>
    </div>
  );
}

export default TutorRealtimeCallScreen;
