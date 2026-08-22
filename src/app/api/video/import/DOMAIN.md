# API: Video Import — 视频/音频导入管线

> 从 URL 导入视频/音频 → 下载 → 转码 → ASR 转写。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `route.ts` | ~1320 | 主路由：管线编排（stage order/cleanup/错误处理/长音频直连/WS 兜底） |
| `video-import-types.ts` | ~293 | 共享类型（StageName, PipelineError, TranscribedResult 等）+ 常量 |
| `video-import-asr-check.ts` | — | ASR 结果完整性校验（`assessAsrCoverage`，所有转写通道共用） |
| `video-import-download.ts` | — | 下载逻辑（yt-dlp/直连/缓存） |
| `video-import-segment.ts` | — | 转录片段处理 |

## 支持平台

| 平台 | Provider | 管线路径 |
|------|----------|---------|
| YouTube | `youtube` | yt-dlp → ASR |
| Bilibili | `bilibili` | yt-dlp → ASR（国内，不需 HK 节点） |
| 小宇宙播客 | `xiaoyuzhou` | 专用 stage → m4a 下载 → 转码 → ASR |
| 抖音 | `douyin` | yt-dlp → ASR（国内，需 cookie） |
| 通用视频 | 其他 | yt-dlp fallback → ASR |

## 长音频处理

>10 分钟自动切换到 `transcribeLongAudioDirect`：直接调 DashScope 异步 API，支持最长 12 小时。

## 不静默降级契约（响应契约）

- **完整性校验统一走 `assessAsrCoverage`**（文本量 + 时间线覆盖）：HTTP 三模式、direct filetrans、WS fallback 三条通道都过同一套；不达标视为失败继续 fallback，trace 留痕（direct 通道留 `asr-direct-insufficient`）。
- **partial 显式标记**：B 站部分下载放行（<25% 但 ≥60s）或 `VIDEO_IMPORT_ALLOW_PARTIAL_RESULT=true` 采用部分结果时，响应带 `partial: true` + `coverageRatio`（真实覆盖率），trace 留 `bili-partial-download` / `asr-*-partial`。
- **WS fallback 如实标记**：响应 `mode` 为 `ws-fallback`（同 subtitle 路径 `mode: 'subtitle'` 的先例）；PCM 切片带 2s 前导重叠，片缝处按时间戳去重。
- 前端 `useSourceImport.ts` 只区分成功/失败，新增字段向后兼容；微信链路（`wechat-video-enrich-service.ts`）读 `partial`/`coverageRatio` 写 provenance `contentState: 'partial'` + 真实 completeness。
