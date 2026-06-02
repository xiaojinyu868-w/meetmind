/**
 * ChatComposer —— 全局对话输入条（顶级 UX）。
 *
 * 职责（Presentational + 极少状态）：
 *   - 渲染附件 chip 行
 *   - 渲染 textarea（接 useChatComposer 的 textareaProps）
 *   - 渲染发送 / 停止 / 麦克风 / 上传 / 切通话 5 个按钮
 *   - 渲染拖拽时的 overlay（isDragging）
 *
 * 不做的事（交给 caller）：
 *   - 不持有 textarea 状态（来自 useChatComposer）
 *   - 不持有文件状态（来自 useChatFileUpload）
 *   - 不知道 endpoint / mode / context
 *
 * 两个 variant：
 *   - 'paper'：默认，米白克制（TutorAgentPanel 等）
 *   - 'glass'：半透明 + backdrop-blur（IntentDialog 沉浸式背景上）
 */

'use client';

import * as React from 'react';
import { Send, Paperclip, Phone, Trash2, FileText, Image as ImageIcon, Music, Video, RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import type { AttachedFile } from './hooks/useChatFileUpload';

export type ChatComposerVariant = 'paper' | 'glass';

export interface ChatComposerCapabilities {
  /** 麦克风按钮（语音→文字回填） */
  mic?: boolean;
  /** 文件上传按钮 */
  file?: boolean;
  /** 切到打电话模式按钮 */
  call?: boolean;
}

export interface ChatComposerProps {
  /** useChatComposer 给的 textarea props（value/onChange/onKeyDown/composing handler/ref） */
  textareaProps: {
    ref: React.RefObject<HTMLTextAreaElement>;
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
    onCompositionStart: () => void;
    onCompositionEnd: () => void;
    disabled?: boolean;
  };
  /** 主动 submit（外部 send 按钮点击触发） */
  onSubmit: () => void;

  /** 当前是否在等响应（决定 textarea 禁用 + 显示 stop 按钮） */
  busy?: boolean;
  /** 中断生成 */
  onStop?: () => void;

  /** 文件附件状态（来自 useChatFileUpload） */
  attachedFiles?: AttachedFile[];
  onAddFiles?: (files: FileList | File[] | null) => void;
  onRemoveFile?: (id: string) => void;
  uploadBusy?: boolean;
  uploadError?: string | null;
  /** M12：上传错误重试（caller 实现具体重试，例如 useChatFileUpload.retryLast） */
  onRetryUpload?: () => void;
  /** 拖拽态（用于显示 overlay） */
  isDragging?: boolean;

  /** 切通话 */
  onCallStart?: () => void;

  /** 麦克风识别后回填到 textarea —— 由 caller 处理（拼接到 useChatComposer.value 里） */
  onVoiceTranscript?: (text: string) => void;

  /** 能力开关 */
  capabilities?: ChatComposerCapabilities;

  /** 文本占位 */
  placeholder?: string;
  /** busy 时的占位（如"同学在想…"） */
  busyPlaceholder?: string;

  variant?: ChatComposerVariant;

  /**
   * 整个 composer 容器 ref —— 用于 useChatFileUpload 监听拖拽 / 粘贴。
   * caller 自己创建 ref 传进来。
   */
  containerRef?: React.RefObject<HTMLFormElement>;

  className?: string;
}

const ACCEPT_DEFAULT =
  '.pdf,.docx,.ppt,.pptx,.txt,.md,.csv,.json,.html,.htm,image/*,audio/*,video/*';

function fileKindIcon(kind: AttachedFile['kind']): React.ReactNode {
  switch (kind) {
    case 'image':
      return <ImageIcon size={11} strokeWidth={1.8} />;
    case 'audio':
      return <Music size={11} strokeWidth={1.8} />;
    case 'video':
      return <Video size={11} strokeWidth={1.8} />;
    default:
      return <FileText size={11} strokeWidth={1.8} />;
  }
}

export function ChatComposer({
  textareaProps,
  onSubmit,
  busy,
  onStop,
  attachedFiles = [],
  onAddFiles,
  onRemoveFile,
  uploadBusy,
  uploadError,
  onRetryUpload,
  isDragging,
  onCallStart,
  onVoiceTranscript,
  capabilities,
  placeholder = '说点什么…',
  busyPlaceholder = '同学在想…',
  variant = 'paper',
  containerRef,
  className,
}: ChatComposerProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const caps: ChatComposerCapabilities = capabilities ?? {};
  const showFile = Boolean(caps.file && onAddFiles);
  const showMic = Boolean(caps.mic && onVoiceTranscript);
  const showCall = Boolean(caps.call && onCallStart);

  // M12：离线检测——浏览器报告 offline 时锁 composer
  const [isOnline, setIsOnline] = React.useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const setOn = () => setIsOnline(true);
    const setOff = () => setIsOnline(false);
    window.addEventListener('online', setOn);
    window.addEventListener('offline', setOff);
    return () => {
      window.removeEventListener('online', setOn);
      window.removeEventListener('offline', setOff);
    };
  }, []);

  // M12：字数提示（>2000 字开始警告，textarea 不阻止继续输入但视觉提醒）
  const charCount = textareaProps.value.length;
  const showCharWarn = charCount > 2000;

  const handleSubmit = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (busy) return;
      if (!isOnline) return; // M12：离线时不提交
      onSubmit();
    },
    [busy, isOnline, onSubmit],
  );

  // glass 变体的 wrapper（沉浸式背景上要更通透）
  const wrapperClasses =
    variant === 'glass'
      ? 'border-t border-white/15 bg-white/8 backdrop-blur-2xl'
      : 'border-t border-divider-light bg-white';

  const innerInputClasses =
    variant === 'glass'
      ? 'flex flex-1 items-end rounded-2xl border border-white/20 bg-white/15 px-3 py-1.5 backdrop-blur-md'
      : 'flex flex-1 items-end rounded-2xl border border-divider bg-paper px-3 py-1.5';

  const textareaClasses =
    variant === 'glass'
      ? 'flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 text-white placeholder:text-white/55 focus:outline-none disabled:opacity-50'
      : 'flex-1 resize-none bg-transparent px-1 py-1.5 text-[15px] leading-6 text-ink placeholder:text-ink-muted focus:outline-none disabled:opacity-50';

  const iconBtnClasses =
    variant === 'glass'
      ? 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/12 text-white/85 backdrop-blur-md transition-colors hover:bg-white/22 disabled:opacity-40'
      : 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-divider bg-white text-ink-secondary transition-colors hover:bg-paper-warm disabled:opacity-40';

  const sendBtnClasses =
    variant === 'glass'
      ? 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-ink transition-colors hover:bg-white/90 disabled:opacity-30'
      : 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-colors hover:bg-pine disabled:opacity-30';

  const stopBtnClasses =
    variant === 'glass'
      ? 'inline-flex h-10 items-center gap-1 rounded-full border border-white/30 bg-white/15 px-4 text-[13px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/25'
      : 'inline-flex h-10 items-center gap-1 rounded-full border border-divider bg-white px-4 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-paper-warm';

  return (
    <form
      ref={containerRef}
      onSubmit={handleSubmit}
      className={cn(
        'relative px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 sm:px-6',
        wrapperClasses,
        className,
      )}
    >
      {/* 拖拽 overlay */}
      {isDragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-t-3xl border-2 border-dashed border-pine/50 bg-pine/5 backdrop-blur-sm">
          <div className="rounded-2xl bg-white px-4 py-2 text-[13px] font-medium text-pine shadow-soft">
            松开以添加文件
          </div>
        </div>
      ) : null}

      {/* 已附加文件 */}
      {attachedFiles.length > 0 || uploadBusy || uploadError ? (
        <div className="mb-2">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2">
            {attachedFiles.map((f) => (
              <span
                key={f.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px]',
                  variant === 'glass'
                    ? 'border-white/25 bg-white/15 text-white/90 backdrop-blur'
                    : 'border-divider bg-white text-ink-secondary',
                )}
              >
                {fileKindIcon(f.kind)}
                <span className="max-w-[160px] truncate">{f.title}</span>
                <span
                  className={cn(
                    'text-[10px]',
                    variant === 'glass' ? 'text-white/60' : 'text-ink-muted',
                  )}
                >
                  {f.characterCount}字
                </span>
                {onRemoveFile ? (
                  <button
                    type="button"
                    onClick={() => onRemoveFile(f.id)}
                    className={cn(
                      'ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full',
                      variant === 'glass'
                        ? 'text-white/70 hover:bg-white/15 hover:text-white'
                        : 'text-ink-muted hover:bg-paper-warm hover:text-ink',
                    )}
                    aria-label="移除"
                  >
                    <Trash2 size={11} strokeWidth={1.8} />
                  </button>
                ) : null}
              </span>
            ))}
            {uploadBusy ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[12px]',
                  variant === 'glass' ? 'text-white/70' : 'text-ink-muted',
                )}
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pine" />
                解析中…
              </span>
            ) : null}
            {uploadError ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-vermilion">
                <span>{uploadError}</span>
                {onRetryUpload ? (
                  <button
                    type="button"
                    onClick={onRetryUpload}
                    className={cn(
                      'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 transition-colors',
                      variant === 'glass'
                        ? 'bg-white/15 text-white hover:bg-white/25'
                        : 'bg-paper-warm text-ink-secondary hover:bg-paper-deep hover:text-ink',
                    )}
                  >
                    <RefreshCw size={10} strokeWidth={2} />
                    重试
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* M12：离线提示条（友好提示，并锁住发送） */}
      {!isOnline ? (
        <div className="mb-2">
          <div
            className={cn(
              'mx-auto inline-flex w-full max-w-2xl items-center gap-2 rounded-lg px-3 py-1.5 text-[12px]',
              variant === 'glass'
                ? 'bg-white/15 text-white/85 backdrop-blur'
                : 'bg-vermilion/[0.06] text-vermilion',
            )}
          >
            <WifiOff size={12} strokeWidth={1.8} />
            <span>网络不太通——回来再发</span>
          </div>
        </div>
      ) : null}

      {/* 输入主行 */}
      <div className="mx-auto flex w-full max-w-2xl items-end gap-2">
        {/* 上传按钮 */}
        {showFile ? (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadBusy}
              className={iconBtnClasses}
              aria-label="上传文件"
              title="上传文件 / 也可以拖入或粘贴"
            >
              <Paperclip size={16} strokeWidth={1.8} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT_DEFAULT}
              className="hidden"
              onChange={(e) => {
                onAddFiles?.(e.target.files);
                e.target.value = '';
              }}
            />
          </>
        ) : null}

        {/* 切通话 */}
        {showCall ? (
          <button
            type="button"
            onClick={onCallStart}
            disabled={busy}
            className={iconBtnClasses}
            aria-label="切到打电话聊"
            title="打电话聊"
          >
            <Phone size={16} strokeWidth={1.8} />
          </button>
        ) : null}

        {/* textarea + 麦克风 */}
        <div className={innerInputClasses}>
          <textarea
            {...textareaProps}
            disabled={textareaProps.disabled || !isOnline}
            placeholder={
              !isOnline
                ? '无网络——回来再发'
                : busy
                  ? busyPlaceholder
                  : placeholder
            }
            rows={1}
            className={textareaClasses}
            style={{ maxHeight: '200px' }}
          />
          {showMic && onVoiceTranscript ? (
            <VoiceMicButton
              onTranscript={onVoiceTranscript}
              disabled={busy || !isOnline}
              size="sm"
              dark={variant === 'glass'}
            />
          ) : null}
        </div>

        {/* 发送 / 停止 */}
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className={stopBtnClasses}
          >
            停一下
          </button>
        ) : (
          <button
            type="submit"
            disabled={!textareaProps.value.trim() || !isOnline}
            className={sendBtnClasses}
            aria-label={isOnline ? '发送' : '离线无法发送'}
            title={isOnline ? '发送' : '回来再发'}
          >
            <Send size={16} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* M12：字数 >2000 提示（极克制——只在超过时显示） */}
      {showCharWarn ? (
        <div className="mt-1 flex justify-end px-1">
          <span
            className={cn(
              'font-mono text-[10.5px] tabular-nums',
              charCount > 4000
                ? 'text-vermilion'
                : variant === 'glass'
                  ? 'text-white/55'
                  : 'text-ink-muted',
            )}
          >
            {charCount.toLocaleString()} 字
          </span>
        </div>
      ) : null}
    </form>
  );
}
