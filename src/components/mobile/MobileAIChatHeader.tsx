'use client';

import { History, PhoneCall } from 'lucide-react';
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
  realtimeTeacherEnabled: boolean;
  onToggleRealtimeTeacher: () => void;
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
            <p className="text-[17px] font-medium tracking-[-0.03em] text-[#232322]">真人老师</p>
          </div>

          <div className="h-9 w-9" aria-hidden="true" />
        </div>
      </div>
    );
  }

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

        <button
          type="button"
          onClick={onToggleRealtimeTeacher}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#232322]"
          title="进入真人老师通话"
          aria-label="进入真人老师通话"
        >
          <PhoneCall size={18} strokeWidth={1.9} />
        </button>
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
    </div>
  );
}
