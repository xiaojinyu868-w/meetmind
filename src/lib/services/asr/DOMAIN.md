# lib/services/asr — ASR 飞书妙记级工艺（纯逻辑层）

> 课堂转写的核心算法与约束，全部是纯 TS（无 React / 无 Next 依赖），方便单测与 server/ 镜像复用。完整工艺总图见 `docs/ASR_PIPELINE.md`，AGENTS.md §3.8 有摘要。

## 文件索引

| 文件 | 职责 | 关键导出 |
|------|------|---------|
| `text-utils.ts` | 客户端与评测侧的 ASR 文本纯工具，用于 CER 对齐、文本去重、归一化比较。服务端代理另有协议解析、去重与噪声幻觉过滤工具，不是本文件的 re-export | `toChars` / `normalizeForCompare` |
| `render-state-machine.ts` | 三段式转写渲染状态机（M2 T2.6）。把 ASR 流式输出分 interim（灰斜体抖动）/ stable（已稳定未 commit）/ final（commit 锚定时间戳）三层，消除"锁定瞬间跳变"。纯逻辑，React hook 另封装 | `TranscriptSegment` / 状态机 reducer |
| `post-edit.ts` | ASR LLM 后校对（M5 T5.2）。只对低置信片段调 `qwen3.7-plus` 复核（≤10 条/次），高置信纠正才接受，失败静默降级。feature flag `ASR_POST_EDIT_ENABLED` 默认关。Prompt 固定版本 `PROMPT_VERSIONS.asrPostEdit` | `postEditSegments` / `PostEditSegment` |
| `audio-constraints.ts` | 浏览器音频采集约束（M5 T2.11/T5.6）。AEC on / NS on / AGC 可配，中心化供 Recorder 与 OmniRealtimeCall 复用，是 `getUserMedia` 约束的**唯一真相源**，env 可覆盖。不引入 vad-web（服务端已有 VAD） | `AudioConstraintOptions` / `buildAudioConstraints` |
| `ws-url.ts` | ASR WebSocket URL 候选构建。根据页面协议推导 `ws/wss`，主路径 `/api/asr-stream`，wss 时追加 `:8443` 直连候选 | `buildAsrWebSocketCandidates` |
| `session-isolation.ts` | 异步定稿的课堂隔离判定。旧课结果可以回写自己的持久化数据，但只有显式 sessionId 与当前课堂严格一致时才能覆盖 editor/ref；缺失标识也拒绝 | `shouldApplyTranscriptToActiveSession` |
| `diarization-service.ts` | 课后说话人整理。两段式 ASR 必须先完成完整原声 batch 定稿并落盘，再基于定稿 segments 补标签；已有实时 speakerId 时跳过；过滤 `-1`，且至少两位发言者各自满足时长 / 文本证据、整段语音足够长才展示匿名标签 | `runDiarizationForSession` / `shouldRunPostBatchDiarization` / `assessDiarizationEvidence` |

每个源文件都有同名 `.test.ts`（`make test` 覆盖）；ASR 评测走 `make eval-asr`。

## 边界与外部依赖

本目录只放**纯逻辑**。以下 ASR 能力不在本目录：

- **长音频分片缝合**（600s 分片 + 2s overlap + LCS 缝合 `stitchSegmentsWithOverlap` / `findOverlapLength`）在 `server/` 与 `src/lib/longcut/`。
- **Contextual biasing**（`buildASRContextHint` 注入 courseTitle / subject / participants / 词汇等 6 字段）在 `src/lib/services/` 相关 service。
- **WebSocket 稳定性**（`reconnecting-websocket` + `p-retry` Full Jitter 退避 + audioQueue 跨重连保留）在消费端 hook。
- `DashScopeASRClient` 对待发送 PCM 强制 FIFO，且为远端 segment/item ID 添加连接命名空间，防止 Qwen/腾讯切换或重连时发生 ID 碰撞。
- 用户主链路不暴露实时 speaker engine 切换。腾讯 `/api/asr-stream-speaker` 仅为内部实验兼容；课后是否展示“发言者 A / B”由 `assessDiarizationEvidence` 决定，短噪声形成的伪第二人必须隐藏。
- **热词聚合**（`AsrCorrection` 表 + `onRecordingStop` 触发 `/api/asr/corrections/aggregate`）走 Prisma + `/api/asr-config/`。

## 修改注意

- `server/asr/text-utils.js` 还承担代理协议解析和短噪声幻觉过滤；只有两边共有的归一化 / 去重算法需要保持行为一致，不能把它当作 TS 文件的 re-export。
- 改本目录前后**必跑** `make eval-asr`（dry-run）或 `make eval-asr-real`（真实调用），数字波动 = 回归信号。
- `post-edit.ts` 默认关闭，开启需确认 `ASR_POST_EDIT_ENABLED` 与成本影响。
