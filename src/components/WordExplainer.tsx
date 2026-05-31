'use client';

/**
 * 选词解释浮窗组件
 * 
 * 用户选中转录文本后弹出，点击「解释一下」后展开 AI 对话卡片，
 * 结合上下文语境解释选中的词汇，支持继续追问。
 * 
 * 功能：
 * - 拖拽移动
 * - 拖拽边缘缩放
 * - 语音输入
 * - 图片上传 / 粘贴
 * - 流式输出
 * - 停止生成
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSimpleSSEStream } from '@/lib/hooks/useSSEStream';
import { useAuth } from '@/lib/hooks/useAuth';
import { StreamingMarkdown } from './StreamingMarkdown';
import { VoiceMicButton } from './VoiceMicButton';
import { ImageUpload, useImagePaste, type UploadedImage } from './ImageUpload';
import { ModelSelector } from './ModelSelector';
import { DEFAULT_MODEL_ID } from '@/lib/services/llm-service';
import type { TextSelectionInfo } from '@/hooks/useTextSelection';

interface WordExplainerProps {
  /** 选中文本信息 */
  selection: TextSelectionInfo;
  /** 完整的转录上下文文本（用于 AI 理解语境） */
  fullContextText?: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 时间戳点击回调 */
  onTimestampClick?: (timeMs: number) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const EXPLAIN_SYSTEM_PROMPT = `你是一位耐心的 AI 家教，学生在课堂转录文本中选中了一些词汇/概念，需要你结合上下文语境来解释。

要求：
1. 先简明扼要地解释这个词/概念的含义（1-2 句话）
2. 结合课堂上下文，说明老师在这里提到它是什么意思
3. 如果有必要，举一个简单的例子帮助理解
4. 语气亲切友好，适合学生阅读
5. 回答不要太长，保持精炼（150 字以内为佳）`;

const MIN_W = 340;
const MIN_H = 280;
const DEFAULT_W = 400;
const DEFAULT_H = 420;

export function WordExplainer({
  selection,
  fullContextText,
  onClose,
  onTimestampClick,
}: WordExplainerProps) {
  const { accessToken } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 模型选择
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [supportsMultimodal, setSupportsMultimodal] = useState(true);

  // 图片上传
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);

  // 拖拽状态
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // 缩放状态
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number; edge: string } | null>(null);

  // 监听粘贴事件
  useImagePaste(
    (pastedImages) => {
      if (expanded && supportsMultimodal) {
        setUploadedImages(prev => [...prev, ...pastedImages].slice(0, 5));
      }
    },
    expanded && supportsMultimodal,
    10
  );

  const {
    fetchStream,
    stopStream,
    isStreaming,
    streamingContent,
    clearContent,
  } = useSimpleSSEStream();

  // 计算初始位置（仅在首次展开/未展开时用）
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
    if (top < 8) {
      top = rect.bottom + 8;
    }
    if (top + bubbleH > viewportH - 8) {
      top = viewportH - 8 - bubbleH;
    }

    return { x: left, y: top };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, expanded]);

  // 实际使用的位置（拖拽后用拖拽位置，否则用计算的初始位置）
  const currentPos = pos || initialPosition;

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // ====== 拖拽逻辑 ======
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // 只在标题栏拖拽
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

      // 如果从左/上边缘拉，需要同步移动位置
      if (ed.includes('w') && pos) {
        setPos(p => p ? { ...p, x: p.x + (origW - newW) } : p);
      }
      if (ed.includes('n') && pos) {
        setPos(p => p ? { ...p, y: p.y + (origH - newH) } : p);
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

  // 发起 AI 解释
  const explain = useCallback(async (question?: string) => {
    setExpanded(true);
    clearContent();

    const userContent = question || `请解释「${selection.text}」`;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userContent,
    };
    setMessages(prev => [...prev, userMsg]);

    const headers: Record<string, string> = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    // 构建消息历史
    const apiMessages = [
      { role: 'system' as const, content: EXPLAIN_SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userContent },
    ];

    // 上下文：选区附近 + 完整转录
    let context = '';
    if (selection.context) {
      context += `【选中词汇附近的文本】\n${selection.context}\n\n`;
    }
    if (fullContextText) {
      // 完整转录有上限——超长 prompt 会让首包延迟变大（prefill 阶段）。
      // 8000 字 ≈ 15 分钟课堂；selection.context 已经覆盖了局部上下文，
      // fullContextText 取尾部（最近 8000 字）即可。
      const cappedFull = fullContextText.length > 8000
        ? fullContextText.slice(-8000)
        : fullContextText;
      context += `【完整课堂转录】\n${cappedFull}`;
    }

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      messages: apiMessages,
      model: selectedModel,
      context,
      stream: true,
    };

    // 多模态：图片
    if (supportsMultimodal && uploadedImages.length > 0) {
      requestBody.messageContent = [
        ...uploadedImages.map(img => ({
          type: 'image_url',
          image_url: { url: img.dataUrl },
        })),
        { type: 'text', text: userContent },
      ];
      setUploadedImages([]);
    }

    try {
      const result = await fetchStream('/api/chat', requestBody, { headers });

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.content || '抱歉，暂时无法解释。',
      };
      setMessages(prev => [...prev, assistantMsg]);
      clearContent();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        const partial = streamingContent;
        if (partial) {
          setMessages(prev => [...prev, {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: partial + '\n\n[已停止]',
          }]);
        }
        clearContent();
      } else {
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `解释失败: ${err instanceof Error ? err.message : '未知错误'}`,
        }]);
      }
    }
  }, [accessToken, clearContent, fetchStream, fullContextText, messages, selection, selectedModel, streamingContent, supportsMultimodal, uploadedImages]);

  // 首次点击「解释一下」
  const handleExplain = useCallback(() => {
    explain();
  }, [explain]);

  // 追问
  const handleFollowUp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputValue.trim() && uploadedImages.length === 0) || isStreaming) return;
    const q = inputValue.trim() || '(发送了图片)';
    setInputValue('');
    explain(q);
  }, [explain, inputValue, isStreaming, uploadedImages.length]);

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
          onClick={handleExplain}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#1C1B19]  rounded-full shadow-soft transition-all hover:scale-105 active:scale-95"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          解释一下
        </button>
      </div>
    );
  }

  // 展开后：AI 解释卡片（可拖拽 + 可缩放）
  return (
    <div
      ref={cardRef}
      data-word-explainer
      className="fixed z-[9999] animate-fade-in"
      style={{ left: currentPos.x, top: currentPos.y }}
    >
      <div
        className="relative flex flex-col bg-white rounded-2xl shadow-2xl shadow-card border border-pine/15"
        style={{ width: size.w, height: size.h }}
      >
        {/* 头部 - 可拖拽 */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between px-4 py-2.5 bg-[#D3E4F4]/30 border-b border-pine/15 cursor-move select-none flex-shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base flex-shrink-0">🔍</span>
            <span className="text-sm font-medium text-pine truncate" title={selection.text}>
              「{selection.text.length > 20 ? selection.text.slice(0, 20) + '...' : selection.text}」
            </span>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <ModelSelector
              value={selectedModel}
              onChange={setSelectedModel}
              onMultimodalChange={setSupportsMultimodal}
              compact={true}
            />
            {isStreaming && (
              <button
                onClick={() => stopStream()}
                className="p-1 text-vermilion/65 hover:text-vermilion transition-colors"
                title="停止生成"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-ink-muted hover:text-ink-secondary transition-colors"
              title="关闭"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-1.5 rounded-2xl bg-[#1C1B19] text-white text-xs">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div className="flex justify-start">
                  <div className="max-w-[95%] text-ink-secondary">
                    <StreamingMarkdown
                      content={msg.content}
                      isStreaming={false}
                      onTimestampClick={onTimestampClick}
                      className="text-xs leading-relaxed"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 流式输出中 */}
          {isStreaming && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[95%] text-ink-secondary">
                <StreamingMarkdown
                  content={streamingContent}
                  isStreaming={true}
                  onTimestampClick={onTimestampClick}
                  className="text-xs leading-relaxed"
                />
              </div>
            </div>
          )}

          {/* 加载中但还没有内容 */}
          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 text-ink-muted">
                <div className="flex gap-0.5">
                  <div className="w-1.5 h-1.5 bg-pine rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 bg-pine rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 bg-pine rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs">正在分析...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* 图片预览 */}
        {uploadedImages.length > 0 && (
          <div className="px-3 py-1.5 border-t border-pine/12 bg-pine-fog/50">
            <ImageUpload
              images={uploadedImages}
              onImagesChange={setUploadedImages}
              maxImages={5}
              disabled={isStreaming}
              className="!p-0"
            />
          </div>
        )}

        {/* 输入区域 */}
        <form onSubmit={handleFollowUp} className="px-3 py-2 border-t border-pine/15 bg-paper-warm/50 flex-shrink-0 rounded-b-2xl">
          <div className="flex items-center gap-1.5">
            {/* 图片上传按钮 */}
            {supportsMultimodal && (
              <label
                className={`flex-shrink-0 p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isStreaming ? 'text-ink-faint cursor-not-allowed' : 'text-ink-muted hover:text-pine hover:bg-pine-fog'
                }`}
                title="上传图片"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={isStreaming}
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    files.forEach(file => {
                      const reader = new FileReader();
                      reader.onload = () => {
                        const img: UploadedImage = {
                          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                          file,
                          dataUrl: reader.result as string,
                          name: file.name,
                        };
                        setUploadedImages(prev => [...prev, img].slice(0, 5));
                      };
                      reader.readAsDataURL(file);
                    });
                    e.target.value = '';
                  }}
                />
              </label>
            )}

            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={isStreaming}
              placeholder="继续追问..."
              className="flex-1 px-3 py-1.5 text-xs border border-divider rounded-lg focus:outline-none focus:ring-1 focus:ring-pine focus:border-pine/40 disabled:bg-paper-deep"
            />

            {/* 语音输入按钮 */}
            <VoiceMicButton
              onTranscript={(text) => setInputValue(prev => prev + text)}
              disabled={isStreaming}
              size="sm"
            />

            <button
              type="submit"
              disabled={isStreaming || (!inputValue.trim() && uploadedImages.length === 0)}
              className="flex-shrink-0 px-3 py-1.5 text-xs text-white bg-pine-fog0 hover:bg-pine-deep rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>
        </form>

        {/* 缩放手柄 - 四角 + 四边 */}
        {/* 右下角 */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'se')}
          className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
        />
        {/* 左下角 */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'sw')}
          className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize"
        />
        {/* 右上角 */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'ne')}
          className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize"
        />
        {/* 右边 */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'e')}
          className="absolute top-3 right-0 w-1.5 bottom-3 cursor-e-resize"
        />
        {/* 下边 */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 's')}
          className="absolute bottom-0 left-3 right-3 h-1.5 cursor-s-resize"
        />
        {/* 左边 */}
        <div
          onMouseDown={(e) => handleResizeStart(e, 'w')}
          className="absolute top-3 left-0 w-1.5 bottom-3 cursor-w-resize"
        />
      </div>
    </div>
  );
}
