'use client';

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Mic, MicOff, PhoneOff, RotateCcw, Volume2, type LucideIcon } from 'lucide-react';
import { useOmniRealtimeCall } from '@/hooks/useOmniRealtimeCall';

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

function formatCallDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function StageMeter({ active }: { active: boolean }) {
  return (
    <div className="mt-3 flex items-end justify-center gap-1.5">
      {Array.from({ length: 5 }).map((_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-[#232322]"
          style={{
            height: 10 + (index % 3) * 5,
            opacity: active ? 1 : 0.14,
            animation: active ? `callMeter 0.9s ease-in-out ${index * 0.09}s infinite alternate` : 'none',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes callMeter {
          0% { transform: scaleY(0.3); opacity: 0.28; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

interface CallActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  muted?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

function CallActionButton({
  icon: Icon,
  label,
  onClick,
  muted = false,
  danger = false,
  disabled = false,
}: CallActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`inline-flex h-12 w-12 items-center justify-center rounded-full border ${
          danger
            ? 'border-[#232322] bg-[#232322] text-white'
            : muted
              ? 'border-[#E9E9E7] bg-white text-[#A3A39E]'
              : 'border-[#E9E9E7] bg-white text-[#232322]'
        }`}
      >
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className={`text-[11px] ${muted ? 'text-[#A3A39E]' : 'text-[#787774]'}`}>{label}</span>
    </button>
  );
}

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
  const isConnecting = status === 'connecting';
  const isAuthorizing = status === 'authorizing';
  const isListening = status === 'listening';
  const isThinking = status === 'thinking';
  const isResponding = status === 'responding';
  const isActive = isConnecting || isAuthorizing || isListening || isThinking || isResponding;

  useEffect(() => {
    if (!isConnected) {
      setConnectedAt(null);
      return;
    }

    setConnectedAt((previous) => previous ?? Date.now());
  }, [isConnected]);

  useEffect(() => {
    if (!connectedAt) return;

    const timer = window.setInterval(() => {
      setTick(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [connectedAt]);

  const elapsedLabel = connectedAt ? formatCallDuration(tick - connectedAt) : '00:00';

  const stageCopy = useMemo(() => {
    if (disabled) {
      return {
        state: '还没接通',
        badge: '先收内容',
        speaker: '状态',
        body: '先收一条课堂内容，再发起真人老师通话。',
      };
    }

    if (errorMessage) {
      return {
        state: '连接失败',
        badge: '待重连',
        speaker: '状态',
        body: errorMessage,
      };
    }

    if (isMuted && isConnected) {
      return {
        state: '已静音',
        badge: '老师还在线',
        speaker: '状态',
        body: '你现在能听到老师，但老师听不到你。点中间按钮重新开麦。',
      };
    }

    if (isListening) {
      return {
        state: '正在听你说',
        badge: '已进入真人通话',
        speaker: '你',
        body: capturedText || '继续说就行。老师说到一半时，你直接开口就能打断。',
      };
    }

    if (isThinking) {
      return {
        state: '老师在想',
        badge: '刚刚听完你这句',
        speaker: '状态',
        body: '这轮语音已经收到了，老师正在组织下一句更自然的回答。',
      };
    }

    if (isResponding) {
      return {
        state: '老师在说',
        badge: '你可以直接插话',
        speaker: '老师',
        body: assistantText || '现在不用等老师说完，你直接开口就会打断。',
      };
    }

    if (isAuthorizing) {
      return {
        state: '等你开麦',
        badge: '老师已连上',
        speaker: '状态',
        body: '老师已经接通了，现在浏览器还没真正开始听。先允许麦克风；如果已经允许了，就点一下页面中间按钮，让这通电话真正开始。',
      };
    }

    if (isConnecting) {
      return {
        state: '连接老师',
        badge: '正在拨通',
        speaker: '状态',
        body: '正在把这节课交给老师。',
      };
    }

    if (isConnected) {
      return {
        state: '已接通',
        badge: '像打电话一样直接说',
        speaker: assistantText ? '老师' : '状态',
        body: assistantText || '现在已经接通了。保持开麦时，你直接说，老师会自动接住你。',
      };
    }

    return {
      state: '正在准备',
      badge: '等待接通',
      speaker: '状态',
      body: '老师还没接通，稍等一下。',
    };
  }, [assistantText, capturedText, disabled, errorMessage, isAuthorizing, isConnected, isConnecting, isListening, isMuted, isResponding, isThinking]);

  const secondaryAction = useMemo(() => {
    if (errorMessage && !isConnected) {
      return {
        icon: RotateCcw,
        label: '重连',
        muted: false,
        onClick: () => void connectSession(),
      };
    }

    return {
      icon: MessageCircle,
      label: '聊天',
      muted: false,
      onClick: () => void (async () => {
        await disconnectSession();
        onExit();
      })(),
    };
  }, [connectSession, disconnectSession, errorMessage, isConnected, onExit]);

  const primaryDisabled = disabled || isConnecting;
  const primaryLabel = isConnecting ? '拨号中' : isAuthorizing ? '点一下开麦' : isMuted ? '开麦' : '静音';

  return (
    <div className="flex h-full flex-col bg-[#F7F7F5] px-5 pb-[max(env(safe-area-inset-bottom),20px)] pt-6">
      <div className="flex-1">
        <div className="flex h-full flex-col items-center justify-between">
          <div className="flex flex-col items-center pt-6 text-center">
            <span className="inline-flex items-center rounded-full border border-[#E9E9E7] bg-white px-3 py-1 text-[11px] text-[#787774]">
              {contextLabel}
            </span>

            <div className="relative mt-10 flex h-32 w-32 items-center justify-center">
              {isActive ? <span className="absolute inset-0 rounded-full border border-[#232322] opacity-15 animate-ping" /> : null}
              <span className={`absolute inset-[10px] rounded-full border ${isActive ? 'border-[#D9D8D3]' : 'border-[#ECEBE6]'}`} />
              <div className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full border border-[#E9E9E7] bg-white text-[28px] font-semibold text-[#232322]">
                师
              </div>
            </div>

            <p className="mt-8 text-[28px] font-semibold tracking-[-0.05em] text-[#232322]">{title}</p>
            <div className="mt-3 flex items-center gap-2 text-sm text-[#787774]">
              <span className={`inline-flex h-2 w-2 rounded-full ${isActive || isConnected ? 'bg-[#232322]' : 'bg-[#C9C8C3]'}`} />
              <span>{stageCopy.state}</span>
              {isConnected ? <span className="font-medium text-[#232322]">{elapsedLabel}</span> : null}
            </div>
            <StageMeter active={isListening || isResponding || isThinking} />
          </div>

          <div className="w-full max-w-sm">
            <div className="rounded-[28px] border border-[#E9E9E7] bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-[11px] text-[#A3A39E]">
                <Volume2 size={13} strokeWidth={1.9} />
                <span>{stageCopy.badge}</span>
              </div>
              <div className="mt-3 rounded-[20px] border border-[#F0EFEB] bg-[#F7F7F5] px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-[11px] text-[#A3A39E]">
                  <span>{stageCopy.speaker}</span>
                  {isResponding ? <span>可直接打断</span> : null}
                </div>
                <p className="mt-2 min-h-[64px] text-[15px] leading-7 text-[#232322]">{stageCopy.body}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-end justify-center gap-7">
        <CallActionButton
          icon={secondaryAction.icon}
          label={secondaryAction.label}
          muted={disabled}
          onClick={secondaryAction.onClick}
          disabled={disabled}
        />

        <button
          type="button"
          onClick={() => void (!primaryDisabled ? toggleRecording() : Promise.resolve())}
          disabled={primaryDisabled}
          className={`flex flex-col items-center gap-2 disabled:opacity-40 ${
            primaryDisabled ? 'cursor-not-allowed' : ''
          }`}
        >
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full border border-[#232322] bg-[#232322] text-white">
            {isMuted || isAuthorizing ? <Mic size={24} strokeWidth={2} /> : <MicOff size={24} strokeWidth={2} />}
          </span>
          <span className="text-[11px] text-[#787774]">{primaryLabel}</span>
        </button>

        <CallActionButton
          icon={PhoneOff}
          label="结束"
          danger
          disabled={disabled}
          onClick={() => void (async () => {
            await disconnectSession();
            onExit();
          })()}
        />
      </div>
    </div>
  );
}

export default TutorRealtimeCallScreen;
