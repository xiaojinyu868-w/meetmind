'use client';

import { History, PhoneCall, Plus } from 'lucide-react';
import { MiniPlayer, type ConfusionMarker as MiniPlayerMarker } from './MiniPlayer';

interface MobileAIChatHeaderProps {
  showConversationHistory: boolean;
  followsSelectedContext: boolean;
  onBack: () => void;
  onShowCurrent: () => void;
  onShowHistory: () => void;
  onNewConversation: () => void;
  hasActiveConversation: boolean;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  markers: MiniPlayerMarker[];
  onSeek: (timeMs: number) => void;
  onPlayPause: () => void;
  onMarkerClick: (marker: MiniPlayerMarker) => void;
  realtimeTeacherEnabled: boolean;
  onToggleRealtimeTeacher: () => void;
}

export function MobileAIChatHeader({
  showConversationHistory,
  followsSelectedContext,
  onBack,
  onShowCurrent,
  onShowHistory,
  onNewConversation,
  hasActiveConversation,
  currentTime,
  duration,
  isPlaying,
  markers,
  onSeek,
  onPlayPause,
  onMarkerClick,
  realtimeTeacherEnabled,
  onToggleRealtimeTeacher,
}: MobileAIChatHeaderProps) {
  if (realtimeTeacherEnabled) {
    return (
      <div className="flex-shrink-0 border-b border-[#E9E9E7] bg-white">
        <div className="flex items-center justify-between px-3 pb-3 pt-3">
          <button
            type="button"
            onClick={onToggleRealtimeTeacher}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#232322]"
            aria-label="返回聊天"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <div className="text-center">
            <p className="text-[17px] font-medium tracking-[-0.03em] text-[#232322]">语音助教</p>
          </div>

          <div className="h-9 w-9" aria-hidden="true" />
        </div>
      </div>
    );
  }

  const hasDuration = duration > 0;

  return (
    <div className="flex-shrink-0 border-b border-[#E9E9E7] bg-white">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-[#232322]"
          aria-label="返回"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.9} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="text-center">
          <p className="text-[17px] font-medium tracking-[-0.03em] text-[#232322]">AI 助教</p>
        </div>

        <div className="flex items-center gap-0.5">
          {/* 开新对话——仅在当前对话模式 + 已有对话内容时显示 */}
          {!showConversationHistory && hasActiveConversation && (
            <button
              type="button"
              onClick={onNewConversation}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#787774] transition-colors active:bg-[#F7F7F5]"
              title="开新对话"
              aria-label="开新对话"
            >
              <Plus size={18} strokeWidth={1.9} />
            </button>
          )}
          <button
            type="button"
            onClick={onToggleRealtimeTeacher}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#232322]"
            title="语音同桌"
            aria-label="语音同桌"
          >
            <PhoneCall size={18} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="inline-flex items-center gap-1 rounded-full border border-[#E9E9E7] bg-[#F7F7F5] p-1">
          <button
            onClick={onShowCurrent}
            className={`inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
              !showConversationHistory
                ? 'bg-white text-[#232322]'
                : 'text-[#A3A39E]'
            }`}
          >
            当前
          </button>
          <button
            onClick={onShowHistory}
            className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-[12px] font-medium transition-colors ${
              showConversationHistory
                ? 'bg-white text-[#232322]'
                : 'text-[#A3A39E]'
            }`}
          >
            <History size={13} strokeWidth={1.9} />
            <span>历史</span>
          </button>
        </div>
      </div>

      {/* MiniPlayer 仅在有音频内容时显示，避免空白占位 */}
      {hasDuration && (
        <div className="px-3 pb-2">
          <MiniPlayer
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            markers={markers}
            onSeek={onSeek}
            onPlayPause={onPlayPause}
            onMarkerClick={onMarkerClick}
            className="overflow-hidden rounded-[18px] border border-[#E9E9E7]"
          />
        </div>
      )}
    </div>
  );
}
