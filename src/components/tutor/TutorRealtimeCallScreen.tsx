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
    <div className="flex items-center justify-center gap-[3px] h-[14px]">
      {Array.from({ length: 4 }).map((_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-[#232322]"
          style={{
            height: active ? '100%' : '30%',
            opacity: active ? 1 : 0.2,
            animation: active ? `pulseWave 0.7s ease-in-out ${index * 0.12}s infinite alternate` : 'none',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes pulseWave {
          0% { height: 30%; opacity: 0.4; }
          100% { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
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
    <div className="flex h-full flex-col bg-[#F7F7F5]">
      {/* 顶部标签 */}
      <div className="flex justify-center pt-5 px-6 pb-2">
        <span className="inline-flex items-center rounded-full border border-[#E9E9E7] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#787774]">
          {contextLabel}
        </span>
      </div>

      {/* 核心视觉区：头像与通话状态 */}
      <div className="flex-1 flex flex-col items-center justify-center pb-2">
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-[#232322]">
          {isActive && (
            <div 
              className="absolute inset-0 rounded-full bg-[#232322] animate-ping opacity-10" 
              style={{ animationDuration: '2s' }} 
            />
          )}
          <span className="text-[34px] font-medium tracking-tight text-white">师</span>
        </div>

        <div className="mt-8 flex flex-col items-center gap-2">
          <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-[#232322]">{title}</h1>
          <div className="flex items-center gap-2 text-[14px] font-medium text-[#787774]">
            {isConnected ? (
              <span className="inline-flex items-center gap-2.5">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
                <span className="text-[#232322] font-semibold tracking-wide">{elapsedLabel}</span>
              </span>
            ) : (
              <span>{stageCopy.state}</span>
            )}
          </div>
        </div>
      </div>

      {/* 内容信息卡片：呈现对话内容与指示 */}
      <div className="w-full px-5 pb-8">
        <div className="relative min-h-[156px] w-full rounded-[32px] border border-[#E9E9E7] bg-white p-6 transition-all duration-300">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[13px] font-medium text-[#A3A39E] tracking-wide">
              {stageCopy.speaker === '状态' ? '提示' : stageCopy.speaker}
            </span>
            {(isListening || isThinking || isResponding) ? (
              <StageMeter active={true} />
            ) : (
              <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#A3A39E]">
                <Volume2 size={13} strokeWidth={2} />
                <span>{stageCopy.badge}</span>
              </div>
            )}
          </div>
          <p className="text-[17px] leading-[1.65] font-medium text-[#232322]">
            {stageCopy.body}
          </p>
        </div>
      </div>

      {/* 底部操作区 */}
      <div className="pb-[max(env(safe-area-inset-bottom),32px)] pt-2 px-8 flex items-end justify-center gap-8">
        <button
          type="button"
          onClick={secondaryAction.onClick}
          disabled={disabled}
          className="flex flex-col items-center gap-3 disabled:opacity-40"
        >
          <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full border border-[#E9E9E7] bg-white text-[#232322] transition-transform active:scale-95">
            <secondaryAction.icon size={22} strokeWidth={1.8} />
          </span>
          <span className="text-[12px] font-medium text-[#787774]">{secondaryAction.label}</span>
        </button>

        <button
          type="button"
          onClick={() => void (!primaryDisabled ? toggleRecording() : Promise.resolve())}
          disabled={primaryDisabled}
          className="flex flex-col items-center gap-3 disabled:opacity-40"
        >
          <span 
            className={`flex h-[76px] w-[76px] items-center justify-center rounded-full transition-all active:scale-95 ${
              isMuted || isAuthorizing 
                ? 'border border-[#E9E9E7] bg-white text-[#232322]' 
                : 'border border-[#232322] bg-[#232322] text-white shadow-sm'
            }`}
          >
            {isMuted || isAuthorizing ? <MicOff size={30} strokeWidth={1.8} /> : <Mic size={30} strokeWidth={1.8} />}
          </span>
          <span className="text-[12px] font-medium text-[#232322]">{primaryLabel}</span>
        </button>

        <button
          type="button"
          onClick={() => void (async () => {
            await disconnectSession();
            onExit();
          })()}
          disabled={disabled}
          className="flex flex-col items-center gap-3 disabled:opacity-40"
        >
          <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#232322] text-white transition-transform active:scale-95">
            <PhoneOff size={22} strokeWidth={1.8} />
          </span>
          <span className="text-[12px] font-medium text-[#787774]">结束</span>
        </button>
      </div>
    </div>
  );
}

export default TutorRealtimeCallScreen;

