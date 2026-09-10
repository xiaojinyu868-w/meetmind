'use client';

/**
 * LiveComposer —— 学生的嘴：一行输入 + 按住说话 + 发送。
 *
 * 老师在讲时学生开口 = 打断（父级 send 负责：闭嘴 → interrupt 附文字 → 续讲）。
 * 按住麦克风的瞬间就让老师停下来听（hush），松开把这段话发出去。
 * 老师提了问题（pendingAsk）时占位文案换成「回答老师…」；一轮讲完给一颗「继续讲」。
 */

import * as React from 'react';
import { ArrowUp, Mic } from 'lucide-react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { TEACH_LIVE_COPY } from '@/lib/ui/copy-teach-live';

interface LiveComposerProps {
  disabled?: boolean;
  /** 老师在讲 / 还有内容没演完 */
  teacherBusy: boolean;
  pendingAsk: string | null;
  onSend: (text: string) => void;
  /** 学生准备开口：老师先停 */
  onHush: () => void;
}

export function LiveComposer({ disabled, teacherBusy, pendingAsk, onSend, onHush }: LiveComposerProps) {
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

  const startPress = React.useCallback(
    async (e: React.PointerEvent) => {
      e.preventDefault();
      if (disabled || pressingRef.current) return;
      pressingRef.current = true;
      spokenRef.current = [];
      setText('');
      onHush();
      await voice.startRecording();
    },
    [disabled, onHush, voice],
  );

  const endPress = React.useCallback(
    async (e: React.PointerEvent) => {
      e.preventDefault();
      if (!pressingRef.current) return;
      pressingRef.current = false;
      await voice.stopRecording();
      const spoken = spokenRef.current.join('').trim();
      spokenRef.current = [];
      if (spoken) {
        setText('');
        onSend(spoken);
      }
    },
    [voice, onSend],
  );

  const placeholder = voice.isRecording
    ? TEACH_LIVE_COPY.composerMicRecording
    : pendingAsk
      ? TEACH_LIVE_COPY.composerAnswerPlaceholder
      : TEACH_LIVE_COPY.composerPlaceholder;

  return (
    <div className="live-composer">
      <div className="live-composer-inner">
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
            if (pressingRef.current) void endPress(e);
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
