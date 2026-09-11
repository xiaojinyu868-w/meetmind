'use client';

/**
 * LiveComposer —— 学生的嘴：一行输入 + 按住说话 + 发送。
 *
 * 老师在讲时学生开口 = 打断（父级 send 负责：闭嘴 → interrupt 附文字 → 续讲）。
 * 按住麦克风的瞬间就让老师停下来听（hush），松开把这段话发出去。
 * 老师提了问题（pendingAsk）时占位文案换成「回答老师…」；一轮讲完给一颗「继续讲」。
 */

import * as React from 'react';
import { ArrowUp, Mic, X } from 'lucide-react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';
import type { BoardQuote } from './useLiveLesson';

interface LiveComposerProps {
  disabled?: boolean;
  /** 老师在讲 / 还有内容没演完 */
  teacherBusy: boolean;
  pendingAsk: string | null;
  onSend: (text: string) => void;
  /** 学生准备开口：老师先停 */
  onHush: () => void;
  /** 正指着板上的东西 */
  quote?: BoardQuote | null;
  onClearQuote?: () => void;
}

export function LiveComposer({ disabled, teacherBusy, pendingAsk, onSend, onHush, quote, onClearQuote }: LiveComposerProps) {
  const [text, setText] = React.useState('');
  const spokenRef = React.useRef<string[]>([]);
  const pressingRef = React.useRef(false);

  const voice = useVoiceInput({
    onTranscript: (t) => {
      if (t.trim()) spokenRef.current.push(t.trim());
    },
    onInterim: (t) => {
      if (pressingRef.current) setText([...spokenRef.current, t].join(''));
    },
  });

  const submit = React.useCallback(() => {
    const clean = text.trim();
    if (!clean || disabled) return;
    setText('');
    onSend(clean);
  }, [text, disabled, onSend]);

  const beginTalk = React.useCallback(async () => {
    if (disabled || pressingRef.current) return;
    pressingRef.current = true;
    spokenRef.current = [];
    setText('');
    onHush();
    await voice.startRecording();
  }, [disabled, onHush, voice]);

  const endTalk = React.useCallback(async () => {
    if (!pressingRef.current) return;
    pressingRef.current = false;
    await voice.stopRecording();
    const spoken = spokenRef.current.join('').trim();
    spokenRef.current = [];
    if (spoken) {
      setText('');
      onSend(spoken);
    }
  }, [voice, onSend]);

  const startPress = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      void beginTalk();
    },
    [beginTalk],
  );
  const endPress = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      void endTalk();
    },
    [endTalk],
  );

  // 按住空格说话（焦点不在输入框里时）
  React.useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTyping()) return;
      e.preventDefault();
      void beginTalk();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !pressingRef.current) return;
      e.preventDefault();
      void endTalk();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [beginTalk, endTalk]);

  const placeholder = voice.isRecording
    ? TEACH_LIVE_COPY.composerMicRecording
    : pendingAsk
      ? TEACH_LIVE_COPY.composerAnswerPlaceholder
      : TEACH_LIVE_COPY.composerPlaceholder;

  return (
    <div className="live-composer">
      {quote ? (
        <div className="live-quote-chip">
          <span>
            {TEACH_LIVE_COPY.quotePrefix}
            {quote.inner ? TEACH_LIVE_COPY.quoteInner(quote.title, quote.inner) : quote.title}
          </span>
          <button type="button" onClick={onClearQuote} aria-label={TEACH_LIVE_COPY.quoteClear} title={TEACH_LIVE_COPY.quoteClear}>
            <X />
          </button>
        </div>
      ) : null}
      <div className={`live-composer-inner${quote ? ' has-quote' : ''}`}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={TEACH_LIVE_COPY.composerPlaceholder}
        />
        {!teacherBusy && !text && !pendingAsk ? (
          <button type="button" className="live-quick" onClick={() => onSend(TEACH_LIVE_COPY.composerContinue)} disabled={disabled}>
            {TEACH_LIVE_COPY.composerContinue}
          </button>
        ) : null}
        <button
          type="button"
          className={`live-round-btn${voice.isRecording ? ' is-recording' : ''}`}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={(e) => {
            if (pressingRef.current) endPress(e);
          }}
          onContextMenu={(e) => e.preventDefault()}
          disabled={disabled}
          aria-label={TEACH_LIVE_COPY.composerMic}
          title={TEACH_LIVE_COPY.composerMic}
        >
          <Mic />
        </button>
        <button type="button" className="live-round-btn is-primary" onClick={submit} disabled={disabled || !text.trim()} aria-label={TEACH_LIVE_COPY.composerSend}>
          <ArrowUp />
        </button>
      </div>
    </div>
  );
}
