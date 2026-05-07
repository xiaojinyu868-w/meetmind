# ASR Pipeline Domain

> M2 交付的 ASR 飞书妙记级工艺总图。
> 判断依据：飞书妙记强不在模型、而在**工程管道的四处杠杆**。

---

## 整体管道

```
浏览器麦克风 (PCM 16kHz mono)
  ├→ WebRTC AudioContext (AGC=on, NS=on, AEC=off)
  ├→ [可选] Silero VAD (浏览器 wasm)   ← TODO M4+
  └→ WebSocket → server.js ASR proxy
       ├→ DashScope Qwen3-ASR-Flash realtime
       ├→ Contextual biasing (课程 + 名单 + 历史纠错)
       ├→ 幻觉过滤 (isLikelyHallucination, VAD 能量门控)
       ├→ 去重 (shouldDedupSegment, LCS 相似度 + 时间 gap)
       └→ 三段式渲染状态机 (interim/stable/final)   ← M2 T2.6

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

### 杠杆 1: Contextual biasing

Qwen3-ASR-Flash 的 `parameters.context` 允许注入任意文本（up to 10k tokens）影响识别。飞书妙记把**每个会议的元数据都注入**——我们跟进：

`buildASRContextHint` (`src/lib/utils/page/context-and-format.ts`) 会拼接：
- 课程标题 + 学科
- 参与者姓名（参加课程的师生）
- 上节课主题关键词（≤10 个）
- 本节课预期生词（≤30 个）
- 用户个人术语（来自历史纠错沉淀）
- 手动 hint + 参考资料摘要
- 近 30 段已识别上下文

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
- **LLM 后编辑**：待 M5 接入 Qwen-Max 对低置信片段做 post-correction

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
- max 5 次尝试可配（`maxReconnectAttempts`）

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
make eval-asr-real      # 真实调 Qwen3-ASR-Flash async（需 DASHSCOPE_API_KEY + audio URL）
```

基线（seed 10 条）：`avg_cer=1.46% / p95=8.33%`

详见 `tests/eval/asr/README.md`（在 `tests/eval/README.md`）。

---

## 环境变量

| 名称 | 默认 | 说明 |
|---|---|---|
| `DASHSCOPE_API_KEY` | — | Qwen3-ASR-Flash 凭证 |
| `ASR_MODEL` | `qwen3-asr-flash-filetrans` | async 模式模型 |
| `ASR_SEGMENT_DURATION_SEC` | 600 | 长音频分片 |
| `ASR_SEGMENT_OVERLAP_SEC` | 2 | 相邻段重叠 |
| `ASR_MIN_DURATION_FOR_SPLIT_SEC` | 240 | 低于此时长不分片 |
| `NEXT_PUBLIC_ASR_AUTO_GAIN_CONTROL` | `true` | 浏览器 AGC |
| `NEXT_PUBLIC_ASR_ECHO_CANCELLATION` | `false` | 浏览器 AEC（课堂场景关） |
| `NEXT_PUBLIC_ASR_NOISE_SUPPRESSION` | `true` | 浏览器 NS |

---

## 下一步

- [ ] M4.5: 纠错闭环 MVP（T2.9）
- [ ] M5: Qwen-Max 低置信后编辑（T2.8）
- [ ] M5+: 浏览器 VAD（`@ricky0123/vad-web`）减少静音段
- [ ] M6: 说话人分离（火山引擎流式双声道 MVP）
- [ ] M6+: 扩 harness dataset（AISHELL-1 + CosyVoice 合成课堂 + MUSAN 混噪）
