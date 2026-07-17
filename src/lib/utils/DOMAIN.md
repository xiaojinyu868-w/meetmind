# Utils — 纯工具函数

> 无状态、无副作用的工具函数。被 services、hooks、components 共同调用。

## 依赖规则

- ✅ 任何模块都可以 import `lib/utils/`
- ❌ `lib/utils/` 不能 import `lib/services/`, `components/`, `hooks/`, `stores/`
- ⚠️ `page-utils.ts` 是例外——它从 page.tsx 提取的函数，可能引用 `types/`

## 文件索引

| 文件 | 行数 | 职责 | 核心 export |
|------|------|------|------------|
| `json-utils.ts` | 459 | JSON 解析/修复（LLM 未转义引号修复、安全序列化） | `parseJsonResponse`, `safeStringify`, `deepClone`, `isValidJson` |
| `page-utils.ts` | 10 | Barrel re-export — 实际实现在 `page/` 子目录 | 全部 54 个导出符号 |
| `video-link.ts` | 191 | 视频链接解析 | `VideoProvider`, `ParsedVideoLink`, `parseVideoLink` |
| `transcript-utils.ts` | 166 | 转录工具（格式化/合并/分块/相似度） | `formatTranscriptWithTimestamps`, `mergeTranscriptText`, `chunkTranscript` |
| `time-utils.ts` | 132 | 时间格式化/解析 | `formatTimestamp`, `parseTimestamp`, `formatDurationMs` |
| `rate-limit.ts` | 59 | API 速率限制中间件封装 | `applyRateLimit`, `withRateLimit` |
| `public-routes.ts` | — | middleware 公共路由白名单与匹配函数；`/api/feed`、Tutor 对话/意图/学习理解与应用执行允许匿名请求，生成额度仍由 route 内 rate limit 控制 | `isPublicRoute` |
| `inline-app-retry.ts` | 23 | 内联应用执行的瞬时失败重试策略 | `shouldRetryInlineAppExecute`, `getInlineAppRetryDelayMs` |
| `tutor-agent-provider.ts` | ~180 | Tutor Agent OpenAI-compatible provider 配置解析（按请求模型 / env 选择 StepFun、DeepSeek、DashScope 或 OpenAI；强制 Chat Completions；提供 provider fallback、15 秒首字熔断配置、可恢复错误分类与用户错误文案格式化） | `resolveTutorAgentProviderConfig`, `resolveTutorAgentProviderFallbacks`, `resolveTutorFirstTokenTimeoutMs`, `shouldFallbackTutorAgentError`, `formatTutorAgentUserError` |
| `ai-model-preference.ts` | 19 | 设置页 AI 模型偏好 key 与 `auto` 解析 | `AI_MODEL_PREFERENCE_KEY`, `resolveExplicitAiModelPreference` |
| `video-source.ts` | 35 | 视频播放源标识恢复（B 站 bvid/cid） | `resolveBilibiliVideoIdentifiers` |
| `video-resolve-url.ts` | 22 | 旧视频 URL 解析接口兼容的安全 URL 归一化 | `resolveLegacyVideoUrl` |
| `video-thumbnail-url.ts` | 14 | B 站封面 URL 代理转换，避免 hdslb 热链 403 | `resolveVideoThumbnailUrl` |
| `translate-rate-limit-response.ts` | 8 | 翻译接口限流时的 200 软降级 payload | `buildTranslateRateLimitedPayload` |
| `open-app-marker.ts` | 31 | AI 回复中 `<open_app:KEY/>` 标记解析与清理 | `extractOpenAppMarker`, `isInlineAppKey` |
| `companion-quiz-memory.ts` | 45 | AI 同桌内联测验作答结果上下文 | `upsertQuizAttempt`, `buildQuestionWithQuizContext` |
| `classroom-companion-storage.ts` | 5 | 课堂同桌历史按 session 分桶 key | `getCompanionMessagesPreferenceKey` |
| `classroom-companion-copy.ts` | 1 | 课堂同桌首 token 前状态文案 | `IN_CLASS_PENDING_REPLY_LABEL` |
| `live-translation-rows.ts` | 34 | 录课中稳定实时转写/翻译行构建 | `buildLiveTranslationRows` |
| `translation-retry-policy.ts` | 23 | 翻译接口失败/429 后的前端退避策略 | `getTranslationRetryDelayMs`, `shouldSkipTranslationTerm`, `shouldSkipTranslationRequest` |
| `inline-app-transcript.ts` | 19 | AI 同桌内联应用生成时选择最新可用转录 | `selectInlineAppTranscript`, `hasEnoughInlineAppTranscript` |
| `inline-app-fallback.ts` | 103 | 内联应用后端生成失败时的本地兜底 payload | `buildInlineAppFallbackPayload` |
| `app-execution-cache.ts` | 223 | 应用矩阵 / 复习对话共用的 localStorage 产物缓存与 task 状态 key；进入历史对话时必须先读缓存，避免已生成应用重复执行 | `readCachedAppResult`, `writeCachedAppResult`, `readCachedTaskState`, `writeCachedTaskState` |
| `learning-context.ts` | ~180 | 长期记忆 / 课堂归组偏好 / 近期活动 / 学习线索的纯恢复、合并、去重与 Tutor 上下文格式化；课堂原件不复制进画像，只同步用户对课程边界的纠正 | `learningContextFromProfile`, `mergeLearningMemory`, `mergeLearningActivity`, `toLearningActivityPreview`, `formatLearningContextForTutor` |
| `course-context.ts` | ~290 | 从真实 `audioSessions` 推导课程上下文：显式学科优先，课名与重复时段只作可见建议；合并用户改名/确认/暂停/单课移出偏好及当前考试边界，被移出的课堂成为可恢复的单课卡，不删除课堂原件 | `buildCourseContextGroups` |
| `app-learning-activity.ts` | ~15 | 应用结果写入学习现场前的稳定摘要选择：优先渲染说明，其次首张卡片，最后使用数量兜底 | `buildAppResultActivityDetail` |
| `index.ts` | 40 | barrel 导出 | re-export time-utils, json-utils, transcript-utils |

### `page/` 子目录（从 page-utils.ts 拆分）

| 文件 | 行数 | 职责 | 核心 export |
|------|------|------|------------|
| `text-and-constants.ts` | 66 | 基础层：常量 + 文本工具 + 键生成器 + Workshop 窗口 | `compactText`, `compactMultilineText`, `ACTION_PROGRESS_KEY_PREFIX`, `normalizeWorkshopWindows` |
| `segment-and-support.ts` | 93 | 转录片段 + 补充材料辅助 | `mapSegmentsForAppend`, `buildSupportReferenceSnippet`, `mergeSupportReferences` |
| `echo-display-utils.ts` | 214 | Echo 回声显示层 | `mergeWorkspaceEchoes`, `resolveEchoDisplayTime`, `buildManualEchoFeedbackFromPayload` |
| `capture-source-utils.ts` | 366 | Capture/Source 采集管理 | `mergeWorkspaceCaptures`, `buildWorkspaceCaptureSourceItem`, `buildWechatCaptureSourceItem` |
| `context-and-format.ts` | 368 | ASR/Tutor 上下文 + 视频洞察 + 格式化 + API 调用 | `buildASRContextHint`, `buildTutorSupportContextText`, `transcribeAudioFile`, `parseDocumentFile` |

> 依赖拓扑：`text-and-constants` 是最底层，被所有其他子模块依赖；`echo-display-utils` 和 `capture-source-utils` 互不依赖；`context-and-format` 依赖 `text-and-constants`。
