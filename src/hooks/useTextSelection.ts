'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface TextSelectionInfo {
  /** 选中的文本 */
  text: string;
  /** 选区矩形位置（相对于视口） */
  rect: DOMRect;
  /** 选中文本所在段落的上下文（前后各取一些文字） */
  context: string;
}

/**
 * 监听指定容器内的文本选中事件
 * 
 * 当用户在 containerRef 容器内选中文字时，返回选中信息
 * 鼠标松开时触发，点击空白处或选中消失时清除
 */
export function useTextSelection(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<TextSelectionInfo | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      // 稍微延迟，等待浏览器选区稳定
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }

      dismissTimerRef.current = setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          // 没有选中或选区折叠（点击），不清除现有弹窗
          return;
        }

        const text = sel.toString().trim();
        if (!text || text.length < 1 || text.length > 200) {
          return;
        }

        // 检查选区是否在容器内
        const range = sel.getRangeAt(0);
        if (!container.contains(range.commonAncestorContainer)) {
          return;
        }

        const rect = range.getBoundingClientRect();

        // 获取上下文：取选区所在最近的文本节点的父元素全文
        let context = '';
        const parentEl = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : range.commonAncestorContainer as HTMLElement;

        if (parentEl) {
          // 向上找到段落级元素
          const blockEl = parentEl.closest('p, div, span, li, td, button') || parentEl;
          context = (blockEl.textContent || '').trim();
          // 限制上下文长度
          if (context.length > 500) {
            const idx = context.indexOf(text);
            if (idx >= 0) {
              const start = Math.max(0, idx - 150);
              const end = Math.min(context.length, idx + text.length + 150);
              context = context.slice(start, end);
            } else {
              context = context.slice(0, 500);
            }
          }
        }

        setSelection({ text, rect, context });
      }, 10);
    };

    // 点击容器外部时关闭
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // 如果点击的是 WordExplainer 内部，不关闭
      if (target.closest('[data-word-explainer]')) {
        return;
      }
      // 如果点击后选区为空，清除
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setSelection(null);
        }
      }, 10);
    };

    container.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleClickOutside);
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [containerRef]);

  return { selection, clearSelection };
}
