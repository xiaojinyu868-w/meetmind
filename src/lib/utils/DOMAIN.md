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
| `public-routes.ts` | 59 | middleware 公共路由白名单与匹配函数 | `isPublicRoute` |
| `inline-app-retry.ts` | 23 | 内联应用执行的瞬时失败重试策略 | `shouldRetryInlineAppExecute`, `getInlineAppRetryDelayMs` |
| `tutor-agent-provider.ts` | 121 | Tutor Agent OpenAI-compatible provider 配置解析（按请求模型 / env 选择 DeepSeek、DashScope 或 OpenAI；强制 Chat Completions；提供 DeepSeek ↔ DashScope fallback 候选、可恢复错误分类与用户错误文案格式化） | `resolveTutorAgentProviderConfig`, `resolveTutorAgentProviderFallbacks`, `shouldFallbackTutorAgentError`, `formatTutorAgentUserError` |
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
