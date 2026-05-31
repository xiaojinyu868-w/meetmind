'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneCall, PhoneOff } from 'lucide-react';
import { useVoiceInput, type VoiceInputStatus } from '@/hooks/useVoiceInput';

interface TutorCallComposerProps {
  disabled?: boolean;
  compact?: boolean;
  hint?: string;
  variant?: 'hero' | 'dock';
  onSubmitTranscript: (text: string) => void | Promise<void>;
}

type CallTone = 'idle' | 'live' | 'busy';

interface CallStatusCopy {
  title: string;
  body: string;
  tone: CallTone;
}

function CallMeter({
  active,
  compact,
}: {
  active: boolean;
  compact: boolean;
}) {
  return (
    <div className={`flex items-end ${compact ? 'gap-1' : 'gap-[5px]'}`}>
      {Array.from({ length: compact ? 4 : 5 }).map((_, index) => (
        <span
          key={index}
          className={`${compact ? 'w-[3px]' : 'w-1'} rounded-full bg-[#1C1B19] transition-opacity duration-200`}
          style={{
            height: compact ? 10 + (index % 2) * 4 : 12 + (index % 3) * 5,
            opacity: active ? 1 : 0.16,
            animation: active ? `callMeter 0.9s ease-in-out ${index * 0.12}s infinite alternate` : 'none',
          }}
        />
      ))}
      <style jsx>{`
        @keyframes callMeter {
          0% { transform: scaleY(0.42); opacity: 0.28; }
          100% { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function getStatusCopy({
  status,
  isSubmitting,
  transcript,
  errorMessage,
  heardNothing,
}: {
  status: VoiceInputStatus;
  isSubmitting: boolean;
  transcript: string;
  errorMessage: string;
  heardNothing: boolean;
}): CallStatusCopy {
  if (errorMessage) {
    return {
      title: '重试',
      body: errorMessage,
      tone: 'idle',
    };
  }

  if (isSubmitting) {
    return {
      title: '老师回复中',
      body: transcript || '这一轮已经发出',
      tone: 'busy',
    };
  }

  if (status === 'connecting') {
    return {
      title: '接通中',
      body: '...',
      tone: 'busy',
    };
  }

  if (status === 'recording') {
    return {
      title: '正在听',
      body: transcript || '...',
      tone: 'live',
    };
  }

  if (heardNothing) {
    return {
      title: '没听清',
      body: '再说一遍',
      tone: 'idle',
    };
  }

  if (transcript) {
    return {
      title: '已发出',
      body: transcript,
      tone: 'busy',
    };
  }

  return {
    title: '待接通',
    body: '...',
    tone: 'idle',
  };
}

export function TutorCallComposer({
  disabled = false,
  compact = false,
  hint,
  variant = 'dock',
  onSubmitTranscript,
}: TutorCallComposerProps) {
  const [capturedText, setCapturedText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [heardNothing, setHeardNothing] = useState(false);
  const autoSubmitKeyRef = useRef<string | null>(null);
  const previousStatusRef = useRef<VoiceInputStatus>('idle');
  const heardDuringCurrentRoundRef = useRef(false);

  const handleSubmitTranscript = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    setErrorMessage('');
    setHeardNothing(false);
    try {
      await onSubmitTranscript(trimmed);
      setCapturedText('');
      heardDuringCurrentRoundRef.current = false;
      autoSubmitKeyRef.current = null;
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : '发送失败，请再试一次。';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [onSubmitTranscript]);

  const {
    status,
    interimText,
    toggleRecording,
  } = useVoiceInput({
    onTranscript: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      heardDuringCurrentRoundRef.current = true;
      setHeardNothing(false);
      setErrorMessage('');
      setCapturedText((prev) => `${prev}${text}`.trim());
    },
    onError: (message) => {
      heardDuringCurrentRoundRef.current = false;
      setHeardNothing(false);
      setErrorMessage(message);
    },
  });

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    if (status === 'connecting') {
      setErrorMessage('');
      setHeardNothing(false);
      return;
    }

    if (
      status === 'idle' &&
      (previousStatus === 'connecting' || previousStatus === 'recording') &&
      !capturedText.trim() &&
      !interimText.trim() &&
      !heardDuringCurrentRoundRef.current &&
      !errorMessage
    ) {
      setHeardNothing(true);
    }
  }, [capturedText, errorMessage, interimText, status]);

  useEffect(() => {
    if (status !== 'idle') {
      autoSubmitKeyRef.current = null;
      return;
    }

    const trimmed = capturedText.trim();
    if (!trimmed || isSubmitting) return;

    const submitKey = `${trimmed}:${trimmed.length}`;
    if (autoSubmitKeyRef.current === submitKey) return;
    autoSubmitKeyRef.current = submitKey;

    void handleSubmitTranscript(trimmed);
  }, [capturedText, handleSubmitTranscript, isSubmitting, status]);

  const handleToggleRecording = useCallback(async () => {
    if (disabled || isSubmitting) return;

    if (status === 'idle') {
      setCapturedText('');
      setErrorMessage('');
      setHeardNothing(false);
      heardDuringCurrentRoundRef.current = false;
      autoSubmitKeyRef.current = null;
    }

    await toggleRecording();
  }, [disabled, isSubmitting, status, toggleRecording]);

  const isRecording = status === 'recording';
  const isConnecting = status === 'connecting';
  const displayTranscript = isRecording ? `${capturedText}${interimText}`.trim() : capturedText.trim();
  const copy = getStatusCopy({
    status,
    isSubmitting,
    transcript: displayTranscript,
    errorMessage,
    heardNothing,
  });
  const isHero = variant === 'hero';
  const isActive = isSubmitting || isRecording || isConnecting;
  const titleToneClass = copy.tone === 'live'
    ? 'text-[#1C1B19]'
    : copy.tone === 'busy'
      ? 'text-[#1C1B19]'
      : 'text-[#5C5A55]';
  const buttonClass = isActive
    ? 'border-[#1C1B19] bg-[#1C1B19] text-white'
    : 'border-[#D9D8D3] bg-white text-[#1C1B19] hover:border-[#1C1B19]';

  if (!isHero && compact) {
    return (
      <div className="rounded-[24px] border border-[#E8E2D5] bg-white p-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleToggleRecording()}
            disabled={disabled || isSubmitting}
            className={`relative flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${buttonClass}`}
            title={isRecording ? '结束这一轮说话' : '开始像打电话一样说话'}
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
            onClick={() => void handleToggleRecording()}
            disabled={disabled || isSubmitting}
            className="min-w-0 flex-1 rounded-[18px] border border-[#E8E2D5] bg-[#FAF7F2] px-4 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div className="flex items-center justify-between gap-3">
              <span className={`truncate text-[15px] font-medium ${titleToneClass}`}>{copy.title}</span>
              <CallMeter active={isActive} compact />
            </div>
            <p className="mt-1 truncate text-xs text-[#5C5A55]">
              {copy.body}
            </p>
          </button>
        </div>
      </div>
    );
  }

  if (!isHero) {
    return (
      <div className="rounded-[22px] border border-[#E8E2D5] bg-[#FAF7F2] px-3 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleToggleRecording()}
            disabled={disabled || isSubmitting}
            className={`relative flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${buttonClass}`}
            title={isRecording ? '结束这一轮说话' : '开始像打电话一样说话'}
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
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex h-2 w-2 rounded-full ${isActive ? 'bg-[#1C1B19]' : 'bg-[#C9C8C3]'}`} />
                <p className={`truncate text-sm font-medium ${titleToneClass}`}>{copy.title}</p>
              </div>
              <CallMeter active={isActive} compact />
            </div>
            <p className="mt-1 text-xs leading-5 text-[#5C5A55]">
              {copy.body}
            </p>
          </div>
        </div>
        {hint && displayTranscript ? (
          <p className="mt-2 pl-[60px] text-[11px] leading-5 text-[#8E8B82]">{hint}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`rounded-[28px] border border-[#E8E2D5] bg-[#FAF7F2] ${compact ? 'px-3 py-3' : 'px-5 py-5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-2.5 w-2.5 rounded-full ${isActive ? 'bg-[#1C1B19]' : 'bg-[#C9C8C3]'}`} />
          <p className={`font-medium ${titleToneClass} ${compact ? 'text-sm' : 'text-[15px]'}`}>{copy.title}</p>
        </div>
        <CallMeter active={isActive} compact={compact} />
      </div>

      <div className="mt-4 flex flex-col items-center gap-4">
        <button
          type="button"
          onClick={() => void handleToggleRecording()}
          disabled={disabled || isSubmitting}
          className={`relative flex items-center justify-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            compact ? 'h-20 w-20' : 'h-24 w-24'
          } ${buttonClass}`}
          title={isRecording ? '结束这一轮说话' : '开始像打电话一样说话'}
        >
          {isActive ? (
            <>
              <span className="absolute inset-[-8px] rounded-full border border-[#1C1B19] opacity-15 animate-ping" />
              <span className="absolute inset-[-16px] rounded-full border border-[#E8E2D5]" />
              <PhoneOff size={compact ? 22 : 26} strokeWidth={1.8} />
            </>
          ) : (
            <PhoneCall size={compact ? 22 : 26} strokeWidth={1.8} />
          )}
        </button>

        <div className="w-full rounded-[22px] border border-[#E8E2D5] bg-white px-4 py-3 text-center">
          <p className={`min-h-[24px] text-[#1C1B19] ${compact ? 'text-xs leading-5' : 'text-sm leading-6'}`}>
            {copy.body}
          </p>
        </div>

        {hint ? (
          <p className={`text-center text-[#8E8B82] ${compact ? 'text-[10px] leading-4' : 'text-[11px] leading-5'}`}>
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default TutorCallComposer;
