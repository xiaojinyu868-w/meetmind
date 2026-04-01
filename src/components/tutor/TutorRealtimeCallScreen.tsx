'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Volume2,
  type LucideIcon,
} from 'lucide-react';
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

interface CallControlButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'primary' | 'danger';
  large?: boolean;
}

function formatCallDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function StageMeter({ active, invert = false }: { active: boolean; invert?: boolean }) {
  const color = invert ? '#FFFFFF' : '#232322';

  return (
    <div className="flex h-[14px] items-center justify-center gap-[3px]">
      {Array.from({ length: 4 }).map((_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full"
          style={{
            backgroundColor: color,
            height: active ? '100%' : '32%',
            opacity: active ? 1 : 0.18,
            animation: active ? `callWave 0.7s ease-in-out ${index * 0.1}s infinite alternate` : 'none',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes callWave {
          0% { height: 28%; opacity: 0.38; }
          100% { height: 100%; opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function CallControlButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  tone = 'default',
  large = false,
}: CallControlButtonProps) {
  const sizeClass = large ? 'h-[78px] w-[78px]' : 'h-[58px] w-[58px]';
  const iconSize = large ? 28 : 22;
  const labelClass = large ? 'text-[12px] text-[#232322]' : 'text-[12px] text-[#787774]';

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
      className="flex w-[86px] flex-col items-center gap-3 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`inline-flex ${sizeClass} items-center justify-center rounded-full ${toneClass} transition-colors duration-300`}>
        <Icon size={iconSize} strokeWidth={1.8} />
      </span>
      <span className={`whitespace-nowrap font-medium ${labelClass} transition-colors duration-300`}>{label}</span>
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
  const [showTranscriptSheet, setShowTranscriptSheet] = useState(false);

  const isConnecting = status === 'connecting';
  const isAuthorizing = status === 'authorizing';
  const isListening = status === 'listening';
  const isThinking = status === 'thinking';
  const isResponding = status === 'responding';
  const isActive = isConnecting || isAuthorizing || isListening || isThinking || isResponding;

  // 顶级体验：极简字幕缓冲机制，避免状态突变时闪烁，实现平滑的话权交接
  const [displayCaption, setDisplayCaption] = useState<{ text: string; speaker: string; isStale: boolean }>({
    text: '',
    speaker: '',
    isStale: false,
  });
  const captionScrollRef = useRef<HTMLDivElement>(null);

  // 顶级体验：抛弃尾部直接截断（line-clamp-2会导致看不见最新字），改为天然打字机：自动将最新行推上来
  useEffect(() => {
    if (captionScrollRef.current) {
      captionScrollRef.current.scrollTop = captionScrollRef.current.scrollHeight;
    }
  }, [displayCaption.text]);

  useEffect(() => {
    if (errorMessage) return;

    if (isResponding) {
      if (assistantText.trim()) {
        setDisplayCaption({ text: assistantText.trim(), speaker: '老师正在说', isStale: false });
      }
    } else if (isListening) {
      if (capturedText.trim()) {
        setDisplayCaption({ text: capturedText.trim(), speaker: '你正在说', isStale: false });
      } else {
        // 刚开始倾听，还没出字，保持旧的字幕，但变灰（天然的过渡态）
        setDisplayCaption((prev) => ({ ...prev, isStale: true }));
      }
    } else if (isThinking || (!isListening && !isResponding && isConnected)) {
      // 思考中，或者通话闲置，保持旧的字幕，但变灰，不立刻消失
      setDisplayCaption((prev) => ({ ...prev, isStale: true }));
    } else if (!isConnected) {
      setDisplayCaption({ text: '', speaker: '', isStale: false });
    }
  }, [errorMessage, isResponding, assistantText, isListening, capturedText, isThinking, isConnected]);

  useEffect(() => {
    if (!isConnected) {
      setConnectedAt(null);
      setShowTranscriptSheet(false);
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
        ambientHint: '先把课堂内容放进来。',
      };
    }

    if (errorMessage) {
      return {
        state: '连接失败',
        badge: '待重连',
        speaker: '状态',
        body: errorMessage,
        ambientHint: '这次没接通，点一下重连。',
      };
    }

    if (isMuted && isConnected) {
      return {
        state: '已静音',
        badge: '老师还在线',
        speaker: '状态',
        body: '你现在能听到老师，但老师听不到你。点中间按钮重新开麦。',
        ambientHint: '当前是静音状态。',
      };
    }

    if (isListening) {
      return {
        state: '正在听你说',
        badge: '已进入真人通话',
        speaker: '你',
        body: capturedText || '继续说就行。老师说到一半时，你直接开口就能打断。',
        ambientHint: '我在听，你直接说。',
      };
    }

    if (isThinking) {
      return {
        state: '老师在想',
        badge: '刚刚听完你这句',
        speaker: '状态',
        body: '这轮语音已经收到了，老师正在组织下一句更自然的回答。',
        ambientHint: '老师在组织下一句。',
      };
    }

    if (isResponding) {
      return {
        state: '老师在说',
        badge: '你可以直接插话',
        speaker: '老师',
        body: assistantText || '现在不用等老师说完，你直接开口就会打断。',
        ambientHint: '不用等说完，随时打断。',
      };
    }

    if (isAuthorizing) {
      return {
        state: '等你开麦',
        badge: '老师已连上',
        speaker: '状态',
        body: '老师已经接通了，现在浏览器还没真正开始听。先允许麦克风；如果已经允许了，就点一下页面中间按钮，让这通电话真正开始。',
        ambientHint: '先允许麦克风。',
      };
    }

    if (isConnecting) {
      return {
        state: '连接老师',
        badge: '正在拨通',
        speaker: '状态',
        body: '正在把这节课交给老师。',
        ambientHint: '正在接通。',
      };
    }

    if (isConnected) {
      return {
        state: '已接通',
        badge: '像打电话一样直接说',
        speaker: assistantText ? '老师' : '状态',
        body: assistantText || '现在已经接通了。保持开麦时，你直接说，老师会自动接住你。',
        ambientHint: '像打电话一样直接说。',
      };
    }

    return {
      state: '正在准备',
      badge: '等待接通',
      speaker: '状态',
      body: '老师还没接通，稍等一下。',
      ambientHint: '稍等，老师马上来。',
    };
  }, [assistantText, capturedText, disabled, errorMessage, isAuthorizing, isConnected, isConnecting, isListening, isMuted, isResponding, isThinking]);

  const secondaryAction = useMemo(() => {
    if (errorMessage && !isConnected) {
      return {
        icon: RotateCcw,
        label: '重连',
        onClick: () => void connectSession(),
      };
    }

    return {
      icon: MessageCircle,
      label: '聊天',
      onClick: () => void (async () => {
        await disconnectSession();
        onExit();
      })(),
    };
  }, [connectSession, disconnectSession, errorMessage, isConnected, onExit]);

  const primaryDisabled = disabled || isConnecting;
  const primaryTone = isMuted || isAuthorizing ? 'default' : 'primary';
  const primaryLabel = isConnecting ? '拨号中' : isAuthorizing ? '点一下开麦' : isMuted ? '开麦' : '静音';
  const primaryIcon = isMuted || isAuthorizing ? Mic : MicOff;

  const hasCaption = Boolean(displayCaption.text);
  const showHelper = errorMessage || isAuthorizing || disabled || (!isConnected && !errorMessage) || isMuted;
  const SecondaryIcon = secondaryAction.icon;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[#F7F7F5] px-4 pb-[max(env(safe-area-inset-bottom),20px)] pt-4">
      {showTranscriptSheet ? (
        <>
          <button
            type="button"
            aria-label="关闭文字面板"
            onClick={() => setShowTranscriptSheet(false)}
            className="absolute inset-0 z-20 bg-[#232322]/8"
          />
          <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-[28px] border border-[#E9E9E7] bg-white px-5 pb-[max(env(safe-area-inset-bottom),18px)] pt-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-medium text-[#A3A39E]">本轮文字</p>
                <p className="mt-1 text-[17px] font-semibold text-[#232322]">{stageCopy.badge}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowTranscriptSheet(false)}
                className="inline-flex h-10 items-center gap-1 rounded-full border border-[#E9E9E7] bg-[#F7F7F5] px-3 text-[12px] font-medium text-[#787774]"
              >
                收起
                <ChevronDown size={14} strokeWidth={1.8} />
              </button>
            </div>

            <div className="mt-4 max-h-[45vh] space-y-3 overflow-y-auto pb-1">
              {assistantText.trim() ? (
                <div className="rounded-[24px] border border-[#E9E9E7] bg-[#F7F7F5] px-4 py-4">
                  <p className="text-[12px] font-medium text-[#A3A39E]">老师</p>
                  <p className="mt-2 text-[16px] leading-7 text-[#232322]">{assistantText.trim()}</p>
                </div>
              ) : null}
              {capturedText.trim() ? (
                <div className="rounded-[24px] border border-[#E9E9E7] bg-white px-4 py-4">
                  <p className="text-[12px] font-medium text-[#A3A39E]">你</p>
                  <p className="mt-2 text-[16px] leading-7 text-[#232322]">{capturedText.trim()}</p>
                </div>
              ) : null}
              <div className="rounded-[24px] border border-[#E9E9E7] bg-white px-4 py-4">
                <p className="text-[12px] font-medium text-[#A3A39E]">状态说明</p>
                <p className="mt-2 text-[15px] leading-7 text-[#232322]">{stageCopy.body}</p>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="flex justify-center pb-2 pt-1">
        <span className="inline-flex items-center rounded-full border border-[#E9E9E7] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#787774]">
          {contextLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center pb-6 pt-4">
        <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-[#DAD8D2] bg-white">
          {isActive ? <span className="absolute inset-0 rounded-full border border-[#232322] opacity-12 animate-ping" /> : null}
          <span className="absolute inset-[12px] rounded-full border border-[#ECEBE6]" />
          <span className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full bg-[#232322] text-[38px] font-medium tracking-[-0.04em] text-white">
            师
          </span>
        </div>

        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <h1 className="text-[34px] font-semibold tracking-[-0.06em] text-[#232322]">{title}</h1>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#E9E9E7] bg-white px-3 py-1.5 text-[13px] font-medium text-[#787774]">
            <span className={`inline-flex h-2.5 w-2.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-[#C9C8C3]'}`} />
            <span>{stageCopy.state}</span>
            {isConnected ? <span className="font-semibold text-[#232322]">{elapsedLabel}</span> : null}
          </div>
          <StageMeter active={isListening || isResponding || isThinking} />
          <p className="text-[13px] font-medium text-[#A3A39E]">{stageCopy.ambientHint}</p>
        </div>
      </div>

      <div className="mt-auto flex w-full flex-col items-center pb-2">
        <div className="relative mb-6 flex h-[84px] w-full flex-col items-center justify-center px-6 text-center">
          <button 
            type="button"
            onClick={() => setShowTranscriptSheet(true)}
            className="group flex h-full w-full flex-col items-center justify-center gap-2"
          >
            {showHelper ? (
              // 强状态覆盖区（错误、等待授权、静音等优先级最高）
              <>
                <div className="flex items-center gap-1.5 opacity-40 transition-opacity group-hover:opacity-100">
                  <span className="text-[11px] font-medium text-[#A3A39E]">{stageCopy.badge}</span>
                </div>
                <p className="line-clamp-2 text-[14px] leading-[1.6] text-[#A3A39E] transition-all">
                  {stageCopy.body}
                </p>
              </>
            ) : hasCaption ? (
              // 顶级通话字幕区（解决截断问题，滚动打字机）
              <>
                <div className={`flex items-center gap-1.5 transition-opacity duration-500 ${displayCaption.isStale ? 'opacity-30' : 'opacity-50 group-hover:opacity-100'}`}>
                  <Volume2 size={12} strokeWidth={2} className="text-[#A3A39E]" />
                  <span className="text-[11px] font-medium text-[#A3A39E]">{displayCaption.speaker}</span>
                </div>
                <div 
                  ref={captionScrollRef}
                  className={`w-full max-h-[50px] overflow-y-hidden scroll-smooth text-[16px] font-medium leading-[25px] text-[#232322] transition-all duration-500 ${displayCaption.isStale ? 'opacity-40' : 'opacity-100'}`}
                >
                  {displayCaption.text}
                </div>
              </>
            ) : (
              // 已接通但双方都没说话兜底提示
              <>
                <div className="flex items-center gap-1.5 opacity-40 transition-opacity group-hover:opacity-100">
                  <span className="text-[11px] font-medium text-[#A3A39E]">{stageCopy.badge}</span>
                </div>
                <p className="line-clamp-2 text-[14px] leading-[1.6] text-[#A3A39E] transition-all">
                  {stageCopy.body}
                </p>
              </>
            )}
          </button>
        </div>

        <div className="flex w-full items-end justify-center gap-4 px-4 sm:gap-8">
          <CallControlButton
            icon={SecondaryIcon}
            label={secondaryAction.label}
            onClick={secondaryAction.onClick}
            disabled={disabled}
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
            label="结束"
            onClick={() => void (async () => {
              await disconnectSession();
              onExit();
            })()}
            disabled={disabled}
            tone="danger"
          />
        </div>
      </div>
    </div>
  );
}

export default TutorRealtimeCallScreen;

