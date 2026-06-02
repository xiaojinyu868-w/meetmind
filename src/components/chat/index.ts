/**
 * Chat 底座 barrel —— 让 adapter 一行 import 拿全。
 *
 * 用法：
 * ```tsx
 * import {
 *   ChatBubble, ChatComposer, ChatMessageList, ChatRenderer, ChatThinkingStripBubble,
 *   useChatComposer, useChatFileUpload, useAutoFollowScroll,
 *   collectMessageText, extractIntentSummary,
 * } from '@/components/chat';
 * ```
 */

export { ChatBubble, ChatBubbleActionButton } from './ChatBubble';
export type { ChatBubbleProps, ChatBubbleRole, ChatBubbleVariant, ChatBubbleActionButtonProps } from './ChatBubble';

export { ChatComposer } from './ChatComposer';
export type { ChatComposerProps, ChatComposerCapabilities, ChatComposerVariant } from './ChatComposer';

export { ChatMessageList } from './ChatMessageList';
export type { ChatMessageListProps } from './ChatMessageList';

export { ChatRenderer } from './ChatRenderer';
export type { ChatRendererProps, ChatMarkerKind, ChatMarkerHit } from './ChatRenderer';

export { ChatThinkingStripBubble } from './ChatThinkingStrip';
export type { ChatThinkingStripProps, ChatThinkingState } from './ChatThinkingStrip';

export { useChatComposer } from './hooks/useChatComposer';
export type { UseChatComposerOptions, UseChatComposerResult } from './hooks/useChatComposer';

export { useChatFileUpload } from './hooks/useChatFileUpload';
export type {
  UseChatFileUploadOptions,
  UseChatFileUploadResult,
  AttachedFile,
} from './hooks/useChatFileUpload';

export { useAutoFollowScroll } from './hooks/useAutoFollowScroll';
export type { UseAutoFollowScrollOptions, UseAutoFollowScrollResult } from './hooks/useAutoFollowScroll';

export { collectMessageText } from './markers/collectMessageText';
export type { MessageLike } from './markers/collectMessageText';

export { extractIntentSummary } from './markers/extractIntentSummary';
export type { IntentSummaryExtraction } from './markers/extractIntentSummary';

export { extractIntentBio } from './markers/extractIntentBio';
export type { IntentBioExtraction } from './markers/extractIntentBio';

export { copyMessageSmart } from './markers/copyMessageSmart';
