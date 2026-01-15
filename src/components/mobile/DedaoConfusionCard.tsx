'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface DedaoConfusionCardProps {
  isOpen: boolean;
  onClose: () => void;
  confusion: {
    id: string;
    timestamp: number;
    content?: string;
    resolved: boolean;
    context?: string;
  } | null;
  onAskAI?: (question: string) => void;
  onResolve?: () => void;
  onSeek?: (timeMs: number) => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function DedaoConfusionCard({
  isOpen,
  onClose,
  confusion,
  onAskAI,
  onResolve,
  onSeek,
}: DedaoConfusionCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !confusion) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div 
        className="fixed inset-0 bg-black/30 z-40 animate-fade-in"
        onClick={onClose}
      />

      {/* 卡片 */}
      <div
        ref={cardRef}
        className={cn(
          'fixed left-4 right-4 bottom-4 z-50',
          'bg-white rounded-2xl shadow-xl overflow-hidden',
          'animate-slide-up'
        )}
        style={{ maxHeight: '60vh' }}
      >
        {/* 顶部拖拽指示器 */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* 头部 */}
        <div className="px-4 pb-3 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn(
                'w-2 h-2 rounded-full',
                confusion.resolved ? 'bg-green-500' : 'bg-red-500'
              )} />
              <span className="text-sm font-medium text-[var(--dedao-text)]">
                {confusion.resolved ? '已解决的困惑' : '待解决的困惑'}
              </span>
            </div>
            <button
              onClick={() => onSeek?.(confusion.timestamp)}
              className="flex items-center gap-1 text-xs text-[var(--dedao-gold)] font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {formatTime(confusion.timestamp)}
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-4 py-4 max-h-[40vh] overflow-y-auto">
          {/* 上下文 */}
          {confusion.context && (
            <div className="mb-4 p-3 bg-[var(--dedao-bg-warm)] rounded-xl">
              <p className="text-xs text-[var(--dedao-text-muted)] mb-1">课堂内容</p>
              <p className="text-sm text-[var(--dedao-text)] leading-relaxed">
                {confusion.context}
              </p>
            </div>
          )}

          {/* 困惑点内容 */}
          {confusion.content && (
            <div className="mb-4">
              <p className="text-xs text-[var(--dedao-text-muted)] mb-1">我的困惑</p>
              <p className="text-sm text-[var(--dedao-text)] leading-relaxed">
                {confusion.content}
              </p>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="px-4 py-3 border-t border-gray-100 flex gap-3">
          {!confusion.resolved && (
            <>
              <button
                onClick={() => onAskAI?.(confusion.content || '帮我解释一下这里')}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-medium',
                  'bg-[var(--dedao-gold)] text-white',
                  'active:scale-98 transition-transform duration-150'
                )}
              >
                问 AI
              </button>
              <button
                onClick={onResolve}
                className={cn(
                  'flex-1 py-2.5 rounded-xl text-sm font-medium',
                  'bg-[var(--dedao-bg-warm)] text-[var(--dedao-text)]',
                  'active:scale-98 transition-transform duration-150'
                )}
              >
                已解决
              </button>
            </>
          )}
          {confusion.resolved && (
            <button
              onClick={onClose}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-medium',
                'bg-[var(--dedao-bg-warm)] text-[var(--dedao-text)]',
                'active:scale-98 transition-transform duration-150'
              )}
            >
              关闭
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slide-up {
          from { 
            opacity: 0;
            transform: translateY(100%);
          }
          to { 
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
        .animate-slide-up {
          animation: slide-up 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }
      `}</style>
    </>
  );
}
