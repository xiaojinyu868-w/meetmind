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
import { COPY } from '@/lib/ui/copy';
import { RealtimeOrb, type RealtimeOrbState } from '@/components/realtime/RealtimeOrb';

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
//
// 历史上这里有一个本地 VoiceOrb（克制黑底版），现在统一用 v7 呼吸光晕版 RealtimeOrb，
// 「聊聊你想要的」和复习态语音同桌共用一个视觉模板，避免两套并存。
//
// 状态映射：useOmniRealtimeCall 的 status → RealtimeOrbState
//   listening / thinking / responding / muted 直接对应；
//   其它（idle / connecting / authorizing / error）映射到 'idle'。

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
      ? 'border border-[#1C1B19] bg-[#1C1B19] text-white'
      : tone === 'primary'
        ? 'border border-[#1C1B19] bg-[#1C1B19] text-white'
        : 'border border-[#E8E2D5] bg-white text-[#1C1B19]';

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
      <span className="whitespace-nowrap text-[11px] font-medium text-[#8E8B82] transition-colors duration-200">{label}</span>
    </button>
  );
}

/* ─── Main Screen ─── */

export function TutorRealtimeCallScreen({
  title = COPY.realtime.defaultTitle,
  contextLabel = COPY.realtime.defaultContext,
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

  const orbState = useMemo<RealtimeOrbState>(() => {
    if (isMuted) return 'muted';
    if (isListening) return 'listening';
    if (isThinking) return 'thinking';
    if (isResponding) return 'responding';
    return 'idle';
  }, [isMuted, isListening, isThinking, isResponding]);

  /* ── 顶部一句话状态 ── */

  const statusLine = useMemo(() => {
    if (disabled) return COPY.realtime.disabled;
    if (errorMessage) return COPY.realtime.reconnect;
    if (isConnecting) return COPY.realtime.connecting;
    if (isAuthorizing) return COPY.realtime.authorizing;
    if (isMuted && isConnected) return COPY.realtime.muted;
    if (isListening) return COPY.realtime.listening;
    if (isThinking) return COPY.realtime.thinking;
    if (isResponding) return COPY.realtime.responding;
    if (isConnected) return COPY.realtime.connected;
    return COPY.realtime.preparing;
  }, [disabled, errorMessage, isConnecting, isAuthorizing, isMuted, isConnected, isListening, isThinking, isResponding]);

  /* ── 按钮逻辑 ── */

  const primaryDisabled = disabled || isConnecting;
  const primaryTone = isMuted || isAuthorizing ? 'default' : 'primary';
  const primaryLabel = isConnecting
    ? COPY.realtime.dialing
    : isAuthorizing
      ? COPY.realtime.start
      : isMuted
        ? COPY.realtime.unmute
        : COPY.realtime.mute;
  const primaryIcon = isMuted || isAuthorizing ? Mic : MicOff;

  const hasTranscript = Boolean(assistantText.trim() || capturedText.trim());

  /* ── 左侧按钮：错误时显示重连，否则显示查看文字（需有内容时才亮） ── */

  const leftAction = useMemo(() => {
    if (errorMessage && !isConnected) {
      return {
        icon: RotateCcw,
        label: COPY.realtime.reconnectAction,
        onClick: () => void connectSession(),
        disabled: false,
      };
    }
    return {
      icon: FileText,
      label: COPY.realtime.showText,
      onClick: () => setShowTranscript(true),
      disabled: !hasTranscript,
    };
  }, [connectSession, errorMessage, hasTranscript, isConnected]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#FAF7F2] px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">

      {/* ── 文字面板（从底部滑出） ── */}
      {showTranscript ? (
        <>
          <button
            type="button"
            aria-label="关闭文字面板"
            onClick={() => setShowTranscript(false)}
            className="absolute inset-0 z-20 bg-[#1C1B19]/8"
          />
          <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border border-[#E8E2D5] bg-white px-5 pb-[max(env(safe-area-inset-bottom),18px)] pt-5">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold text-[#1C1B19]">{COPY.realtime.transcriptTitle}</p>
              <button
                type="button"
                onClick={() => setShowTranscript(false)}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-[#E8E2D5] bg-[#FAF7F2] px-3 text-[12px] font-medium text-[#5C5A55]"
              >
                {COPY.realtime.collapse}
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pb-1">
              {assistantText.trim() ? (
                <div className="rounded-[20px] border border-[#E8E2D5] bg-[#FAF7F2] px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#8E8B82]">{COPY.realtime.assistantLabel}</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-[#1C1B19]">{assistantText.trim()}</p>
                </div>
              ) : null}
              {capturedText.trim() ? (
                <div className="rounded-[20px] border border-[#E8E2D5] bg-white px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#8E8B82]">{COPY.realtime.userLabel}</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-[#1C1B19]">{capturedText.trim()}</p>
                </div>
              ) : null}
              {!assistantText.trim() && !capturedText.trim() ? (
                <p className="py-8 text-center text-[14px] text-[#8E8B82]">{COPY.realtime.emptyTranscript}</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {/* ── 顶部 badge ── */}
      <div className="flex justify-center pb-2 pt-1">
        <span className="inline-flex items-center rounded-full border border-[#E8E2D5] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#5C5A55]">
          {contextLabel}
        </span>
      </div>

      {/* ── 中央舞台：Orb + 标题 + 状态 ── */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <RealtimeOrb state={orbState} size={120} />

        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-[32px] font-semibold tracking-[-0.04em] text-[#1C1B19]">{title}</h1>

          <div className="inline-flex items-center gap-2 rounded-full border border-[#E8E2D5] bg-white px-3 py-1.5">
            <span className={`inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-pine' : 'bg-divider'}`} />
            <span className="text-[13px] font-medium text-[#5C5A55]">{statusLine}</span>
            {isConnected ? (
              <span className="text-[13px] font-semibold text-[#1C1B19]">{elapsed}</span>
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
          label={COPY.realtime.endCall}
          onClick={() => void (async () => {
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
