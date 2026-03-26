'use client';

import { AIChat } from '@/components/AIChat';
import { AITutor } from '@/components/AITutor';
import { ConversationList } from '@/components/ConversationHistory/ConversationList';
import { MobileAIChatHeader } from './MobileAIChatHeader';
import type { TutorLaunchImage } from '@/components/tutor/tutor-types';
import type { Anchor, TranscriptSegment } from '@/types';
import type { ConversationHistory } from '@/types/conversation';
import type { ActionItem } from '@/types/page-types';
import type { ConfusionMarker as MiniPlayerMarker } from './MiniPlayer';

interface MobileAIChatPanelProps {
  showConversationHistory: boolean;
  followsSelectedContext: boolean;
  onBack: () => void;
  onShowCurrent: () => void;
  onShowHistory: () => void;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  markers: MiniPlayerMarker[];
  onPlayerSeek: (timeMs: number) => void;
  onPlayPause: () => void;
  onMarkerClick: (marker: MiniPlayerMarker) => void;
  selectedHistoryConversation: ConversationHistory | null;
  onBackToHistoryList: () => void;
  onCloseHistory: () => void;
  onSelectHistoryConversation: (conversation: ConversationHistory) => void;
  sessionId: string;
  tutorSupportContextText: string;
  tutorBreakpoint: import('@/components/tutor/tutor-types').AITutorProps['breakpoint'];
  segments: TranscriptSegment[];
  onResolve: () => void;
  onActionItemsUpdate: (items: ActionItem[]) => void;
  preferSupportContext: boolean;
  launchQuestion: string;
  launchDisplayText: string;
  launchImages: TutorLaunchImage[];
  launchQuestionNonce: number;
  onLaunchQuestionConsumed?: () => void;
  onTutorSeek: (timeMs: number) => void;
}

export function MobileAIChatPanel({
  showConversationHistory,
  followsSelectedContext,
  onBack,
  onShowCurrent,
  onShowHistory,
  currentTime,
  duration,
  isPlaying,
  markers,
  onPlayerSeek,
  onPlayPause,
  onMarkerClick,
  selectedHistoryConversation,
  onBackToHistoryList,
  onCloseHistory,
  onSelectHistoryConversation,
  sessionId,
  tutorSupportContextText,
  tutorBreakpoint,
  segments,
  onResolve,
  onActionItemsUpdate,
  preferSupportContext,
  launchQuestion,
  launchDisplayText,
  launchImages,
  launchQuestionNonce,
  onLaunchQuestionConsumed,
  onTutorSeek,
}: MobileAIChatPanelProps) {
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#F7F7F5]">
      <MobileAIChatHeader
        showConversationHistory={showConversationHistory}
        followsSelectedContext={followsSelectedContext}
        onBack={onBack}
        onShowCurrent={onShowCurrent}
        onShowHistory={onShowHistory}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        markers={markers}
        onSeek={onPlayerSeek}
        onPlayPause={onPlayPause}
        onMarkerClick={onMarkerClick}
      />

      <div className="flex-1 min-h-0 overflow-hidden rounded-[28px] border border-[#E9E9E7] bg-white/92 px-3 pb-3 shadow-[0_18px_38px_rgba(148,163,184,0.10)]">
        {showConversationHistory ? (
          selectedHistoryConversation ? (
            <div className="h-full flex flex-col">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-600 truncate flex-1 mr-2">{selectedHistoryConversation.title}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onBackToHistoryList}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
                    title="返回列表"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                  <button
                    onClick={onCloseHistory}
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[#787774] hover:bg-[#EFEFEF]"
                    title="新对话"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <AIChat
                  conversationId={selectedHistoryConversation.conversationId}
                  sessionId={sessionId}
                  isMobile={true}
                  contextText={tutorSupportContextText}
                  onTimestampClick={onTutorSeek}
                />
              </div>
            </div>
          ) : (
            <ConversationList
              sessionId={sessionId}
              onSelect={onSelectHistoryConversation}
              showSearch={true}
              maxHeight="100%"
            />
          )
        ) : (
          <AITutor
            breakpoint={tutorBreakpoint}
            segments={segments}
            isLoading={false}
            onResolve={onResolve}
            onActionItemsUpdate={onActionItemsUpdate}
            sessionId={sessionId}
            supportContextText={tutorSupportContextText}
            preferSupportContext={preferSupportContext}
            launchQuestion={launchQuestion}
            launchDisplayText={launchDisplayText}
            launchImages={launchImages}
            launchQuestionNonce={launchQuestionNonce}
            onLaunchQuestionConsumed={onLaunchQuestionConsumed}
            isMobile={true}
            hideMobileHeader={true}
            onSeek={onTutorSeek}
          />
        )}
      </div>
    </div>
  );
}
