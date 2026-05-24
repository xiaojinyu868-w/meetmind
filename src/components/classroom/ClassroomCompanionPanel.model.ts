import { isInClassBlockedInlineAppKey } from '@/lib/utils/open-app-marker';

type CompanionPanelMode = 'idle' | 'listening' | 'reflecting';

interface CompanionMessageLike {
  inlineApp?: {
    appKey?: string | null;
  };
}

interface ForesightLike {
  id: string;
  label: string;
  text: string;
  createdAt: number;
}

export function buildClassroomCompanionPanelModel<
  Message extends CompanionMessageLike,
  Foresight extends ForesightLike,
>(input: {
  mode: CompanionPanelMode;
  messages: Message[];
  streamingMessage: Message | null;
  foresights: Foresight[];
}) {
  const visibleForesights = input.mode === 'listening' ? input.foresights : [];
  const visibleMessages = input.mode === 'listening'
    ? input.messages.filter((message) => !isInClassBlockedInlineAppKey(message.inlineApp?.appKey))
    : input.messages;
  const hasMainContent = visibleMessages.length > 0 || input.streamingMessage !== null;
  const showListeningStarter =
    input.mode === 'listening' && visibleMessages.length <= 1 && input.streamingMessage === null;

  return {
    visibleMessages,
    visibleForesights,
    latestForesight: visibleForesights[visibleForesights.length - 1] ?? null,
    hasMainContent,
    showListeningStarter,
  };
}
