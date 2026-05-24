'use client';

import { useMemo } from 'react';
import { useRealtimeTutorConversationBridge } from '@/hooks/useRealtimeTutorConversationBridge';
import { TutorRealtimeCallScreen } from './TutorRealtimeCallScreen';
import {
  REALTIME_TEACHER_MODEL_ID,
  type AITutorProps,
  type Segment,
} from './tutor-types';
import {
  buildRealtimeTutorContextLabel,
  buildRealtimeTutorInstructions,
  resolveRealtimeTutorHasContext,
} from './realtime-tutor-panel-model';

interface RealtimeTutorPanelProps {
  breakpoint: AITutorProps['breakpoint'];
  segments: Segment[];
  sessionId?: string;
  supportContextText?: string;
  preferSupportContext?: boolean;
  enableSearch?: boolean;
  onExit: () => void;
  onRealtimeConversationSaved?: (conversationId: string) => void;
  onConversationActiveChange?: (hasMessages: boolean) => void;
}

export function RealtimeTutorPanel({
  breakpoint,
  segments,
  sessionId = 'default',
  supportContextText = '',
  preferSupportContext = false,
  enableSearch = false,
  onExit,
  onRealtimeConversationSaved,
  onConversationActiveChange,
}: RealtimeTutorPanelProps) {
  const hasTutorContext = useMemo(
    () => resolveRealtimeTutorHasContext({ segments, supportContextText }),
    [segments, supportContextText],
  );
  const contextLabel = useMemo(
    () => buildRealtimeTutorContextLabel({ breakpoint, preferSupportContext }),
    [breakpoint, preferSupportContext],
  );
  const instructions = useMemo(
    () => buildRealtimeTutorInstructions({
      breakpoint,
      segments,
      supportContextText,
      preferSupportContext,
    }),
    [breakpoint, preferSupportContext, segments, supportContextText],
  );

  const {
    handleUserTranscript,
    handleAssistantChange,
    handleAssistantDone,
    handleAssistantStart,
    handleAssistantEnd,
  } = useRealtimeTutorConversationBridge({
    sessionId,
    modelId: REALTIME_TEACHER_MODEL_ID,
    onRealtimeConversationSaved,
    onConversationActiveChange,
  });

  return (
    <div className="h-full flex flex-col ai-chat-container bg-[#F7F7F5]">
      <TutorRealtimeCallScreen
        title="语音同桌"
        contextLabel={contextLabel}
        disabled={!hasTutorContext}
        instructions={instructions}
        enableSearch={enableSearch}
        onExit={onExit}
        onUserTranscript={handleUserTranscript}
        onAssistantTranscriptChange={handleAssistantChange}
        onAssistantTranscriptDone={handleAssistantDone}
        onAssistantResponseStart={handleAssistantStart}
        onAssistantResponseEnd={handleAssistantEnd}
      />
    </div>
  );
}

export default RealtimeTutorPanel;
