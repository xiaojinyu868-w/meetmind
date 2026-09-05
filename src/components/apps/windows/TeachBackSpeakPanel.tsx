'use client';

/**
 * TeachBackSpeakPanel — 「讲给同桌听」半双工语音版的讲课面板。
 *
 * 浮在像素教室底部的毛玻璃面板（镜像旧打字版布局）：
 *   同桌气泡区（最近 2 条 + 说话指示点）
 *   → 可编辑 textarea（语音转写追加进来，可手改）
 *   → 左下 VoiceMicButton（点录再点停 → /api/asr/oneshot → 文字追加进框）
 *   → 按钮行：回到目标 / 讲给同桌（提交一段）/ 讲完了（进入核对）
 * 全部用户面字符串走 COPY.apps.teachBack。
 */

import { VoiceMicButton } from '@/components/VoiceMicButton';
import { COPY } from '@/lib/ui/copy';

interface TeachBackSpeakPanelProps {
  /** 同桌正在出声 */
  speaking: boolean;
  /** 同桌说过的最近几条（新→旧），面板只展示前 2 条 */
  deskmateLines: string[];
  /** 输入框里还没提交的文字（语音转写追加到这里，可编辑） */
  pendingText: string;
  onPendingTextChange: (text: string) => void;
  /** 语音转写完成：追加进输入框 */
  onMicTranscript: (text: string) => void;
  /** 开始录音：父级负责让同桌闭嘴 */
  onMicStart: () => void;
  /** 提交输入框里这一段（讲给同桌） */
  onSubmitSegment: () => void;
  /** 讲完了：进入核对 */
  onFinish: () => void;
  onBack: () => void;
  /** 还没讲过任何内容时禁用「讲完了」 */
  finishDisabled: boolean;
}

export function TeachBackSpeakPanel({
  speaking,
  deskmateLines,
  pendingText,
  onPendingTextChange,
  onMicTranscript,
  onMicStart,
  onSubmitSegment,
  onFinish,
  onBack,
  finishDisabled,
}: TeachBackSpeakPanelProps) {
  const copy = COPY.apps.teachBack;
  const visibleLines = deskmateLines.slice(0, 2);
  const canSubmit = pendingText.trim().length > 0;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center px-5 pb-5 pt-14"
      style={{ background: 'linear-gradient(180deg, transparent, rgba(242,240,233,0.94) 30%)' }}
    >
      <div className="pointer-events-auto flex w-full max-w-[520px] flex-col gap-3 rounded-2xl border border-divider/80 bg-card/92 px-5 py-4 shadow-card backdrop-blur-md">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold text-ink">{copy.textTitle}</p>
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span
              className={`h-1.5 w-1.5 rounded-full transition-colors ${speaking ? 'animate-pulse bg-pine' : 'bg-divider'}`}
            />
            {copy.deskmateListening}
          </span>
        </div>

        {visibleLines.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {visibleLines.map((line, index) => (
              <p
                key={`${index}-${line}`}
                className={`max-w-[85%] self-start rounded-2xl rounded-bl-md bg-paper px-3 py-1.5 text-[12.5px] leading-5 text-ink-secondary ${
                  index > 0 ? 'opacity-60' : ''
                }`}
              >
                {line}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-[11.5px] leading-5 text-ink-muted">{copy.textHint}</p>
        )}

        <textarea
          value={pendingText}
          onChange={(event) => onPendingTextChange(event.target.value)}
          placeholder={copy.speakPlaceholder}
          className="h-[96px] resize-none rounded-[14px] border border-divider bg-paper p-3.5 text-[13.5px] leading-6 text-ink outline-none transition-colors placeholder:text-ink-muted focus:border-pine/50"
        />

        <div className="flex items-center gap-2">
          <VoiceMicButton
            size="sm"
            onTranscript={onMicTranscript}
            onRecordingStart={onMicStart}
          />
          <button
            type="button"
            onClick={onBack}
            className="text-[12px] text-ink-muted transition-colors hover:text-ink"
          >
            {copy.backToTargets}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onSubmitSegment}
            disabled={!canSubmit}
            className="rounded-full border border-pine/40 px-4 py-2 text-[12.5px] font-medium text-pine transition-opacity hover:bg-pine-mist disabled:opacity-40"
          >
            {copy.submitSegment}
          </button>
          <button
            type="button"
            onClick={onFinish}
            disabled={finishDisabled}
            className="rounded-full bg-pine px-5 py-2 text-[13px] font-medium text-white transition-opacity disabled:opacity-40"
          >
            {copy.finishText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default TeachBackSpeakPanel;
