# server/asr — ASR 代理纯逻辑

> `server.js` 的 WebSocket 协议与文本处理函数。保持 CommonJS + Node 内建测试，使用 `make test-server` 验证。

## 文件索引

| 文件 | 职责 |
|------|------|
| `text-utils.js` | Qwen / 腾讯结果解析、去重、分句与噪声幻觉过滤 |
| `text-utils.test.js` | 文本处理与幻觉过滤回归测试 |
| `qwen-session.js` | 构造 Qwen-ASR Realtime 官方会话合同；课堂上下文走 `corpus.text`，server_vad 结束走 `session.finish` |
| `qwen-session.test.js` | 语种自动识别、上下文与 VAD 协议回归测试 |

## 边界

- 这里只放不依赖 Next / 浏览器的纯函数。
- 协议字段必须以阿里云 Qwen-ASR Realtime 当前官方 API reference 为准；不要发明 `prompt` 等未定义字段。
- `server_vad` 模式禁止发送 `input_audio_buffer.commit`；停止录音必须等 FIFO 排空后发 `session.finish`，并以 `session.finished` 作为尾句完成信号。
- 修改后运行 `make test-server` 与 `make eval-asr`。
