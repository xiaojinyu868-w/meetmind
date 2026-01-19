'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';

export interface ConfusionCardProps {
  isOpen: boolean;
  onClose: () => void;
  confusion: {
    id: string;
    timestamp: number;
    content?: string;
    resolved: boolean;
    context?: string;        // 相关上下文
  } | null;
  onAskAI: (question?: string) => void;
  onResolve: () => void;
  onSeek?: (timeMs: number) => void;
  className?: string;
}

// 格式化时间
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function ConfusionCard({
  isOpen,
  onClose,
  confusion,
  onAskAI,
  onResolve,
  onSeek,
  className,
}: ConfusionCardProps) {
  const [question, setQuestion] = useState('');

  if (!isOpen || !confusion) return null;

  const handleAskAI = () => {
    onAskAI(question || undefined);
    setQuestion('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAskAI();
    }
  };

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-fadeIn"
        onClick={onClose}
      />

      {/* 卡片 */}
      <div
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50",
          "bg-slate-900 rounded-t-3xl",
          "max-h-[70vh] overflow-hidden",
          "animate-slideUp",
          "flex flex-col",
          className
        )}
      >
        {/* 拖拽指示条 */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-slate-700" />
        </div>

        {/* 头部 */}
        <div className="px-5 pb-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* 状态指示 */}
              <div className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center",
                confusion.resolved
                  ? "bg-emerald-500/20"
                  : "bg-rose-500/20"
              )}>
                {confusion.resolved ? (
                  <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>
              
              <div>
                <h3 className="text-base font-medium text-white">
                  {confusion.resolved ? '已解决的困惑' : '待解决的困惑'}
                </h3>
                <button
                  onClick={() => onSeek?.(confusion.timestamp)}
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {formatTime(confusion.timestamp)}
                </button>
              </div>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 困惑内容 */}
          {confusion.content && (
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1">困惑内容</p>
              <p className="text-sm text-slate-300 bg-slate-800/50 rounded-lg px-3 py-2">
                {confusion.content}
              </p>
            </div>
          )}

          {/* 相关上下文 */}
          {confusion.context && (
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-1">相关上下文</p>
              <p className="text-sm text-slate-400 bg-slate-800/30 rounded-lg px-3 py-2 italic">
                "{confusion.context}"
              </p>
            </div>
          )}

          {/* 快捷问题 */}
          {!confusion.resolved && (
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-2">快捷提问</p>
              <div className="flex flex-wrap gap-2">
                {[
                  '详细解释一下',
                  '举个例子',
                  '这个重要吗？',
                ].map((q) => (
                  <button
                    key={q}
                    onClick={() => onAskAI(q)}
                    className="text-xs px-3 py-1.5 rounded-full bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部操作区 */}
        <div className="px-5 py-4 border-t border-slate-800 bg-slate-900/95">
          {!confusion.resolved ? (
            <>
              {/* AI 问答输入框 */}
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="输入你的问题..."
                  className={cn(
                    "flex-1 bg-slate-800 rounded-full px-4 py-2.5",
                    "text-sm text-white placeholder-slate-500",
                    "border border-slate-700 focus:border-amber-500",
                    "focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                  )}
                />
                <button
                  onClick={handleAskAI}
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center",
                    "bg-gradient-to-br from-amber-400 to-amber-500",
                    "text-white shadow-lg shadow-amber-500/20",
                    "active:scale-95 transition-transform"
                  )}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                </button>
              </div>

              {/* 标记解决按钮 */}
              <button
                onClick={onResolve}
                className="w-full py-2.5 rounded-full bg-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/30 transition-colors"
              >
                标记为已解决
              </button>
            </>
          ) : (
            <button
              onClick={() => onAskAI()}
              className={cn(
                "w-full py-3 rounded-full",
                "bg-gradient-to-r from-amber-400 to-amber-500",
                "text-white text-sm font-medium",
                "shadow-lg shadow-amber-500/20",
                "active:scale-[0.98] transition-transform"
              )}
            >
              继续问 AI
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        .animate-slideUp {
          animation: slideUp 0.3s ease-out;
        }
      `}</style>
    </>
  );
}

export default ConfusionCard;
