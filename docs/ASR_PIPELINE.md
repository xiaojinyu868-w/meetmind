# ASR Pipeline Domain

> 当前产品合同（2026-08 单遍化）：课中 realtime 低延迟字幕**即定稿**——realtime 质量已够好、
> 课堂≈单说话人，课后不再自动跑完整原声 batch 定稿和说话人分离。
> batch 路由（/api/transcribe*）与 /api/asr/diarize 保留可用，供将来的手动「重新精转」；
> realtime 一句没接住时的兜底批量转写仍然保留（那是唯一的转录来源）。

---

## 整体管道

```
浏览器麦克风 (mono，AEC/NS/AGC 默认开)
  ├→ MediaRecorder 立即保留完整原声（不等 WebSocket）
  ├→ AudioContext 连续相位重采样为 PCM 16kHz（兼容 44.1kHz 手机）
  └→ 有界 FIFO → WebSocket → server.js ASR proxy
       ├→ DashScope Qwen-Audio-3.0-ASR-Flash-Streaming（默认；duplex 任务协议 /api-ws/v1/inference）
       │    按模型族分派：qwen-audio-3.0* / fun-asr* 走新协议，qwen3-asr* 走旧 Omni Realtime 协议
       ├→ server VAD（新协议 max_sentence_silence=1000ms；旧协议 threshold=0.20 / silence=1000ms）
       ├→ 服务端句级/字级时间戳（新协议 begin_time/end_time，优先于客户端 VAD 猜测）
       ├→ 幻觉过滤（过短、不可能语速、低信息附和词）
       ├→ 去重 (shouldDedupSegment, LCS 相似度 + 时间 gap)
       └→ interim/stable/final 三段式课中渲染

结束这节课
  ├→ 新协议发送 finish-task / 旧协议 server_vad 会话发送 session.finish（不是 manual-only commit）
  ├→ 收到 task-finished / session.finished 后交付完整 realtime 尾句 + 原声
  └→ realtime 结果即定稿（2026-08 单遍化），直接发布为标题、摘要与应用输入
       ├→ 不再自动跑 qwen-audio-3.0-asr-flash / filetrans 课后定稿；/api/transcribe* 保留供手动「重新精转」
       ├→ 例外：realtime 一句没接住且原声有效 → 兜底批量转写（唯一转录来源，保留）
       └→ 兜底结果按 recordingId + sessionId 回填，不得覆盖下一节课 UI

文件上传
  ├→ ffmpeg 分片 (10min + 2s overlap)   ← M2 T2.7
  ├→ Parallel submit to async task API
  ├→ p-retry + Full Jitter polling      ← M2 T2.3
  ├→ fetchTranscription per task
  ├→ stitchSegmentsWithOverlap (token LCS 缝合)   ← M2 T2.7
  └→ 返回 {success, sentences, partialFailure}   ← M2 T2.1/T2.4
```

---

## 飞书妙记级"四处杠杆"

### 杠杆 1: 上下文严格走官方协议

`buildASRContextHint` 会产生课程标题、学科、人名和用户术语。Qwen Realtime 的当前官方契约支持 `input_audio_transcription.corpus.text` 上下文偏置：

- 课程上下文只在 `session.update` 时作为 `corpus.text` 发送；旧实现使用未定义的 `prompt` 字段，已移除。
- Qwen Realtime 不支持会话开始后的动态二次 `session.update`，最近识别文本不能伪装成实时动态热词。
- 热词库等更强精度增强仍需 Fun-ASR 等支持模型，并经真实课堂 A/B 后再决策。
- 完整原声定稿优先利用更完整的声学上下文，这是当前稳定有效的准确率杠杆。

`buildASRContextHint` (`src/lib/utils/page/context-and-format.ts`) 会拼接：
- 课程标题 + 学科
- 参与者姓名（参加课程的师生）
- 上节课主题关键词（≤10 个）
- 本节课预期生词（≤30 个）
- 用户个人术语（来自历史纠错沉淀）
- 手动 hint + 参考资料摘要
- 近期已识别上下文（仅供支持该能力的后续模型 / 文本校对使用）

### 杠杆 2: 三段式渲染

`TranscriptRenderMachine` (`src/lib/services/asr/render-state-machine.ts`)：

| 层 | 视觉 | 触发 |
|---|---|---|
| interim | 灰色斜体 | 首次或文本变化 |
| stable  | 黑色正文 | 连续 N 次（默认 3）未变 & 持续 ≥500ms |
| final   | commit  | ASR 给 `isFinal=true` |

用户感知到的是"我说的字越来越稳"，而不是"字一直在跳"。

### 杠杆 3: ITN + LLM 后编辑并联

- **ITN**：Qwen3-ASR-Flash `parameters.enable_itn: true` 默认开启（"二零二六"→"2026"），不自己接 WeTextProcessing 避免双重 ITN
- **LLM 后编辑**：`postEditSegments`（`src/lib/services/asr/post-edit.ts`）对低置信片段调 DeepSeek V4 Flash 做 post-correction（2026-08 起默认开启，按节分批 + 字符上限护栏）；失败静默降级为原文。

### 杠杆 4: 纠错反馈闭环

待 M4.5 落地（需要 DB schema 变更）：
```
用户改字 → POST /api/asr/corrections
       → user_hotwords 表（sessionId, original, corrected）
       → 下次调用时注入到 userHotwords 上下文
       → 高频词周度进入全局热词字典
```

---

## 稳定性工程

### T2.1 失败传播修复
`stitchSegments` / `stitchSegmentsWithOverlap` 保证：
- 分块失败时 offset 按**定义的段边界**累加（不依赖实际输出长度）
- `failedIndices` 显式返回给上层

### T2.2 WebSocket 自动重连
`DashScopeASRClient`：
- `userStopRequested` flag 区分主动停止 vs 意外断开
- `onclose` 意外断开 → `scheduleReconnect` → Full Jitter 退避重连
- `audioQueue` **跨重连保留**，重连成功后 `flushAudioQueue`
- flush 期间的新 PCM 继续进入同一 FIFO，禁止绕过旧缓冲直发；浏览器、Qwen proxy、腾讯 speaker proxy 三层规则一致
- 每次 WebSocket 连接的 segment/item ID 带连接命名空间，避免重连或切换引擎后的 `seg-0` 冲突被误去重
- max 8 次尝试可配（`maxReconnectAttempts`）
- 首次连接也不阻塞录音：PCM 先进队列，MediaRecorder 先收原声，避免弱网开头吞字。

### 录课会话隔离

- 手机端只有在拿到音频流、MediaRecorder 真正启动并创建新 session 后才进入录课页；此时同步清空上节课的 segments / interim / anchors / timeline，不等待 ASR WebSocket。权限拒绝或设备失败留在原页并明确提示，不能出现假的 `00:00` 录课态。
- 每次录课使用独立 sessionId + recordingId。
- 停止后 Recorder 立即可开始下一节课；realtime 结果即定稿（2026-08 单遍化），兜底批量转写在后台 detached 运行时启动时就冻结 sessionId + recordingId。
- realtime 字幕随停录即落为可复习 transcript 并派生课堂标题（课后理解 realtime 完成即触发）。
- 兜底批量转写失败时保留原声并明确落为 failed / 可重试，不让课堂永久卡在 pending。
- 上节课延迟到达的兜底转写只写回它自己的 session，不更新当前编辑器；漏传 sessionId 的结果也拒绝进入当前课堂。
- 课后说话人整理 2026-08 起不再自动触发；`finalPassPending` 两段式定稿机制整体退役（字段保留兼容，见 `recorder-types.ts`）。
- Qwen Realtime 当前工作在 `server_vad` 模式，结束时必须发送官方 `session.finish` 并等待 `session.finished`；`input_audio_buffer.commit` 只属于 manual mode。旧链路把 VAD 会话当 manual 提交，错误又被静默吞掉，实测会让 25 秒干净课堂只剩第一句话（CER 78.57%）。新一代 `qwen-audio-3.0-asr-flash-streaming` 走 duplex 任务协议，对应收尾动作为 `finish-task` / `task-finished`。
- proxy 先排空弱网音频 FIFO 再发 `session.finish` / `finish-task`；浏览器正常等待最终事件，异常网络最多等待 5 秒后释放，realtime 一句没有时完整原声仍由后台兜底批量转写接住。

### 模型族协议分派（2026-08 起）

- 实时：`DASHSCOPE_ASR_WS_MODEL` 以 `qwen-audio-3.0` / `fun-asr` 开头 → duplex 任务协议（`wss://dashscope.aliyuncs.com/api-ws/v1/inference`，`run-task` 后直接发二进制 PCM 帧，结果事件 `result-generated` 带句级/字级时间戳）；`qwen3-asr` 开头 → 旧 Omni Realtime 协议（`/api-ws/v1/realtime?model=`，base64 JSON 帧）。上游地址可用 `DASHSCOPE_ASR_WS_URL` 整体覆盖（如 WorkspaceId 专属域名）。
- 参数映射：`corpus.text` 上下文 → `input.context`（input_text 消息，每条 ≤400 字最多 5 条）；`silence_duration_ms` → `max_sentence_silence`（[200,6000]）；`language` → `language_hints` 数组；`turn_detection.threshold` 新协议无对应参数，忽略。新协议默认开 `heartbeat: true` 防长静音 60s 断连；任务进行中可用 `continue-task` 更新上下文。
- batch / filetrans 同理按族分派：新族 batch 走 multimodal-generation 消息式 `input_audio`（响应文本在 `output.text` / `output.output.sentence.text`），新族 filetrans 用 `input.file_urls` + `language_hints`，查询结果 URL 在 `output.results[0].transcription_url`（旧族在 `output.result.transcription_url`）。

### 说话人产品策略：听准是主链路，分人是课后增强

- Qwen `qwen-audio-3.0-asr-flash-streaming` 是用户主链路唯一默认实时引擎（旧默认 `qwen3-asr-flash-realtime-2026-02-10` 可通过 env 回退）。首页与录课中不再展示“单人 / 多人”技术开关；用户不需要理解供应商差异，也不能为了分人牺牲正文准确率。
- 2026-08：腾讯 `16k_zh_en_speaker` proxy（/api/asr-stream-speaker）与前端 `speakerDiarization` 参数已整体拆除，实验链路关闭。
- 2026-08 单遍化后课后不再自动跑说话人整理；`/api/asr/diarize` 与 `diarization-service.ts` 保留，供将来的手动「重新精转」。届时仍按原证据门槛：至少两位发言者各自累计 ≥1.5s 且 ≥6 个非空白字符、整段有效语音 ≥6s 才应用标签；`speakerId=-1` 与短噪声聚类永远不展示。
- UI 仅显示匿名“发言者 A / B”，不自动把第一位命名为老师，也不猜真实姓名。没有足够证据时保持无标签，比展示错误身份更可信。
- diarization 句子贴回已有转写时按时间区间最大重叠匹配；只有没有重叠时才允许 ≤1.5s 的近邻兜底，禁止用宽松起始时间近邻把整段错标给另一个人。
- 说话人质量用 DER 单独验收：先做匿名 speaker ID 最优映射，再统计 missed speech / false alarm / confusion；不能用正文 CER 代替说话人评测。

### T2.3 Polling 退避
`waitForSingleTask`: `p-retry` + AWS Full Jitter
- base 1000ms / cap 10s / max 120 attempts
- 遇 `AbortError` 立刻停止（timeout / task failed）

### T2.4 友好失败响应
API 返回带 `failedSegmentIndices` 和 `partialFailure`——前端可：
- 局部重试单个失败的分块
- 显示"部分内容转写失败"而不是整体 500

---

## 长音频分片 + 重叠缝合（T2.7）

**分片**（`splitAudio`）：
- `SEGMENT_DURATION_SEC` 默认 600（10min）
- `SEGMENT_OVERLAP_SEC` 默认 2（首段无 overlap）
- seg i: `[i*stride - overlap, (i+1)*stride]`

**缝合**（`stitchSegmentsWithOverlap`）：
1. 每段的 `overlapLeadMs` 内句子直接丢弃（前段负责）
2. 时间轴排序后，相邻句 LCS ≥ 0.95 且时间 gap ≤ 500ms → 视为 overlap 边界残留，去重
3. 结果 `{allSentences, failedIndices, totalDurationMs}`

---

## 评测（eval harness）

```bash
make eval-asr           # dry-run 用 case.hypothesis 字段
make eval-asr-real      # 本地短 fixture 走 batch data URI；公网 URL 走 filetrans；自动读取 .env.local / .env
ASR_EVAL_TRANSPORT=realtime make eval-asr-real  # 经本地 /api/asr-stream 实时回放
```

基线（seed 10 条）：`avg_cer=1.46% / p95=8.33%`。这是 dry-run 回归门，
不代表真实噪声课堂的 CER / 首字延迟；真实结论必须用带原声标注的 clean / noisy / 中英混合集运行 `make eval-asr-real`。

冻结的 25 秒英语课堂同源噪声矩阵（Qwen Realtime 2026-02-10，2026-07-17）。远端模型输出存在小幅波动；CER 为同日重复运行的观测区间，延迟列为其中一次完整实时回放：

| 条件 | CER | first partial | final lag |
|---|---:|---:|---:|
| clean | 3.76% | 1625ms | 247ms |
| pink noise 20dB | 4.14–4.51% | 444ms | 248ms |
| pink noise 10dB | 5.64–6.39% | 1547ms | 238ms |
| pink noise 5dB | 8.27–9.77% | 1552ms | 209ms |
| 平均 | 5.73–5.83% | 1292ms | 236ms |

同日另一轮完整产品 WebSocket 回放的平均 first partial 为 1268ms、平均 final lag 为 233ms；区间用于表达远端服务的自然波动，不把单次结果当成固定承诺。

fixture 与人工 reference 在 `tests/eval/asr/fixtures/`、`datasets/real-noise-demo.jsonl`。这些数字证明当前协议和确定性粉红噪声条件，不外推为所有真实教室。

详见 `tests/eval/asr/README.md`（在 `tests/eval/README.md`）。

---

## 环境变量

| 名称 | 默认 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | — | DashScope（百炼）凭证 |
| `DASHSCOPE_ASR_WS_MODEL` | `qwen-audio-3.0-asr-flash-streaming` | 课中低延迟模型（改回 `qwen3-asr-flash-realtime-*` 即回退旧协议） |
| `DASHSCOPE_ASR_BATCH_MODEL` | `qwen-audio-3.0-asr-flash` | 短音频完整原声定稿模型 |
| `DASHSCOPE_ASR_FILE_MODEL` | `qwen-audio-3.0-asr-flash-filetrans` | 长音频异步定稿模型 |
| `DASHSCOPE_ASR_WS_URL` | 按模型族自动选择 | 实时上游地址整体覆盖（如 `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`） |
| `ASR_SEGMENT_DURATION_SEC` | 600 | 长音频分片 |
| `ASR_SEGMENT_OVERLAP_SEC` | 2 | 相邻段重叠 |
| `ASR_MIN_DURATION_FOR_SPLIT_SEC` | 240 | 低于此时长不分片 |
| `DASHSCOPE_ASR_WS_VAD_SILENCE_MS` | 1000 | realtime 句尾静音时长（新协议映射 `max_sentence_silence`）；比对话多保留 200ms 上下文，interim 首字延迟不受影响 |
| `DASHSCOPE_ASR_WS_VAD_THRESHOLD` | 0.20 | 仅旧协议 server VAD 触发阈值；新协议无对应参数，会被忽略 |
| `NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL` | `true` | 浏览器 AGC |
| `NEXT_PUBLIC_ASR_ECHO_CANCELLATION` | `true` | 浏览器 AEC |
| `NEXT_PUBLIC_ASR_NOISE_SUPPRESSION` | `true` | 浏览器 NS |

---

## 下一步

- [ ] M4.5: 纠错闭环 MVP（T2.9）
- [x] M5: 低置信后编辑（T2.8）— `src/lib/services/asr/post-edit.ts`（2026-08 起默认开，DeepSeek V4 Flash）
- [x] 课中 realtime 单遍即定稿（2026-08 起；课后 batch 定稿退役为手动精转能力）
- [x] 录课开始不等 ASR ready，首段 PCM 有界排队
- [x] 新课同步清屏 + 延迟回填 session 隔离
- [x] 同一英语课堂 clean / 5dB / 10dB / 20dB 粉红噪声确定性回归
- [ ] 扩充真实评测集：中文、中英混合、真实远场、风扇与键盘噪声
- [ ] 在真实数据上 A/B `qwen3-asr-flash-realtime-2026-02-10` / `fun-asr-realtime` / `qwen3.5-omni-plus-realtime`，用 CER + first-partial + final-lag + 噪声误触发率决策
