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

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !confusion) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 animate-fade-in" onClick={onClose} />

      <div
        ref={cardRef}
        className={cn(
          'fixed left-4 right-4 bottom-4 z-50',
          'overflow-hidden rounded-2xl bg-white shadow-xl',
          'animate-slide-up'
        )}
        style={{ maxHeight: '60vh' }}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-gray-200" />
        </div>

        <div className="border-b border-gray-100 px-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cn('h-2 w-2 rounded-full', confusion.resolved ? 'bg-green-500' : 'bg-red-500')} />
              <span className="text-sm font-medium text-[var(--dedao-text)]">
                {confusion.resolved ? '已解决的困惑' : '待解决的困惑'}
              </span>
            </div>
            <button
              onClick={() => onSeek?.(confusion.timestamp)}
              className="flex items-center gap-1 text-xs font-medium text-[var(--dedao-gold)]"
            >
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              {formatTime(confusion.timestamp)}
            </button>
          </div>
        </div>

        <div className="max-h-[40vh] overflow-y-auto px-4 py-4">
          {confusion.context ? (
            <div className="mb-4 rounded-xl bg-[var(--dedao-bg-warm)] p-3">
              <p className="mb-1 text-xs text-[var(--dedao-text-muted)]">课堂内容</p>
              <p className="text-sm leading-relaxed text-[var(--dedao-text)]">{confusion.context}</p>
            </div>
          ) : null}

          {confusion.content ? (
            <div className="mb-4">
              <p className="mb-1 text-xs text-[var(--dedao-text-muted)]">我的困惑</p>
              <p className="text-sm leading-relaxed text-[var(--dedao-text)]">{confusion.content}</p>
            </div>
          ) : null}
        </div>

        <div className="flex gap-3 border-t border-gray-100 px-4 py-3">
          {!confusion.resolved ? (
            <>
              <button
                onClick={() => onAskAI?.(confusion.content || '帮我解释一下这里')}
                className={cn(
                  'flex-1 rounded-xl py-2.5 text-sm font-medium text-white',
                  'bg-[var(--dedao-gold)] transition-transform duration-150 active:scale-98'
                )}
              >
                问 AI
              </button>
              <button
                onClick={onResolve}
                className={cn(
                  'flex-1 rounded-xl py-2.5 text-sm font-medium',
                  'bg-[var(--dedao-bg-warm)] text-[var(--dedao-text)] transition-transform duration-150 active:scale-98'
                )}
              >
                已解决
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className={cn(
                'flex-1 rounded-xl py-2.5 text-sm font-medium',
                'bg-[var(--dedao-bg-warm)] text-[var(--dedao-text)] transition-transform duration-150 active:scale-98'
              )}
            >
              关闭
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
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
