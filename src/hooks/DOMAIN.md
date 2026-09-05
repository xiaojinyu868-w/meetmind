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
| `useConversationHistory.ts` | 385 | 对话历史管理（CRUD + 分页 + 消息级操作） |
| `useDragGesture.ts` | 143 | 拖拽手势（用于浮窗拖动） |
| `useNetworkStatus.ts` | 26 | 网络在线状态监听 |
| `useRecording.ts` | 70 | 录音控制（start/stop/pause） |
| `useResizable.ts` | 145 | 面板大小调整（拖拽调整宽度） |
| `useResponsive.ts` | 113 | 响应式断点检测（mobile/tablet/desktop） |
| `useTextSelection.ts` | 97 | 文本选择检测（用于划词解释） |
| `useTranscript.ts` | 134 | 转录数据管理 |
| `useVoiceInput.ts` | 270 | 语音输入（含 buffered 模式判断） |
| `useOmniRealtimeCall.ts` | ~400 | **@deprecated 2026-08**：Qwen Omni realtime 语音通话（/api/tutor-call 已拆除），保留一个周期后物理删除 |
| `useRealtimeTutorConversationBridge.ts` | ~120 | 语音同桌转写持久化到 `global-chat`（随语音通话下线，仅 deprecated 组件引用） |
| `useWorkshopWindows.ts` | 122 | Workshop 浮窗状态管理 |
| `useClassCheck.ts` | ~455 | 随堂检验控制器（Plan 生成 + 播放追踪 + 自动/手动触发 + checkpoint 状态机）；流式转录尚未覆盖预热窗口或限流时降级为证据就近的兜底题，外部通过 videoPlayerRef 真正暂停/恢复媒体 |
| `useReviewSession.ts` | 506 | 复习会话恢复（IndexedDB / 服务端转录 → 播放态），从 page.tsx 提取 |
| `useEchoActions.tsx` | 412 | 回声操作（refreshDailyEcho + 筛选 memo + 手动触发 UI），从 page.tsx 提取 |
| `useWorkspaceCaptureActions.ts` | ~430 | 工作空间 capture CRUD 操作（新建/编辑/保存/归档/删除等 10 个函数），从 page.tsx 提取 |
| `useSourceImport.ts` | ~863 | 文件/链接导入管线（handleImportFiles + importVideoLink + importArticleLink + handleVideoImportReady + handleSourceFile* + importComposerVideoLink），从 page.tsx 提取 |
| `useCollectionComposer.ts` | ~689 | 收集 Composer 完整逻辑（输入/提交/上下文选择/引用/滚动/菜单操作/语音听写），从 page.tsx 提取（Phase 3）；placeholder 与 pulse nudge 文案统一走 `COPY.collection` |
| `useCollectionPulse.ts` | ~250 | 收集整理提示（collectionPulse 状态计算 + captureActivitySummary + 自动显隐 effect），从 page.tsx 提取（Phase 3）；title/body/chips/actions 文案统一走 `COPY.collection.pulse` |
| `useTutorLauncher.ts` | ~340 | AI 家教启动逻辑（blobToDataUrl + buildTutorLaunchImages + buildTutorPrompt* + openTutor* + applyBatchAction），从 page.tsx 提取（Phase 4） |
| `useTranscriptIngest.ts` | ~400 | 转录摄入与持久化；尊重调用方的 persistSourceKey/sourceType/role，并将来源 provenance 写入 WorkspaceCapture。音频拼接护栏：只有「当前会话本身就是上一次导入新建的」才把已有会话音频并入（模块级 lastIngestCreatedSessionId），防止资料 A 的音频拼进课程 B |
| `useRecordingLifecycle.ts` | 477 | 录音生命周期（persistCaptureToWorkspace + handleRecordingStart + handleRecordingStop）；写入 `transcriptionStatus` pending/completed/failed；2026-08 单遍化：realtime 结果停录即发布为课后证据并触发课后理解，不再自动跑课后 batch 定稿与说话人分离 |
| `useTranscriptHandlers.ts` | 349 | 转录处理器（handleTranscriptUpdate + handleRecordingTranscriptionError + handleTranscriptEnhanced + handleVideoAssistantMessage + handleTranscriptTextUpdate）；兜底批量转写落盘后推进 ready / review，失败时同步 audioSession 为 failed；不再自动触发 diarization |
| `useAudioMessagePlayback.ts` | ~130 | 收集流音频播放（stopAudioMessagePlayback + toggleAudioMessagePlayback + cleanup effect），从 page.tsx 提取（Phase 4） |
| `useCollectionListActions.ts` | ~268 | 收集列表操作适配层（ensureWorkspaceCaptureSourceItem + resolveCollectionListSourceItem + quote/review/toggle/archive/restore/delete/edit/askTutor），从 page.tsx 提取（Phase 5） |
| `usePointsSummary.ts` | ~140 | 积分摘要（GET /api/points/summary）：无 token 静默返回 null；`notifyPointsChanged()` 事件（含 BroadcastChannel 跨标签页广播）让扣费入口触发余额刷新；页面回前台（visibilitychange/focus）自动刷新，覆盖站外完成支付场景；契约含 `membership`（档位/到期）与 `asrFreeMinutesPerMonth`（档位化总额度，进度条分母） |
| `points-guard.ts` | ~55 | 402 扣费拦截统一识别（insufficient_points / monthly_cost_cap / guest_daily_cap / membership_required）与 COPY 文案，供 tutor/apps 各 fetch 入口复用 |
| `useAsrQuotaPrecheck.ts` | ~60 | 录课前 ASR 免费额度预检（GET /api/points/asr-quota）：免费分钟用完时 toast 一句轻提示；余额也不够按分钟续时直接唤起 Paywall；由 useRecordingLifecycle.handleRecordingStart 开新课时调用 |
| `usePaywall.ts` | ~90 | 全局付费拦截页状态（zustand）：402 insufficient_points / membership_required / ASR 额度用尽 / 设置页与一级页面主动打开（topup/upgrade）时 `openPaywallGlobal` 唤起 `PaywallDialog`；`tab` 参数指定落「会员」或「充积分」Tab；guest 限额不弹（先引导登录）。`openPaywallForChatError` / `parseChatErrorPointsBlock`：useChat（DefaultChatTransport）面板的 402 统一接线——Error.message 即响应 body，识别后唤起对应 Tab 并把行内错误换成 points-guard 文案（TutorAgentPanel / GlobalAskPanel 已接） |
| `useWechatCaptureImport.ts` | ~243 | 微信收集导入；兜底文章解析沿用 `wechat:*` sourceKey 与 provenance，避免重复 capture |
| `useWorkspaceContextLoader.ts` | ~183 | 工作区上下文加载 + 同步（API 加载 + captures 合并 + captureDrivenPulse 自动过期），从 page.tsx 提取（Phase 5） |
| `useAnchorActions.ts` | ~175 | 困惑点/锚点 CRUD（handleAnchorMark + handlePlaybackAnchorAdd + handleAnchorSelect + handleResolveAnchor），从 page.tsx 提取（Phase 5） |
| `useSeekController.ts` | ~125 | 播放跳转 + 时间归一化（normalizeSeekTime + handleVideoSeek + handleUnifiedSeek），从 page.tsx 提取（Phase 5） |
| `useAppStateRestore.ts` | ~195 | 应用初始化 + 状态持久化（saveAppState + persist effect + init effect），从 page.tsx 提取（Phase 5） |
| `usePendingRecordedAudio.ts` | ~55 | 待处理录音音频管理（pendingRecordedAudiosRef + resolve/clear），从 page.tsx 提取（Phase 6） |
| `useNoteActions.ts` | ~65 | 笔记 CRUD（handleAddNote + handleUpdateNote + handleDeleteNote），从 page.tsx 提取（Phase 6） |
| `useActionItems.ts` | ~105 | 行动项管理（handleActionComplete + handleStartNextAction + handleGenerateSummary + handleActionItemsUpdate），从 page.tsx 提取（Phase 6） |
| `useExtractTerms.ts` | ~105 | ASR 热词提取 + 实时上下文提示（extractTerms effect + liveASRContextHint memo），从 page.tsx 提取（Phase 6） |
| `useSourceItemManagement.ts` | ~120 | 源项 CRUD（appendSourceItem + updateSourceItem + appendSupportSource），从 page.tsx 提取（Phase 6） |
| `useClassroomLessons.ts` | ~130 | 课堂列表数据适配（audioSessions + transcripts + highlightTopics + workspaceEchoes/Captures + preferences + sourceItems → Lesson[] + markReviewed），响应式 |
| `useClassroomCompanion.ts` | ~260 | 课堂同桌对话（/api/tutor 流式 + 动态开场白 + 按 session 历史持久化 + 错误降级 + short-circuit），为 ClassroomView 专属 |
| `useClassroomFlow.ts` | ~145 | 课中课堂脉络请求与稳定状态：只把上次成功请求后未消费的 segment 作为 `newSegments` 按字符预算顺序分批发送，失败不推进游标；成功结果按 sessionId 持久化，课后应用矩阵直接复用；保留上一轮有用理解并标记新内容，不用关键词替模型切主题 |
| `usePersistedClassroomFlow.ts` | ~45 | 按当前 sessionId 读取录课中已保存的课堂脉络，并在切换课堂时取消旧读取结果；同时为本地试听脉络提供按 updatedAt 去重的持久化桥，供桌面与移动应用矩阵共享 |
| `useLiveConcepts.ts` | ~100 | 录课中关键概念启发式抽取（订阅 captureEditorStore.segments，零 API），ClassroomRecordingView 消费 |
| `useLearningContext.ts` | ~220 | 双层学习上下文状态：登录态合并写入 `learnerProfile`，游客写 IndexedDB；长期学习理解可由模型整理、用户纠正，客观最近学习现场独立保存，并通过页面事件同步多个消费组件 |
| `useCourseContextPack.ts` | ~110 | 按学生选中的真实课堂懒加载转录、标记与摘要；至少两节有原文时构造 unit ContextPack，有学生确认的考试对象时升级为 exam tier 并注入考试名/日期/方式/大纲，不把空课堂或模型猜测伪装成考试材料 |
| `useLessonDigest.ts` | ~150 | 课后课堂笔记：只展示与当前完整转录 requestKey 对应的模型结果；返回前保持整理态，禁止用前几句话截断拼临时标题后再覆盖。生成成功按 sessionId 持久化到 IndexedDB `lessonDigests` 表，挂载时先读缓存，内容签名（段数+末段 endMs+图片 id 集合）一致直接复用不打 LLM |
| `useGlobalAskHistory.ts` | ~205 | 全局 Ask 的 IndexedDB 对话恢复/增量持久化 adapter；只恢复 `metadata.scope='global-ask'`，避免误接课堂复习对话；`authReady`（auth 初始化完成）前不恢复/不持久化，防止 anonymous→真实 userId 切换清空对话；恢复跳过 0 条消息的空壳对话回退到最近有内容的一条；登录态找不到时回退捞 anonymous 名下的旧对话并 `claimConversation` 迁移归属；恢复期间用户已发言则不覆盖；`restoredTitle` 仅真实恢复时设置 |
| `useLearningIntentFlow.ts` | ~120 | 全局 Ask 的意图确认与线程转换：高置信且无关键分歧时直接开始，并把最终计划同步放进第一次 Tutor 请求；只有真实歧义或低置信计划才停下来确认 |
| `useLearningMemoryDistillation.ts` | ~90 | 全局学习问答持久化后的静默学习理解管理：调用 `/api/tutor/memory` 获取少量候选，按 `replaceId` 更新或新增长期理解并同步活跃学习线索；是否值得保留由证据约束模型判断，网络或模型失败不影响客观学习现场与主回答 |
| `useAppLearningActivity.ts` | ~80 | 桌面与移动应用共用的学习活动回写：记录应用生成结果及闪卡/测验交互到最近学习现场，使用稳定 sourceId 去重，不直接升级为长期记忆 |

### data/ — API 数据 hooks

| 文件 | 行数 | 职责 |
|------|------|------|
| `useSession.ts` | 140 | 会话 CRUD（IndexedDB） |
| `useSessionKeyframes.ts` | ~55 | 复习页按 sessionId 懒加载课中「截取这一页」关键帧（blob→objectURL / mediaUrl），喂 TranscriptFlowView keyframes prop |
| `useSummary.ts` | 155 | 课堂摘要生成（调用 API）— classSummary 仍被 AITutor / WorkshopYellowPage 消费 |
| `useTopics.ts` | 129 | 精选片段生成（调用 API）— ⚠️ UI 入口已移除，仅后台数据能力保留 |
| `useTranscript.ts` | 121 | 转录数据请求（调用 API） |
| `useTutor.ts` | 164 | AI 家教交互（调用 API） |
| `useFeedStream.ts` | ~190 | 今日情报请求与缓存：按工作区上下文/目标签名缓存 6 小时，先恢复可用旧结果再后台刷新；收集或目标变化时自动失效，并过滤本机已标记不相关的卡片 |

## ⚠️ 超标文件

（无）
