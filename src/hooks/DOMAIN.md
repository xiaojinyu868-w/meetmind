# Hooks — 客户端状态与交互逻辑

> 封装可复用的客户端逻辑。被 components 和 page.tsx 调用。

## 依赖规则

```
hooks → stores + types + lib/db + lib/utils
```

- ✅ hooks 可以调用 `stores/`, `types/`, `lib/db/`, `lib/utils/`
- ✅ hooks 可以调用其他 hooks
- ✅ 从 page.tsx 提取的 hooks 可调用 `lib/services/`（classroomDataService, memoryService, anchorService 等客户端本地服务）
- ❌ hooks 不能 import `components/`（hooks 被组件调用，不能反向）

## 文件索引

### 顶层 hooks

| 文件 | 行数 | 职责 |
|------|------|------|
| `useAnalytics.ts` | 349 | 用户行为分析上报（会话/页面/事件追踪） |
| `useAnchors.ts` | 130 | 困惑锚点 CRUD（IndexedDB） |
| `useAudio.ts` | 104 | 音频播放控制（play/pause/seek） |
| `useAudioSessions.ts` | 127 | IndexedDB 会话/锚点/转录查询 |
| `useConversationHistory.ts` | ~455 | 对话历史管理（CRUD + 分页 + 消息级操作）；云端 evidence 合并后重读列表与当前消息，删除态清空当前选择 |
| `useWorkspaceConversationSync.ts` | ~35 | 登录态会话 outbox 生命周期：挂载、重新联网和新 mutation 时排空；暴露云端合并 revision 给历史 UI 水合 |
| `useAccountConversationSync.ts` | ~35 | 账号级全局问答同步生命周期：登录挂载、重新联网和新 mutation 时执行首次补传、outbox 排空与云端下拉；广播账号历史合并 revision |
| `useDragGesture.ts` | 143 | 拖拽手势（用于浮窗拖动） |
| `useFloatingPanelGeometry.ts` | ~275 | 锚点浮窗的可见视口约束与二维 pointer 拖拽/缩放；监听 `visualViewport`，手机键盘弹起或窗口变化时自动收纳，并提供纯几何函数供边界测试 |
| `useNetworkStatus.ts` | 26 | 网络在线状态监听 |
| `useRecording.ts` | 70 | 录音控制（start/stop/pause） |
| `useResizable.ts` | 145 | 面板大小调整（拖拽调整宽度） |
| `useResponsive.ts` | 113 | 响应式断点检测（mobile/tablet/desktop） |
| `useTextSelection.ts` | ~130 | 鼠标、触屏、键盘文本选择检测（用于划词解释） |
| `useTranscript.ts` | 134 | 转录数据管理 |
| `useVoiceInput.ts` | 270 | 语音输入（含 buffered 模式判断） |
| `useOmniRealtimeCall.ts` | ~400 | Qwen Omni realtime 语音通话（麦克风上行 + 语音下行） |
| `useRealtimeTutorConversationBridge.ts` | ~130 | 语音同桌转写持久化到课堂绑定 `global-chat`，并把 conversationId 回传给文字 agent；挂载时恢复会话 outbox 重试 |
| `useWorkshopWindows.ts` | 122 | Workshop 浮窗状态管理 |
| `useClassCheck.ts` | ~455 | 随堂检验控制器（Plan 生成 + 播放追踪 + 自动/手动触发 + checkpoint 状态机）；流式转录尚未覆盖预热窗口或限流时降级为证据就近的兜底题，外部通过 videoPlayerRef 真正暂停/恢复媒体 |
| `useReviewSession.ts` | <500 | 复习会话恢复（IndexedDB / 服务端转录 → 播放态）；共享视频源构建下沉到 `lib/capture/video-session.ts`，store action group 作为稳定 callback 依赖 |
| `useEchoActions.tsx` | 412 | 回声操作（refreshDailyEcho + 筛选 memo + 手动触发 UI），从 page.tsx 提取 |
| `useWorkspaceCaptureActions.ts` | ~430 | 工作空间 capture CRUD 操作（新建/编辑/保存/归档/删除等 10 个函数），从 page.tsx 提取 |
| `useSourceImport.ts` | 55 | 收集导入组合层：组合文件、视频、文章三个 Hook，并按 composer reach 分派链接；对 page.tsx 保持原有调用契约 |
| `source-import-types.ts` | 131 | 收集导入共享契约（依赖、refs、文件选择模式、视频/文章 options 与统一返回类型） |
| `useSourceFileImport.ts` | 416 | 本地文件导入：图片/文档解析、音视频转写、进度反馈、来源条目与 workspace capture 回写 |
| `useVideoSourceImport.ts` | 257 | 视频链接导入：URL 去重、平台解析、进度与错误映射、当前 B站 Cookie 请求、完整 provenance 摄入 |
| `useArticleSourceImport.ts` | 188 | 文章链接导入：URL 去重、正文/图片接入、完整 provenance 与原文回写 |
| `useCollectionComposer.ts` | 420 | 收集 Composer 编排层：链接识别、语音听写、提交、文件粘贴与原声入口；不再反向依赖 Recorder 组件，只声明所需的最小 recorder 能力 |
| `useCollectionContextController.ts` | 405 | 收集上下文控制器：勾选、引用、菜单、长按、composer 聚焦与相关状态自愈；用户文案统一走 `COPY.collection` |
| `useCollectionFeedNavigation.ts` | 158 | 收集流排序、滚动侦测、首屏定位与新消息自动跟随；隔离 DOM/MutationObserver 生命周期 |
| `useCollectionPulse.ts` | ~250 | 收集整理提示（collectionPulse 状态计算 + captureActivitySummary + 自动显隐 effect），从 page.tsx 提取（Phase 3）；title/body/chips/actions 文案统一走 `COPY.collection.pulse` |
| `useTutorLauncher.ts` | <500 | AI 家教启动逻辑（blobToDataUrl + buildTutorLaunchImages + buildTutorPrompt* + openTutor* + applyBatchAction），从 page.tsx 提取（Phase 4）；今日情报入口保留卡片原问题，并把关联收集的文本与图片作为有根上下文注入对话，启动前清理旧选择以避免串场 |
| `useTranscriptIngest.ts` | ~400 | 转录摄入与持久化；尊重调用方的 persistSourceKey/sourceType/role，并将来源 provenance 写入 WorkspaceCapture |
| `useRecordingLifecycle.ts` | ~255 | 录音生命周期组合层：Workspace capture 持久化 + 开始录课状态隔离；停止收尾委托 `useRecordingStop` |
| `useRecordingStop.ts` | ~390 | 停止录课收尾：本地音频/转录落盘、Workspace 锚点快照、原声音频与关键帧上传、capture 落地后锚点/笔记/会话 outbox 重试、延迟定稿快照冻结与课后应用入口 |
| `useAnchorActions.ts` | ~270 | 课堂锚点显式 mutation 入口：新增、解决和补备注先更新本机，再写锚点与个人笔记持久 outbox；登录态恢复或网络重新在线时重试 Workspace 增量同步 |
| `useTranscriptHandlers.ts` | <500 | 转录处理器（handleTranscriptUpdate + handleRecordingTranscriptionError + handleTranscriptEnhanced + handleVideoAssistantMessage + handleTranscriptTextUpdate）；完整原声定稿落盘后才推进 ready / review，并使用 pending 快照同步同课锚点，失败时同步 audioSession 为 failed |
| `useAudioMessagePlayback.ts` | ~130 | 收集流音频播放（stopAudioMessagePlayback + toggleAudioMessagePlayback + cleanup effect），从 page.tsx 提取（Phase 4） |
| `useCollectionListActions.ts` | ~280 | 收集列表操作适配层（ensureWorkspaceCaptureSourceItem + resolveCollectionListSourceItem + quote/review/toggle/archive/restore/delete/edit/askTutor），打开复习可携带课堂毫秒位置，从 page.tsx 提取（Phase 5） |
| `useWechatCaptureImport.ts` | ~243 | 微信收集导入；兜底文章解析沿用 `wechat:*` sourceKey 与 provenance，避免重复 capture |
| `useWorkspaceContextLoader.ts` | ~183 | 工作区上下文加载 + 同步（API 加载 + captures 合并 + captureDrivenPulse 自动过期），从 page.tsx 提取（Phase 5） |
| `useSeekController.ts` | ~125 | 播放跳转 + 时间归一化（normalizeSeekTime + handleVideoSeek + handleUnifiedSeek），从 page.tsx 提取（Phase 5） |
| `useAppStateRestore.ts` | ~195 | 应用初始化 + 状态持久化（saveAppState + persist effect + init effect），从 page.tsx 提取（Phase 5） |
| `usePendingRecordedAudio.ts` | ~55 | 待处理录音音频管理（pendingRecordedAudiosRef + resolve/clear），从 page.tsx 提取（Phase 6） |
| `useNoteActions.ts` | ~75 | 笔记 CRUD：先通过 `note-service` 落 IndexedDB 并进入 Workspace outbox，再回写/乐观更新课堂 store；从 page.tsx 提取（Phase 6） |
| `useWorkspaceNoteHydration.ts` | ~55 | 当前课堂笔记水合：按 session 与账号过滤 IndexedDB 笔记，监听 evidence 合并事件后刷新课堂 store，避免复习页被空数组覆盖 |
| `useActionItems.ts` | ~105 | 行动项管理（handleActionComplete + handleStartNextAction + handleGenerateSummary + handleActionItemsUpdate），从 page.tsx 提取（Phase 6） |
| `useExtractTerms.ts` | ~105 | ASR 热词提取 + 实时上下文提示（extractTerms effect + liveASRContextHint memo），从 page.tsx 提取（Phase 6） |
| `useSourceItemManagement.ts` | ~120 | 源项 CRUD（appendSourceItem + updateSourceItem + appendSupportSource），从 page.tsx 提取（Phase 6） |
| `useClassroomLessons.ts` | ~130 | 课堂列表数据适配（audioSessions + transcripts + highlightTopics + workspaceEchoes/Captures + preferences + sourceItems → Lesson[] + markReviewed），响应式 |
| `useClassroomCompanion.ts` | 443 | 课堂同桌组合层：构造 in-class 请求、消费 UIMessage stream、清理课中时间戳与调度结构化应用；切换课堂或连续提问会使旧流失效，模型与 learner profile 始终读取当前值 |
| `useClassroomCompanionHistory.ts` | 142 | 课堂同桌 session 历史：按课堂水合/防抖持久化、动态开场白、新课清空与停止录课收尾；录课结束不重新水合，避免覆盖收尾消息 |
| `useClassroomMomentMarker.ts` / `.model.ts` | ~130 | 课中「记一下」闭环：从当前转录与录音时钟生成有根时间点，5 秒窗口防重复，写入 IndexedDB `anchors(type='important')` 并同步当前 store；成功落盘后才由组件反馈 |
| `useClassroomInlineApps.ts` | 250 | 课堂同桌内联应用：生成/重试/诚实空态、闪卡与测验交互记忆；应用请求使用当前模型偏好 |
| `classroom-companion-helpers.ts` | 54 | 课堂同桌纯 helper：过滤空应用卡/自动在场消息、去重本轮问题、清洁代理 HTML 与长错误 |
| `useClassroomFlow.ts` | ~145 | 课中课堂脉络请求与稳定状态：只把上次成功请求后未消费的 segment 作为 `newSegments` 按字符预算顺序分批发送，失败不推进游标；成功结果按 sessionId 持久化，课后应用矩阵直接复用；保留上一轮有用理解并标记新内容，不用关键词替模型切主题 |
| `usePersistedClassroomFlow.ts` | ~45 | 按当前 sessionId 读取录课中已保存的课堂脉络，并在切换课堂时取消旧读取结果；同时为本地试听脉络提供按 updatedAt 去重的持久化桥，供桌面与移动应用矩阵共享 |
| `useLiveConcepts.ts` | ~100 | 录课中关键概念启发式抽取（订阅 captureEditorStore.segments，零 API），ClassroomRecordingView 消费 |
| `useLearningContext.ts` | ~250 | 双层学习上下文状态：登录态合并写入 `learnerProfile`，游客写 IndexedDB；长期学习理解、客观近期现场和有界 Task 历史独立保存；同课应用互动与已精确绑定的深度对话 Event 可与活动流原子合并，推进活跃 Task 并追加课堂/对话/应用证据 ID，通过页面事件同步多个消费组件 |
| `useCourseContextPack.ts` | ~110 | 按学生选中的真实课堂懒加载转录、标记与摘要；至少两节有原文时构造 unit ContextPack，有学生确认的考试对象时升级为 exam tier 并注入考试名/日期/方式/大纲，不把空课堂或模型猜测伪装成考试材料 |
| `useLessonDigest.ts` | ~140 | 课后课堂笔记：requestKey 覆盖当前完整转录段正文、时间范围、图片 OCR 与标题；任意课堂原文修正都会使旧 digest 失效，返回前保持整理态，失败保留原文并提供原地重试，禁止用前几句话截断拼临时标题后再覆盖 |
| `useGlobalAskHistory.ts` | ~195 | 全局 Ask 的账号同步 + IndexedDB 恢复/增量持久化 adapter；水合前先收敛云端历史，优先按 active learning thread 的 `conversationId` 恢复并在首次持久化时回填绑定，按 `sessionId='global-ask'` 精确恢复，合并打开期间的乐观消息避免覆盖用户刚发送的内容 |
| `useGlobalAskThreadBinding.ts` / `.test.ts` | ~75 | 全局 Ask 的活跃学习线索绑定桥：稳定保存面板打开期间的线程引用，创建深度会话时先更新引用，再把真实对话 ID 回填到线程；已绑定或非 active 线程不可被覆盖 |
| `useLearningIntentFlow.ts` | ~120 | 全局 Ask 的意图确认与线程转换：高置信且无关键分歧时直接开始，并把最终计划同步放进第一次 Tutor 请求；深度 Task 创建时同时绑定 `sessionId` 和 `relatedSessionIds` 首条证据，只有同课真实应用互动才可回流；只有真实歧义或低置信计划才停下来确认 |
| `useLearningMemoryDistillation.ts` / `.test.ts` | ~150 | 全局学习问答持久化后的静默上下文管理：调用 `/api/tutor/memory` 获取少量长期理解候选，按 `replaceId` 更新或新增；仅深度会话更新活跃学习线，先用真实回答保存可恢复摘要，模型成功后再以独立 `threadProgress` 精炼累计进度与一个下一步。快捷问答不污染线索，网络或模型失败不影响客观学习现场与主回答 |
| `useAppLearningActivity.ts` | ~80 | 桌面与移动应用共用的学习活动回写：生成结果只记录到客�