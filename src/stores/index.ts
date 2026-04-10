/**
 * Zustand Stores 统一导出
 * 
 * 遵循 vercel-react-best-practices 规则：
 * - bundle-barrel-file: 使用命名导出支持 tree-shaking
 */

// UI Store
export { 
  useUIStore,
  useViewMode,
  useReviewTab,
  useVideoWorkspaceTab,
  useMobileSubPage,
  useIsMenuOpen,
  useIsActionDrawerOpen,
  useShowConversationHistory,
  useShowTranscriptBar,
  useShowAISearch,
  useShowMobileRecorder,
  useMobileCollectionSheet,
  useShowSplash,
  useAppReady,
  useLoadingProgress,
  useUIActions,
} from './ui-store';
export type { UIStore, ViewMode, DataSource, ReviewTab, VideoWorkspaceTab, MobileSubPage, MobileCollectionSheet } from './ui-store';

// Player Store
export {
  usePlayerStore,
  useIsPlaying,
  useCurrentTime,
  useIsPlayingAll,
  usePlayAllIndex,
  usePlayerActions,
} from './player-store';
export type { PlayerStore } from './player-store';

// Session Store
export {
  useSessionStore,
  useSessionId,
  useIsRecording,
  useDataSource,
  useServiceStatus,
  useSessionMediaDurationMs,
  useVideoSeekNonce,
  useVideoPlayNonce,
  useSelectedAnchor,
  useSelectedConfusion,
  useSelectedHistoryConversation,
  useSessionActions,
} from './session-store';
export type { SessionStore } from './session-store';

// Collection Store
export {
  useCollectionStore,
  useSourceItems,
  useArchivedLocalCollectionItems,
  useSupportReferences,
  useCollectionComposerText,
  useShowCollectionPulsePreview,
  useCaptureDrivenPulse,
  useShowScrollToLatest,
  useIsCollectionContextSelectionMode,
  useSelectedCollectionContextIds,
  useSelectedCollectionPrimaryId,
  useSourceImportError,
  usePlayingAudioMessageId,
  useAudioPlaybackState,
  useWorkspaceCaptureEditor,
  useIsSavingWorkspaceCaptureEdit,
  useCollectionActions,
  useSourceImporting,
} from './collection-store';
export type { CollectionStore, AudioPlaybackState } from './collection-store';

// Echo Store
export {
  useEchoStore,
  useWorkspaceEchoes,
  useWorkspaceCaptures,
  useSelectedEchoChip,
  useIsManualEchoRefreshing,
  useManualEchoDebugNote,
  useManualEchoFeedback,
  useSharingEcho,
  useEchoActions,
} from './echo-store';
export type { EchoStore } from './echo-store';

// Mobile AI Store
export {
  useMobileAIStore,
  useMobileAIQuestion,
  useMobileAIDisplayQuestion,
  useMobileAILaunchImages,
  useMobileAILaunchSupportContextText,
  useMobileAIQuestionNonce,
  useMobileAIConsumedQuestionNonce,
  useMobileAIPreferSelectedContext,
  useMobileAILaunchTarget,
  useMobileAINewConversationNonce,
  useMobileAIHasActiveConversation,
  useMobileAIActions,
} from './mobile-ai-store';
export type { MobileAIStore, MobileAILaunchTarget } from './mobile-ai-store';

// Capture Editor Store
export {
  useCaptureEditorStore,
  useSegments,
  useAnchors,
  useTimeline,
  useActionItems,
  useAudioBlob,
  useAudioUrl,
  useVideoSource,
  useNotes,
  useConfusionChatAnchor,
  useVideoInsightItems,
  useActiveVideoInsightId,
  useExtractedTermsHint,
  useRecorderAutoStartSignal,
  useCaptureEditorActions,
} from './capture-editor-store';
export type { CaptureEditorStore } from './capture-editor-store';
