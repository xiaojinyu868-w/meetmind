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
| `page-utils.ts` | ~1133 | 页面级工具函数集（从 page.tsx 提取） | `compactText`, `mergeWorkspaceEchoes`, `buildWorkspaceCaptureSourceItem`, `formatTime` 等 ~40+ 函数 |
| `video-link.ts` | 191 | 视频链接解析 | `VideoProvider`, `ParsedVideoLink`, `parseVideoLink` |
| `transcript-utils.ts` | 166 | 转录工具（格式化/合并/分块/相似度） | `formatTranscriptWithTimestamps`, `mergeTranscriptText`, `chunkTranscript` |
| `time-utils.ts` | 132 | 时间格式化/解析 | `formatTimestamp`, `parseTimestamp`, `formatDurationMs` |
| `rate-limit.ts` | 59 | API 速率限制中间件封装 | `applyRateLimit`, `withRateLimit` |
| `index.ts` | 40 | barrel 导出 | re-export time-utils, json-utils, transcript-utils |

## ⚠️ 超标文件

- `page-utils.ts` (1133) — 从 page.tsx 提取的大量函数，后续可按功能域拆分
