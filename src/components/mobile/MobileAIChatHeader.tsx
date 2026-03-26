'use client';

import { History, MessageCircle } from 'lucide-react';
import { MiniPlayer, type ConfusionMarker as MiniPlayerMarker } from './MiniPlayer';

interface MobileAIChatHeaderProps {
  showConversationHistory: boolean;
  followsSelectedContext: boolean;
  onBack: () => void;
  onShowCurrent: () => void;
  onShowHistory: () => void;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  markers: MiniPlayerMarker[];
  onSeek: (timeMs: number) => void;
  onPlayPause: () => void;
  onMarkerClick: (marker: MiniPlayerMarker) => void;
}

export function MobileAIChatHeader({
  showConversationHistory,
  followsSelectedContext,
  onBack,
  onShowCurrent,
  onShowHistory,
  currentTime,
  duration,
  isPlaying,
  markers,
  onSeek,
  onPlayPause,
  onMarkerClick,
}: MobileAIChatHeaderProps) {
  const statusLabel = showConversationHistory
    ? '历史对话'
    : followsSelectedContext
      ? '跟随已选内容'
      : '跟随当前课堂';

  const description = showConversationHistory
    ? '回看这节课之前的问答，快速接回思路。'
    : followsSelectedContext
      ? '优先围绕你刚圈出的重点继续，不用来回切换。'
      : '不离开复习，直接把这节课继续问下去。';

  return (
    <div className="flex-shrink-0 px-3 pb-2 pt-2">
      <div className="rounded-[24px] border border-[#E9E9E7] bg-white/94 px-3 py-2.5 shadow-[0_12px_24px_rgba(148,163,184,0.08)]">
        <div className="flex items-start gap-2.5">
          <button
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-[14px] border border-[#efe5d8] bg-white text-slate-600 shadow-[0_6px_14px_rgba(148,163,184,0.08)] transition hover:-translate-y-0.5 hover:text-slate-900"
            aria-label="返回"
          >
            <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[15px] font-semibold tracking-[-0.03em] text-slate-900">AI 助教</p>
              <span className="inline-flex items-center rounded-full bg-[#f6efe6] px-2 py-1 text-[10px] font-semibold text-[#9a6b2f]">
                {statusLabel}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-4.5 text-slate-500">{description}</p>
          </div>
          <div className="inline-flex items-center gap-1 rounded-[14px] border border-[#efe5d8] bg-[#f7f2eb] p-1">
            <button
              onClick={onShowCurrent}
              className={`inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-medium transition-all ${
                !showConversationHistory
                  ? 'bg-white text-[#c57a16] shadow-[0_6px_14px_rgba(148,163,184,0.10)]'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
              title="当前对话"
            >
              <MessageCircle size={13} strokeWidth={1.9} />
              <span>当前</span>
            </button>
            <button
              onClick={onShowHistory}
              className={`inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-[11px] font-medium transition-all ${
                showConversationHistory
                  ? 'bg-white text-[#c57a16] shadow-[0_6px_14px_rgba(148,163,184,0.10)]'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
              title="历史对话"
            >
              <History size={13} strokeWidth={1.9} />
              <span>历史</span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-2">
        <MiniPlayer
          currentTime={currentTime}
          duration={duration}
          isPlaying={isPlaying}
          markers={markers}
          onSeek={onSeek}
          onPlayPause={onPlayPause}
          onMarkerClick={onMarkerClick}
          className="overflow-hidden rounded-[20px] border border-[#efe5d8] shadow-[0_10px_24px_rgba(148,163,184,0.08)]"
        />
      </div>
    </div>
  );
}
