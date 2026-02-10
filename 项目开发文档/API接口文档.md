# MeetMind API 接口文档

> 详细的 API 路由说明和核心组件列表

---

## API 路由

### 核心功能 API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/chat` | POST | 通用 AI 对话，支持多模型、流式响应 |
| `/api/chat` | GET | 获取可用模型列表 |
| `/api/tutor` | POST | AI 家教解释困惑点，支持引导问题、联网搜索 |
| `/api/feedback` | POST | 提交用户反馈 |

### 语音转录 API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/transcribe` | POST | 离线语音转录（阿里云异步 ASR） |
| `/api/transcribe/status` | GET | 查询异步转录任务状态 |
| `/api/transcribe-fast` | POST | 快速转录 API |
| `/api/transcribe-turbo` | POST | Turbo 转录 API（高速模式） |
| `/api/transcript-enhance` | POST | 转录文本增强优化（AI 智能纠错、分段） |
| `/api/asr-config` | GET | 获取 ASR 配置信息 |
| `/api/upload-audio` | POST | 上传音频文件 |
| `WS /api/asr-stream` | WebSocket | 实时语音识别代理 |

### 内容生成 API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/generate-summary` | POST | 生成课堂总结 |
| `/api/generate-topics` | POST | 生成主题标签/精选片段 |

### 认证 API（12个接口）

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/auth/login` | POST | 用户登录 |
| `/api/auth/register` | POST | 用户注册 |
| `/api/auth/refresh` | POST | 刷新令牌 |
| `/api/auth/logout` | POST | 用户登出 |
| `/api/auth/send-code` | POST | 发送验证码（邮箱/短信） |
| `/api/auth/verify-code` | POST | 验证码校验 |
| `/api/auth/reset-password` | POST | 重置密码 |
| `/api/auth/profile` | GET | 获取用户资料 |
| `/api/auth/profile` | PUT | 更新用户资料 |
| `/api/auth/wechat/login` | POST | 微信登录 |
| `/api/auth/wechat/callback` | GET | 微信回调 |
| `/api/auth/check` | GET | 检查登录状态 |

### 数据分析 API

| 路由 | 方法 | 功能 |
|------|------|------|
| `/api/analytics` | POST | 数据分析上报 |
| `/api/analytics/stats` | GET | 统计数据查询 |

---

## 核心组件

| 组件 | 文件 | 功能 |
|------|------|------|
| `Recorder` | `src/components/Recorder.tsx` | 核心录音组件，支持实时/批处理转录、困惑点标记 |
| `AITutor` | `src/components/AITutor.tsx` | AI 家教对话，解释困惑点、生成行动清单 |
| `AIChat` | `src/components/AIChat.tsx` | AI 对话组件（SSE 流式输出、思维引导、停止生成） |
| `TimelineView` | `src/components/TimelineView.tsx` | 课堂时间轴，显示转录和困惑点，支持选词解释 |
| `WaveformPlayer` | `src/components/WaveformPlayer.tsx` | 音频波形播放器，支持锚点跳转 |
| `ActionList` | `src/components/ActionList.tsx` | 行动清单，显示待完成任务 |
| `ConfusionHeatmap` | `src/components/ConfusionHeatmap.tsx` | 困惑热区可视化 |
| `OnboardingGuide` | `src/components/OnboardingGuide.tsx` | 新用户引导组件，支持交互式引导 |
| `AnalyticsProvider` | `src/components/AnalyticsProvider.tsx` | 数据分析上下文提供者 |
| `TranscriptPreviewPanel` | `src/components/TranscriptPreviewPanel.tsx` | 转录预览面板，支持编辑、增强、选词解释 |
| `ThinkingVisualizer` | `src/components/ThinkingVisualizer.tsx` | AI 思维过程可视化组件 |
| `ThinkingGuideRenderer` | `src/components/ThinkingGuideRenderer.tsx` | 思维引导渲染器 |
| `ConversationHistory` | `src/components/ConversationHistory/` | 对话历史组件（v2.1 新增） |
| `SessionHistoryList` | `src/components/SessionHistoryList.tsx` | 会话历史列表 |
| `AppLoading` | `src/components/AppLoading.tsx` | 应用加载状态 |
| `ServiceStatus` | `src/components/ServiceStatus.tsx` | 服务状态显示 |
| `ImageUpload` | `src/components/ImageUpload.tsx` | 图片上传组件（支持粘贴） |
| `WordExplainer` | `src/components/WordExplainer.tsx` | 选词解释浮窗（拖拽/缩放/语音/图片/追问，v2.7 新增） |
| `VoiceMicButton` | `src/components/VoiceMicButton.tsx` | 语音输入按钮 |
| `GuidanceQuestion` | `src/components/GuidanceQuestion.tsx` | 引导问题组件 |
| `Citations` | `src/components/Citations.tsx` | 引用/来源展示 |
| `StreamingMarkdown` | `src/components/StreamingMarkdown.tsx` | 流式 Markdown 渲染 |
| `TeacherDashboard` | `src/components/teacher/TeacherDashboard.tsx` | 教师端仪表盘主组件 |
| `ConfusionHotspotCard` | `src/components/teacher/ConfusionHotspotCard.tsx` | 困惑热点 TOP3 卡片 |
| `ReflectionGenerator` | `src/components/teacher/ReflectionGenerator.tsx` | AI 流式生成课后反思 |
| `MobileAIFab` | `src/components/mobile/MobileAIFab.tsx` | 移动端 AI 悬浮按钮 |
| `MobileRecorder` | `src/components/mobile/MobileRecorder.tsx` | 移动端录音器 |
| `MobileAITutor` | `src/components/mobile/MobileAITutor.tsx` | 移动端 AI 家教 |
| `MiniPlayer` | `src/components/mobile/MiniPlayer.tsx` | 迷你播放器 |
| `MobileLayout` | `src/components/mobile/MobileLayout.tsx` | 移动端布局容器 |
| `MobileTimeline` | `src/components/mobile/MobileTimeline.tsx` | 移动端时间轴 |
| `BottomPanel` | `src/components/mobile/BottomPanel.tsx` | 底部面板 |
| `ConfusionCard` | `src/components/mobile/ConfusionCard.tsx` | 困惑点卡片 |
| `MenuDrawer` | `src/components/mobile/MenuDrawer.tsx` | 菜单抽屉 |
| `ResizablePanel` | `src/components/layout/ResizablePanel.tsx` | 可调整大小面板 |
| `ResponsiveLayout` | `src/components/layout/ResponsiveLayout.tsx` | 响应式布局 |

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

## 数据分析 API（v2.0 新增）

### POST /api/analytics

数据上报接口，用于收集用户行为数据。

**请求参数**：
```json
{
  "action": "session_start | session_update | session_end | page_view | event | batch",
  "sessionToken": "1706947200000-abc123def",
  "userId": "user_id (可选)",
  "data": {
    // 根据 action 类型提供不同字段
  }
}
```

**action 类型说明**：

| action | 说明 | data 字段 |
|--------|------|-----------|
| `session_start` | 会话开始 | `entryPage`, `isNewUser` |
| `session_update` | 心跳上报 | `durationMs`, `exitPage` |
| `session_end` | 会话结束 | `durationMs`, `exitPage` |
| `page_view` | 页面访问 | `path`, `referrer`, `pageDuration` |
| `event` | 事件追踪 | `eventName`, `eventCategory`, `eventData` |
| `batch` | 批量事件 | `events[]`, `durationMs`, `exitPage` |

**示例 - 会话开始**：
```json
{
  "action": "session_start",
  "sessionToken": "1706947200000-abc123",
  "data": {
    "entryPage": "/",
    "isNewUser": true
  }
}
```

**示例 - 事件追踪**：
```json
{
  "action": "event",
  "sessionToken": "1706947200000-abc123",
  "data": {
    "eventName": "recording_start",
    "eventCategory": "recording",
    "eventData": {
      "subject": "英语",
      "duration": 0
    }
  }
}
```

**响应**：
```json
{
  "success": true,
  "data": { /* 创建/更新的记录 */ }
}
```

---

### GET /api/analytics/stats

统计数据查询接口，需要管理员或教师角色认证。

**请求头**：
```
Authorization: Bearer <token>
```

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `type` | string | 查询类型：`overview` / `trend` / `ip` |
| `days` | number | 趋势天数（仅 `type=trend` 时有效，默认 30） |

**示例请求**：
```bash
# 综合概览
GET /api/analytics/stats?type=overview

# 每日趋势（最近 30 天）
GET /api/analytics/stats?type=trend&days=30

# IP 分布
GET /api/analytics/stats?type=ip
```

**响应 - 综合概览**：
```json
{
  "success": true,
  "data": {
    "totalUsers": 100,
    "newUsersToday": 5,
    "newUsersThisWeek": 20,
    "newUsersThisMonth": 50,
    "dauToday": 30,
    "dauYesterday": 25,
    "wau": 60,
    "mau": 80,
    "avgSessionDuration": 300,
    "totalSessionDuration": 90000,
    "totalSessions": 300,
    "sessionsToday": 45,
    "topPages": [
      { "path": "/", "views": 500 },
      { "path": "/parent", "views": 200 }
    ],
    "topEvents": [
      { "eventName": "recording_start", "count": 150 },
      { "eventName": "anchor_mark", "count": 80 }
    ]
  }
}
```

**响应 - 每日趋势**：
```json
{
  "success": true,
  "data": [
    {
      "date": "2026-02-01",
      "sessions": 45,
      "activeUsers": 30,
      "newUsers": 5,
      "avgDuration": 300
    },
    {
      "date": "2026-02-02",
      "sessions": 50,
      "activeUsers": 35,
      "newUsers": 3,
      "avgDuration": 280
    }
  ]
}
```

**响应 - IP 分布**：
```json
{
  "success": true,
  "data": [
    { "ip": "223.104.xxx.xxx", "count": 50 },
    { "ip": "116.179.xxx.xxx", "count": 30 }
  ]
}
```

---

*文档版本：v1.5*  
*更新日期：2026-02-10*  
*更新内容：新增 WordExplainer、VoiceMicButton 组件；更新 AIChat、TimelineView、TranscriptPreviewPanel 描述*
