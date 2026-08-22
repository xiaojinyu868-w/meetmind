# server/asr — ASR 代理纯逻辑

> `server.js` 的 WebSocket 协议与文本处理函数。保持 CommonJS + Node 内建测试，使用 `make test-server` 验证。
>
> 2026-08：server.js 只保留 `/api/asr-stream` 一条 WS 代理；腾讯云 `/api/asr-stream-speaker`
> 实验链路与 `/api/tutor-call` 实时语音通话代理已整体拆除。

## 文件索引

| 文件 | 职责 |
|------|------|
| `text-utils.js` | Qwen 结果解析、去重、分句与噪声幻觉过滤（腾讯 speaker 链路 2026-08 已拆除） |
| `text-utils.test.js` | 文本处理与幻觉过滤回归测试 |
| `qwen-session.js` | 旧族 Qwen3-ASR Realtime（Omni Realtime 协议）会话合同；课堂上下文走 `corpus.text`，server_vad 结束走 `session.finish` |
| `qwen-session.test.js` | 旧族语种自动识别、上下文与 VAD 协议回归测试 |
| `duplex-session.js` | 新族 Qwen-Audio-3.0-ASR / Fun-ASR 的 duplex 任务协议：模型族分派、上游 URL 解析、run-task / continue-task / finish-task 构造、result-generated 解析 |
| `duplex-session.test.js` | 新族协议构造与解析、按族分派回归测试 |

## 协议分派（按模型族）

- 模型名以 `qwen-audio-3.0` / `fun-asr` 开头 → **duplex 任务协议**：上游 `wss://dashscope.aliyuncs.com/api-ws/v1/inference`（可用 `DASHSCOPE_ASR_WS_URL` 整体覆盖），鉴权 `Authorization: bearer <key>`；连接后发 `run-task`，`task-started` 后直接发**二进制 PCM 帧**；结果事件 `result-generated`（`payload.output.sentence`：text / begin_time / end_time / sentence_end / words）；结束发 `finish-task`，收尾 `task-finished`，失败 `task-failed`（`header.error_message`）。
- 模型名以 `qwen3-asr` 开头 → **旧 Omni Realtime 协议**：`/api-ws/v1/realtime?model=`，base64 JSON 帧 + `session.update` / `session.finish`。
- 参数映射（旧 → 新）：`input_audio_transcription.corpus.text` → `input.context`（input_text 消息，每条 ≤400 字、最多 5 条）；`turn_detection.silence_duration_ms` → `parameters.max_sentence_silence`（[200,6000]，默认 1300）；`language` → `parameters.language_hints`（数组，auto 省略）；`turn_detection.threshold` 无对应参数，不映射。新协议固定开 `heartbeat: true`（防连续静音 60s 被断连），任务进行中可用 `continue-task` 更新上下文。
- 新协议定稿时间戳优先用服务端 `begin_time` / `end_time`，缺失才回退客户端 VAD 猜测（`resolveTimestamp`）。

## 边界

- 这里只放不依赖 Next / 浏览器的纯函数。
- 协议字段必须以阿里云官方 API reference 为准（[实时用户指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide) / [duplex 客户端事件](https://help.aliyun.com/en/model-studio/fun-asr-client-events)）；不要发明 `prompt` 等未定义字段。
- `server_vad` 模式禁止发送 `input_audio_buffer.commit`；停止录音必须等 FIFO 排空后发 `session.finish`（旧族）或 `finish-task`（新族），并以 `session.finished` / `task-finished` 作为尾句完成信号。
- 修改后运行 `make test-server` 与 `make eval-asr`。
