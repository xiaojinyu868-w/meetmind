'use client';

import { useEffect, useState } from 'react';
import { SafeAITutor } from '@/components/SafeAITutor';
import { RealtimeTutorPanel } from '@/components/tutor/RealtimeTutorPanel';
import { ConversationList } from '@/components/ConversationHistory/ConversationList';
import { primeOmniRealtimeCallEntry } from '@/hooks/useOmniRealtimeCall';
import { MobileAIChatHeader } from './MobileAIChatHeader';
import type { TutorLaunchImage } from '@/components/tutor/tutor-types';
import type { TranscriptSegment } from '@/types';
import type { ConversationHistory } from '@/types/conversation';
import type { ActionItem } from '@/types/page-types';
import type { ConfusionMarker as MiniPlayerMarker } from './MiniPlayer';

interface MobileAIChatPanelProps {
  showConversationHistory: boolean;
  followsSelectedContext: boolean;
  onBack: () => void;
  onShowCurrent: () => void;
  onShowHistory: () => void;
  onNewConversation: () => void;
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
  realtimeTeacherEnabled?: boolean;
  onEnterRealtimeTeacher?: () => void;
  onExitRealtimeTeacher?: () => void;
  /** 当前 agent 对话是否非空，用于 Header 显示「开新对话」按钮 */
  hasActiveConversation?: boolean;
  /** 递增触发开新对话 */
  newConversationNonce?: number;
  /** 当前 agent 对话状态变化通知 */
  onConversationActiveChange?: (hasMessages: boolean) => void;
}

export function MobileAIChatPanel({
  showConversationHistory,
  followsSelectedContext,
  onBack,
  onShowCurrent,
  onShowHistory,
  onNewConversation,
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
  realtimeTeacherEnabled = false,
  onEnterRealtimeTeacher,
  onExitRealtimeTeacher,
  hasActiveConversation = false,
  newConversationNonce = 0,
  onConversationActiveChange,
}: MobileAIChatPanelProps) {
  const [realtimeConversationId, setRealtimeConversationId] = useState<string | null>(null);

  useEffect(() => {
    setRealtimeConversationId(null);
  }, [sessionId]);

  const handleNewConversation = () => {
    setRealtimeConversationId(null);
    onNewConversation();
  };

  const tutorPanelClassName = 'flex-1 min-h-0 overflow-hidden rounded-[28px] border border-[#E8E2D5] bg-white px-3 pb-3';
  const realtimePanelClassName = 'flex-1 min-h-0 overflow-hidden rounded-[28px] border border-[#E8E2D5] bg-[#FAF7F2]';
  const historyPanelClassName = 'flex-1 min-h-0 overflow-hidden rounded-[28px] border border-[#E8E2D5] bg-white px-3 pb-3';

  // 是否显示历史覆盖层（非通话模式 + showConversationHistory）
  const showHistoryOverlay = !realtimeTeacherEnabled && showConversationHistory;

  const handleEnterRealtimeTeacher = () => {
    void (async () => {
      await primeOmniRealtimeCallEntry();
      onEnterRealtimeTeacher?.();
    })();
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#FAF7F2]">
      <MobileAIChatHeader
        showConversationHistory={showConversationHistory}
        followsSelectedContext={followsSelectedContext}
        onBack={onBack}
        onShowCurrent={onShowCurrent}
        onShowHistory={onShowHistory}
        onNewConversation={handleNewConversation}
        hasActiveConversation={hasActiveConversation}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        markers={markers}
        onSeek={onPlayerSeek}
        onPlayPause={onPlayPause}
        onMarkerClick={onMarkerClick}
        realtimeTeacherEnabled={realtimeTeacherEnabled}
        onToggleRealtimeTeacher={() => {
          if (realtimeTeacherEnabled) {
            onExitRealtimeTeacher?.();
            return;
          }
          handleEnterRealtimeTeacher();
        }}
      />

      {/* 历史覆盖层——条件渲染，不影响当前 agent 对话挂载 */}
      {showHistoryOverlay && (
        <div className={historyPanelClassName}>
          {selectedHistoryConversation ? (
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between border-b border-[#E8E2D5] px-3 py-3">
                <span className="mr-2 flex-1 truncate text-[14px] text-[#1C1B19]">{selectedHistoryConversation.title}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={onBackToHistoryList}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#5C5A55] hover:bg-[#FAF7F2]"
                    title="返回列表"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                    </svg>
                  </button>
                  <button
                    onClick={onCloseHistory}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#5C5A55] hover:bg-[#FAF7F2]"
                    title="新对话"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <SafeAITutor
                  breakpoint={tutorBreakpoint}
                  segments={segments}
                  isLoading={false}
                  onResolve={onResolve}
                  onActionItemsUpdate={onActionItemsUpdate}
                  sessionId={sessionId}
                  supportContextText={tutorSupportContextText}
                  preferSupportContext={preferSupportContext}
                  launchQuestion=""
                  launchDisplayText=""
                  launchImages={[]}
                  launchQuestionNonce={0}
                  isMobile={true}
                  hideMobileHeader={true}
                  onSeek={onTutorSeek}
                  currentTimeSec={Math.floor(currentTime / 1000)}
                  selectedConversationId={selectedHistoryConversation.conversationId}
                  selectedConversationTitle={selectedHistoryConversation.title}
                  onShowHistory={onBackToHistoryList}
                  onAgentNewConversation={onCloseHistory}
                />
              </div>
            </div>
          ) : (
            <ConversationList
              type="global-chat"
              sessionId={sessionId}
              onSelect={onSelectHistoryConversation}
              showSearch={true}
              maxHeight="100%"
            />
          )}
        </div>
      )}

      {/* 文字 AI 始终挂载，通过 hidden 控制可见性，确保对话状态跨历史/通话切换保持 */}
      <div className={tutorPanelClassName} hidden={showHistoryOverlay || realtimeTeacherEnabled}>
        <SafeAITutor
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
          currentTimeSec={Math.floor(currentTime / 1000)}
          selectedConversationId={realtimeConversationId}
          onShowHistory={onShowHistory}
          onAgentNewConversation={handleNewConversation}
          newConversationNonce={newConversationNonce}
          onConversationActiveChange={onConversationActiveChange}
        />
      </div>

      {realtimeTeacherEnabled ? (
        <div className={realtimePanelClassName}>
          <RealtimeTutorPanel
            breakpoint={tutorBreakpoint}
            segments={segments}
            sessionId={sessionId}
            supportContextText={tutorSupportContextText}
            preferSupportContext={preferSupportContext}
            onExit={() => onExitRealtimeTeacher?.()}
            onRealtimeConversationSaved={setRealtimeConversationId}
            onConversationActiveChange={onConversationActiveChange}
          />
        </div>
      ) : null}
    </div>
  );
}
