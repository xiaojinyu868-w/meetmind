'use client';

/**
 * IntentVoiceCallScreen — 「聊聊你想要的」打电话模式
 *
 * 用户点了 IntentDialog 顶部的"打电话聊"，进到这一屏：
 *   全屏暖色 → 中央 v7 呼吸光晕 → 底部三个控件（查看文字 / 麦克风 / 挂断）
 *
 * 后端：复用 useOmniRealtimeCall（qwen3.5-omni-realtime via /api/tutor-call）
 * Prompt：用 buildTutorSystemPrompt('goal', { goal: { existingGoals, sessionHint } })
 *         拼出来作为 instructions 传进去。
 *
 * 视觉：呼应 v7 设计宪法（仪式时刻例外允许更情绪化）
 *   - 米白纸感主底（不是黑底科技感）
 *   - 中央 RealtimeOrb（pine 主光环 + vermilion 响应点缀）
 *   - 底部三个 FAB
 */

import * as React from 'react';
import { ChevronDown, Mic, MicOff, MessageSquare, PhoneOff, RotateCcw, X, type LucideIcon } from 'lucide-react';
import { useOmniRealtimeCall } from '@/hooks/useOmniRealtimeCall';
import { RealtimeOrb, type RealtimeOrbState } from './RealtimeOrb';

interface IntentVoiceCallScreenProps {
  open: boolean;
  /** prompt 模板：上层把 buildTutorSystemPrompt('goal', ...) 拼好传进来 */
  instructions: string;
  /** 退出通话（关闭整个屏） */
  onExit: () => void;
  /** 切回文字模式 */
  onSwitchToText: () => void;
  /** 通话过程中识别出的用户文字（最终态） */
  onUserTranscript?: (text: string) => void;
  /** 通话过程中 AI 的最终回复文字 */
  onAssistantTranscriptDone?: (text: string) => void;
}

function formatCallDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface CallButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  large?: boolean;
}

function CallButton({ icon: Icon, label, onClick, disabled, tone = 'default', large }: CallButtonProps) {
  const sizeClass = large ? 'h-[72px] w-[72px]' : 'h-[56px] w-[56px]';
  const iconSize = large ? 26 : 20;
  const toneClass =
    tone === 'danger'
      ? 'border border-[#1C1B19] bg-[#1C1B19] text-white'
      : tone === 'primary'
        ? 'border border-pine bg-pine text-white'
        : 'border border-[#E8E2D5] bg-white text-[#1C1B19]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-[80px] flex-col items-center gap-2.5 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`inline-flex ${sizeClass} items-center justify-center rounded-full ${toneClass} transition-colors duration-200`}
      >
        <Icon size={iconSize} strokeWidth={1.8} />
      </span>
      <span className="whitespace-nowrap text-[11px] font-medium text-[#5C5A55]">{label}</span>
    </button>
  );
}

export function IntentVoiceCallScreen({
  open,
  instructions,
  onExit,
  onSwitchToText,
  onUserTranscript,
  onAssistantTranscriptDone,
}: IntentVoiceCallScreenProps) {
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
    connectOnMount: open,
    onUserTranscript,
    onAssistantTranscriptDone,
  });

  const [connectedAt, setConnectedAt] = React.useState<number | null>(null);
  const [tick, setTick] = React.useState(() => Date.now());
  const [showTranscript, setShowTranscript] = React.useState(false);

  React.useEffect(() => {
    if (!isConnected) {
      setConnectedAt(null);
      setShowTranscript(false);
      return;
    }
    setConnectedAt((prev) => prev ?? Date.now());
  }, [isConnected]);

  React.useEffect(() => {
    if (!connectedAt) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [connectedAt]);

  const elapsed = connectedAt ? formatCallDuration(tick - connectedAt) : '00:00';

  const orbState: RealtimeOrbState = React.useMemo(() => {
    if (isMuted) return 'muted';
    if (status === 'listening') return 'listening';
    if (status === 'thinking') return 'thinking';
    if (status === 'responding') return 'responding';
    return 'idle';
  }, [isMuted, status]);

  const statusLine = React.useMemo(() => {
    if (errorMessage) return '没接通，点重连';
    if (status === 'connecting') return '正在接通…';
    if (status === 'authorizing') return '点下面按钮开始';
    if (isMuted && isConnected) return '已静音 · 我还在';
    if (status === 'listening') return '我在听你说…';
    if (status === 'thinking') return '我想一下…';
    if (status === 'responding') return '我在说…';
    if (isConnected) return '直接说就好';
    return '准备中…';
  }, [errorMessage, status, isMuted, isConnected]);

  const handleExit = React.useCallback(async () => {
    const pendingUser = capturedText.trim();
    if (pendingUser) onUserTranscript?.(pendingUser);
    const pendingAssistant = assistantText.trim();
    if (pendingAssistant) onAssistantTranscriptDone?.(pendingAssistant);
    await disconnectSession();
    onExit();
  }, [assistantText, capturedText, disconnectSession, onAssistantTranscriptDone, onExit, onUserTranscript]);

  if (!open) return null;

  const isConnecting = status === 'connecting';
  const isAuthorizing = status === 'authorizing';
  const primaryDisabled = isConnecting;
  const primaryTone = isMuted || isAuthorizing ? 'default' : 'primary';
  const primaryLabel = isConnecting
    ? '接通中'
    : isAuthorizing
      ? '开始'
      : isMuted
        ? '开麦'
        : '静音';
  const primaryIcon = isMuted || isAuthorizing ? Mic : MicOff;

  const hasTranscript = Boolean(assistantText.trim() || capturedText.trim());

  const leftAction = errorMessage && !isConnected
    ? { icon: RotateCcw, label: '重连', onClick: () => void connectSession(), disabled: false }
    : { icon: MessageSquare, label: '查看文字', onClick: () => setShowTranscript(true), disabled: !hasTranscript };

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-paper px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">
      {/* 顶部 */}
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={onSwitchToText}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-divider bg-white px-3.5 text-[12px] font-medium text-[#5C5A55] transition-colors hover:bg-paper-warm"
        >
          <ChevronDown size={14} strokeWidth={1.8} />
          文字
        </button>
        <span className="text-[12px] font-medium text-[#5C5A55]">聊聊你想要的</span>
        <button
          type="button"
          onClick={() => void handleExit()}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white text-[#5C5A55]"
          aria-label="关闭"
        >
          <X size={16} strokeWidth={1.8} />
        </button>
      </header>

      {/* 中央 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <RealtimeOrb state={orbState} size={144} />
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-[#1C1B19]">在听你说</h1>
          <div className="inline-flex items-center gap-2 rounded-full border border-divider bg-white px-3 py-1.5">
            <span className={`inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-pine' : 'bg-divider'}`} />
            <span className="text-[13px] font-medium text-[#5C5A55]">{statusLine}</span>
            {isConnected ? (
              <span className="text-[13px] font-semibold text-[#1C1B19]">{elapsed}</span>
            ) : null}
          </div>
        </div>
      </div>

      {/* 底部 */}
      <div className="flex w-full items-end justify-center gap-6 pb-2 pt-4">
        <CallButton {...leftAction} />
        <CallButton
          icon={primaryIcon}
          label={primaryLabel}
          onClick={() => void (!primaryDisabled ? toggleRecording() : Promise.resolve())}
          disabled={primaryDisabled}
          tone={primaryTone}
          large
        />
        <CallButton icon={PhoneOff} label="挂断" onClick={() => void handleExit()} tone="danger" />
      </div>

      {/* 文字面板 */}
      {showTranscript ? (
        <>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setShowTranscript(false)}
            className="absolute inset-0 z-20 bg-[#1C1B19]/8"
          />
          <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border border-divider bg-white px-5 pb-[max(env(safe-area-inset-bottom),18px)] pt-5">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-semibold text-[#1C1B19]">本轮对话文字</p>
              <button
                type="button"
                onClick={() => setShowTranscript(false)}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-divider bg-paper-warm px-3 text-[12px] font-medium text-[#5C5A55]"
              >
                收起
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="mt-4 max-h-[50vh] space-y-3 overflow-y-auto pb-1">
              {assistantText.trim() ? (
                <div className="rounded-[20px] border border-divider bg-paper-warm px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#8E8B82]">同学</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-[#1C1B19]">{assistantText.trim()}</p>
                </div>
              ) : null}
              {capturedText.trim() ? (
                <div className="rounded-[20px] border border-divider bg-white px-4 py-3.5">
                  <p className="text-[11px] font-medium text-[#8E8B82]">你</p>
                  <p className="mt-1.5 text-[15px] leading-7 text-[#1C1B19]">{capturedText.trim()}</p>
                </div>
              ) : null}
              {!assistantText.trim() && !capturedText.trim() ? (
                <p className="py-8 text-center text-[14px] text-[#8E8B82]">还没有对话内容</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default IntentVoiceCallScreen;
