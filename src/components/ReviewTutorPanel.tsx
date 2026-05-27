'use client';

import type { MutableRefObject } from 'react';
import { useState, useCallback } from 'react';
import { SafeAITutor } from '@/components/SafeAITutor';
import { ConversationList } from '@/components/ConversationHistory/ConversationList';
import { WaveformPlayer, type WaveformAnchor, type WaveformPlayerRef } from '@/components/WaveformPlayer';
import type { Anchor, TranscriptSegment } from '@/types';
import type { ConversationHistory } from '@/types/conversation';
import type { ActionItem } from '@/types/page-types';
import type { TutorLaunchImage } from '@/components/tutor/tutor-types';
import type { WorkshopAppKey } from '@/lib/ai-native/app-catalog';

interface ReviewTutorPanelProps {
  audioSrc?: string | Blob;
  waveformRef: MutableRefObject<WaveformPlayerRef | null>;
  waveformAnchors: WaveformAnchor[];
  anchors: Anchor[];
  selectedAnchor: Anchor | null;
  onTimeUpdate: (timeMs: number) => void;
  onPlayStateChange: (isPlaying: boolean) => void;
  onAnchorSelect: (anchor: Anchor) => void;
  onAnchorAdd: (timestamp: number) => void;
  showConversationHistory: boolean;
  selectedHistoryConversation: ConversationHistory | null;
  onBackToHistoryList: () => void;
  onCloseHistory: () => void;
  onShowHistory: () => void;
  onSelectHistoryConversation: (conversation: ConversationHistory) => void;
  onClearSelectedAnchor: () => void;
  sessionId: string;
  tutorSupportContextText: string;
  onSeek: (timeMs: number) => void;
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
  currentTimeSecOverride?: number;
  onOpenAppInWorkspace?: (appKey: WorkshopAppKey) => void;
  learningActivityContext?: string;
}

export function ReviewTutorPanel({
  audioSrc,
  waveformRef,
  waveformAnchors,
  anchors,
  selectedAnchor,
  onTimeUpdate,
  onPlayStateChange,
  onAnchorSelect,
  onAnchorAdd,
  showConversationHistory,
  selectedHistoryConversation,
  onBackToHistoryList,
  onCloseHistory,
  onShowHistory,
  onSelectHistoryConversation,
  onClearSelectedAnchor,
  sessionId,
  tutorSupportContextText,
  onSeek,
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
  currentTimeSecOverride,
  onOpenAppInWorkspace,
  learningActivityContext,
}: ReviewTutorPanelProps) {
  // M10：把当前播放位置注入给 SafeAITutor（视频/录音复习 AI 同桌会用它做
  // "此刻在听的那段"锚点，无需用户手动引用时间戳）。
  // 截流到秒级，避免每 ~100ms 的 onTimeUpdate 触发无意义 re-render。
  const [localCurrentTimeSec, setLocalCurrentTimeSec] = useState(0);
  const currentTimeSec = currentTimeSecOverride ?? localCurrentTimeSec;
  const handleTimeUpdate = useCallback(
    (timeMs: number) => {
      const sec = Math.floor(timeMs / 1000);
      setLocalCurrentTimeSec((prev) => (prev === sec ? prev : sec));
      onTimeUpdate(timeMs);
    },
    [onTimeUpdate],
  );

  return (
    <div className="h-full flex flex-col bg-white ai-chat-container">
      {audioSrc && (
        <div
          className="flex-shrink-0 border-b px-3 py-2"
          style={{ background: '#FCFBF8', borderColor: 'var(--edu-border-light)' }}
        >
          <WaveformPlayer
            ref={waveformRef}
            src={audioSrc}
            anchors={waveformAnchors}
            onTimeUpdate={handleTimeUpdate}
            onPlayStateChange={onPlayStateChange}
            onAnchorClick={(anchor) => {
              const found = anchors.find((item) => item.id === anchor.id);
              if (found) onAnchorSelect(found);
            }}
            onAnchorAdd={onAnchorAdd}
            allowAddAnchor={true}
            selectedAnchorId={selectedAnchor?.id}
            compact={true}
            height={24}
            waveColor="#E3D5C4"
            progressColor="#F3EADF"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col" style={{ minHeight: 'var(--ai-chat-min-height, 300px)' }}>
        {!showConversationHistory && (
          <div
            className="flex-shrink-0 px-3 py-1.5 flex items-center gap-2 border-b"
            style={{ background: '#FCFBF8', borderColor: 'var(--edu-border-light)' }}
          >
            <button
              onClick={onClearSelectedAnchor}
              className={`px-3 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                !selectedAnchor
                  ? 'bg-[#232322] text-white'
                  : 'bg-white text-gray-600 hover:text-[#787774] hover:bg-[#EFEFEF] border border-gray-200'
              }`}
              title="基于整节课内容与 AI 对话"
            >
              <span>对话</span>
              整节课对话
            </button>
            {selectedAnchor && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-lg border border-[#E9E9E7] text-xs">
                <span className={`w-2 h-2 rounded-full ${selectedAnchor.resolved ? 'bg-mint' : 'bg-[#FADEC9] animate-pulse'}`} />
                <span className="text-[#232322] font-medium">困惑点</span>
                <button
                  onClick={onClearSelectedAnchor}
                  className="ml-1 text-gray-400 hover:text-gray-600"
                  title="返回整节课对话"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            )}
            {!selectedAnchor && anchors.length > 0 && (
              <span className="text-xs text-gray-400 ml-auto">点击左侧困惑点可切换到针对性解答</span>
            )}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-hidden">
          {showConversationHistory ? (
            selectedHistoryConversation ? (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                  <span className="text-sm text-gray-600 truncate flex-1 mr-2">{selectedHistoryConversation.title}</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={onBackToHistoryList}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-navy hover:bg-gray-100 transition-colors"
                      title="返回列表"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                      </svg>
                    </button>
                    <button
                      onClick={onCloseHistory}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-[#232322] hover:text-[#232322] hover:bg-[#EFEFEF] transition-colors"
                      title="新对话"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                    onSeek={onSeek}
                    currentTimeSec={currentTimeSec}
                    onOpenAppInWorkspace={onOpenAppInWorkspace}
                    learningActivityContext={learningActivityContext}
                    selectedConversationId={selectedHistoryConversation.conversationId}
                    selectedConversationTitle={selectedHistoryConversation.title}
                    onShowHistory={onBackToHistoryList}
                    onAgentNewConversation={onCloseHistory}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col">
                <div className="px-4 py-2 border-b flex items-center justify-between flex-shrink-0" style={{ background: 'var(--edu-bg-soft)', borderColor: 'var(--edu-border-light)' }}>
                  <span className="text-sm font-medium text-navy">历史对话</span>
                  <button
                    onClick={onCloseHistory}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-[#787774] hover:text-[#232322] hover:bg-[#EFEFEF] transition-colors"
                    title="新对话"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <ConversationList
                    type="global-chat"
                    sessionId={sessionId}
                    onSelect={onSelectHistoryConversation}
                    showSearch={true}
                    maxHeight="100%"
                  />
                </div>
              </div>
            )
          ) : (
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
              onSeek={onSeek}
              currentTimeSec={currentTimeSec}
              onOpenAppInWorkspace={onOpenAppInWorkspace}
              learningActivityContext={learningActivityContext}
              onShowHistory={onShowHistory}
              onAgentNewConversation={onCloseHistory}
            />
          )}
        </div>
      </div>
    </div>
  );
}
