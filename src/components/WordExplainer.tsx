'use client';

/**
 * 选词解释浮窗 —— M14.5 收口版
 *
 * 用户选中转录文本后弹出，点「解释一下」展开 AI 对话，
 * 结合课堂语境解释选中的词。继续追问也走同一对话。
 *
 * M14.5：
 *   - 加底座 useChatFileUpload —— 支持拖图 / 粘图 / 点回形针上传
 *     场景：学生选了一个词，又想配一张题目截图问"这个能不能用上面这个公式"
 *   - 附件统一通过 context.supportMaterials 注入 prompt（mode='word' 自动支持）
 *   - 提交后清空附件
 *
 * 设计系统：v7 设计宪法（克制 + 双签名色）
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { X, Square, Paperclip, Trash2, FileText, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '@/lib/hooks/useAuth';
import {
  ChatRenderer,
  ChatThinkingStripBubble,
  collectMessageText,
  useChatComposer,
  useChatFileUpload,
} from '@/components/chat';
import { OctoAvatar } from '@/components/ui/octo-avatar';
import { VoiceMicButton } from './VoiceMicButton';
import type { TextSelectionInfo } from '@/hooks/useTextSelection';

interface WordExplainerProps {
  /** 选中文本信息 */
  selection: TextSelectionInfo;
  /** 完整的转录上下文文本（用于 AI 理解语境） */
  fullContextText?: string;
  /** 关闭回调 */
  onClose: () => void;
}

const MIN_W = 340;
const MIN_H = 280;
const DEFAULT_W = 420;
const DEFAULT_H = 460;

export function WordExplainer({
  selection,
  fullContextText,
  onClose,
}: WordExplainerProps) {
  const { accessToken } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 拖拽状态
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // 缩放状态
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; edge: string } | null>(null);

  // ──────────────────────────────────────────────────────────────
  // M14.5：底座文件上传（学生贴题目截图问问题）
  // ──────────────────────────────────────────────────────────────
  const fileUpload = useChatFileUpload({
    authToken: accessToken ?? undefined,
    targetRef: formRef,
  });

  // ──────────────────────────────────────────────────────────────
  // M13 收口：useChat → /api/tutor/agent mode='word'
  // ──────────────────────────────────────────────────────────────

  const sessionId = useMemo(() => `word:${Date.now()}`, []);

  // fullContextText 取尾部 8000 字（避免巨长 prompt 拖慢 TTFT）
  const fullTranscriptTail = useMemo(() => {
    if (!fullContextText) return undefined;
    return fullContextText.length > 8000
      ? fullContextText.slice(-8000)
      : fullContextText;
  }, [fullContextText]);

  // M14.5: 把 attachedFiles 接进顶层 context.supportMaterials
  // mode='word' 的 buildTutorSystemPrompt 会自动 capSupportMaterials
  const supportMaterials = useMemo(() => {
    if (fileUpload.attachedFiles.length === 0) return undefined;
    return fileUpload.attachedFiles.map((f) => ({ title: f.title, content: f.text }));
  }, [fileUpload.attachedFiles]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/tutor/agent',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: () => ({
          sessionId,
          mode: 'word' as const,
          transcript: [],
          context: {
            word: {
              selectionText: selection.text,
              nearbyContext: selection.context,
              fullTranscriptTail,
            },
            ...(supportMaterials ? { supportMaterials } : {}),
          },
          options: {},
        }),
      }),
    [accessToken, sessionId, selection.text, selection.context, fullTranscriptTail, supportMaterials],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';
  const isThinking =
    status === 'submitted' ||
    (status === 'streaming' && messages[messages.length - 1]?.role === 'user');

  // 首次展开自动发送"请解释 X"
  const explainTriggeredRef = useRef(false);
  const handleFirstExplain = useCallback(() => {
    if (explainTriggeredRef.current) return;
    explainTriggeredRef.current = true;
    setExpanded(true);
    sendMessage({ text: `请解释「${selection.text}」` });
  }, [selection.text, sendMessage]);

  // composer hook（统一 IME / 草稿 / 大段粘贴）
  const handleSubmit = useCallback(
    (text: string) => {
      sendMessage({ text });
      // 提交后清空附件
      if (fileUpload.attachedFiles.length > 0) fileUpload.clear();
    },
    [sendMessage, fileUpload],
  );
  const composer = useChatComposer({
    draftKey: sessionId,
    onSubmit: handleSubmit,
    disabled: busy,
  });

  // 计算初始位置
  const initialPosition = useMemo(() => {
    const { rect } = selection;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const bubbleW = expanded ? size.w : 160;
    const bubbleH = expanded ? size.h : 40;

    let left = rect.left + rect.width / 2 - bubbleW / 2;
    if (left < 8) left = 8;
    if (left + bubbleW > viewportW - 8) left = viewportW - 8 - bubbleW;

    let top = rect.top - bubbleH - 8;
    if (top < 8) top = rect.bottom + 8;
    if (top + bubbleH > viewportH - 8) top = viewportH - 8 - bubbleH;

    return { x: left, y: top };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, expanded]);

  const currentPos = pos || initialPosition;

  // 自动滚动到最新消息
  useEffect(() => {
    if (!expanded) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, expanded]);

  // ====== 拖拽逻辑 ======
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: currentPos.x,
      origY: currentPos.y,
    };

    const handleDragMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        x: dragRef.current.origX + dx,
        y: dragRef.current.origY + dy,
      });
    };

    const handleDragEnd = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
  }, [currentPos]);

  // ====== 缩放逻辑 ======
  const handleResizeStart = useCallback((e: React.MouseEvent, edge: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: size.w,
      origH: size.h,
      edge,
    };

    const handleResizeMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const dy = ev.clientY - resizeRef.current.startY;
      const { origW, origH, edge: ed } = resizeRef.current;

      let newW = origW;
      let newH = origH;

      if (ed.includes('e')) newW = Math.max(MIN_W, origW + dx);
      if (ed.includes('w')) newW = Math.max(MIN_W, origW - dx);
      if (ed.includes('s')) newH = Math.max(MIN_H, origH + dy);
      if (ed.includes('n')) newH = Math.max(MIN_H, origH - dy);

      setSize({ w: newW, h: newH });

      if (ed.includes('w') && pos) {
        setPos((p) => (p ? { ...p, x: p.x + (origW - newW) } : p));
      }
      if (ed.includes('n') && pos) {
        setPos((p) => (p ? { ...p, y: p.y + (origH - newH) } : p));
      }
    };

    const handleResizeEnd = () => {
      resizeRef.current = null;
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);
  }, [size, pos]);

  // 未展开时：简洁气泡按钮
  if (!expanded) {
    return (
      <div
        ref={cardRef}
        data-word-explainer
        className="fixed z-[9999] animate-fade-in"
        style={{ left: currentPos.x, top: currentPos.y }}
      >
        <button
          onClick={handleFirstExplain}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#1C1B19] rounded-full shadow-soft transition-all hover:scale-105 active:scale-95"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          解释一下
        </button>
      </div>
    );
  }

  const lastMessage = messages[messages.length - 1] as UIMessage | undefined;

  return (
    <div
      ref={cardRef}
      data-word-explainer
      className="fixed z-[9999] animate-fade-in"
      style={{ left: currentPos.x, top: currentPos.y }}
    >
      <div
        className="relative flex flex-col bg-paper rounded-2xl shadow-card border border-divider"
        style={{ width: size.w, height: size.h }}
      >
        {/* 头部 - 可拖拽 */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between px-4 py-2.5 border-b border-divider cursor-move select-none flex-shrink-0 bg-paper-warm/40 rounded-t-2xl"
        >
          <div className="flex items-center gap-2 min-w-0">
            <OctoAvatar mood={busy ? 'happy' : 'idle'} size="sm" aura={busy} />
            <span className="text-[13px] font-medium text-pine truncate" title={selection.text}>
              「{selection.text.length > 20 ? selection.text.slice(0, 20) + '…' : selection.text}」
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {busy && (
              <button
                onClick={() => stop()}
                className="p-1 text-vermilion/65 hover:text-vermilion transition-colors"
                title="停止生成"
                aria-label="停止生成"
              >
                <Square size={14} fill="currentColor" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-ink-muted hover:text-ink-secondary transition-colors"
              title="关闭"
              aria-label="关闭"
            >
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.map((m) => {
            const text = collectMessageText(m);
            const isStreaming =
              m.id === lastMessage?.id && status === 'streaming' && m.role === 'assistant';
            if (m.role === 'user') {
              return (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-1.5 rounded-2xl bg-ink text-white text-[13px]">
                    {text}
                  </div>
                </div>
              );
            }
            return (
              <div key={m.id} className="flex justify-start">
                <div className="max-w-[95%] text-ink-secondary">
                  <ChatRenderer
                    content={text}
                    isStreaming={isStreaming}
                    className="text-[13px] leading-relaxed"
                  />
                </div>
              </div>
            );
          })}
          {isThinking && <ChatThinkingStripBubble label="正在分析…" />}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区域（M14.5：加图片附件支持） */}
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            composer.submit();
          }}
          className="px-3 py-2 border-t border-divider bg-paper-warm/40 flex-shrink-0 rounded-b-2xl"
        >
          {/* M14.5：拖拽 overlay */}
          {fileUpload.isDragging ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-2 top-2 flex items-center justify-center rounded-xl border-2 border-dashed border-pine/50 bg-pine/10 z-20">
              <span className="text-[12px] font-medium text-pine">松开以添加图片</span>
            </div>
          ) : null}

          {/* M14.5：附件 chip 行 */}
          {(fileUpload.attachedFiles.length > 0 || fileUpload.busy || fileUpload.error) ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {fileUpload.attachedFiles.map((f) => (
                <span
                  key={f.id}
                  className="inline-flex items-center gap-1 rounded-full border border-divider bg-white px-2 py-0.5 text-[11px] text-ink-secondary"
                >
                  {f.kind === 'image' ? (
                    <ImageIcon size={10} strokeWidth={1.8} />
                  ) : (
                    <FileText size={10} strokeWidth={1.8} />
                  )}
                  <span className="max-w-[120px] truncate">{f.title}</span>
                  <button
                    type="button"
                    onClick={() => fileUpload.removeFile(f.id)}
                    aria-label="移除"
                    className="ml-0.5 text-ink-muted hover:text-ink"
                  >
                    <Trash2 size={10} strokeWidth={1.8} />
                  </button>
                </span>
              ))}
              {fileUpload.busy ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-pine" />
                  解析中…
                </span>
              ) : null}
              {fileUpload.error ? (
                <span className="text-[11px] text-vermilion">{fileUpload.error}</span>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-end gap-1.5">
            {/* M14.5：图片/文件上传按钮（紧凑型） */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || fileUpload.busy}
              className="flex-shrink-0 inline-flex h-[32px] w-[32px] items-center justify-center rounded-lg border border-divider bg-white text-ink-secondary transition-colors hover:bg-paper-warm disabled:opacity-40"
              aria-label="上传图片或文件"
              title="上传图片 / 也可拖入或粘贴"
            >
              <Paperclip size={13} strokeWidth={1.8} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => {
                fileUpload.onInputChange(e);
              }}
            />
            <textarea
              {...composer.textareaProps}
              placeholder="继续追问…"
              rows={1}
              disabled={busy}
              className="flex-1 resize-none px-3 py-1.5 text-[13px] border border-divider rounded-lg focus:outline-none focus:ring-1 focus:ring-pine focus:border-pine/40 disabled:bg-paper-deep max-h-[120px]"
              style={{ minHeight: '32px' }}
            />
            <VoiceMicButton
              onTranscript={(text) => composer.setValue((composer.value ? composer.value + ' ' : '') + text)}
              disabled={busy}
              size="sm"
            />
            <button
              type="submit"
              disabled={busy || (!composer.value.trim() && fileUpload.attachedFiles.length === 0)}
              className="flex-shrink-0 px-3 py-1.5 text-[12.5px] text-white bg-pine hover:bg-pine-deep rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>
        </form>

        {/* 缩放手柄 - 四角 + 四边 */}
        <div onMouseDown={(e) => handleResizeStart(e, 'se')} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" />
        <div onMouseDown={(e) => handleResizeStart(e, 'sw')} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize" />
        <div onMouseDown={(e) => handleResizeStart(e, 'ne')} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize" />
        <div onMouseDown={(e) => handleResizeStart(e, 'e')} className="absolute top-3 right-0 w-1.5 bottom-3 cursor-e-resize" />
        <div onMouseDown={(e) => handleResizeStart(e, 's')} className="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize" />
        <div onMouseDown={(e) => handleResizeStart(e, 'w')} className="absolute top-3 left-0 w-1.5 bottom-3 cursor-w-resize" />
      </div>
    </div>
  );
}
