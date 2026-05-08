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
| `tutor-agent-provider.ts` | 31 | Tutor Agent OpenAI-compatible provider 配置解析 | `resolveTutorAgentProviderConfig` |
| `video-source.ts` | 35 | 视频播放源标识恢复（B 站 bvid/cid） | `resolveBilibiliVideoIdentifiers` |
| `companion-quiz-memory.ts` | 45 | AI 同桌内联测验作答结果上下文 | `upsertQuizAttempt`, `buildQuestionWithQuizContext` |
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
