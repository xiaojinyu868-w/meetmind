# Stores — 全局客户端状态

> Zustand 状态管理。组件和 hooks 通过 selector 订阅。

## 依赖规则

```
components/hooks → stores → types
```

- ✅ stores 可以 import `types/`
- ❌ stores 不能 import `components/`, `hooks/`, `lib/services/`
- ⚠️ session-store 有例外：import `Anchor` from `anchor-service`（类型 only）和 `ConfusionMarker` from `PodcastPlayer`

## 文件索引

| 文件 | 行数 | 职责 | 核心 export | 管理状态数 |
|------|------|------|------------|-----------|
| `ui-store.ts` | ~160 | 全局 UI 状态 | `useUIStore`, `useViewMode`, `useReviewTab`, `useVideoWorkspaceTab`, `useMobileSubPage`, `useMobileCollectionSheet`, `useUIActions` | 16 |
| `player-store.ts` | 67 | 音频播放器状态 | `usePlayerStore`, `useIsPlaying`, `useCurrentTime`, `usePlayerActions` | 4 |
| `session-store.ts` | ~140 | 课堂会话核心 | `useSessionStore`, `useSessionId`, `useIsRecording`, `useDataSource`, `useSelectedAnchor`, `useSessionActions` | 10 |
| `index.ts` | ~50 | barrel 导出 | re-export 全部 | — |

## 迁移状态（page.tsx）

已从 page.tsx 的 useState 迁移到 Zustand store：

### ui-store（16 个）
`showSplash`, `appReady`, `loadingProgress`, `viewMode`, `reviewTab`, `videoWorkspaceTab`, `mobileSubPage`, `isMenuOpen`, `isActionDrawerOpen`, `showConversationHistory`, `showTranscriptBar`, `showAISearch`, `showMobileRecorder`, `mobileCollectionSheet`

### player-store（4 个）
`isPlaying`, `currentTime`, `isPlayingAll`, `playAllIndex`

### session-store（10 个）
`sessionId`, `isRecording`, `dataSource`, `serviceStatus`, `sessionMediaDurationMs`, `videoSeekNonce`, `videoPlayNonce`, `selectedAnchor`, `selectedConfusion`, `selectedHistoryConversation`

### 仍在 page.tsx useState 中（~54 个）
暂未迁移的状态因为与 ref 紧密配套（如 `segments` + `segmentsRef`）或属于局部 UI 交互，迁移收益低于风险。

## 使用约定

1. **始终用 selector** 订阅（`useUIStore(s => s.viewMode)`），不要 `useUIStore()` 全量订阅
2. 新增全局状态前先确认不能用 React state 或 URL params 解决
3. Store 不做异步操作（异步逻辑放在 hooks 或 services 中）
4. page.tsx 中使用 **setter alias** 模式（`const setViewMode = uiActions.setViewMode`），对下游代码零破坏
5. 需要函数式更新的状态使用专用 action（如 `incrementVideoSeekNonce`、`toggleTranscriptBar`）
