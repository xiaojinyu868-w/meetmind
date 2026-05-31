'use client';

import { useMemo } from 'react';
import { MessageCircle, PhoneCall, PhoneOff } from 'lucide-react';
import { useOmniRealtimeCall } from '@/hooks/useOmniRealtimeCall';

interface TutorRealtimeCallBarProps {
  disabled?: boolean;
  instructions: string;
  enableSearch?: boolean;
  onUserTranscript: (text: string) => void;
  onAssistantTranscriptChange: (text: string) => void;
  onAssistantTranscriptDone: (text: string) => void;
  onAssistantResponseStart?: () => void;
  onAssistantResponseEnd?: () => void;
}

function LevelMeter({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-1">
      {Array.from({ length: 4 }).map((_, index) => (
        <span
          key={index}
          className="w-[3px] rounded-full bg-[#1C1B19]"
          style={{
            height: 10 + (index % 2) * 4,
            opacity: active ? 1 : 0.16,
            animation: active ? `phoneMeter 0.9s ease-in-out ${index * 0.12}s infinite alternate` : 'none',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes phoneMeter {
          0% { transform: scaleY(0.4); opacity: 0.3; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function TutorRealtimeCallBar({
  disabled = false,
  instructions,
  enableSearch = false,
  onUserTranscript,
  onAssistantTranscriptChange,
  onAssistantTranscriptDone,
  onAssistantResponseStart,
  onAssistantResponseEnd,
}: TutorRealtimeCallBarProps) {
  const {
    status,
    isMuted,
    capturedText,
    assistantText,
    errorMessage,
    toggleRecording,
  } = useOmniRealtimeCall({
    instructions,
    enableSearch,
    onUserTranscript,
    onAssistantTranscriptChange,
    onAssistantTranscriptDone,
    onAssistantResponseStart,
    onAssistantResponseEnd,
  });

  const isListening = status === 'listening';
  const isConnecting = status === 'connecting';
  const isAuthorizing = status === 'authorizing';
  const isThinking = status === 'thinking';
  const isResponding = status === 'responding';
  const isActive = isListening || isConnecting || isAuthorizing || isThinking || isResponding;

  const copy = useMemo(() => {
    if (errorMessage) {
      return {
        title: '重试',
        body: errorMessage,
      };
    }

    if (isMuted) {
      return {
        title: '已静音',
        body: '点一下继续开麦',
      };
    }

    if (isListening) {
      return {
        title: '正在听',
        body: capturedText || '...',
      };
    }

    if (isConnecting) {
      return {
        title: '连接老师',
        body: '正在拨通...',
      };
    }

    if (isAuthorizing) {
      return {
        title: '等待开麦',
        body: '先允许麦克风，再点一下让电话开始听',
      };
    }

    if (isThinking) {
      return {
        title: '老师在想',
        body: capturedText || '...',
      };
    }

    if (isResponding) {
      return {
        title: '老师回复中',
        body: assistantText || capturedText || '...',
      };
    }

    return {
      title: '已接通',
      body: capturedText || '像打电话一样直接开口',
    };
  }, [assistantText, capturedText, errorMessage, isAuthorizing, isConnecting, isListening, isMuted, isResponding, isThinking]);

  return (
    <div className="rounded-[24px] border border-[#E8E2D5] bg-white p-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void toggleRecording()}
          disabled={disabled}
          className={`relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            isActive
              ? 'border-[#1C1B19] bg-[#1C1B19] text-white'
              : 'border-[#D9D8D3] bg-white text-[#1C1B19]'
          }`}
          title={isMuted ? '重新开麦' : '静音'}
        >
          {isActive ? (
            <>
              <span className="absolute inset-[-5px] rounded-full border border-[#1C1B19] opacity-20 animate-ping" />
              <PhoneOff size={18} strokeWidth={1.8} />
            </>
          ) : (
            <PhoneCall size={18} strokeWidth={1.8} />
          )}
        </button>

        <button
          type="button"
          onClick={() => void toggleRecording()}
          disabled={disabled}
          className="min-w-0 flex-1 rounded-[18px] border border-[#E8E2D5] bg-[#FAF7F2] px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          title={isMuted ? '重新开麦' : '静音'}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`inline-flex h-2 w-2 rounded-full ${isActive ? 'bg-[#1C1B19]' : 'bg-[#C9C8C3]'}`} />
              <span className={`truncate text-[15px] font-medium ${isActive ? 'text-[#1C1B19]' : 'text-[#5C5A55]'}`}>
                {copy.title}
              </span>
            </div>
            <LevelMeter active={isActive} />
          </div>
          <div className="mt-1 flex items-center gap-2">
            <MessageCircle size={12} strokeWidth={1.8} className="flex-shrink-0 text-[#8E8B82]" />
            <p className="truncate text-xs text-[#5C5A55]">{copy.body}</p>
          </div>
        </button>
      </div>
    </div>
  );
}

export default TutorRealtimeCallBar;
