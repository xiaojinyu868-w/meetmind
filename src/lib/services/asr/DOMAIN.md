# lib/services/asr — ASR 飞书妙记级工艺（纯逻辑层）

> 课堂转写的核心算法与约束，全部是纯 TS（无 React / 无 Next 依赖），方便单测与 server/ 镜像复用。完整工艺总图见 `docs/ASR_PIPELINE.md`，AGENTS.md §3.8 有摘要。

## 文件索引

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `text-utils.ts` | ASR 文本后处理工具（TS 版）。是 `server/asr/text-utils.js`（JS/CJS）的语义镜像；真正实现只在这边维护，JS 层只 re-export。用于 CER 对齐、文本去重、归一化比较 | `toChars` / `normalizeForCompare` |
| `render-state-machine.ts` | 三段式转写渲染状态机（M2 T2.6）。把 ASR 流式输出分 interim（灰斜体抖动）/ stable（已稳定未 commit）/ final（commit 锚定时间戳）三层，消除"锁定瞬间跳变"。纯逻辑，React hook 另封装 | `TranscriptSegment` / 状态机 reducer |
| `post-edit.ts` | ASR LLM 后校对（M5 T5.2）。只对低置信片段调 `qwen3.7-plus` 复核（≤10 条/次），高置信纠正才接受，失败静默降级。feature flag `ASR_POST_EDIT_ENABLED` 默认关。Prompt 固定版本 `PROMPT_VERSIONS.asrPostEdit` | `postEditSegments` / `PostEditSegment` |
| `audio-constraints.ts` | 浏览器音频采集约束（M5 T2.11/T5.6）。AEC on / NS on / AGC 可配，中心化供 Recorder 与 OmniRealtimeCall 复用，是 `getUserMedia` 约束的**唯一真相源**，env 可覆盖。不引入 vad-web（服务端已有 VAD） | `AudioConstraintOptions` / `buildAudioConstraints` |
| `ws-url.ts` | ASR WebSocket URL 候选构建。根据页面协议推导 `ws/wss`，主路径 `/api/asr-stream`，wss 时追加 `:8443` 直连候选 | `buildAsrWebSocketCandidates` |

每个源文件都有同名 `.test.ts`（`make test` 覆盖）；ASR 评测走 `make eval-asr`。

## 边界与外部依赖

本目录只放**纯逻辑**。以下 ASR 能力不在本目录：

- **长音频分片缝合**（600s 分片 + 2s overlap + LCS 缝合 `stitchSegmentsWithOverlap` / `findOverlapLength`）在 `server/` 与 `src/lib/longcut/`。
- **Contextual biasing**（`buildASRContextHint` 注入 courseTitle / subject / participants / 词汇等 6 字段）在 `src/lib/services/` 相关 service。
- **WebSocket 稳定性**（`reconnecting-websocket` + `p-retry` Full Jitter 退避 + audioQueue 跨重连保留）在消费端 hook。
- **热词聚合**（`AsrCorrection` 表 + `onRecordingStop` 触发 `/api/asr/corrections/aggregate`）走 Prisma + `/api/asr-config/`。

## 修改注意

- 改 `text-utils.ts` 时**必须同步** `server/asr/text-utils.js`（两者语义必须一致，JS 层是 re-export wrapper）。
- 改本目录前后**必跑** `make eval-asr`（dry-run）或 `make eval-asr-real`（真实调用），数字波动 = 回归信号。
- `post-edit.ts` 默认关闭，开启需确认 `ASR_POST_EDIT_ENABLED` 与成本影响。
