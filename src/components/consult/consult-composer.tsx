'use client';

/**
 * ConsultComposer — /consult 页面输入区
 *
 * 设计取自学习产品 CollectionComposerBar 的视觉骨架（卡片式两段布局），
 * 但用 consult 主题变量配色，并且去掉学习产品特有的 quoted/link/录课等概念。
 *
 * 能力：
 *   1. [+] 上传文件 → 直接打 /api/consult/upload，把解析后的正文摘要拼进 user message
 *   2. [Mic] 麦克风 → 复用 useVoiceInput（DashScope 实时转写），转写文字直接追加到 textarea
 *   3. [↑] 发送 / [Mic] 麦克风 二选一：textarea 有内容时显示发送，否则显示麦克风
 *
 * 行为约定：
 *   - Enter 发送，Shift+Enter / Ctrl+Enter 换行
 *   - 上传后在 textarea 上方出现一枚"已附带"chip，可移除
 *   - 提交时把附件正文以 [文件 X.pdf · N 字]\n<text>\n[/文件] 的形式拼到正文之前，作为隐式上下文
 *   - 麦克风权限失败 / STT 报错 → 短暂红字提示，不阻断输入
 */

import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Mic, Paperclip, Plus, X } from 'lucide-react';
import { useVoiceInput } from '@/hooks/useVoiceInput';

// ── Types ────────────────────────────────────────────────────────────────

export interface ConsultComposerHandle {
  /** 把焦点放进 textarea，并把光标移到末尾 */
  focus: () => void;
}

interface AttachedFile {
  /** 上传后由后端返回的文件名，用于显示 */
  fileName: string;
  /** 后端解析出的字符数 */
  charCount: number;
  /** 解析后的纯文本正文（已截断到 12000 字以内） */
  text: string;
  /** 是否被截断 */
  truncated: boolean;
}

interface ConsultComposerProps {
  /** 当前输入框文本（受控） */
  value: string;
  /** textarea 内容变化 */
  onChangeValue: (next: string) => void;
  /** 真实发送：拿到完整 message text 后调用一次 sendMessage */
  onSubmit: (composedText: string) => void;
  /** 是否处于 streaming 状态（禁用发送/上传） */
  disabled?: boolean;
  /** 文件上传后端：默认 /api/consult/upload */
  uploadEndpoint?: string;
  /** placeholder */
  placeholder?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** 把附件正文拼到用户消息前面，作为隐式上下文 */
function composeMessageWithAttachments(input: string, files: AttachedFile[]): string {
  if (files.length === 0) return input;
  const blocks = files.map((f) => {
    const header = `[附件：${f.fileName} · 约 ${f.charCount} 字${f.truncated ? '（已截断到前 12000 字）' : ''}]`;
    return `${header}\n${f.text}\n[/附件]`;
  });
  // 附件在前、用户文本在后，让 agent 先看到材料再读问题
  return `${blocks.join('\n\n')}\n\n${input}`.trim();
}

// ── Component ────────────────────────────────────────────────────────────

export const ConsultComposer = forwardRef<ConsultComposerHandle, ConsultComposerProps>(function ConsultComposer({
  value,
  onChangeValue,
  onSubmit,
  disabled = false,
  uploadEndpoint = '/api/consult/upload',
  placeholder = '说你的目标、背景、卡点或手上的材料。也可以直接传 CV 或语音说一段。',
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    },
  }), []);

  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── 麦克风听写（复用 useVoiceInput） ─────────────────────────────────
  const appendTranscript = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    onChangeValue(
      // 与现有内容之间补一个空格，避免句子粘连
      value.length === 0 || /\s$/.test(value) ? value + t : value + ' ' + t,
    );
  }, [onChangeValue, value]);

  const {
    isRecording,
    interimText,
    toggleRecording,
  } = useVoiceInput({
    onTranscript: appendTranscript,
    onError: (msg) => setError(msg || '语音听写出了点问题'),
  });

  // ── 文件上传 ────────────────────────────────────────────────────────
  const onPickFile = useCallback(async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(uploadEndpoint, { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `上传失败：HTTP ${res.status}`);
      }
      const data = json.data as { fileName: string; charCount: number; text: string };
      const truncated = (data.text?.length || 0) > 12000;
      setFiles((prev) => [
        ...prev,
        {
          fileName: data.fileName,
          charCount: data.charCount,
          text: (data.text || '').slice(0, 12000),
          truncated,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      // 允许重复选同一个文件
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploadEndpoint]);

  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  // ── 发送 ────────────────────────────────────────────────────────────
  const composerHasText = value.trim().length > 0;
  const canSend = (composerHasText || files.length > 0) && !disabled && !uploading;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    const composed = composeMessageWithAttachments(value.trim(), files);
    onSubmit(composed);
    // 清场
    onChangeValue('');
    setFiles([]);
    setError(null);
  }, [canSend, value, files, onSubmit, onChangeValue]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // 让浏览器走默认换行（textarea 对 Shift+Enter 默认换行；Ctrl/Cmd+Enter 这里不阻止）
    e.preventDefault();
    handleSend();
  };

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    handleSend();
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleFormSubmit} className="mx-auto w-full max-w-[760px]">
      {/* 已附文件 chip 行 */}
      {(files.length > 0 || uploading || error || isRecording || interimText) && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {files.map((f, i) => (
            <span
              key={`${f.fileName}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--consult-border)] bg-[var(--consult-surface)] px-2.5 py-1 text-[11.5px] text-[var(--consult-text)]"
            >
              <Paperclip size={11} strokeWidth={1.8} className="text-[var(--consult-muted)]" />
              <span className="max-w-[200px] truncate">{f.fileName}</span>
              <span className="text-[var(--consult-muted)]">· {f.charCount} 字{f.truncated ? '（截断）' : ''}</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="ml-0.5 rounded-full p-0.5 text-[var(--consult-muted)] hover:bg-[var(--consult-hover)] hover:text-[var(--consult-text)]"
                aria-label={`移除 ${f.fileName}`}
              >
                <X size={11} strokeWidth={2} />
              </button>
            </span>
          ))}
          {uploading && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--consult-border)] bg-[var(--consult-surface)] px-2.5 py-1 text-[11.5px] text-[var(--consult-muted)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--consult-primary)] consult-dot-pulse" />
              正在解析文件…
            </span>
          )}
          {isRecording && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/60 bg-rose-50 px-2.5 py-1 text-[11.5px] text-rose-600">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500 consult-dot-pulse" />
              正在听写{interimText ? ` · ${interimText.slice(0, 24)}${interimText.length > 24 ? '…' : ''}` : ''}
            </span>
          )}
          {error && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/60 bg-rose-50 px-2.5 py-1 text-[11.5px] text-rose-600">
              {error.length > 60 ? error.slice(0, 60) + '…' : error}
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded-full p-0.5 hover:bg-rose-100"
                aria-label="关闭"
              >
                <X size={11} strokeWidth={2} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* 输入卡片：上 textarea + 下按钮行（ChatGPT 风格） */}
      <div
        className="rounded-2xl border border-[var(--consult-border)] bg-[var(--consult-surface)] transition focus-within:border-[var(--consult-primary)]"
        onClick={() => textareaRef.current?.focus()}
      >
        <div className="px-4 pt-3 pb-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChangeValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className="max-h-40 min-h-[28px] w-full resize-none bg-transparent text-[14px] leading-[1.65] text-[var(--consult-text)] placeholder:text-[var(--consult-muted)] focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between px-2.5 pb-2 pt-0.5">
          {/* 左：+ 上传 */}
          <div className="flex items-center gap-0.5">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".pdf,.docx,.ppt,.pptx,.txt,.md,.csv,.json,.html"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPickFile(f);
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              disabled={uploading || disabled}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--consult-muted)] transition hover:bg-[var(--consult-hover)] hover:text-[var(--consult-text)] disabled:opacity-40"
              aria-label="上传文件"
              title="上传 CV / 文书 / 链接截图（PDF/DOCX/PPTX/MD/TXT）"
            >
              <Plus size={18} strokeWidth={1.6} />
            </button>
          </div>

          {/* 右：发送 / 麦克风 二选一 */}
          {composerHasText ? (
            <button
              type="submit"
              disabled={!canSend}
              className={
                'flex h-8 w-8 items-center justify-center rounded-lg transition ' +
                (canSend
                  ? 'bg-[var(--consult-primary)] text-white hover:bg-[var(--consult-primary-hover)]'
                  : 'bg-[var(--consult-hover)] text-[var(--consult-muted)] cursor-default')
              }
              aria-label="发送"
            >
              <ArrowUp size={15} strokeWidth={2.4} />
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void toggleRecording();
              }}
              disabled={disabled}
              className={
                'flex h-8 w-8 items-center justify-center rounded-lg transition ' +
                (isRecording
                  ? 'bg-rose-500 text-white hover:bg-rose-600'
                  : 'bg-[var(--consult-hover)] text-[var(--consult-muted)] hover:text-[var(--consult-text)]')
              }
              aria-label={isRecording ? '停止听写' : '语音说一段'}
              title={isRecording ? '点一下结束听写' : '点一下开始语音听写（按一下即停）'}
            >
              <Mic size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-1.5 text-center text-[10px] text-[var(--consult-muted)]">
        Enter 发送 · Shift+Enter 换行 · 支持上传材料 / 语音说一段
      </div>
    </form>
  );
});

export default ConsultComposer;
