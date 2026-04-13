# Stores — 全局客户端状态

> Zustand 状态管理。组件和 hooks 通过 selector 订阅。

## 依赖规则

```
components/hooks → stores → types
```

- ✅ stores 可以 import `types/`, `types/page-types`
- ❌ stores 不能 import `components/`, `hooks/`, `lib/services/`
- ⚠️ session-store 有例外：import `Anchor` from `anchor-service`（类型 only）和 `ConfusionMarker` from `PodcastPlayer`
- ⚠️ echo-store 有例外：import `EchoData` from `EchoCard`（类型 only）
- ⚠️ capture-editor-store 有例外：import `VideoInsightItem` from `VideoInsightTimeline`（类型 only）

## 文件索引

| 文件 | 行数 | 职责 | 核心 export | 管理状态数 |
|------|------|------|------------|-----------|
| `ui-store.ts` | ~160 | 全局 UI 状态 | `useUIStore`, `useViewMode`, `useReviewTab`, `useVideoWorkspaceTab`, `useMobileSubPage`, `useMobileCollectionSheet`, `useUIActions` | 16 |
| `player-store.ts` | 67 | 音频播放器状态 | `usePlayerStore`, `useIsPlaying`, `useCurrentTime`, `usePlayerActions` | 4 |
| `session-store.ts` | ~140 | 课堂会话核心 | `useSessionStore`, `useSessionId`, `useIsRecording`, `useDataSource`, `useSelectedAnchor`, `useSessionActions` | 11 |
| `collection-store.ts` | ~240 | 收集流状态 | `useCollectionStore`, `useSourceItems`, `useCollectionActions`, `useSourceImporting` | 28 |
| `echo-store.ts` | ~105 | 回声状态 | `useEchoStore`, `useWorkspaceEchoes`, `useEchoActions` | 7 |
| `mobile-ai-store.ts` | ~125 | 移动端 AI 状态 | `useMobileAIStore`, `useMobileAIActions`, `MobileAILaunchTarget` | 10 |
| `capture-editor-store.ts` | ~140 | 课堂内容核心数据 | `useCaptureEditorStore`, `useSegments`, `useAnchors`, `useCaptureEditorActions` | 14 |
| `index.ts` | ~130 | barrel 导出 | re-export 全部 | — |

## 迁移状态（page.tsx → Zustand）

**总计已迁移 ~89 个状态**（Phase 1 完成后）

### ui-store（16 个）
`showSplash`, `appReady`, `loadingProgress`, `viewMode`, `reviewTab`, `videoWorkspaceTab`（默认 `'transcript'`）, `mobileSubPage`, `isMenuOpen`, `isActionDrawerOpen`, `showConversationHistory`, `showTranscriptBar`, `showAISearch`, `showMobileRecorder`, `mobileCollectionSheet`

### player-store（4 个）
`isPlaying`, `currentTime`, `isPlayingAll`, `playAllIndex`

### session-store（10 个）
`sessionId`, `isRecording`, `dataSource`, `serviceStatus`, `sessionMediaDurationMs`, `videoSeekNonce`, `videoPlayNonce`, `selectedAnchor`, `selectedConfusion`, `selectedHistoryConversation`

### collection-store（28 个）— Phase 1 新增
`sourceItems`, `archivedLocalCollectionItems`, `supportReferences`, `collectionComposerText`, `showCollectionPulsePreview`, `captureDrivenPulse`, `showScrollToLatest`, `isCollectionContextSelectionMode`, `selectedCollectionContextIds`, `selectedCollectionPrimaryId`, `quotedCollectionContextIds`, `quotedCollectionPrimaryId`, `confirmSelectedCollectionDelete`, `activeCollectionMessageMenuId`, `confirmCollectionDeleteId`, `sourceFilePickerMode`, `activeSourceImportCount`, `sourceImportError`, `playingAudioMessageId`, `audioPlaybackState`, `expandedAudioTranscriptId`, `workspaceCaptureEditor`, `workspaceCaptureEditorTitle`, `workspaceCaptureEditorBody`, `isSavingWorkspaceCaptureEdit`

派生 selector: `useSourceImporting`（`activeSourceImportCount > 0`）

### echo-store（7 个）— Phase 1 新增
`workspaceEchoes`, `workspaceCaptures`, `selectedEchoChip`, `isManualEchoRefreshing`, `manualEchoDebugNote`, `manualEchoFeedback`, `sharingEcho`

### mobile-ai-store（10 个）— Phase 1 新增
`mobileAIQuestion`, `mobileAIDisplayQuestion`, `mobileAILaunchImages`, `mobileAILaunchSupportContextText`, `mobileAIQuestionNonce`, `mobileAIConsumedQuestionNonce`, `mobileAIPreferSelectedContext`, `mobileAILaunchTarget`, `mobileAINewConversationNonce`, `mobileAIHasActiveConversation`

额外 action: `clearLaunchState`（批量清除启动状态）

### capture-editor-store（14 个）— Phase 1 新增
`segments`, `anchors`, `timeline`, `actionItems`, `audioBlob`, `audioUrl`, `videoSource`, `notes`, `confusionChatAnchor`, `videoInsightItems`, `activeVideoInsightId`, `extractedTermsHint`, `recorderAutoStartSignal`

### 仍在 page.tsx 中的局部状态

以下状态保留在 page.tsx，因为它们是纯局部 UI 或与 ref 紧耦合：
- `asrContextHint` — 只读，无 setter
- `hasCollectionContext` — useMemo 派生值
- `liveASRContextHint` — useMemo 派生值
- 各种 `useRef` 声明（segmentsRef, anchorsRef, etc.）

## Store 设计约定

1. **始终用 selector** 订阅（`useCollectionStore(s => s.sourceItems)`），不要全量订阅
2. 新增全局状态前先确认不能用 React state 或 URL params 解决
3. Store 不做异步操作（异步逻辑放在 hooks 或 services 中）
4. page.tsx 中使用 **setter alias** 模式（`const setViewMode = uiActions.setViewMode`），对下游代码零破坏
5. 需要函数式更新的 setter 使用 `resolveUpdate<T>()` 辅助函数
6. 每个 store 提供 `reset*State()` action 用于新会话初始化
7. 每个 store 通过 `devtools` 中间件支持 Redux DevTools 调试
