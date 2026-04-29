# API: Video Import — 视频/音频导入管线

> 从 URL 导入视频/音频 → 下载 → 转码 → ASR 转写。

## 文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `route.ts` | ~1209 | 主路由：管线编排（stage order/cleanup/错误处理/长音频直连） |
| `video-import-types.ts` | — | 共享类型（StageName, PipelineError 等） |
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
