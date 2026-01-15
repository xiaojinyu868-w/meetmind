# MeetMind API 接口文档

> 详细的 API 路由说明和核心组件列表

---

## API 路由

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/chat` | POST | 通用 AI 对话，支持多模型、流式响应 |
| `/api/chat` | GET | 获取可用模型列表 |
| `/api/tutor` | POST | AI 家教解释困惑点，支持引导问题、联网搜索 |
| `/api/transcribe` | POST | 语音转录（同步/异步模式） |
| `/api/transcribe/status` | GET | 查询异步转录任务状态 |
| `/api/asr-config` | GET | 获取 ASR 配置信息 |
| `/api/upload-audio` | POST | 上传音频文件 |
| `/api/generate-summary` | POST | 生成课堂总结 |
| `/api/generate-topics` | POST | 生成主题标签 |
| `WS /api/asr-stream` | WebSocket | 实时语音识别代理 |

---

## 核心组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `Recorder` | `src/components/Recorder.tsx` | 核心录音组件，支持实时/批处理转录、困惑点标记 |
| `AITutor` | `src/components/AITutor.tsx` | AI 家教对话，解释困惑点、生成行动清单 |
| `AIChat` | `src/components/AIChat.tsx` | 自由 AI 对话组件 |
| `TimelineView` | `src/components/TimelineView.tsx` | 课堂时间轴，显示转录和困惑点 |
| `WaveformPlayer` | `src/components/WaveformPlayer.tsx` | 音频波形播放器，支持锚点跳转 |
| `ActionList` | `src/components/ActionList.tsx` | 行动清单，显示待完成任务 |
| `ConfusionHeatmap` | `src/components/ConfusionHeatmap.tsx` | 困惑热区可视化 |
| `TeacherDashboard` | `src/components/teacher/TeacherDashboard.tsx` | 教师端仪表盘主组件 |
| `ConfusionHotspotCard` | `src/components/teacher/ConfusionHotspotCard.tsx` | 困惑热点 TOP3 卡片 |
| `ReflectionGenerator` | `src/components/teacher/ReflectionGenerator.tsx` | AI 流式生成课后反思 |

---

## API 详细说明

### POST /api/chat

通用 AI 对话接口，支持多模型切换和流式响应。

**请求参数**：
```json
{
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "model": "qwen3-max",
  "stream": true
}
```

**响应**：流式 SSE 或 JSON

---

### POST /api/tutor

AI 家教核心接口，解释困惑点并生成行动清单。

**请求参数**：
```json
{
  "timestamp": 125000,
  "segments": [
    { "text": "...", "startMs": 120000, "endMs": 130000 }
  ],
  "model": "qwen3-max",
  "enable_guidance": true,
  "enable_web": false,
  "subject": "英语"
}
```

**响应结构**：
```markdown
## 老师是这样讲的
[02:05-02:15] "Australia is often called..."

## 帮我定位你的困惑
A. 不理解为什么名字会重复说两遍
B. 分不清昵称和全名的区别
C. 听不清具体发音
D. 不理解文化背景或语法结构

## 今晚行动清单（20分钟）
1. ✅ [回放] 再听一遍 02:05-02:15
2. ✅ [练习] 跟读句子，注意发音
3. ✅ [复习] 总结澳大利亚别称的知识点
```

---

### POST /api/transcribe

语音转录接口，支持同步和异步模式。

**请求参数**：
- `file`: 音频文件（WebM/WAV）
- `mode`: `sync` | `async`

**同步响应**：
```json
{
  "segments": [
    { "id": "1", "text": "...", "startMs": 0, "endMs": 5000 }
  ]
}
```

**异步响应**：
```json
{
  "taskId": "xxx",
  "status": "processing"
}
```

---

### GET /api/transcribe/status

查询异步转录任务状态。

**请求参数**：
- `taskId`: 任务 ID

**响应**：
```json
{
  "status": "completed",
  "segments": [...]
}
```

---

### WS /api/asr-stream

实时语音识别 WebSocket 代理。

**连接**：`ws://localhost:3001/api/asr-stream`

**客户端发送**：PCM Int16 二进制数据（16kHz, mono）

**服务端事件**：
```json
{ "event": "ready" }
{ "event": "result", "sentence": { "text": "...", "beginTime": 1000, "endTime": 2000 } }
{ "event": "interim", "text": "..." }
{ "event": "error", "error": "..." }
{ "event": "closed", "code": 1000 }
```

---

### POST /api/generate-summary

生成课堂摘要。

**请求参数**：
```json
{
  "sessionId": "xxx",
  "segments": [...]
}
```

**响应**：
```json
{
  "overview": "本节课主要讲解了...",
  "takeaways": ["知识点1", "知识点2", "知识点3"]
}
```

---

### POST /api/generate-topics

生成精选片段/主题标签。

**请求参数**：
```json
{
  "sessionId": "xxx",
  "segments": [...]
}
```

**响应**：
```json
{
  "topics": [
    { "title": "澳大利亚的别称", "segments": [...] }
  ]
}
```

---

*文档版本：v1.0*  
*从 README.md 拆分*
