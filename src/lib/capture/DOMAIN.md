# Capture — 收集逻辑

> 「收集」是 MeetMind 的核心概念：用户把学习现场（录音/链接/图片/文本）发给 MeetMind。
> 这个模块处理收集项的类型识别、实时录音追加、视频会话判断。

## 文件索引

| 文件 | 行数 | 职责 | 核心 export |
|------|------|------|------------|
| `collection-context.ts` | 139 | 收集上下文项类型 + 用户面显示逻辑（音频显示为“录音”） | `CollectionContextItem`, `getCollectionContextDisplayTitle`, `buildSelectedCollectionContextText` |
| `collection-context.test.ts` | — | 收集上下文用户面文案护栏 | `getCollectionContextTypeLabel` |
| `live-recording.ts` | 64 | 实时录音追加（时间偏移 + 段落规范化） | `resolveLiveRecordingAppendOffset`, `appendLiveRecordingSegments` |
| `video-session.ts` | 76 | 视频会话判断 + 元数据构建 | `isStoredVideoFileSession`, `isStoredVideoSession`, `buildStoredVideoSource` |
